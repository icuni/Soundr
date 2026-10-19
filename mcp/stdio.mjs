import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { EnvelopeSchema } from '../core/commands.mjs';
import { Id, ProjectId, Rate } from '../core/model.mjs';
import {
  ImportSchema,
  PreviewPlanSchema,
  ApplyPlanSchema,
  AuditionPlanSchema,
  RestoreSchema,
} from '../server/service.mjs';
import { check, SoundrError, errorResult } from '../core/util.mjs';
const option = process.argv.indexOf('--data-root'),
  root = path.resolve(
    option >= 0
      ? process.argv[option + 1]
      : process.env.SOUNDR_DATA_ROOT || fileURLToPath(new URL('../.soundr-data', import.meta.url)),
  );
const N = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  base = { projectId: ProjectId, expectedRevision: N, requestId: Id };
async function api(method, route, data) {
  let runtime;
  try {
    runtime = JSON.parse(await fs.readFile(path.join(root, 'runtime.json'), 'utf8'));
  } catch {
    throw new SoundrError('SERVER_UNAVAILABLE', 'Start Orama Soundr before calling project tools.');
  }
  check(
    Number.isInteger(runtime.port) &&
      runtime.port > 0 &&
      runtime.port <= 65535 &&
      runtime.application === 'Orama Soundr' &&
      /^[a-f0-9]{64}$/.test(runtime.token),
    'SERVER_UNAVAILABLE',
    'Soundr runtime metadata is invalid.',
  );
  const response = await fetch('http://127.0.0.1:' + runtime.port + route, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-soundr-session': runtime.token },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(60000),
  });
  return response.json();
}
const definitions = [
  {
    name: 'soundr_list_projects',
    description: 'List independent Soundr sessions and their current revisions.',
    schema: z.strictObject({}),
    call: () => api('GET', '/api/projects'),
  },
  {
    name: 'soundr_create_project',
    description:
      'Create a local Orama Soundr project. Reuse the same requestId only for identical retries.',
    schema: z.strictObject({ title: z.string().min(1).max(250), frameRate: Rate, requestId: Id }),
    call: (a) => api('POST', '/api/projects', a),
  },
  {
    name: 'soundr_inspect_project',
    description:
      'Inspect a saved project, stable story IDs, edits, routing, versions and dependency identities.',
    schema: z.strictObject({
      projectId: ProjectId,
      detail: z.enum(['summary', 'full']).default('summary'),
    }),
    call: async (a) => {
      const data = await api('GET', '/api/project/' + encodeURIComponent(a.projectId));
      if (a.detail === 'full' || !data.project) return data;
      const p = data.project;
      return {
        ...data,
        project: {
          id: p.id,
          title: p.title,
          revision: p.revision,
          storyProjectId: p.storyProjectId,
          frameRate: p.frameRate,
          sampleRate: p.sampleRate,
          timelineOrigin: p.timelineOrigin,
          activePictureId: p.activePictureId,
          durationSamples: p.durationSamples,
          story: p.story,
          clips: p.clips,
          cues: p.cues,
          takeGroups: p.takeGroups,
          tracks: p.tracks,
          buses: p.buses,
          routes: p.routes,
          automation: p.automation,
          sources: p.sources.map(({ peaks, ...s }) => s),
          pictures: p.pictures,
        },
      };
    },
  },
  {
    name: 'soundr_apply_commands',
    description:
      'Atomically edit clips, takes, story links, routing, processing or automation through the same commands as the UI. expectedRevision and a stable requestId are required; history.undo/history.redo are separate commands.',
    schema: EnvelopeSchema,
    call: (a) => api('POST', '/api/commands', a),
  },
  {
    name: 'soundr_import_asset',
    description:
      'Import WAV audio or CFR MP4/WebM picture from a relative path under Soundr data/imports. Original bytes are copied immutably. No absolute paths, arbitrary URLs or shell execution.',
    schema: z.strictObject({ ...ImportSchema.shape, relativePath: z.string().min(1).max(1024) }),
    call: (a) => api('POST', '/api/import-file', a),
  },
  {
    name: 'soundr_import_story',
    description:
      'Import a supplied Screenwritr story-graph v1 or Storytellr v2 snapshot. Preserve stable IDs/provenance; no live sibling session is read or changed.',
    schema: z.strictObject({
      ...base,
      format: z.enum(['screenwritr', 'storytellr']),
      data: z.unknown(),
      frameRate: Rate.optional(),
      sceneMap: z.record(z.string(), Id).default({}),
      revision: z.string().max(160).default('snapshot'),
    }),
    call: (a) => api('POST', '/api/import-story', a),
  },
  {
    name: 'soundr_query_cues',
    description:
      'Find a character ID’s unapproved lines and every candidate take/clip; results retain stable line identities and the inspected revision.',
    schema: z.strictObject({
      projectId: ProjectId,
      characterId: Id.nullable().default(null),
      status: z.enum(['all', 'unapproved']).default('unapproved'),
      offset: N.default(0),
      limit: z.number().int().min(1).max(100).default(100),
    }),
    call: (a) => api('POST', '/api/query', a),
  },
  {
    name: 'soundr_preview_picture_change',
    description:
      'Build a read-only shot-ID-based change plan for a specific imported picture version. Spanning, truncated, removed and unlinked sounds/absolute automation need explicit resolutions.',
    schema: PreviewPlanSchema,
    call: (a) => api('POST', '/api/reconform-preview', a),
  },
  {
    name: 'soundr_audition_picture_change',
    description:
      'Prepare a read-only audio preview of a fully resolved current picture-change plan. Returns a local preview URL and candidate timing; does not mutate the saved cut.',
    schema: AuditionPlanSchema,
    call: (a) => api('POST', '/api/reconform-audition', a),
  },
  {
    name: 'soundr_apply_picture_change',
    description:
      'Apply a current reviewed plan with all conflicts resolved in one undoable transaction. Never infer director resolutions.',
    schema: ApplyPlanSchema,
    call: (a) => api('POST', '/api/reconform-apply', a),
  },
  {
    name: 'soundr_export_audio',
    description:
      'Queue a frozen master/dialogue/music/effects export. Returns a job ID, not a completed export. Inspect status and manifest before claiming delivery.',
    schema: z.strictObject({ ...base, startSample: N.default(0), endSample: N.optional() }),
    call: (a) => api('POST', '/api/render', a),
  },
  {
    name: 'soundr_render_status',
    description:
      'Inspect actual terminal render state, hashes, picture version, origin, omissions and output metrics.',
    schema: z.strictObject({ jobId: z.string().regex(/^job-[a-f0-9]{24}$/) }),
    call: (a) => api('GET', '/api/jobs/' + a.jobId),
  },
  {
    name: 'soundr_restore_version',
    description:
      'Restore an earlier immutable edit/picture snapshot as a new revision. The current state remains undoable.',
    schema: RestoreSchema,
    call: (a) => api('POST', '/api/restore', a),
  },
];
const tools = new Map(definitions.map((d) => [d.name, d]));
const server = new Server(
  { name: 'orama-soundr', version: '0.2.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'Soundr is an independent film-audio workstation inside Orama. Inspect before mutations; use stable IDs, expectedRevision and requestId. UI and MCP share one operation service. Preview picture changes and obtain director resolutions before applying. Audio renders return jobs; verify completed manifests. REAPER is a reference, never a dependency.',
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: definitions.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: z.toJSONSchema(d.schema),
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  let result;
  try {
    const tool = tools.get(request.params.name);
    check(tool, 'NOT_FOUND', 'Unknown Soundr tool.');
    const parsed = tool.schema.safeParse(request.params.arguments || {});
    check(parsed.success, 'VALIDATION_ERROR', 'Tool arguments are invalid.', {
      issues: parsed.success
        ? []
        : parsed.error.issues
            .slice(0, 8)
            .map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    result = await tool.call(parsed.data);
    check(
      Buffer.byteLength(JSON.stringify(result)) <= 1024 * 1024,
      'RESOURCE_LIMIT',
      'Response is too large. Use summary inspection or paginated cue queries.',
    );
  } catch (error) {
    result = errorResult(error);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result.ok === false,
  };
});
await server.connect(new StdioServerTransport());
