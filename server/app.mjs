import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod/v4';
import { SoundrService } from './service.mjs';
import { ProjectSchema, ProjectId } from '../core/model.mjs';
import { EnvelopeSchema } from '../core/commands.mjs';
import { check, errorResult, SoundrError } from '../core/util.mjs';
import { atomicJson } from '../core/store.mjs';
import { scopedFile, AUDIO_LIMIT, PICTURE_LIMIT } from '../core/media.mjs';
const APP_ROOT = fileURLToPath(new URL('../', import.meta.url)),
  UI_ROOT = path.join(APP_ROOT, 'ui');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
};
async function body(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    check(length <= limit, 'RESOURCE_LIMIT', 'Request exceeds the permitted size.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  check(
    (req.headers['content-type'] || '').startsWith('application/json'),
    'VALIDATION_ERROR',
    'Send JSON request data.',
  );
  try {
    return JSON.parse((await body(req)).toString('utf8'));
  } catch (error) {
    if (error.code) throw error;
    throw new SoundrError('VALIDATION_ERROR', 'Invalid JSON.');
  }
}
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function streamFile(req, res, file, { download = false, contentType = null } = {}) {
  const info = await fs.stat(file),
    type = contentType || TYPES[path.extname(file)] || 'application/octet-stream';
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    check(match, 'VALIDATION_ERROR', 'Unsupported byte range.');
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), end) : end;
    check(start <= end && start < info.size, 'VALIDATION_ERROR', 'Invalid byte range.');
    status = 206;
  }
  const headers = {
    'Content-Type': type,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
  };
  if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + info.size;
  if (download)
    headers['Content-Disposition'] = 'attachment; filename="' + path.basename(file) + '"';
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file, { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
}
export async function createSoundrServer({
  dataRoot = path.join(APP_ROOT, '.soundr-data'),
  port = 17841,
  writeRuntime = true,
} = {}) {
  const service = await new SoundrService(dataRoot).init(),
    token = randomBytes(32).toString('hex');
  let address;
  const authenticated = (req) => {
    const value =
      req.headers['x-soundr-session'] ||
      (req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('soundr='))
        ?.slice(7);
    return (
      typeof value === 'string' &&
      value.length === token.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(token))
    );
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      check(req.headers.host === address, 'FORBIDDEN', 'Unrecognized local host.');
      const origin = req.headers.origin;
      check(
        !origin || origin === 'http://' + address,
        'FORBIDDEN',
        'Cross-origin access is not permitted.',
      );
      const url = new URL(req.url, 'http://' + address),
        route = url.pathname;
      if (route === '/' && req.method === 'GET')
        return streamFile(req, res, path.join(UI_ROOT, 'index.html'));
      if (/^\/ui\/[a-z0-9-]+\.(mjs|css|svg)$/.test(route) && req.method === 'GET')
        return streamFile(req, res, path.join(UI_ROOT, path.basename(route)));
      if (route === '/api/session' && req.method === 'GET') {
        res.setHeader('Set-Cookie', 'soundr=' + token + '; HttpOnly; SameSite=Strict; Path=/');
        return send(res, 200, { token, application: 'Orama Soundr', version: '0.2.0' });
      }
      check(
        authenticated(req),
        'FORBIDDEN',
        'Open Soundr locally or use its private stdio bridge.',
      );
      if (route === '/api/projects' && req.method === 'GET')
        return send(res, 200, { projects: await service.store.list() });
      if (route === '/api/projects' && req.method === 'POST')
        return send(res, 200, { project: await service.create(await jsonBody(req)) });
      if (route.startsWith('/api/project/') && req.method === 'GET') {
        const key = route.slice('/api/project/'.length);
        ProjectId.parse(key);
        return send(res, 200, await service.store.inspect(key));
      }
      if (route === '/api/commands' && req.method === 'POST')
        return send(res, 200, await service.store.execute(await jsonBody(req)));
      if (route === '/api/schema' && req.method === 'GET')
        return send(res, 200, {
          project: z.toJSONSchema(ProjectSchema),
          commands: z.toJSONSchema(EnvelopeSchema),
        });
      if (route === '/api/query' && req.method === 'POST') {
        const b = await jsonBody(req);
        check(
          Number.isInteger(b.offset ?? 0) &&
            Number.isInteger(b.limit ?? 100) &&
            (b.limit ?? 100) > 0 &&
            (b.limit ?? 100) <= 100 &&
            (b.offset ?? 0) >= 0,
          'VALIDATION_ERROR',
          'Invalid query pagination.',
        );
        return send(res, 200, await service.query(b.projectId, b));
      }
      if (route.startsWith('/api/import/') && req.method === 'POST') {
        let meta;
        try {
          meta = JSON.parse(decodeURIComponent(String(req.headers['x-upload-meta'] || '')));
        } catch {
          throw new SoundrError('VALIDATION_ERROR', 'Upload metadata is invalid.');
        }
        meta.projectId = route.slice('/api/import/'.length);
        const bytes = await body(req, meta.kind === 'audio' ? AUDIO_LIMIT : PICTURE_LIMIT);
        return send(res, 200, await service.importAsset(meta, bytes));
      }
      if (route === '/api/import-file' && req.method === 'POST')
        return send(res, 200, await service.importFile(await jsonBody(req)));
      if (route === '/api/import-story' && req.method === 'POST')
        return send(res, 200, await service.importStory(await jsonBody(req)));
      if (route === '/api/reconform-preview' && req.method === 'POST')
        return send(res, 200, await service.preview(await jsonBody(req)));
      if (route === '/api/reconform-audition' && req.method === 'POST')
        return send(res, 200, await service.audition(await jsonBody(req)));
      if (route === '/api/reconform-apply' && req.method === 'POST')
        return send(res, 200, await service.applyPlan(await jsonBody(req)));
      if (route === '/api/restore' && req.method === 'POST') {
        return send(res, 200, await service.restore(await jsonBody(req)));
      }
      if (route === '/api/render' && req.method === 'POST')
        return send(res, 200, await service.enqueue(await jsonBody(req)));
      if (route === '/api/preview' && req.method === 'POST') {
        const b = await jsonBody(req),
          preview = await service.audioPreview(b.projectId, b.expectedRevision);
        return send(res, 200, {
          revision: preview.revision,
          contentHash: preview.digest,
          url: '/api/playback/' + preview.digest,
          manifest: preview.manifest,
        });
      }
      if (/^\/api\/jobs\/job-[a-f0-9]{24}$/.test(route) && req.method === 'GET')
        return send(res, 200, await service.renderer.status(route.split('/').at(-1)));
      if (/^\/api\/playback\/[a-f0-9]{64}$/.test(route) && ['GET', 'HEAD'].includes(req.method)) {
        const digest = route.split('/')[3];
        return streamFile(
          req,
          res,
          await scopedFile(path.join(dataRoot, 'preview', digest, 'complete'), 'master.float.wav'),
          { contentType: 'application/octet-stream' },
        );
      }
      if (route.startsWith('/asset/') && ['GET', 'HEAD'].includes(req.method)) {
        const [, , projectId, assetId] = route.split('/');
        const p = (await service.store.inspect(projectId)).project,
          asset = [...p.sources, ...p.pictures].find((a) => a.id === assetId);
        check(asset, 'NOT_FOUND', 'Media was not found.');
        return streamFile(
          req,
          res,
          await scopedFile(path.join(dataRoot, 'assets'), asset.assetFile),
        );
      }
      if (
        /^\/download\/job-[a-f0-9]{24}\/(master\.wav|dialogue\.wav|music\.wav|effects\.wav|manifest\.json)$/.test(
          route,
        ) &&
        req.method === 'GET'
      ) {
        const [, , jobId, name] = route.split('/'),
          status = await service.renderer.status(jobId);
        check(status.status === 'completed', 'RENDER_NOT_READY', 'This job has not completed.');
        return streamFile(
          req,
          res,
          await scopedFile(path.join(dataRoot, 'jobs', jobId, 'complete'), name),
          { download: true },
        );
      }
      if (route === '/api/demo' && req.method === 'GET') {
        let demo = null;
        try {
          demo = JSON.parse(await fs.readFile(path.join(dataRoot, 'demo.json'), 'utf8'));
        } catch {}
        return send(res, 200, { demo });
      }
      if (route === '/api/demo/create' && req.method === 'POST') {
        check(
          !server.demoRunning,
          'RESOURCE_LIMIT',
          'The demonstration scene is already being prepared.',
        );
        server.demoRunning = true;
        try {
          await new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [path.join(APP_ROOT, 'scripts', 'create-demo.mjs')],
              {
                env: { ...process.env, SOUNDR_DATA_ROOT: dataRoot },
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            );
            let errors = '';
            child.stderr.on('data', (d) => {
              if (errors.length < 2000) errors += d;
            });
            const timer = setTimeout(() => {
              child.kill();
              reject(new SoundrError('DEMO_FAILED', 'Demo media preparation timed out.'));
            }, 120000);
            child.on('error', reject);
            child.on('exit', (code) => {
              clearTimeout(timer);
              code === 0
                ? resolve()
                : reject(
                    new SoundrError('DEMO_FAILED', 'Could not prepare the generated demo scene.', {
                      reason: errors.slice(0, 500),
                    }),
                  );
            });
          });
          return send(
            res,
            200,
            JSON.parse(await fs.readFile(path.join(dataRoot, 'demo.json'), 'utf8')),
          );
        } finally {
          server.demoRunning = false;
        }
      }
      throw new SoundrError('NOT_FOUND', 'This Soundr operation was not found.');
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 422;
      send(res, status, errorResult(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  address = '127.0.0.1:' + server.address().port;
  const runtime = {
    port: server.address().port,
    pid: process.pid,
    token,
    application: 'Orama Soundr',
    version: '0.2.0',
  };
  if (writeRuntime) await atomicJson(path.join(dataRoot, 'runtime.json'), runtime);
  return { server, service, url: 'http://' + address, token, dataRoot };
}
