import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createSoundrServer } from '../server/app.mjs';
import { decodeWav, encodeWav } from '../core/wav.mjs';
import { hash } from '../core/util.mjs';
import { testRoot } from './fixtures.mjs';
const APP = fileURLToPath(new URL('../', import.meta.url)),
  exec = promisify(execFile);
test('HTTP workstation and official MCP client share one durable operation service', async (t) => {
  const root = await testRoot(),
    app = await createSoundrServer({ dataRoot: root, port: 0 });
  const client = new Client({ name: 'soundr-acceptance', version: '1.0.0' }, { capabilities: {} }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(APP, 'mcp', 'stdio.mjs'), '--data-root', root],
      stderr: 'pipe',
    });
  let sequence = 0,
    p;
  const req = () => 'integration-' + ++sequence,
    api = async (route, body) => {
      const r = await fetch(app.url + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-soundr-session': app.token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return r.json();
    };
  const mcp = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return r.structuredContent || JSON.parse(r.content[0].text);
  };
  const refresh = async () => (p = (await api('/api/project/' + p.id)).project);
  const commands = async (list) => {
    const result = await api('/api/commands', {
      projectId: p.id,
      expectedRevision: p.revision,
      requestId: req(),
      commands: list,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    await refresh();
    return result;
  };
  try {
    await client.connect(transport);
    await t.test(
      'real stdio tool discovery, create retries and local HTTP authorization',
      async () => {
        const listing = await client.listTools();
        assert.ok(listing.tools.some((x) => x.name === 'soundr_audition_picture_change'));
        assert.equal(listing.tools.length, 13);
        const create = {
          title: 'Protocol acceptance',
          frameRate: { numerator: 30000, denominator: 1001 },
          requestId: req(),
        };
        p = (await mcp('soundr_create_project', create)).project;
        assert.ok(p.id);
        assert.equal((await mcp('soundr_create_project', create)).project.id, p.id);
        assert.equal(
          (await mcp('soundr_create_project', { ...create, title: 'Changed payload' })).error.code,
          'REQUEST_ID_CONFLICT',
        );
        assert.equal((await fetch(app.url + '/api/projects')).status, 403);
        assert.equal(
          (
            await fetch(app.url + '/api/session', {
              headers: { Origin: 'https://untrusted.example' },
            })
          ).status,
          403,
        );
        const denied = await mcp('soundr_import_asset', {
          projectId: p.id,
          expectedRevision: p.revision,
          requestId: req(),
          kind: 'audio',
          name: 'outside.wav',
          relativePath: '../outside.wav',
        });
        assert.equal(denied.error.code, 'FORBIDDEN');
        await commands([
          {
            type: 'project.timing.set',
            durationSamples: 4800,
            frameRate: p.frameRate,
            timelineOrigin: p.timelineOrigin,
          },
        ]);
      },
    );
    let originalBytes,
      sourceIds = {};
    await t.test(
      'story IDs, immutable media, UI edit visible to MCP and duplicate MCP operation exactly once',
      async () => {
        const story = {
          characters: [{ id: 'character-amenewa', name: 'Amenewa', sourceRef: null }],
          scenes: [{ id: 'scene-one', name: 'Waiting room', sourceRef: null }],
          lines: [
            {
              id: 'line-one',
              sceneId: 'scene-one',
              characterId: 'character-amenewa',
              text: 'Wait here.',
              reviewRequired: false,
              sourceRef: null,
            },
          ],
          shots: [],
          imports: [],
        };
        await commands([{ type: 'story.set', storyProjectId: 'story-acceptance', story }]);
        for (const [i, kind] of ['dialogue', 'music', 'effects', 'ambience'].entries()) {
          const samples = Float32Array.from(
            { length: 4800 },
            (_, n) => 0.025 * (i + 1) * Math.sin((2 * Math.PI * (220 + i * 110) * n) / 48000),
          );
          samples[0] = 0.1 * (i + 1);
          const bytes = encodeWav([samples], { originSample: 172800000 }),
            relativePath = kind + '.wav';
          await fs.writeFile(path.join(root, 'imports', relativePath), bytes);
          if (!i) originalBytes = bytes;
          const input = {
            projectId: p.id,
            expectedRevision: p.revision,
            requestId: req(),
            kind: 'audio',
            name: relativePath,
            relativePath,
          };
          const imported = await mcp('soundr_import_asset', input);
          assert.equal(imported.ok, true, JSON.stringify(imported));
          sourceIds[kind] = imported.detail.assetId;
          await refresh();
        }
        assert.equal(p.sources[0].originalTimeReference, '172800000');
        const result = await commands(
          ['dialogue', 'music', 'effects', 'ambience'].map((kind) => ({
            type: 'clip.add',
            sourceId: sourceIds[kind],
            trackId: 'track-' + kind,
            startSample: 0,
            sourceInSample: 0,
            durationSamples: 4800,
            lineId: kind === 'dialogue' ? 'line-one' : null,
            sceneId: 'scene-one',
            shotId: null,
          })),
        );
        const clipId = result.detail.commands[0].clipId;
        const inspected = await mcp('soundr_inspect_project', { projectId: p.id, detail: 'full' });
        assert.equal(inspected.project.clips[0].id, clipId);
        const edit = {
          projectId: p.id,
          expectedRevision: p.revision,
          requestId: req(),
          commands: [{ type: 'clip.move', clipIds: [clipId], deltaSamples: 48 }],
        };
        const first = await mcp('soundr_apply_commands', edit);
        assert.equal(first.ok, true);
        assert.equal((await mcp('soundr_apply_commands', edit)).replayed, true);
        await refresh();
        assert.equal(p.clips[0].startSample, 48);
        assert.equal(p.cues[0].startSample, 48);
        assert.equal(
          (
            await mcp('soundr_apply_commands', {
              ...edit,
              commands: [{ type: 'clip.move', clipIds: [clipId], deltaSamples: 49 }],
            })
          ).error.code,
          'REQUEST_ID_CONFLICT',
        );
        const stale = await mcp('soundr_apply_commands', { ...edit, requestId: req() });
        assert.equal(stale.error.code, 'REVISION_CONFLICT');
        const query = await mcp('soundr_query_cues', {
          projectId: p.id,
          characterId: 'character-amenewa',
          status: 'unapproved',
        });
        assert.equal(query.cues[0].line.id, 'line-one');
        const file = path.join(
          root,
          'assets',
          p.sources.find((s) => s.id === sourceIds.dialogue).assetFile,
        );
        assert.equal(hash(await fs.readFile(file)), hash(originalBytes));
        await commands([{ type: 'clip.move', clipIds: [clipId], deltaSamples: -48 }]);
        await commands([{ type: 'project.save', label: 'Saved protocol proof' }]);
      },
    );
    let jobs = [];
    await t.test(
      'two frozen deliveries match bytes, share BWF origins and sum to master',
      async () => {
        for (let pass = 0; pass < 2; pass++) {
          const input = { projectId: p.id, expectedRevision: p.revision, requestId: req() },
            receipt = await mcp('soundr_export_audio', input);
          assert.equal(receipt.detail.status, 'queued');
          assert.equal((await mcp('soundr_export_audio', input)).replayed, true);
          let status;
          for (let i = 0; i < 200; i++) {
            status = await api('/api/jobs/' + receipt.detail.jobId);
            if (['completed', 'failed'].includes(status.status)) break;
            await new Promise((r) => setTimeout(r, 25));
          }
          assert.equal(status.status, 'completed', JSON.stringify(status));
          jobs.push(status);
          assert.equal(status.manifest.picture, null);
          assert.equal(status.manifest.range.durationSamples, 4800);
          assert.equal(status.manifest.purpose, 'delivery');
        }
        const outputs = jobs[0].manifest.outputs;
        assert.deepEqual(
          outputs.map((x) => x.sha256),
          jobs[1].manifest.outputs.map((x) => x.sha256),
        );
        const waves = {};
        for (const output of outputs) {
          const bytes = await fs.readFile(
            path.join(root, 'jobs', jobs[0].jobId, 'complete', output.file),
          );
          assert.equal(hash(bytes), output.sha256);
          const decoded = decodeWav(bytes);
          assert.equal(decoded.frames, 4800);
          assert.equal(decoded.originSample, 172800000);
          assert.equal(decoded.channels.length, 2);
          waves[output.role] = decoded.channels;
        }
        let peakDifference = 0;
        for (let c = 0; c < 2; c++)
          for (let n = 0; n < 4800; n++)
            peakDifference = Math.max(
              peakDifference,
              Math.abs(
                waves.master[c][n] - waves.dialogue[c][n] - waves.music[c][n] - waves.effects[c][n],
              ),
            );
        assert.ok(peakDifference <= 4 / 8388608, 'Master vs D+M+E difference ' + peakDifference);
        const probe = JSON.parse(
          (
            await exec(
              'ffprobe',
              [
                '-v',
                'error',
                '-show_entries',
                'stream=sample_rate,channels,bits_per_sample,duration_ts:format_tags=time_reference',
                '-of',
                'json',
                path.join(root, 'jobs', jobs[0].jobId, 'complete', 'master.wav'),
              ],
              { windowsHide: true },
            )
          ).stdout,
        );
        assert.equal(probe.streams[0].sample_rate, '48000');
        assert.equal(probe.streams[0].bits_per_sample, 24);
        assert.equal(probe.streams[0].duration_ts, 4800);
      },
    );
    await t.test(
      'missing/changed required media fails delivery; saved versions reopen',
      async () => {
        const source = p.sources.find((s) => s.id === sourceIds.effects),
          file = path.join(root, 'assets', source.assetFile),
          saved = await fs.readFile(file);
        await fs.rename(file, file + '.held');
        try {
          const receipt = await api('/api/render', {
            projectId: p.id,
            expectedRevision: p.revision,
            requestId: req(),
          });
          let status;
          for (let i = 0; i < 200; i++) {
            status = await api('/api/jobs/' + receipt.detail.jobId);
            if (['completed', 'failed'].includes(status.status)) break;
            await new Promise((r) => setTimeout(r, 25));
          }
          assert.equal(status.status, 'failed');
          assert.equal(status.error.code, 'MEDIA_UNAVAILABLE');
          assert.equal(status.error.message.includes(root), false);
        } finally {
          await fs.rename(file + '.held', file);
        }
        await fs.writeFile(
          file,
          Buffer.from(saved.map((v, i) => (i === saved.length - 1 ? v ^ 1 : v))),
        );
        try {
          const receipt = await api('/api/render', {
            projectId: p.id,
            expectedRevision: p.revision,
            requestId: req(),
          });
          let status;
          for (let i = 0; i < 200; i++) {
            status = await api('/api/jobs/' + receipt.detail.jobId);
            if (['completed', 'failed'].includes(status.status)) break;
            await new Promise((r) => setTimeout(r, 25));
          }
          assert.equal(status.status, 'failed');
          assert.equal(status.error.code, 'MEDIA_CHANGED');
        } finally {
          await fs.writeFile(file, saved);
        }
        const before = p.revision;
        await commands([{ type: 'project.set', title: 'Revised title' }]);
        const restored = await mcp('soundr_restore_version', {
          projectId: p.id,
          expectedRevision: p.revision,
          requestId: req(),
          revision: before,
        });
        assert.equal(restored.ok, true);
        await refresh();
        assert.equal(p.title, 'Protocol acceptance');
        assert.equal(p.clips.length, 4);
      },
    );
    await fs.writeFile(
      path.join(root, 'acceptance.json'),
      JSON.stringify(
        {
          status: 'passed',
          projectId: p.id,
          revision: p.revision,
          toolCount: 13,
          deliveries: jobs.map((j) => ({
            jobId: j.jobId,
            contentHash: j.manifest.contentHash,
            outputs: j.manifest.outputs,
          })),
        },
        null,
        2,
      ),
    );
    console.log('Protocol and delivery evidence: ' + path.join(root, 'acceptance.json'));
  } finally {
    await client.close();
    await new Promise((resolve) => app.server.close(resolve));
  }
});
