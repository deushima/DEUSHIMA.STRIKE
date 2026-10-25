/**
 * Deploy del build estático al proyecto Vercel existente (cs16-browser).
 * Usa el CLI global instalado por npm; no requiere .vercel local.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const candidates = [
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'vercel', 'dist', 'index.js'),
  path.join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', 'vercel', 'dist', 'index.js'),
  'vercel',
];
const cli = candidates.find((p) => p === 'vercel' || fs.existsSync(p));
if (!cli) {
  console.error('No se encontró Vercel CLI. Instalá con: npm i -g vercel');
  process.exit(1);
}
const args = cli === 'vercel'
  ? ['deploy', 'dist', '--prod', '--yes', '--force', '--project', 'cs16-browser']
  : [cli, 'deploy', 'dist', '--prod', '--yes', '--force', '--project', 'cs16-browser'];
const result = spawnSync(cli === 'vercel' ? 'vercel' : process.execPath, args, {
  stdio: 'inherit',
  shell: cli === 'vercel',
  cwd: root,
});
process.exit(result.status ?? 1);
