base=r'.\src\ui'
p=base+r'\classic.js'
s=open(p,encoding='utf-8').read()
s=s.replace("    ctx.fillStyle = ch.color || GREEN;\n    ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);\n    ctx.restore();","    ctx.restore();")
open(p,'w',encoding='utf-8').write(s)
p=base+r'\ui.js'
s=open(p,encoding='utf-8').read()
s=s.replace("'<span class=\"xh t\"></span><span class=\"xh b\"></span>' +\n    '<span class=\"xh l\"></span><span class=\"xh r\"></span><span class=\"xh dot\"></span>'","'<span class=\"xh t\"></span><span class=\"xh b\"></span>' +\n    '<span class=\"xh l\"></span><span class=\"xh r\"></span>'")
s=s.replace('<div class="hud-scope u-hidden" data-ref="scope" data-hud="scope"><span class="scope-dot"></span></div>','<div class="hud-scope u-hidden" data-ref="scope" data-hud="scope"></div>')
open(p,'w',encoding='utf-8').write(s)
print('done')
