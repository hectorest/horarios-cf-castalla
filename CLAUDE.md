# Planificador de Campo · Castalla C.F.

Web estática (HTML + CSS + JS sin compilación) en GitHub Pages con dominio propio `intranet.cfcastalla.com` (archivo `CNAME`; CNAME en Arsys → `hectorest.github.io`), con datos en Supabase (proyecto `wwkfaxrmmbptuithqpxn`). Todo el texto de la interfaz va en español de España.

## Reglas al añadir o cambiar funcionalidades

- **Tutorial**: toda funcionalidad visible nueva o cambiada debe tener su paso en `tutorial.js` (`TUTORIAL_STEPS`). Usa `since` = (valor máximo actual + 1) para que los usuarios que ya vieron el tutorial vean la novedad al entrar. Indica `roles` si solo aplica a coordinador o entrenador, y un `target` visible tanto en escritorio como en móvil (varios selectores separados por comas).
- **Base de datos**: los cambios de esquema se aplican como migración en Supabase y se reflejan también en `supabase/schema.sql`, que debe representar siempre el estado completo e idempotente. Revisa los avisos de seguridad de Supabase tras cada cambio.
- **Permisos**: el calendario solo lo ven usuarios con `status = 'aprobado'`; solo los coordinadores aprobados escriben. Las funciones de permisos viven en el esquema `private`.
- **Altas**: solo por enlace de invitación (`public.invitations`, `#invitacion=TOKEN`). El trigger `handle_new_user` rechaza registros sin invitación válida. No añadas formularios de registro abiertos. `public.invitation_info` es pública a propósito (aviso del linter aceptado).
- **Modo demo**: si `config.js` no tiene credenciales, `app.js` usa `makeLocalStore()` (localStorage) con usuarios de prueba. Cualquier función nueva del almacén debe existir en los dos almacenes (demo y Supabase).
- **Horario habitual**: `schedule_template` es la semana tipo; `bookings.template_id` enlaza cada entreno con su habitual para detectar cambios (día, horario, campo, cancelado, extra). El coordinador publica cada semana con `apply_template` (no hay generación automática). Los cambios al habitual se propagan desde hoy solo a entrenos no modificados (trigger `private.template_changed`).
- **Tipos de reserva**: `entreno`, `partido` y `evento` (extraordinaria: `team` nulo, `title` obligatorio, ocupa campo). Usa `whoOf(b)` en lugar de `teamOf(b.team)` para nombre y color de cualquier reserva.
- **Partidos**: `confirmed` y `observations` en `bookings`; propuestas en `match_proposals` (las pueden crear el coordinador y los entrenadores del equipo vía `private.can_propose`; solo el coordinador las resuelve).
- **Partidos fuera**: `bookings.away` y `venue`. Son solo referencia: no ocupan zona (`zone='full'` ignorada), no entran en el reparto de campo ni en `needsRival`/pendientes; se dibujan en la columna «Fuera» (`AWAY_W`) solo los días que tienen alguno. Sí avisan si el mismo equipo tiene otra reserva a la vez.
- **Arrastre en móvil**: con táctil, arrastrar requiere pulsación larga (450 ms); deslizar antes es scroll. No quites `touch-action: pan-x pan-y` de `.editing .block`.
- **Horario federativo**: franjas de saque por categoría en `config.js > FED_WINDOWS` (equipos con `fed`). Fuera de franja, `bookings.rival_status` (pendiente/aprobado/rechazado); vuelve a `pendiente` si cambia día u hora.
- **Solapes asumidos**: `overlap_acks` (partido–entreno); valen solo mientras coincidan las firmas `ackSig` de ambas reservas. Pueden asumirlos el coordinador y los entrenadores de cualquiera de los dos equipos (`private.can_ack`).
- **Horarios**: todo en tramos de 15 minutos. En partidos, `start_min` es la hora del saque; el calentamiento se dibuja antes.
- **Móvil**: la página no hace scroll; solo se desplaza el calendario. El zoom está bloqueado. Comprueba cada cambio también a ~390 px de ancho.
- **Instalable**: `manifest.webmanifest` + iconos en `assets/` (generados desde el escudo original con fondo blanco; los `maskable` llevan margen). Mantén las etiquetas `apple-*` y `theme-color` de `index.html`.
- **Sin indexar**: mantén `robots.txt` y las etiquetas `robots`/`googlebot` con `noindex` en `index.html`. No añadas sitemap ni enlaces públicos.
- **Publicar**: antes de cada commit que cambie la web, ejecuta `./release.sh` (actualiza `version.txt`, `APP_VERSION` y los `?v=` de `index.html`). Así los navegadores no mezclan archivos viejos y nuevos, y las pestañas abiertas y la app instalada se recargan solas (`watchVersion`: al volver a la app, `pageshow`, `online` y cada 2 min; recarga con `?v=` para saltarse la caché). No añadas un service worker que cachee la página sin integrarlo con este sistema.
- Documenta los cambios relevantes para el usuario en `README.md`.
