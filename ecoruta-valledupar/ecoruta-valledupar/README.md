# EcoRuta Valledupar

Prototipo web del proyecto **Proyecto de Ingeniería II** (UNAD): monitoreo IoT del llenado de contenedores de residuos y rutas de recolección que incluyen solo los contenedores que ya lo necesitan.

Todo el contenido es de demostración: los contenedores, sus ubicaciones y sus niveles de llenado son simulados.

## Páginas

| Archivo | Qué muestra |
|---|---|
| `index.html` | Portada con una demostración del umbral y enlaces a las demás páginas |
| `dashboard.html` | Mapa de Valledupar con 53 contenedores, lista lateral, umbral, filtro de críticos y rutas por calles para 1 a 3 camiones |
| `hardware.html` | Modelo 3D del contenedor y su equipo: se gira, se acerca y se separa por piezas |
| `conductor.html` | Pantalla del conductor con próxima parada, indicaciones giro a giro y botón «Recolectado» |
| `proyecto.html` | Problema, alcance, funciones cubiertas, límites y estructura del código |

## Cómo ejecutarlo

Necesita conexión a Internet (mapas, rutas, tipografías y librerías se cargan desde la red).

Con Python instalado, desde la carpeta del proyecto:

```
python -m http.server 8000
```

Luego abra `http://localhost:8000`. También funciona con la extensión Live Server de VS Code. Abrir `index.html` con doble clic suele funcionar, pero algunos navegadores limitan `localStorage` en archivos locales; el servidor local evita ese problema.

## Publicarlo en GitHub Pages

1. Cree un repositorio y suba el contenido de la carpeta (que `index.html` quede en la raíz).
2. En el repositorio: **Settings → Pages**.
3. En **Build and deployment** elija **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`.
4. Al terminar, el sitio queda en `https://SU_USUARIO.github.io/NOMBRE_DEL_REPOSITORIO/`.

## Estructura

```
ecoruta-valledupar/
├── index.html  dashboard.html  hardware.html  conductor.html  proyecto.html
├── css/
│   ├── base.css        variables de diseño, encabezado, botones, avisos
│   └── home.css  dashboard.css  hardware.css  conductor.css  docs.css
├── js/
│   ├── config.js       todos los ajustes (umbral, colores, supuestos, servidor de rutas)
│   ├── geo.js          distancias, formatos y escape de texto
│   ├── data.js         generación de los 53 contenedores simulados
│   ├── store.js        estado compartido y localStorage
│   ├── routing.js      OSRM, agrupación, orden de paradas y ahorro
│   ├── layout.js       encabezado, pie de página y avisos
│   ├── map.js          funciones del mapa con Leaflet
│   └── home.js  dashboard.js  hardware3d.js  conductor.js
├── assets/favicon.svg
└── tests/run-tests.js
```

Los scripts son clásicos (sin módulos ES) y cuelgan de un único objeto global, `EcoRuta`. En cada HTML el orden de carga importa: primero `config.js`, `geo.js`, `data.js`, `store.js`, `routing.js` y `layout.js`; al final el script de la página.

## Librerías externas (versión fija)

| Librería | Versión | Uso |
|---|---|---|
| Leaflet | 1.9.4 | Mapas (cdnjs) |
| Three.js + OrbitControls | r147 | Modelo 3D (jsDelivr). Es la última versión que incluye OrbitControls como script clásico |
| OpenStreetMap | – | Fondo del mapa |
| OSRM (servidor público de demostración) | – | Rutas por calles |
| Bricolage Grotesque, Atkinson Hyperlegible | – | Tipografías (Google Fonts) |

## Cómo se calculan las rutas

1. Una sola consulta a OSRM (`/table`) trae las duraciones y distancias entre la base y los 53 contenedores, y ajusta cada contenedor a la calle más cercana.
2. Los contenedores críticos (nivel ≥ umbral) se reparten entre los camiones con k-means.
3. Cada camión ordena sus paradas con vecino más cercano y mejora el orden con 2-opt.
4. OSRM (`/route`) dibuja el recorrido real por calles e indica los giros.
5. El ahorro se compara con **un camión que recoge todos los contenedores**.

Si OSRM no responde, se usan distancias estimadas (línea recta × 1,35 a 22 km/h) y las rutas se dibujan punteadas.

## Supuestos editables (`js/config.js`)

- Umbral inicial de 80 % (accesos rápidos a 80 % y 90 %).
- 0,45 L de combustible por km, 2,68 kg de CO₂ por litro, 2 minutos por parada.
- Base de los camiones y centros de los sectores: ubicaciones aproximadas, no oficiales.

## Pruebas

La lógica pura (datos, estado, rutas) se prueba con Node, sin librerías externas:

```
node tests/run-tests.js
```

## Límites

- No hay sensores ni servidor reales; el estado vive en el navegador (`localStorage`).
- El servidor público de OSRM es para demostración y puede limitar el uso.
- Los valores del hardware son de referencia y deben confirmarse con las hojas de datos; en Colombia se debe verificar la normativa de la ANE para la banda LoRa.
- La vista del conductor mueve un camión de prueba; no lee un GPS.

## Autoría

Juan José Domínguez Picón · Proyecto de Ingeniería II · Universidad Nacional Abierta y a Distancia (UNAD).
