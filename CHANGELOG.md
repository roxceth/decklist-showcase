# Changelog

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
