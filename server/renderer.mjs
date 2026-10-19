import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { atomicJson } from '../core/store.mjs';
import { check, hash, SoundrError, errorResult } from '../core/util.mjs';
export class Renderer {
  constructor(root) {
    this.root = root;
    this.tail = Promise.resolve();
    this.pending = 0;
    this.running = new Map();
  }
  async prepare(project, requestId, range) {
    check(this.pending < 6, 'RESOURCE_LIMIT', 'The render queue is full.');
    const jobId = 'job-' + hash(project.id + '|' + requestId).slice(0, 24),
      dir = path.join(this.root, 'jobs', jobId),
      request = { project, mode: 'delivery', range, requestHash: hash({ project, range }) };
    await fs.mkdir(dir, { recursive: true });
    try {
      const existing = JSON.parse(await fs.readFile(path.join(dir, 'request.json'), 'utf8'));
      check(
        existing.requestHash === request.requestHash,
        'REQUEST_ID_CONFLICT',
        'Render request ID was used for a different snapshot.',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicJson(path.join(dir, 'request.json'), request);
      await atomicJson(path.join(dir, 'status.json'), {
        jobId,
        projectId: project.id,
        revision: project.revision,
        status: 'queued',
      });
    }
    return { jobId, dir };
  }
  enqueue(jobId) {
    check(/^job-[a-f0-9]{24}$/.test(jobId), 'VALIDATION_ERROR', 'Invalid render job ID.');
    if (this.running.has(jobId)) return;
    const task = this.task(async () => {
      const dir = path.join(this.root, 'jobs', jobId);
      let initial = { jobId, status: 'running' };
      try {
        const request = JSON.parse(await fs.readFile(path.join(dir, 'request.json'), 'utf8'));
        initial = { ...initial, projectId: request.project.id, revision: request.project.revision };
        const previous = await this.status(jobId);
        if (previous.status === 'completed') return previous;
        try {
          const completed = JSON.parse(
            await fs.readFile(path.join(dir, 'complete', 'manifest.json'), 'utf8'),
          );
          check(
            completed.contentHash === hash(request.project),
            'RENDER_ERROR',
            'Recovered render snapshot mismatch.',
          );
          for (const output of completed.outputs)
            check(
              hash(await fs.readFile(path.join(dir, 'complete', output.file))) === output.sha256,
              'RENDER_ERROR',
              'Recovered output hash mismatch.',
            );
          const status = { ...initial, status: 'completed', manifest: completed };
          await atomicJson(path.join(dir, 'status.json'), status);
          return status;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await atomicJson(path.join(dir, 'status.json'), initial);
        const manifest = await this.worker({ ...request, root: this.root, outputDir: dir });
        const status = { ...initial, status: 'completed', manifest };
        await atomicJson(path.join(dir, 'status.json'), status);
        return status;
      } catch (error) {
        console.error('Soundr render failure', jobId, error.code || error.name, error.message);
        const status = { ...initial, status: 'failed', error: errorResult(error).error };
        await atomicJson(path.join(dir, 'status.json'), status);
        return status;
      }
    });
    this.running.set(jobId, task);
    task.catch(() => {}).finally(() => this.running.delete(jobId));
  }
  task(fn) {
    this.pending++;
    const next = this.tail.catch(() => {}).then(fn);
    this.tail = next;
    return next.finally(() => this.pending--);
  }
  worker(data) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./render-worker.mjs', import.meta.url), {
        workerData: data,
        execArgv: [],
      });
      let settled = false;
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new SoundrError('RENDER_TIMEOUT', 'The bounded scene render exceeded two minutes.'));
      }, 120000);
      worker.on('message', (message) => {
        if (message.type === 'completed') {
          settled = true;
          clearTimeout(timeout);
          resolve(message.manifest);
        }
        if (message.type === 'failed') {
          settled = true;
          clearTimeout(timeout);
          reject(new SoundrError(message.error.code, message.error.message, message.error.details));
        }
      });
      worker.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      worker.on('exit', (code) => {
        clearTimeout(timeout);
        if (!settled)
          reject(
            new SoundrError(
              'RENDER_ERROR',
              'Render worker exited before producing a completed receipt.',
            ),
          );
      });
    });
  }
  async preview(project) {
    const digest = hash(project),
      dir = path.join(this.root, 'preview', digest);
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(dir, 'complete', 'manifest.json'), 'utf8'));
      check(
        manifest.contentHash === digest &&
          hash(await fs.readFile(path.join(dir, 'complete', 'master.float.wav'))) ===
            manifest.outputs[0].sha256,
        'MEDIA_CHANGED',
        'Prepared playback no longer matches its recorded version.',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const key = 'preview:' + digest;
      if (!this.running.has(key)) {
        await fs.mkdir(dir, { recursive: true });
        const task = this.task(() =>
          this.worker({ root: this.root, project, mode: 'preview', outputDir: dir }),
        );
        this.running.set(key, task);
        task.catch(() => {}).finally(() => this.running.delete(key));
      }
      manifest = await this.running.get(key);
    }
    return {
      digest,
      revision: project.revision,
      manifest,
      file: path.join(dir, 'complete', 'master.float.wav'),
    };
  }
  async status(jobId) {
    check(/^job-[a-f0-9]{24}$/.test(jobId), 'VALIDATION_ERROR', 'Invalid render job ID.');
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.root, 'jobs', jobId, 'status.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code === 'ENOENT') throw new SoundrError('NOT_FOUND', 'Render job was not found.');
      throw error;
    }
  }
}
