/**
 * Build estático para Vercel.
 *
 * El build público incluye:
 *   - código de juego
 *   - branding propio
 *   - personajes Quaternius (CC0)
 *   - sonidos y las texturas WAD seleccionadas para los escenarios
 *
 * Los mapas conservan materiales procedurales de respaldo si falla una textura.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = ['index.html', 'favicon.svg', 'character-credits.html'];
for (const file of files) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, file));
}

// Marca el build público para los recursos HUD/modelos que siguen sin publicarse.
const indexPath = path.join(out, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('<head>', '<head>\n    <script>globalThis.__DEUSHIMA_PUBLIC__ = true;</script>');
  fs.writeFileSync(indexPath, html);
}

const dirs = ['src', 'vendor'];
for (const dir of dirs) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, dir), { recursive: true });
}

// Branding propio / CC0 y música.
for (const dir of ['branding', 'characters', 'music']) {
  const src = path.join(root, 'assets', dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, 'assets', dir), { recursive: true });
}
// Sonidos requeridos por el juego en la versión publicada.
const soundSrc = path.join(root, 'assets', 'cs16', 'sound');
if (fs.existsSync(soundSrc)) {
  fs.cpSync(soundSrc, path.join(out, 'assets', 'cs16', 'sound'), { recursive: true });
}
// Los PNG WAD suministrados para los mapas deben cargarse también en Vercel.
const wadSrc = path.join(root, 'assets', 'cs16', 'textures', 'wad');
if (!fs.existsSync(wadSrc)) {
  throw new Error('Faltan las texturas de mapas assets/cs16/textures/wad');
}
fs.cpSync(wadSrc, path.join(out, 'assets', 'cs16', 'textures', 'wad'), { recursive: true });
for (const file of ['deushima-strike.png']) {
  const src = path.join(root, 'assets', file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, 'assets', file));
}

const vercel = {
  version: 2,
  cleanUrls: true,
  trailingSlash: false,
  headers: [
    {
      source: '/vendor/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      source: '/assets/characters/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
    },
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};
fs.writeFileSync(path.join(out, 'vercel.json'), JSON.stringify(vercel, null, 2));
let commit = process.env.VERCEL_GIT_COMMIT_SHA || '';
if (!commit) {
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* source archive */ }
}
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ commit, version: '2.0.0', builtAt: new Date().toISOString() }, null, 2));
fs.writeFileSync(path.join(out, 'BUILD_INFO.txt'), [
  'DEUSHIMA STRIKE - public static build',
  'Includes sounds (assets/cs16/sound) and WAD textures (assets/cs16/textures/wad).',
  'Extracted GoldSrc HUD and classic model files are NOT included.',
].join('\n'));

for (const forbidden of ['assets/cs16/models', 'assets/cs16/ui', 'server.mjs', 'package.json', 'node_modules']) {
  if (fs.existsSync(path.join(out, forbidden))) {
    throw new Error(`Build público contiene ${forbidden}`);
  }
}
const bytes = (p) => {
  if (!fs.existsSync(p) || fs.statSync(p).isFile()) return fs.statSync(p).size;
  return fs.readdirSync(p).reduce((n, f) => n + bytes(path.join(p, f)), 0);
};
console.log(`Static build ready: ${out}`);
console.log(`  ${(bytes(out) / 1024 / 1024).toFixed(1)} MB · sonidos y texturas de mapas incluidos, sin modelos/HUD extraídos`);
