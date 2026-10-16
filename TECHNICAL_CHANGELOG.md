# Technical changelog

## 0.2.0
- `Code.gs` `VERSION` 0.2.0. `Organizers` schema + `Role` ('admin'|''), `TempUntil` (ISO or ''). Blank values are read as organizer / no temp password, so old rows work before and after re-running `setup()` (it only rewrites headers).
- Session record `{id, pv}` where `pv` = first 16 hex of the password hash; `requireSession_` re-reads the sheet on every call and compares `pv`, `Active`, `Role`, `TempUntil`. Password change/reset/disable therefore invalidates sessions with no cache enumeration. `dispatch_` blocks everything except `changePassword`, `logout`, `whoami` (`ALLOWED_WHILE_TEMP`) while a temp password is pending (`password_change_required`).
- New actions: `whoami`, `changePassword` (current password required, shares the login lockout key, returns a new session), admin-only `listOrganizers`, `createOrganizer`, `resetOrganizerPassword`, `setOrganizerActive`, `setOrganizerRole` (`requireAdmin_`). Guards: no self reset/disable, last active admin protected, 50 organizers max, case-insensitive unique names. Temp password: 12 chars of a 31-symbol alphabet, rejection sampling over `Utilities.getUuid()` bytes, 72 h. Never logged or put in Audit.
- Editor-only: `addOrganizer(name, password, role)`, `makeAdminFromProperties` (`ADMIN_ORG_NAME`).
- Frontend: `views/team.js`, `views/password.js`; routes `#/team`, `#/password`; `session.js` stores `role` and `mustChange`; router redirects forced changes and non-admins; `api.js` handles `password_change_required`; Password link in the top bar; Team button on the dashboard for admins.
- Tests: `qa/organizers.test.mjs` (18) and 5 e2e. `helpers.mjs` makes 'Hector D.' an admin. Total 111.

## 0.1.8
- `ui.js`: `rankTone(n)` -> `r1|r2|r3|rn`; CSS vars `--rk-fill/--rk-ink/--rk-text` (`.r1 #e0b14a`, `.r2 #c9d1dd`, `.r3 #cf8a5c`, `.rn #2a3140`). Aplicado en `present.js` (`pres-rank`, `sl-rank`), `player.js`, `editEvent.js`, `newEvent.js`. Icono `refresh` en SVG; `refreshButton` usa `replaceChildren(icon, text)`.
- `login.js`: se eliminan eyebrow y `.steps`; `sample()` (`.sample`, `aria-hidden`) con 4 `.mini-row`. CSS muerto `.eyebrow/.steps/.step` eliminado.
- A11y: `present.js` con región `role=status aria-live=polite` (`announce()`), `.pres-place` con `.sr-only` ordinal+récord, `h1.app` "Standings"; `.sr-only` global; `aria-label` en progressbar y botones "That's me".
- `.cardlist` con fallback `2.6vh` antes de `cqw`.
- Pruebas: +3 (login, podio con contraste >=4.5, semantica de lector de pantalla). Total 88.
- No verificable en el sandbox: WebKit, fuentes reales, Apps Script/Pages en vivo, lectores de pantalla reales.

## 0.1.7
- CSS: `.tabs` segmentado, `.colors` grid de 5 (vertical bajo 560 px), `.btn.gold-outline`, `.ev-line`, `.lock-note`, `color-scheme: dark`, `accent-color`, `::selection`, `caret-color`, `scrollbar-color`, `tabular-nums`, `text-wrap: balance`, `prefers-reduced-motion` global, `.head-actions` con `order`.
- `newEvent.js`: `sharePanel` oculto hasta crear; `oninput` limpia `.banner.error`. `player.js`: sin `.eyebrow`, `aria-labelledby` en tablist. Se mantienen la tarjeta de pasos 01/02/03 y el kicker del login (decisión pendiente).
- Pruebas: aserción de error limpiado al editar. Total 85.

## 0.1.6
- `config.js`: `CAPYLEAGUE_URL` opcional (solo https). `layout.js`: `capyLeagueLink()` en `organizerShell`. La protección real del contenido depende del modo de compartir del artifact, no del login de esta app (la URL está en el código público).
- Pruebas e2e: +1 (visible solo para organizadores, `target=_blank`, `rel=noopener`). Total 85.

## 0.1.5
- `present.js`: `linkPanel` incrusta `<iframe class="embed-frame">` si `embeddable(url)` (https + hostname `exburst.dev`); `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"` (sin `allow-top-navigation`), `referrerpolicy="no-referrer"`. Fallback de caja con link si el host no es válido. `.pres-main.wide` también para links. No hay forma fiable de detectar el bloqueo X-Frame-Options desde JS, por eso el botón de respaldo siempre está visible.
- Pruebas e2e: +1 (iframe, sandbox, tamaño, botón de respaldo); `newPage` intercepta `https://exburst.dev/**` con una página falsa. Total 84.
- Probado a mano por el usuario: Exburst permite incrustarse (archivo de prueba aparte).

## 0.1.4
- `player.js`: `draw()`/`drawPicker()` devuelven arrays con `null`; `replaceChildren(...arr)` convertía `null` en el texto "null". Ahora `.filter(Boolean)` en las 7 llamadas.
- `present.js`: `showMissing` (oculto por defecto); `ensurePhoto` mide la proporción (`p.ratio`) antes de pintar y usa `.pres-main.wide` si ratio >= 1.2; `.catch` encadenado (el `throw` por MIME inválido no llegaba al manejador de error del mismo `.then`); caption en `.pres-zoom`; la diapositiva de link muestra `.link-url`.
- CSS: `.sl-row:focus-visible` con outline 3 px; placeholder `#858ea3`; `.sl-row.none` sin opacity; `@media (pointer: coarse) { .btn.small { min-height: 44px } }`; `.ev h2`.
- Pruebas e2e: listado con toggle y contraste, "null", títulos y tamaños táctiles, imagen ancha/alta con zoom. Total 83. La prueba de "null" se verificó fallando sin el arreglo.

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
