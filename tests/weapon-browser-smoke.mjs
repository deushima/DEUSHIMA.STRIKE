/** Chrome/WebGL integration smoke test; run with the local server already up. */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CS16_BASE_URL || 'http://127.0.0.1:8095/');
  await page.getByRole('button', { name: 'JUGAR 1V1' }).click();
  await page.waitForFunction(() => window.game?.weapons && window.game?.characters?.ready, null, { timeout: 15000 });
  const result = await page.evaluate(async () => {
    const { WEAPON_ASSETS, loadWeaponModel } = await import('/src/weapon-assets.js');
    const { loadPovArms } = await import('/src/pov-arms.js');
    const ids = Object.keys(WEAPON_ASSETS);
    const sampleFrames = async () => {
      const frames = await new Promise(resolve => {
        const stamps = [];
        const sample = time => {
          stamps.push(time);
          if (stamps.length < 50) requestAnimationFrame(sample);
          else resolve(stamps.slice(1).map((value, index) => value - stamps[index]));
        };
        requestAnimationFrame(sample);
      });
      const ordered = frames.sort((a, b) => a - b);
      return { median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.floor(ordered.length * .95)] };
    };
    const baselineFrames = await sampleFrames();
    const start = performance.now();
    const models = await Promise.all(ids.flatMap(id => ['view', 'world'].map(async role => {
      const model = await loadWeaponModel(id, role);
      let meshes = 0;
      model.traverse(part => { if (part.isMesh) meshes++; });
      return { id, role, meshes };
    })));
    const arms = await Promise.all(['T', 'CT'].map(async team => {
      const rig = await loadPovArms(team);
      let bones = 0;
      rig.scene.traverse(part => { if (part.isBone) bones++; });
      return { team, bones };
    }));
    const characters = ['T', 'CT'].map(team => {
      const actor = game.characters.create(team);
      actor.update(1/60, { onGround: true, weaponId: 'm4a1' });
      const result = { team, id: actor.characterId, grip: actor.getGripErrors() };
      actor.dispose();
      return result;
    });
    const vm = game.weapons.viewmodel;
    const reloadFraming = [];
    for (const id of ['ak47', 'm4a1', 'awp', 'scout', 'mp5', 'usp', 'deagle', 'm249']) {
      vm.setWeapon(id);
      for (let tries = 0; tries < 100 && !vm.models.get(id)?.native; tries++)
        await new Promise(resolve => setTimeout(resolve, 20));
      const magazine = vm.models.get(id)?.native?.getObjectByName('magazine');
      if (!magazine) throw new Error(`Missing animated magazine: ${id}`);
      vm.deploy = 1;
      vm.update(1/60, { reloading: true, reloadProgress: .4, team: game.player.team });
      vm.root.updateWorldMatrix(true, true);
      const screen = magazine.getWorldPosition(new vm.camera.position.constructor()).project(vm.camera);
      reloadFraming.push({ id, x: screen.x, y: screen.y });
    }
    const loadMs = performance.now() - start;
    const loadedFrames = await sampleFrames();
    const gl = game.renderer.getContext();
    return { ids: ids.length, models, arms, characters, reloadFraming,
      loadMs,
      frameMs: { baseline: baselineFrames, loaded: loadedFrames },
      renderer: gl.getParameter(gl.RENDERER),
      activeNative: !!game.weapons.viewmodel.models.get(game.weapons.currentId)?.native,
      activeArmTeam: [...game.weapons.viewmodel.armsByTeam.keys()],
    };
  });
  assert.equal(result.ids, 16);
  assert.equal(result.models.length, 32);
  assert.ok(result.models.every(model => model.meshes > 0), 'empty GLB');
  assert.deepEqual(result.arms.map(arm => arm.team), ['T', 'CT']);
  assert.ok(result.arms.every(arm => arm.bones > 20), 'unrigged POV arm');
  assert.ok(result.characters.every(actor => Math.max(...Object.values(actor.grip)) < .05));
  assert.equal(result.characters.find(actor => actor.team === 'CT').id, 'community-sas-e9c56308');
  assert.ok(result.reloadFraming.every(row => Math.abs(row.x) < 1 && Math.abs(row.y) < 1), 'reload magazine outside POV camera');
  assert.deepEqual(errors, []);
  const credits = await browser.newPage();
  await credits.goto(new URL('/character-credits.html', process.env.CS16_BASE_URL || 'http://127.0.0.1:8095/').href);
  assert.equal(await credits.locator('#weapons-creators').count(), 1);
  for (const author of ['3dmodelscc0', 'Maia Studios', 'SirDraco65', 'locarem', 'WRiKS', 'BAMEN', 'DEUSHIMA STRIKE']) {
    assert.ok((await credits.locator('body').innerText()).includes(author), `missing credit: ${author}`);
  }
  await credits.close();
  console.log(JSON.stringify({ ...result, models: `${result.models.length} GLBs with meshes`, errors }, null, 2));
} finally {
  await browser.close();
}
