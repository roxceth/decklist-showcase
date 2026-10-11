# Changelog

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
