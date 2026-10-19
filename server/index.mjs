import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSoundrServer } from './app.mjs';
const root = path.resolve(
  process.env.SOUNDR_DATA_ROOT || fileURLToPath(new URL('../.soundr-data', import.meta.url)),
);
await fs.mkdir(root, { recursive: true });
const lock = path.join(root, 'server.lock');
try {
  const old = JSON.parse(await fs.readFile(lock, 'utf8'));
  let alive = false;
  try {
    process.kill(old.pid, 0);
    alive = true;
  } catch {}
  if (alive) throw new Error('Soundr is already running for this data folder.');
  await fs.unlink(lock);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await fs.writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
try {
  const app = await createSoundrServer({
    dataRoot: root,
    port: Number(process.env.SOUNDR_PORT || 17841),
  });
  console.log('Orama Soundr: ' + app.url);
  const stop = async () => {
    app.server.close();
    await fs.unlink(lock).catch(() => {});
    await fs.unlink(path.join(root, 'runtime.json')).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  await fs.unlink(lock).catch(() => {});
  throw error;
}
