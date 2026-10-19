import fs from 'node:fs/promises';
import { z } from 'zod/v4';
import { ProjectSchema } from '../core/model.mjs';
import { EnvelopeSchema } from '../core/commands.mjs';
await fs.mkdir(new URL('../schemas/', import.meta.url), { recursive: true });
for (const [name, schema] of [
  ['project-v2', ProjectSchema],
  ['command-envelope-v2', EnvelopeSchema],
])
  await fs.writeFile(
    new URL('../schemas/' + name + '.schema.json', import.meta.url),
    JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n',
  );
console.log('Exported runtime project and command schemas.');
