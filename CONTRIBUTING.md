# Colaboración y publicación — DEUSHIMA STRIKE

Repositorio destino: https://github.com/Juancaina/DEUSHIMA.STRIKE
Producción actual: https://cs16-1v1.vercel.app/
Rama de publicación: `main`.

## Desarrollo colaborativo

1. Clonar el repositorio e instalar dependencias con `npm install` si se necesitan para desarrollo.
2. Trabajar sobre una rama `feat/<descripcion>` y abrir un Pull Request para revisar los cambios, o publicar a `main` si ambos acuerdan acceso directo.
3. Vercel debe estar conectado al repositorio y configurado para publicar `main` automáticamente. La compilación está definida en `vercel.json`: `npm run build:static` con salida `dist`.
4. No usar `npm run deploy` para el flujo colaborativo: este comando despliega manualmente por CLI con credenciales de Vercel.

## Recursos y tests

- `assets/cs16/`, `dist/` y `node_modules/` están excluidos de Git. Los recursos propietarios de GoldSrc/Valve no deben subirse al repositorio público.
- En un clon limpio sin `assets/cs16/sound`, el build funciona y genera una versión sin esos audios. Esto **no es idéntico** al deployment manual que incluye audio local.
- Los tests `node tests/duel-logic.test.mjs` y `node tests/redline-map.test.mjs` se pueden ejecutar sin esos archivos. `npm test` también revisa recursos locales que no se incluyen en Git.

## Cuentas y despliegues

- Organización GitHub: `Juancaina`. Colaboradores previstos: `deushima`, `krestosa`.
- Para Vercel Hobby y GitHub Organization, la integración nativa requiere un repositorio público; los repositorios privados de organizaciones requieren Vercel Pro. Antes de migrar, revisar que la visibilidad pública del código esté permitida.
- No compartir tokens de Vercel, claves, cookies, `.env`, ni credenciales con colaboradores ni commitearlos.