import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { ProjectStore } from '../core/store.mjs';
import { Id, ProjectId, Rate, ShotSchema } from '../core/model.mjs';
import { check, copy, hash } from '../core/util.mjs';
import { prepareAsset, scopedFile, AUDIO_LIMIT, PICTURE_LIMIT } from '../core/media.mjs';
import { adaptStoryGraph, adaptStorytellr } from '../core/adapters.mjs';
import { reconform } from '../core/reconform.mjs';
import { Renderer } from './renderer.mjs';
const N = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Base = { projectId: ProjectId, expectedRevision: N, requestId: Id };
export const ImportSchema = z.strictObject({
  ...Base,
  kind: z.enum(['audio', 'picture']),
  name: z.string().min(1).max(250),
  frameRate: Rate.optional(),
  cutId: Id.default('cut-v001'),
  sourceInFrame: N.default(0),
  timelineStartSample: N.default(0),
});
export const PreviewPlanSchema = z.strictObject({
  projectId: ProjectId,
  expectedRevision: N,
  pictureId: Id,
  shots: z.array(ShotSchema).min(1).max(5000),
});
export const ApplyPlanSchema = z.strictObject({
  ...Base,
  planId: z.string().regex(/^plan-[a-f0-9]{32}$/),
  resolutions: z.record(
    z.string().max(200),
    z.enum([
      'park',
      'keep-absolute',
      'extend-to-picture',
      'trim',
      'follow-with-tail',
      'follow-shots',
    ]),
  ),
});
export const AuditionPlanSchema = z.strictObject({
  projectId: ProjectId,
  expectedRevision: N,
  planId: z.string().regex(/^plan-[a-f0-9]{32}$/),
  resolutions: ApplyPlanSchema.shape.resolutions,
});
export const RestoreSchema = z.strictObject({ ...Base, revision: N });
const parse = (schema, raw) => {
  const result = schema.safeParse(raw);
  check(result.success, 'VALIDATION_ERROR', 'Invalid request.', {
    issues: result.success
      ? []
      : result.error.issues
          .slice(0, 8)
          .map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
  return result.data;
};
export class SoundrService {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.store = new ProjectStore(this.root, options);
    this.renderer = new Renderer(this.root);
    this.plans = new Map();
  }
  async init() {
    await this.store.init();
    for (const project of await this.store.list()) {
      if (project.error) continue;
      const record = await this.store.readRecord(project.id);
      for (const jobId of record.jobs) this.renderer.enqueue(jobId);
    }
    return this;
  }
  async create(raw) {
    const input = parse(
      z.strictObject({ title: z.string().min(1).max(250), frameRate: Rate, requestId: Id }),
      raw,
    );
    return this.store.locked('create', () =>
      this.store.create(input.title, input.frameRate, input.requestId),
    );
  }
  async importAsset(raw, bytes) {
    const input = parse(ImportSchema, raw);
    const inspected = await this.store.inspect(input.projectId);
    const prepared = await prepareAsset(this.root, bytes, {
      ...input,
      frameRate: input.frameRate || inspected.project.frameRate,
    });
    return this.store.transact(
      input,
      async (record) => {
        const list = prepared.kind === 'audio' ? record.project.sources : record.project.pictures;
        if (!list.some((x) => x.id === prepared.asset.id)) list.push(prepared.asset);
        return {
          changedIds: [prepared.asset.id],
          detail: {
            assetId: prepared.asset.id,
            kind: prepared.kind,
            sha256: prepared.asset.assetHash,
          },
        };
      },
      {
        label: 'Import ' + input.kind,
        fingerprintPayload: { ...input, assetHash: prepared.asset.assetHash },
      },
    );
  }
  async importFile(raw) {
    const { relativePath, ...input } = parse(
      z.strictObject({ ...ImportSchema.shape, relativePath: z.string().min(1).max(1024) }),
      raw,
    );
    const file = await scopedFile(path.join(this.root, 'imports'), relativePath);
    check(
      (await fs.stat(file)).size <= (input.kind === 'audio' ? AUDIO_LIMIT : PICTURE_LIMIT),
      'RESOURCE_LIMIT',
      'Import exceeds the M1 size limit.',
    );
    return this.importAsset(input, await fs.readFile(file));
  }
  async importStory(raw) {
    const input = parse(
      z.strictObject({
        ...Base,
        format: z.enum(['screenwritr', 'storytellr']),
        data: z.unknown(),
        frameRate: Rate.optional(),
        sceneMap: z.record(z.string(), Id).default({}),
        revision: z.string().max(160).default('snapshot'),
      }),
      raw,
    );
    const current = (await this.store.inspect(input.projectId)).project;
    let next = copy(current.story),
      storyProjectId = current.storyProjectId,
      warnings = [];
    if (input.format === 'screenwritr') {
      const adapted = adaptStoryGraph(input.data);
      storyProjectId = adapted.storyProjectId;
      next = { ...adapted.story, shots: current.story.shots };
      warnings = adapted.warnings;
    } else {
      const adapted = adaptStorytellr(input.data, input);
      const existing = new Map(next.scenes.map((s) => [s.id, s]));
      for (const scene of adapted.scenes) if (!existing.has(scene.id)) next.scenes.push(scene);
      next.shots = adapted.shots;
      next.imports.push(adapted.importRecord);
      warnings = adapted.warnings;
    }
    const result = await this.store.execute({
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
      commands: [{ type: 'story.set', storyProjectId, story: next }],
    });
    return { ...result, warnings: [...result.warnings, ...warnings] };
  }
  async preview(raw) {
    const input = parse(PreviewPlanSchema, raw),
      p = (await this.store.inspect(input.projectId)).project;
    check(
      p.revision === input.expectedRevision,
      'REVISION_CONFLICT',
      'Inspect the current project before planning.',
      { currentRevision: p.revision },
    );
    const plan = reconform(p, input),
      planId = 'plan-' + hash({ projectId: p.id, baseHash: plan.baseHash, input }).slice(0, 32);
    this.plans.set(planId, { input, baseHash: plan.baseHash });
    if (this.plans.size > 100) this.plans.delete(this.plans.keys().next().value);
    const { afterProject, ...publicPlan } = plan;
    return { ok: true, planId, ...publicPlan };
  }
  async applyPlan(raw) {
    const input = parse(ApplyPlanSchema, raw);
    return this.store.transact(
      input,
      async (record) => {
        const saved = this.plans.get(input.planId);
        check(
          saved &&
            saved.input.projectId === input.projectId &&
            saved.baseHash === hash(record.project),
          'PLAN_STALE',
          'The reviewed plan expired or the project changed. Preview again.',
        );
        const result = reconform(record.project, saved.input, input.resolutions);
        check(
          result.unresolved === 0,
          'UNRESOLVED_CONFLICTS',
          'Resolve every flagged picture change before applying.',
          { unresolved: result.unresolved },
        );
        record.project = result.afterProject;
        return {
          changedIds: [result.newPictureId, ...result.changes.map((c) => c.id)],
          detail: { planId: input.planId, changes: result.changes, resolutions: input.resolutions },
        };
      },
      { label: 'Apply reviewed picture change', fingerprintPayload: input },
    );
  }
  async audition(raw) {
    const input = parse(AuditionPlanSchema, raw),
      p = (await this.store.inspect(input.projectId)).project,
      saved = this.plans.get(input.planId);
    check(
      p.revision === input.expectedRevision &&
        saved &&
        saved.input.projectId === input.projectId &&
        saved.baseHash === hash(p),
      'PLAN_STALE',
      'Preview the current cut again.',
    );
    const result = reconform(p, saved.input, input.resolutions);
    check(
      result.unresolved === 0,
      'UNRESOLVED_CONFLICTS',
      'Choose a resolution for every conflict before auditioning.',
    );
    const preview = await this.renderer.preview(result.afterProject);
    return {
      ok: true,
      revision: p.revision,
      contentHash: preview.digest,
      url: '/api/playback/' + preview.digest,
      candidateProject: result.afterProject,
      manifest: preview.manifest,
    };
  }
  async restore(raw) {
    const input = parse(RestoreSchema, raw);
    return this.store.restore(input, input.revision);
  }
  async enqueue(raw) {
    const input = parse(
      z.strictObject({ ...Base, startSample: N.default(0), endSample: N.optional() }),
      raw,
    );
    const result = await this.store.transact(
      input,
      async (record) => {
        const end = input.endSample ?? record.project.durationSamples;
        check(
          end > input.startSample && end <= record.project.durationSamples,
          'VALIDATION_ERROR',
          'Invalid render range.',
        );
        const job = await this.renderer.prepare(copy(record.project), input.requestId, {
          startSample: input.startSample,
          endSample: end,
        });
        if (!record.jobs.includes(job.jobId)) record.jobs.push(job.jobId);
        return { detail: { jobId: job.jobId, status: 'queued' } };
      },
      { edit: false, label: 'Queue delivery', fingerprintPayload: input },
    );
    this.renderer.enqueue(result.detail.jobId);
    return result;
  }
  async audioPreview(projectId, expectedRevision) {
    const p = (await this.store.inspect(projectId)).project;
    check(
      p.revision === expectedRevision,
      'REVISION_CONFLICT',
      'The project changed before playback preparation.',
      { currentRevision: p.revision },
    );
    return this.renderer.preview(p);
  }
  async query(
    projectId,
    { characterId = null, status = 'unapproved', offset = 0, limit = 100 } = {},
  ) {
    const p = (await this.store.inspect(projectId)).project;
    const cues = p.cues.filter((q) => {
      const line = p.story.lines.find((l) => l.id === q.lineId);
      return (
        (!characterId || line?.characterId === characterId) &&
        (status === 'all' || q.approval !== 'approved')
      );
    });
    return {
      projectId,
      revision: p.revision,
      total: cues.length,
      nextOffset: offset + limit < cues.length ? offset + limit : null,
      cues: cues.slice(offset, offset + limit).map((q) => ({
        ...q,
        line: p.story.lines.find((l) => l.id === q.lineId) || null,
        takeGroups: p.takeGroups.filter((g) => g.cueId === q.id),
        clips: p.clips.filter((c) => c.anchor.type === 'cue' && c.anchor.cueId === q.id),
      })),
    };
  }
}
