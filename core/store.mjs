import fs from 'node:fs/promises';
import path from 'node:path';
import { EnvelopeSchema, applyCommand } from './commands.mjs';
import { newProject, ProjectId, validateProject, refreshCueRanges } from './model.mjs';
import { check, copy, hash, id, SoundrError } from './util.mjs';
export async function atomicJson(file, payload, fault = null) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + id('tmp');
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(payload));
    await handle.sync();
    await handle.close();
    handle = null;
    if (fault) await fault(file);
    await fs.rename(temp, file);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}
const sealed = (payload) => ({ checksum: hash(payload), payload });
function unseal(text) {
  const record = JSON.parse(text);
  check(
    record?.payload && record.checksum === hash(record.payload),
    'PROJECT_CORRUPT',
    'The project checkpoint failed its integrity check.',
  );
  validateProject(record.payload.project);
  return record.payload;
}
export class ProjectStore {
  constructor(root, { fault = null } = {}) {
    this.root = path.resolve(root);
    this.fault = fault;
    this.queues = new Map();
    this.recoveryWarnings = new Map();
  }
  async init() {
    for (const folder of ['projects', 'assets', 'imports', 'jobs', 'preview'])
      await fs.mkdir(path.join(this.root, folder), { recursive: true });
  }
  dir(projectId) {
    ProjectId.parse(projectId);
    return path.join(this.root, 'projects', projectId);
  }
  async locked(projectId, fn) {
    const before = this.queues.get(projectId) || Promise.resolve(),
      job = before.catch(() => {}).then(fn);
    this.queues.set(projectId, job);
    try {
      return await job;
    } finally {
      if (this.queues.get(projectId) === job) this.queues.delete(projectId);
    }
  }
  async readRecord(projectId) {
    const dir = this.dir(projectId);
    try {
      return unseal(await fs.readFile(path.join(dir, 'current.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new SoundrError('NOT_FOUND', 'Project was not found.');
      let previous;
      try {
        previous = unseal(await fs.readFile(path.join(dir, 'previous.json'), 'utf8'));
      } catch {
        throw new SoundrError(
          'PROJECT_CORRUPT',
          'No valid project checkpoint is available. Preserve this folder for recovery.',
        );
      }
      const warning =
        'Recovered the previous valid checkpoint; the latest damaged checkpoint was retained.';
      await fs
        .copyFile(
          path.join(dir, 'current.json'),
          path.join(dir, 'damaged-' + id('checkpoint') + '.json'),
        )
        .catch(() => {});
      await atomicJson(path.join(dir, 'current.json'), sealed(previous));
      this.recoveryWarnings.set(projectId, warning);
      return previous;
    }
  }
  async writeRecord(record) {
    const dir = this.dir(record.project.id),
      file = path.join(dir, 'current.json');
    let previous = null;
    try {
      const bytes = await fs.readFile(file, 'utf8');
      unseal(bytes);
      previous = JSON.parse(bytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (previous) await atomicJson(path.join(dir, 'previous.json'), previous);
    await atomicJson(file, sealed(record), this.fault);
  }
  async version(record, label, checkpoint = false) {
    const p = record.project,
      digest = hash(p),
      file = String(p.revision).padStart(8, '0') + '-' + digest.slice(0, 12) + '.json',
      dir = path.join(this.dir(p.id), 'versions');
    await fs.mkdir(dir, { recursive: true });
    const destination = path.join(dir, file);
    try {
      check(
        hash(JSON.parse(await fs.readFile(destination, 'utf8'))) === digest,
        'PROJECT_CORRUPT',
        'Version snapshot identity mismatch.',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicJson(destination, p);
    }
    const existing = record.versions.find((v) => v.revision === p.revision);
    if (existing) {
      if (checkpoint) existing.label = label;
    } else
      record.versions.push({
        revision: p.revision,
        label,
        file,
        hash: digest,
        pictureId: p.activePictureId,
      });
  }
  async create(title, frameRate, requestId = null) {
    await this.init();
    const project = newProject(title, frameRate);
    if (requestId) project.id = 'project-' + hash(requestId).slice(0, 32);
    const creationFingerprint = hash({ title, frameRate });
    if (requestId) {
      try {
        const old = await this.readRecord(project.id);
        check(
          old.creationFingerprint === creationFingerprint,
          'REQUEST_ID_CONFLICT',
          'Create request ID was already used.',
        );
        return copy(old.project);
      } catch (error) {
        if (error.code !== 'NOT_FOUND') throw error;
      }
    }
    const record = {
      project,
      sequence: 0,
      creationFingerprint,
      undo: [],
      redo: [],
      receipts: {},
      versions: [],
      jobs: [],
    };
    await fs.mkdir(this.dir(project.id), { recursive: true });
    await this.version(record, 'Created');
    await this.writeRecord(record);
    return copy(project);
  }
  async inspect(projectId) {
    const record = await this.readRecord(projectId);
    return {
      project: copy(record.project),
      sequence: record.sequence || 0,
      contentHash: hash(record.project),
      undoAvailable: record.undo.length > 0,
      redoAvailable: record.redo.length > 0,
      versions: copy(record.versions),
      jobs: copy(record.jobs),
      warnings: this.recoveryWarnings.has(projectId) ? [this.recoveryWarnings.get(projectId)] : [],
    };
  }
  async list() {
    await this.init();
    const out = [];
    for (const entry of await fs.readdir(path.join(this.root, 'projects'), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !ProjectId.safeParse(entry.name).success) continue;
      try {
        const r = await this.readRecord(entry.name);
        out.push({
          id: r.project.id,
          title: r.project.title,
          revision: r.project.revision,
          pictureId: r.project.activePictureId,
          durationSamples: r.project.durationSamples,
        });
      } catch (error) {
        out.push({
          id: entry.name,
          title: 'Project requires recovery',
          error: error.code || 'IO_ERROR',
        });
      }
    }
    return out;
  }
  async transact(
    input,
    mutate,
    { edit = true, label = 'Edit', fingerprintPayload = input, checkpoint = false } = {},
  ) {
    return this.locked(input.projectId, async () => {
      const record = await this.readRecord(input.projectId),
        fingerprint = hash(fingerprintPayload);
      if (Object.hasOwn(record.receipts, input.requestId)) {
        const stored = record.receipts[input.requestId];
        check(
          stored.fingerprint === fingerprint,
          'REQUEST_ID_CONFLICT',
          'Request ID was already used with different arguments.',
        );
        return { ...copy(stored.result), replayed: true };
      }
      check(
        record.project.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        'The project changed. Inspect it before editing.',
        { currentRevision: record.project.revision },
      );
      check(
        Object.keys(record.receipts).length < 10000,
        'RESOURCE_LIMIT',
        'This M1 session reached its command receipt limit. Preserve it and start a new project.',
      );
      const next = copy(record),
        before = copy(record.project),
        result = await mutate(next);
      next.sequence = (record.sequence || 0) + 1;
      next.project.revision = before.revision + (edit ? 1 : 0);
      if (edit) refreshCueRanges(next.project);
      next.project = validateProject(next.project);
      if (edit) {
        next.undo.push({ before, after: copy(next.project), label });
        next.undo = next.undo.slice(-100);
        next.redo = [];
      }
      await this.version(next, label, checkpoint);
      const receipt = {
        ok: true,
        requestId: input.requestId,
        projectId: input.projectId,
        revisionBefore: before.revision,
        revisionAfter: next.project.revision,
        contentHash: hash(next.project),
        durability: 'committed',
        changedIds: result?.changedIds || [],
        detail: result?.detail || {},
        warnings: result?.warnings || [],
      };
      next.receipts = { ...next.receipts, [input.requestId]: { fingerprint, result: receipt } };
      await this.writeRecord(next);
      return receipt;
    });
  }
  async execute(raw) {
    const parsed = EnvelopeSchema.safeParse(raw);
    check(parsed.success, 'VALIDATION_ERROR', 'Invalid command envelope.', {
      issues: parsed.success
        ? []
        : parsed.error.issues
            .slice(0, 8)
            .map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    const input = parsed.data,
      first = input.commands[0];
    if (first.type.startsWith('history.') || first.type === 'project.save')
      check(
        input.commands.length === 1,
        'VALIDATION_ERROR',
        'History and save operations must be separate commands.',
      );
    if (first.type === 'history.undo' || first.type === 'history.redo')
      return this.history(input, first.type === 'history.undo');
    return this.transact(
      input,
      async (record) => {
        const changedIds = [],
          details = [];
        for (const c of input.commands) {
          if (c.type === 'project.save') {
            details.push({ savedRevision: record.project.revision });
            continue;
          }
          const result = applyCommand(record.project, c);
          changedIds.push(...result.changedIds);
          details.push(result.detail);
        }
        return { changedIds: [...new Set(changedIds)], detail: { commands: details } };
      },
      {
        edit: first.type !== 'project.save',
        checkpoint: first.type === 'project.save',
        label:
          first.type === 'project.save'
            ? first.label
            : input.commands.map((c) => c.type).join(', '),
      },
    );
  }
  async history(input, undo) {
    return this.locked(input.projectId, async () => {
      const r = await this.readRecord(input.projectId),
        fingerprint = hash(input);
      if (Object.hasOwn(r.receipts, input.requestId)) {
        const old = r.receipts[input.requestId];
        check(old.fingerprint === fingerprint, 'REQUEST_ID_CONFLICT', 'Request ID conflict.');
        return { ...copy(old.result), replayed: true };
      }
      check(
        r.project.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        'The project changed.',
        { currentRevision: r.project.revision },
      );
      const next = copy(r),
        from = undo ? next.undo : next.redo,
        to = undo ? next.redo : next.undo,
        entry = from.pop();
      check(entry, 'NOT_FOUND', undo ? 'Nothing to undo.' : 'Nothing to redo.');
      to.push(entry);
      next.project = copy(undo ? entry.before : entry.after);
      next.sequence = (r.sequence || 0) + 1;
      next.project.revision = r.project.revision + 1;
      validateProject(next.project);
      await this.version(next, undo ? 'Undo ' + entry.label : 'Redo ' + entry.label);
      const result = {
        ok: true,
        requestId: input.requestId,
        projectId: input.projectId,
        revisionBefore: r.project.revision,
        revisionAfter: next.project.revision,
        contentHash: hash(next.project),
        durability: 'committed',
        changedIds: [],
        detail: { history: entry.label },
        warnings: [],
      };
      next.receipts = { ...next.receipts, [input.requestId]: { fingerprint, result } };
      await this.writeRecord(next);
      return result;
    });
  }
  async restore(input, revision) {
    const record = await this.readRecord(input.projectId),
      v = record.versions.find((x) => x.revision === revision);
    check(v, 'NOT_FOUND', 'Version was not found.');
    const p = JSON.parse(
      await fs.readFile(path.join(this.dir(input.projectId), 'versions', v.file), 'utf8'),
    );
    check(hash(p) === v.hash, 'PROJECT_CORRUPT', 'Version snapshot is damaged.');
    return this.transact(
      input,
      async (next) => {
        next.project = validateProject(p);
        return { detail: { restoredRevision: revision } };
      },
      { label: 'Restore version ' + revision, fingerprintPayload: { ...input, revision } },
    );
  }
}
