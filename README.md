# Decklist Showcase v0.1

Herramienta para el equipo **Capy** (Union Arena): el organizador crea un torneo pegando los resultados, comparte un link, los jugadores reclaman su nombre y envían la lista que jugaron (texto de Exburst, imagen o link de Exburst), y el organizador presenta todas las listas en pantalla completa para grabar el video de showcase. Los datos se borran solos (14 días por defecto).

## Cómo está armado

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Sitio (HTML/JS/CSS, sin dependencias) | GitHub Pages (`roxceth/decklist-showcase`, raíz) | Pantallas de organizador, jugador y presentación |
| API JSON | Google Apps Script (web app, "Execute as: Me", acceso "Anyone") | Reglas, seguridad, lectura/escritura |
| Base de datos | Google Sheets (`DecklistShowcase_DB`) | Torneos, jugadores, listas, auditoría |
| Fotos | Google Drive (carpeta privada por torneo) | Las imágenes; solo salen por la API al organizador |

## Despliegue paso a paso

### 1. Backend (Apps Script)
1. Entra a <https://script.google.com> > **Nuevo proyecto** (con la cuenta de Google donde quieres guardar datos).
2. Crea los archivos `Code.gs` y `Parsers.gs` y pega el contenido de `apps-script/Code.gs` y `apps-script/Parsers.gs`.
3. **Configuración del proyecto** > activa *Mostrar el archivo de manifiesto appsscript.json* y pega el contenido de `apps-script/appsscript.json` (ajusta `timeZone` si quieres).
4. Ejecuta la función **`setup`** (menú de funciones > Ejecutar). Acepta los permisos. Crea la hoja `DecklistShowcase_DB`, la carpeta `DecklistShowcase_Photos` y el disparador diario de borrado.
5. Crea **tu cuenta de administrador** (solo esta vez desde el editor): en **Configuración del proyecto > Propiedades de la secuencia de comandos** agrega `NEW_ORG_NAME` y `NEW_ORG_PASSWORD` (mínimo 8 caracteres), ejecuta **`addOrganizerFromProperties`** y después agrega `ADMIN_ORG_NAME` (tu mismo nombre) y ejecuta **`makeAdminFromProperties`**. Las propiedades se borran solas al terminar. Los demás organizadores se crean desde la app, en la pantalla **Team** (ver abajo).
6. **Implementar > Nueva implementación > Aplicación web**: *Ejecutar como: Yo*, *Quién tiene acceso: Cualquier persona*. Copia la URL que termina en `/exec`.

**Si ya tenías la v0.1 desplegada y actualizas a la v0.2:** pega el nuevo `Code.gs`, ejecuta **`setup`** otra vez (solo agrega las columnas nuevas `Role` y `TempUntil` a `Organizers`; no toca los datos), ejecuta **`makeAdminFromProperties`** con tu nombre en `ADMIN_ORG_NAME`, y en **Implementar > Administrar implementaciones > editar (lápiz) > Nueva versión** (la URL `/exec` no cambia). Sin el paso de administrador nadie podrá usar Team.

### Equipo (organizadores)
- Un **administrador** abre **Team** (botón en el panel), escribe un nombre y pulsa *Add organizer*. La app genera una **contraseña temporal** (se ve una sola vez, vale 72 horas) y un mensaje listo para copiar y enviar a la persona.
- La persona entra con esa contraseña y la app le obliga a elegir la suya antes de hacer nada más. Cualquier organizador puede cambiarla luego con el botón **Password**.
- En Team el administrador puede *Reset password* (genera otra temporal y cierra las sesiones de esa persona), *Disable/Enable* y *Make admin/Remove admin*. Siempre queda al menos un administrador activo, y nadie puede desactivarse ni resetearse a sí mismo desde ahí.
- Desde el editor siguen existiendo `addOrganizerFromProperties` (con `NEW_ORG_NAME`/`NEW_ORG_PASSWORD`) y `disableOrganizerFromProperties` (`DISABLE_ORG_NAME`) como salida de emergencia, por ejemplo si pierdes tu contraseña de administrador.

### Seguridad con el código público
El repo es público, pero **nada secreto está en él**: las contraseñas (solo sus hashes con sal), los roles y el ID de la hoja viven en tu Google Sheet y en las propiedades de tu Apps Script. La URL `/exec` es pública por diseño. El permiso de administrador **se lee de la hoja en cada llamada**: aunque alguien modifique el código del navegador o envíe campos como `role: admin`, el servidor lo ignora. Cambiar o resetear una contraseña, o desactivar a alguien, cierra sus sesiones de inmediato.

### 2. Sitio (GitHub Pages)
1. Sube a la raíz del repo: `index.html`, `config.js`, `css/`, `js/`, `shared/`, `assets/` (el resto es opcional).
2. En `config.js` pon la URL `/exec` en `API_URL`.
3. Settings > Pages > rama principal, carpeta `/ (root)`.

### 3. Verificar contra Google de verdad
```
API_URL="https://script.google.com/macros/s/XXXX/exec" ORG_NAME="Tu nombre" ORG_PASSWORD="..." node qa/live-smoke.mjs
```
Crea un torneo temporal, sube una foto a Drive, la lee de vuelta y lo borra. Si algo falla, no sigas: pásame el resultado.

### Actualizar el backend más adelante
Cambia el código y usa **Implementar > Administrar implementaciones > Editar > Nueva versión**. La URL `/exec` no cambia.

## Pruebas (para quien modifique el código)
```
npm test            # sincronía de parsers + backend + unitarias + pantallas (Playwright)
npm run test:backend
npm run test:e2e
npm run dev         # servidor local con API simulada: http://127.0.0.1:8080
```
Las pruebas del backend corren el `Code.gs` real dentro de un simulador de los servicios de Google (Sheets, Drive, Cache, Lock). **Un simulador no prueba a Google**: por eso existe `qa/live-smoke.mjs`.

`apps-script/Parsers.gs` se genera desde `shared/parsers.js` (`npm run sync`); no lo edites a mano.

## Límites conocidos (honestos)
- Apps Script no permite limitar por IP: alguien con el link de un torneo podría intentar reclamar nombres o llenar listas. Mitigaciones: ID aleatorio de 12 caracteres, un secreto por navegador, validación estricta, el organizador puede cerrar el torneo y liberar nombres.
- El bloqueo por 5 intentos fallidos de login es por nombre (alguien podría bloquear a propósito a un organizador durante 15 min). La sesión (6 h) y los contadores viven en la caché de Google, que puede vaciarse: solo implica volver a iniciar sesión.
- Quien conozca la contraseña temporal de alguien antes de que la use podría entrar como esa persona durante 72 horas: envíala por un canal privado (mensaje directo, no el grupo) y revisa en Team que diga *Has not signed in yet* hasta que la persona entre.
- Contraseñas con SHA-256 + sal (una vuelta). Aceptable con mínimo 8 caracteres y bloqueo, pero no es bcrypt.
- Latencia ~1 s por llamada; la primera después de un rato inactivo puede tardar varios segundos.
- La importación del `.txt` exportado hacia Exburst no está verificada.

Ver `CHANGELOG.md`, `TECHNICAL_CHANGELOG.md` y `docs/GUIA_USUARIO.md`.
