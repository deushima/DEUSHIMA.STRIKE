# Carpeta de texturas para arreglar con Astra GPT

El proyecto de entrega está en:

```
.
```

También queda la copia de trabajo en:

```
.
```

Para verlo, abrir una consola en la carpeta del proyecto y ejecutar:

```powershell
cd .
node server.mjs
```

Luego entrar a **http://127.0.0.1:8095/**.

## Texturas del mapa / GoldSrc

```
assets/cs16/textures/
├── wad/
│   ├── cs_dust/          texturas de aim_1v1 / de_dust2
│   ├── cs_assault/       texturas de assault
│   ├── cs_office/        texturas de office
│   └── ...
└── *.png
```

## HUD / UI

```
assets/cs16/ui/hud/       640hud*.png, sniper_scope.png, daño, etc.
assets/cs16/ui/           iconos y paneles de la interfaz
assets/branding/          fondo del menú DEUSHIMA STRIKE
```

## Personajes

```text
assets/characters/quaternius/
├── soldier_ct.glb
└── soldier_t.glb
```

Los soldados Quaternius son GLB animados CC0. La apariencia y las animaciones vienen integradas en cada archivo.

## Reglas para reemplazar texturas

1. Mantener el **mismo nombre de archivo**.
2. Mantener el **tamaño** y el canal alfa (especialmente HUD y recortes).
3. Para mapas, conservar el patrón repetible; no agregar bordes negros.
4. Guardar como **PNG** (sin cambiar la extensión).
5. Recargar con `Ctrl+F5`; el servidor no necesita reiniciarse.

## Prioridades visuales conocidas

- Suelo `aim_1v1`: está sólido, pero se puede mejorar el detalle de arena.
- Paredes de `aim_1v1` / `cs_assault`: texturas WAD originales de baja resolución.
- HUD: los números de `640hud` son los originales de CS 1.6 (aspecto pixelado).
- Personajes Quaternius: mantener una silueta CT/T legible si se retocan materiales o modelos.
