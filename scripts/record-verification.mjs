import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { hash } from '../core/util.mjs';
import { ProjectStore } from '../core/store.mjs';
const app = fileURLToPath(new URL('../', import.meta.url)),
  root = path.join(app, '.soundr-data'),
  out = path.join(app, 'acceptance', 'm1');
const readJSON = async (file) =>
  JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const data = await readJSON(path.join(root, 'demo.json')),
  scene = await readJSON(path.join(app, 'output', 'acceptance', 'milestone.json')),
  fractional = await readJSON(path.join(app, 'output', 'acceptance', 'fractional-sync.json')),
  browser = await readJSON(path.join(app, 'output', 'acceptance', 'browser-sync.json')),
  responsive = await readJSON(path.join(app, 'output', 'acceptance', 'responsive.json')),
  audit = await readJSON(path.join(app, 'output', 'npm-audit.json'));
const tap = await fs.readFile(path.join(app, 'output', 'final-tests.tap'), 'utf8'),
  tests = Number(/# tests (\d+)/.exec(tap)?.[1]),
  passes = Number(/# pass (\d+)/.exec(tap)?.[1]),
  failures = Number(/# fail (\d+)/.exec(tap)?.[1]);
assert.equal(tests, 23);
assert.equal(passes, tests);
assert.equal(failures, 0);
assert.equal(audit.metadata.vulnerabilities.total, 0);
assert.ok(responsive.documentWidth <= responsive.viewport);
assert.equal(scene.status, 'passed');
assert.equal(fractional.status, 'passed');
const store = new ProjectStore(root),
  record = await store.inspect(data.projectId),
  p = record.project;
assert.equal(p.durationSamples, 3600000);
assert.equal(p.activePictureId, data.oldPictureId);
assert.equal(record.versions.find((v) => v.revision === p.revision).label, 'Director checkpoint');
const jobId = record.jobs.at(-1),
  job = await readJSON(path.join(root, 'jobs', jobId, 'status.json'));
assert.equal(job.status, 'completed');
assert.equal(job.manifest.projectRevision, p.revision);
assert.equal(job.manifest.picture.id, data.oldPictureId);
function pcm(bytes) {
  for (let at = 12; at + 8 <= bytes.length;) {
    const n = bytes.readUInt32LE(at + 4);
    if (bytes.toString('ascii', at, at + 4) === 'data') return bytes.subarray(at + 8, at + 8 + n);
    at += 8 + n + (n % 2);
  }
  throw new Error('PCM chunk absent');
}
const restored = [];
for (const o of job.manifest.outputs) {
  const now = await fs.readFile(path.join(root, 'jobs', jobId, 'complete', o.file)),
    earlier = await fs.readFile(path.join(root, 'jobs', scene.before.jobId, 'complete', o.file));
  assert.equal(hash(now), o.sha256);
  assert.ok(pcm(now).equals(pcm(earlier)));
  restored.push({
    role: o.role,
    file: o.file,
    sha256: o.sha256,
    frames: o.frames,
    originSample: o.originSample,
    pcmIdenticalAfterVersionRestore: true,
  });
}
for (const source of p.sources)
  assert.equal(
    hash(await fs.readFile(path.join(root, 'assets', source.assetFile))),
    source.assetHash,
  );
const screenshots = [
    'workstation-initial.png',
    'workstation-selected.png',
    'review-unresolved.png',
    'review-applied.png',
    'delivery-ready.png',
    'workstation-final.png',
    'delivery-final.png',
    'mobile-overflow-before.png',
    'mobile-final.png',
  ],
  visual = [];
for (const file of screenshots) {
  const bytes = await fs.readFile(path.join(app, 'output', 'playwright', file));
  visual.push({ file: 'output/playwright/' + file, sha256: hash(bytes) });
}
const sourceFiles = [];
for (const dir of ['core', 'server', 'mcp', 'ui', 'tests', 'scripts', 'schemas'])
  for (const f of await fs.readdir(path.join(app, dir))) {
    if (!/\.(mjs|css|html|svg|py|ps1|json)$/.test(f)) continue;
    const file = path.join(dir, f);
    sourceFiles.push({
      file: file.replaceAll('\\', '/'),
      sha256: hash(await fs.readFile(path.join(app, file))),
    });
  }
for (const file of ['package.json', 'package-lock.json'])
  sourceFiles.push({ file, sha256: hash(await fs.readFile(path.join(app, file))) });
sourceFiles.sort((a, b) => a.file.localeCompare(b.file));
const deps = [];
for (const name of ['@modelcontextprotocol/sdk', 'zod']) {
  const d = await readJSON(path.join(app, 'node_modules', name, 'package.json'));
  deps.push({ name, version: d.version, license: d.license });
}
const report = {
  schema: 'org.icuni.soundr.milestone-verification',
  schemaVersion: 1,
  collectedAt: new Date().toISOString(),
  status: 'PASSED_GENERATED_MEDIA_ENGINEERING_CHECKS',
  application: 'Orama Soundr',
  version: '0.2.0',
  node: process.version,
  platform: process.platform,
  tests: { total: tests, passed: passes, failed: failures, receipt: 'output/final-tests.tap' },
  dependencyAudit: {
    knownVulnerabilities: audit.metadata.vulnerabilities.total,
    dependencies: deps,
  },
  scene,
  fractional,
  browserSoftwareSync: browser,
  responsive,
  finalSession: {
    projectId: p.id,
    revision: p.revision,
    seconds: 75,
    activePictureId: p.activePictureId,
    sourceCount: p.sources.length,
    clipCount: p.clips.length,
    checkpointLabel: 'Director checkpoint',
    uiExportJobId: jobId,
    restoredOutputs: restored,
    allSourceHashesPreserved: true,
  },
  nativeUI: {
    method: 'Observed Playwright CLI interactions and native browser screenshots',
    verified: [
      'clip gain and save/reopen',
      'selected and restored alternate take',
      'clip drag and undo',
      'right-edge trim and undo',
      'file-picker WAV import',
      'read-only picture-change preview/audition',
      'explicit resolutions and apply',
      'version-history restore',
      'named checkpoint',
      'completed master/D/M/E UI handoff',
      'automation editor',
      'desktop and responsive layout',
    ],
  },
  screenshots: visual,
  sourceFiles,
  notAccepted: [
    'Human editorial acceptance with a real owned scene',
    'Physical speaker/display calibration',
    'Live sibling-app round trips',
    'Sustained large-session production playback',
    'Six reference-application empirical scene benchmarks',
  ],
};
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
await fs.copyFile(path.join(app, 'output', 'final-tests.tap'), path.join(out, 'tests.tap'));
await fs.copyFile(
  path.join(app, 'output', 'npm-audit.json'),
  path.join(out, 'dependency-audit.json'),
);
console.log(
  'Recorded ' +
    tests +
    ' passing checks; restored UI export PCM matches the original scene, source hashes match, and responsive capture has no page overflow.',
);
