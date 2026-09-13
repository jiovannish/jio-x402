import { db } from './db.ts';
import { readdirSync } from 'node:fs';
const dir = new URL('../migrations/', import.meta.url);
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort())
  await db.query(await Bun.file(new URL(file, dir)).text());
await db.end();
