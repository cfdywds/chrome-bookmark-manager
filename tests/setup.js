import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsDir = join(__dirname, '..', 'js');

const load = (f) => {
  const code = readFileSync(join(jsDir, f), 'utf-8');
  (0, eval)(code);
};

if (!globalThis.BM_CONST) load('constants.js');
if (!globalThis.BM_RULES) load('rules-data.js');
