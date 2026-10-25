base=r'.\src'
p=base+r'\core\audio.js'
s=open(p,encoding='utf-8').read()
s=s.replace("    this._samplesEnabled = true;","    this._samplesEnabled = !globalThis.__DEUSHIMA_PUBLIC__;")
s=s.replace("    // Precarga los sonidos que mÃ¡s se usan.\n    setTimeout(() => {","    // Precarga los sonidos que más se usan.\n    if (globalThis.__DEUSHIMA_PUBLIC__) return;\n    setTimeout(() => {")
# If encoding variant didn't match, try ASCII marker.
s=s.replace("    if (this.ctx.state === 'suspended') this.ctx.resume();\n    // Precarga los sonidos", "    if (this.ctx.state === 'suspended') this.ctx.resume();\n    if (globalThis.__DEUSHIMA_PUBLIC__) return;\n    // Precarga los sonidos")
open(p,'w',encoding='utf-8').write(s)
p=base+r'\world\wad.js'
s=open(p,encoding='utf-8').read()
s=s.replace("export async function preloadWadTextures() {\n  if (loaded) return;","export async function preloadWadTextures() {\n  if (loaded || globalThis.__DEUSHIMA_PUBLIC__) return;")
open(p,'w',encoding='utf-8').write(s)
p=base+r'\ui\classic.js'
s=open(p,encoding='utf-8').read()
s=s.replace("  async load() {\n    this.hudData = null;","  async load() {\n    this.hudData = null;")
# insert public guard at beginning of load method after signature
s=s.replace("  async load() {\n    const res = await fetch(`${ASSETS}/ui/hud.json`).catch(() => null);", "  async load() {\n    if (globalThis.__DEUSHIMA_PUBLIC__) return false;\n    const res = await fetch(`${ASSETS}/ui/hud.json`).catch(() => null);")
open(p,'w',encoding='utf-8').write(s)
print('ok')
