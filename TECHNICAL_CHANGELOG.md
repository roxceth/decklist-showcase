# Technical changelog

## 0.1.3
- `presentView(eventId, startIndex = -1)`: `view` = `list` | `slide`; `renderList()` pinta todos los `entries` (no solo los que tienen deck); `showList()`; teclas L / Esc (slide -> list -> salir); Home/End/Z/flechas solo en slide; Reload conserva la vista. CSS `.standings` (grid por columnas, `.multi` apila el deck bajo el nombre).
- Pruebas e2e: +1 (listado: orden, clic, volver, recarga), las existentes ahora abren primero un jugador desde el listado. Total 80.

## 0.1.2
- `manifest.webmanifest` + `apple-touch-icon` (180), `icon-192/512`, `icon-maskable-512` (opacos, fondo #0d0f14, generados de `assets/logo.png`); meta `theme-color`, `apple-mobile-web-app-*`, `viewport-fit=cover`. iOS ignora los íconos del manifest y usa apple-touch-icon.
- Presentación: barra inferior reestructurada (`.pres-tools` / `.pres-arrows`), media queries ≤760 px y landscape bajo, safe-area insets, swipe táctil, botón Fullscreen oculto en `(hover:none)`.
- Formulario nuevo torneo: `.form-actions` apilado ≤640 px; `.textarea` 16 px; `input[type=date]` con `appearance:none`.
- Pruebas e2e: +5 (presentación en 3 tamaños de celular, formulario móvil, manifest/íconos). Total 79.

## 0.1.1
- `config.js`: `APP_NAME`, `LOGO_URL`. `ui.js`: `appName()`, `logoEl()` (img con fallback a SVG en `error`), `refreshButton()`.
- Sin polling: solo refresco manual (menos llamadas a Apps Script). Logo: original negro/blanco convertido a alfa (luminancia invertida) y teñido de dorado #e0b14a, 512x512.
- Presentación: `presentView(eventId, startIndex)`; `reload()` hace `runLeave()` y vuelve a montar conservando el índice.
- Pruebas e2e: +2 (marca/refrescos, fallback de logo). Total e2e 15.

## 0.1.0
- **Arquitectura**: sitio estático (ES modules sin dependencias) + Apps Script web app como API JSON (`POST text/plain`, evita preflight CORS) + Sheets + Drive. Router por hash (`#/`, `#/dashboard`, `#/new`, `#/edit/<id>`, `#/present/<id>`, `#/e/<id>`).
- **API**: público `ping, getEvent, claimPlayer, submitDeck, login`; organizador (token de sesión en CacheService, 6 h, revalidado contra la hoja Organizers en cada llamada) `logout, listEvents, createEvent, getEventAdmin, updateEvent, setStatus, addPlayer, updatePlayer, removePlayer, releaseName, releaseList, undoRelease, getDecklists, getPhoto, deleteEvent`. Respuestas `{ok,data}` / `{ok:false,error:{code,message}}`; errores internos se registran y se devuelven genéricos.
- **Datos**: hojas Organizers, Events, Players, Decklists, Audit, Config; todas con formato de texto `@` (y se reaplica al agregar filas) para que fechas/números/`=` no se reinterpreten; búsquedas por ID, nunca por número de fila; escrituras por lotes (`appendObjs_`, `deleteWhere_` con llamadas constantes).
- **Concurrencia**: `LockService.getScriptLock` en toda escritura (10 s, error `busy`); la foto se sube a Drive antes del lock y se envía a la papelera si la escritura falla.
- **Seguridad**: contraseña SHA-256 con sal; bloqueo 5 fallos/15 min; secreto del jugador generado en el navegador (hash en servidor, un secreto no reclama dos nombres en el mismo torneo); validación de enlaces Exburst por regex estricta; imágenes por magic bytes (JPEG/PNG/WEBP, ≤1.5 MiB); rechazo de `= + @` al inicio; auditoría sin secretos ni contenido; frontend solo usa `textContent`.
- **Parsers compartidos**: `shared/parsers.js` → `apps-script/Parsers.gs` generado (`qa/sync-parsers.mjs`, verificado en `npm test`).
- **Frontend**: compresión de imagen con canvas (≤1600 px, JPEG q0.8 con descenso de calidad), ZIP "store" propio con CRC32, presentación con tamaño de fuente según ancho de columna (container query) y 2–4 columnas.
- **QA**: simulador en memoria de Apps Script (`qa/mock-gas.mjs`, fecha controlable, formato de celdas emulado), pruebas `node:test`, e2e con Playwright (escritorio 1280 y móvil 390), mutaciones manuales de reglas críticas verificadas, `qa/live-smoke.mjs` para el despliegue real.
- **Defectos encontrados en revisión visual y corregidos**: códigos truncados en listas largas, columnas desalineadas en la tabla de jugadores, separación entre secciones, error obsoleto visible tras corregir, etiqueta de color sin estilo.
