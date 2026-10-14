# Changelog

## 0.1.5
- **Listas enviadas como link de Exburst:** ahora la presentación muestra la página de Exburst dentro del slide (a pantalla ancha, con el jugador en una franja arriba), en vez de un botón. Debajo queda "Open on Exburst" por si la página no carga o pide iniciar sesión. Solo se incrusta `https://exburst.dev`. La página incrustada no puede mover ni redirigir tu presentación.
- Aviso: si una persona usa Exburst con sesión iniciada y tú no, es posible que veas distinto; lo ideal es probar el link antes de grabar. Si haces clic dentro de la página incrustada, el teclado deja de cambiar de slide hasta que pulses un botón de la barra de abajo o fuera del recuadro.

## 0.1.4
Cambios a partir de una revisión de diseño.
- **Corregido:** la pantalla del jugador mostraba la palabra "null" encima de "Find your name" en torneos abiertos. Ya no aparece (tampoco tras Refresh).
- **Presentación:** el listado ya no muestra a los jugadores sin lista (ni el conteo "N players have no list") en el cuadro grabado. Hay un botón **Show without list (N)** en la barra de abajo, solo para ti, para verlos atenuados y volver a ocultarlos.
- **Presentación, imágenes:** si la imagen es horizontal, usa casi todo el ancho de la pantalla y los datos del jugador pasan a una franja arriba. Al ampliar con **Z** ahora se ve el nombre del jugador.
- **Presentación, links:** la diapositiva muestra el link como texto y avisa que abre Exburst en una pestaña nueva (la presentación no se cierra).
- **Accesibilidad:** el foco del teclado en el listado ahora es un contorno visible; mejor contraste en los placeholders y en las filas sin lista; botones pequeños de 44 px en pantallas táctiles; títulos del panel en orden correcto (h1 > h2).
- Si una foto no se puede cargar, ahora muestra "Try again" (antes podía quedarse en "Loading photo…").

## 0.1.3
- **Presentación con listado por posiciones**: al presentar, ahora se abre primero una pantalla con todos los jugadores en orden de posición, con su nombre, récord y el deck que usaron (color y nombre). Tú eliges a quién mostrar: haces clic en un jugador y se abre su decklist. Con el botón **List (L)** o la tecla **L** (o **Esc**) vuelves al listado; **Esc** otra vez sale de la presentación. Las flechas siguen pasando de un jugador a otro.
- Los jugadores que aún no enviaron lista aparecen atenuados con "No list yet" y no se pueden abrir.
- Hasta 8 jugadores se muestran en 1 columna, hasta 16 en 2 y más en 3, para que todo quepa en una sola pantalla al grabar. En celular es una lista con scroll.

## 0.1.2
- **Presentación en celular**: los botones de abajo (flechas, contador, Exit, Reload) ya no se salen de la pantalla ni quedan tapados. En vertical se apilan (flechas grandes arriba, Exit/Reload abajo); en horizontal todo cabe en una línea. Se puede **deslizar** el dedo a izquierda/derecha para cambiar de jugador. Respeta la barra inferior del iPhone.
- **Crear torneo en celular**: botones "Create & get link" y "Cancel" a todo el ancho (ya no se parte el texto), campos de 16 px (Safari ya no hace zoom al tocar), selector de fecha uniforme.
- **Guardar como app en la pantalla de inicio**: ahora aparece el logo de CapyBros (ícono dorado sobre fondo oscuro), con el nombre "CapyBurst" y abre a pantalla completa. Si ya la habías guardado antes, elimina el acceso directo y vuelve a agregarlo para que tome el ícono nuevo.

## 0.1.1
- Nombre visible para todos: **CapyBurst Decklist Showcase** (cabecera, pestaña del navegador y presentación). Se cambia en `config.js` (`APP_NAME`).
- Logo de CapyBros (`assets/logo.png`, en dorado sobre fondo transparente) en la cabecera y como ícono de la pestaña. Se cambia con `LOGO_URL` en `config.js`; si el archivo falta, se usa el ícono de siempre.
- Botón **Refresh** (solo manual, sin actualización automática, para no saturar Apps Script) en panel, editar torneo y página del jugador. En la presentación: botón o tecla **R** para recargar las listas sin perder la posición.
- Corregido "Hector D.." (doble punto) en el panel.

## 0.1.0 — primera versión
**Organizador**
- Inicio de sesión con nombre y contraseña (varios organizadores; todos ven todos los torneos).
- Crear torneo pegando resultados (rango y récord opcionales), fecha, días de auto-borrado (1–90, 14 por defecto) y link de Exburst opcional. Vista previa en vivo y link para compartir.
- Panel con filtro "Todos / Solo míos", progreso de listas, copiar link y borrar ahora.
- Editar torneo: detalles, cerrar/abrir envíos, agregar jugador tardío, editar nombre/rango/récord, quitar jugador, liberar nombre, liberar lista (la anterior se conserva hasta que llegue la nueva) y deshacer la liberación.
- Ver cada lista, descargar `.txt` por jugador y exportar todo en `.zip` (txt + `summary.csv`).
- Presentación a pantalla completa: flechas/espacio, `F` pantalla completa, `Z` ampliar imagen, `Esc` salir; precarga de fotos; listas largas en 2–4 columnas sin cortar códigos.

**Jugador (sin cuenta)**
- Elige su nombre, confirma, y envía: texto de Exburst (pegado o archivo `.txt`), imagen (se reduce en el dispositivo a JPEG ≤1600 px) o link de Exburst. Nombre de mazo opcional y color obligatorio (Red, Blue, Green, Yellow, Purple).
- Su secreto vive solo en su navegador; el servidor guarda únicamente su hash.

**Seguridad y datos**
- Borrado automático diario; fotos privadas en Drive, servidas solo al organizador; validación de imágenes por bytes reales; protección contra fórmulas en Sheets y contra HTML inyectado.

**Calidad**: 44 pruebas de API, 10 de parsers, 5 unitarias, 13 de pantallas (escritorio y móvil) y script de humo para el despliegue real.

**Sin verificar todavía**: Apps Script real (usa `qa/live-smoke.mjs`), iPhone/Safari, latencia de arranque en frío, tiempo real de carga de fotos, importación del `.txt` en Exburst.
