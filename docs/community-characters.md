# Personajes comunitarios

| Equipo | Modelo de runtime | Autor | Licencia | Rig |
|---|---|---|---|---|
| T | [Leet model](https://sketchfab.com/3d-models/leet-model-fe6216ca48b048e69e593b7a94a73f17) | Themodelingveseq•• | CC BY 4.0 | 122 joints originales |
| CT | [FREE [Military Soldier] RIGGED](https://sketchfab.com/3d-models/free-military-soldier-rigged-e9c56308a67d4a3db62e914fafa4d198) | BAMEN | CC BY 4.0 | 78 joints |

El modelo Leet fue entregado por el usuario el 24/10/2026 y conserva el GLB original. El soldado CT de BAMEN se obtuvo de la [distribución de 3d-fps](https://github.com/cktang88/3d-fps/tree/main/public/assets/models/characters), que acredita al autor original. `scripts/convert-ct-soldier.py` retira los clips de animación de esa distribución, conserva malla y pesos, y renombra los controles usados por el animador del juego. Las poses de locomoción, apuntado, disparo y agarre son propias de DEUSHIMA STRIKE.

La primera integración CT del 24/10/2026 utilizaba un soldado de Jellypack bajo CC BY-NC 4.0. Ese original y su rig permanecen archivados en `assets/characters/community/SAS` y `sas.glb` para conservar los archivos aportados por el usuario. `scripts/build-static.mjs` copia únicamente `leet.glb` y `sas-bamen.glb`, además de sus licencias de runtime; excluye el modelo no comercial del sitio público.

`src/characters.js` carga ambos GLB, los normaliza a 1,8 unidades y clona sus esqueletos para los avatares. `src/characters/community-rig.js` usa IK para las piernas y para las manos que sujetan las armas de tercera persona. Los IDs del protocolo están en `src/characters/identities.js`.

La procedencia, hashes y transformaciones actuales figuran en `docs/v3-asset-manifest.json`. `docs/community-model-integrity.json` documenta la auditoría histórica del modelo Jellypack; no describe el CT de runtime actual.
