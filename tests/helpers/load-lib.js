import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'js');

export function loadLib() {
  const load = (f) => {
    const code = readFileSync(join(dir, f), 'utf-8');
    // 在 globalThis 上下文执行经典脚本
    (0, eval)(code);
  };
  if (!globalThis.BM_CONST) load('constants.js');
  if (!globalThis.BM_RULES) load('rules-data.js');
  load('lib.js');
  return globalThis.BM;
}

export function ensurePreamble() {
  const load = (f) => {
    const code = readFileSync(join(dir, f), 'utf-8');
    (0, eval)(code);
  };
  if (!globalThis.BM_CONST) load('constants.js');
  if (!globalThis.BM_RULES) load('rules-data.js');
}
