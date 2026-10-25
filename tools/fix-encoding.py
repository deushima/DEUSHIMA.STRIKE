p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
repl={
 'ALMACÃ‰N':'ALMACÉN','CÃ“MO':'CÓMO','MenÃº':'Menú','GOLDSRC Â·':'GOLDSRC ·',
 'DUELO RÃPIDO':'DUELO RÁPIDO','fÃ­sica':'física','JUGAR Â·':'JUGAR ·',
 'TAB Â·':'TAB ·','B Â·':'B ·','ESC Â·':'ESC ·','cs16-classic Â· build assets 1.6':'DEUSHIMA STRIKE · assets CS 1.6',
 'â— Listo':'● Listo','Ã—':'×','â˜ ':'☠','armas Â· combate':'armas · combate',
 'extraÃ­dos':'extraídos','instalaciÃ³n':'instalación','mÃ©trica':'métrica','mÃºmeros':'números',
 'menÃº':'menú','clÃ¡sica':'clásica','GeometrÃ­a':'Geometría','lÃ­neas':'líneas','municiÃ³n':'munición',
 'EjecutÃ¡':'Ejecutá','ConfiguraciÃ³n':'Configuración','VÃ­deo':'Vídeo','RATÃ“N':'RATÓN','TECLADO':'TECLADO',
 'Sensibilidad':'Sensibilidad','Invertir':'Invertir','ResoluciÃ³n':'Resolución',
}
for a,b in repl.items(): s=s.replace(a,b)
open(p,'w',encoding='utf-8').write(s)
print('fixed')
