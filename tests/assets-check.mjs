import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'assets', 'cs16');
assert.ok(fs.existsSync(assets), 'Falta assets/cs16. Ejecutá tools/extract-assets.py');

const hud = JSON.parse(fs.readFileSync(path.join(assets, 'ui', 'hud.json'), 'utf8'));
assert.ok(Object.keys(hud).length > 80, 'HUD incompleto');
assert.ok(hud.number_0 && hud.d_ak47 && hud.suit_full, 'Faltan sprites clave');

const sounds = fs.readdirSync(path.join(assets, 'sound'), { recursive: true }).filter((f) => f.endsWith('.wav'));
assert.ok(sounds.length >= 380, `Sonidos insuficientes: ${sounds.length}`);

const models = fs.readdirSync(path.join(assets, 'models')).filter((f) => f.endsWith('.json'));
assert.ok(models.length >= 20, `Modelos insuficientes: ${models.length}`);
for (const id of ['v_ak47', 'v_m4a1', 'v_awp', 'v_usp', 'v_glock18', 'v_deagle']) {
  assert.ok(fs.existsSync(path.join(assets, 'models', `${id}.json`)), `Falta ${id}.json`);
}

for (const wad of ['cs_dust', 'cs_assault', 'cs_office']) {
  const dir = path.join(assets, 'textures', 'wad', wad);
  assert.ok(fs.existsSync(dir), `Falta WAD ${wad}`);
  assert.ok(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length > 0, `WAD ${wad} sin texturas`);
}

console.log(`assets-check OK: ${Object.keys(hud).length} HUD, ${sounds.length} sonidos, ${models.length} modelos`);
