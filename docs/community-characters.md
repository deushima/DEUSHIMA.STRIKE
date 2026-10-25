# Personajes comunitarios entregados por el usuario

El 24/10/2026 el usuario reemplazó los dos IDs iniciales del prompt por los
archivos de `assets/characters/community`. El manifiesto registra esta elección.

| Equipo | Modelo | Autor | Licencia | Rig |
|---|---|---|---|---|
| T | Leet model, fe6216ca48b048e69e593b7a94a73f17 | Themodelingveseq•• | CC BY 4.0 | 122 joints originales |
| CT | PS1/Low Poly Gas Mask Soldier, d2807183ee004888890b4aa8285541d2 | Jellypack | CC BY-NC 4.0 | 21 huesos añadidos |

Originales y ZIP del usuario intactos. Leet GLB conserva su SHA-256 exacto.
SAS se riggeó en Blender 4.4.3 calculando pesos sobre una copia soldada y
transfiriéndolos a los 657 vértices de la malla original. No se exportó la
topología auxiliar. La exportación glTF duplica 3 vértices por atributos:
660 vértices de runtime, los mismos 680 triángulos, mismas UV en cada esquina
a tolerancia 1e-6 y texturas con píxeles idénticos. SAS: 256²; Leet: 1024².
No hay mapas normales ni tangentes en los originales; no se inventaron detalles.
Ver `community-model-integrity.json` y `v3-asset-manifest.json`.

## Integración

- `src/characters.js`: carga ambos GLB una vez, normaliza escala y orientación,
  clona skeleton por avatar, y añade iluminación ambiental neutra a materiales
  PBR sin cambiar factores ni texturas del archivo original.
- `src/characters/community-rig.js`: poses propias desde estado de juego,
  dirección local, salto, agachado, disparo y arma; torso y cuello articulados;
  IK de ambos brazos y piernas. Las transiciones se suavizan y no acumulan
  rotaciones entre frames. No se reutilizaron clips de Valve.
- `src/characters/identities.js`: identidades explícitas en el protocolo.
- Bots y online usan los mismos modelos. El SAS ya no necesita rigging en runtime.
- `character-credits.html` es accesible en el juego y se incluye en el build.

Para reproducir el rig: Blender `--background --python-exit-code 1 --python
tools/rig-community-sas.py -- --input <SAS-original.glb> --output <directorio>`.

## QA y límites

40 combinaciones: ambos modelos, pitch -80/-45/0/45/80, pie/agachado y rifle/pistola.
Distancia muñeca-target menor a 0.015 unidades; en la ejecución medida, ~1e-7.
El root no se inclina para apuntar. Mesh original no cambia con las poses.
Clones independientes. Tras crear/eliminar 20 personajes: geometrías GPU 20→20,
texturas 8→8 (incluye el entorno neutro). Video y capturas de navegador reales
en `tests/artifacts/community`. `npm run test:characters` requiere Playwright
en `PLAYWRIGHT_MODULE` y el servidor local activo.

Son poses tácticas procedurales adaptadas a rigs comunitarios. No son clips
idénticos a Valve ni captura de movimiento. Los rigs no articulan cada dedo;
el contacto individual de dedos y algunas deformaciones del SAS de 680 triángulos
tienen la resolución del modelo original. Las armas externas son las formas
procedurales del proyecto, no worldmodels comerciales importados.
La prueba de rendimiento mide envío de frames en Chrome headless/SwiftShader;
no certifica FPS reales de hardware. La validación visual y de red no sustituye
un playtest humano de comodidad y estética.

Licencias incluidas por Sketchfab: Leet con atribución, SAS con atribución y uso
no comercial. El usuario declaró diseños comunitarios independientes; la auditoría
registra esos datos y no pretende probar la autoría histórica sólo por su apariencia.
