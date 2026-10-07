# Tejado al Sol

**Simulador de placas solares en 3D** + una página por municipio de España (~6.000) con producción, ahorro y amortización calculados con la radiación real de PVGIS.

- Dibuja tu tejado (dos aguas, un agua, cuatro aguas o plano) con sus medidas, inclinación y orientación.
- Coloca o quita cada panel tocando el tejado. «Tamaño óptimo» elige cuántos paneles y dónde dejan más beneficio con tu consumo.
- Añade chimeneas, claraboyas, árboles y edificios: el simulador calcula la sombra hora a hora sobre cada panel y colorea los que rinden menos.
- Mueve el Sol por meses y horas para ver las sombras.
- Resultados: producción mensual, autoconsumo, excedentes, batería, ahorro, amortización y beneficio a 25 años.
- Comparte la simulación con un enlace (todo va en el propio enlace; no hay servidor ni base de datos).

## Cómo se publica (gratis)

GitHub Actions hace todo en `.github/workflows/deploy.yml`:

1. La primera vez descarga de PVGIS la radiación de los ~6.000 municipios (unos 20 minutos) y la guarda en `data/radiation.json`. Las siguientes veces solo descarga lo que falte.
2. Genera el sitio con `node build.js`.
3. Lo publica en GitHub Pages. Se reconstruye solo cada lunes.

Puesta en marcha: en el repositorio, **Settings → Pages → Source: GitHub Actions** y después **Actions → Construir y publicar → Run workflow**.

Con dominio propio: variables `SITE_URL` (`https://tudominio.es`) y `BASE_PATH` (`/`) en Settings → Secrets and variables → Actions → Variables.

## Desarrollo local

```bash
npm install
node scripts/dev-radiation.js    # datos aproximados SOLO para probar sin internet (no se publican)
# o, con internet: node scripts/fetch-radiation.js
BASE_PATH=/ node build.js --limit 40
npx serve dist
```

## Estructura

- `src/solar.js` — motor fotovoltaico y económico (posición del Sol, Hay-Davies, temperatura, pérdidas, autoconsumo, batería, compensación, 25 años). Funciona en Node y en el navegador.
- `src/roof.js` — geometría del tejado, huecos para paneles, obstáculos y sombras.
- `public/sim.js` — simulador 3D (Three.js).
- `build.js` — páginas de municipio, provincia, ranking, inicio y metodología.
- `scripts/fetch-radiation.js` — descarga de PVGIS.
- `site.config.js` — URL, AdSense y contacto.

## Monetización

- AdSense: variable `ADSENSE_CLIENT`.
- Lo más rentable a medio plazo: captación de contactos para instaladores (formulario «Quiero presupuesto») o licenciar el simulador a instaladores para su web.

## Créditos

Radiación: PVGIS © Unión Europea (JRC). Municipios: GeoNames (CC BY 4.0). 3D: Three.js (MIT).
