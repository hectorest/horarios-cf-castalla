# Planificador de Campo · Castalla C.F.

Web estática (HTML + CSS + JS sin compilación) en GitHub Pages, con datos en Supabase (proyecto `wwkfaxrmmbptuithqpxn`). Todo el texto de la interfaz va en español de España.

## Reglas al añadir o cambiar funcionalidades

- **Tutorial**: toda funcionalidad visible nueva o cambiada debe tener su paso en `tutorial.js` (`TUTORIAL_STEPS`). Usa `since` = (valor máximo actual + 1) para que los usuarios que ya vieron el tutorial vean la novedad al entrar. Indica `roles` si solo aplica a coordinador o entrenador, y un `target` visible tanto en escritorio como en móvil (varios selectores separados por comas).
- **Base de datos**: los cambios de esquema se aplican como migración en Supabase y se reflejan también en `supabase/schema.sql`, que debe representar siempre el estado completo e idempotente. Revisa los avisos de seguridad de Supabase tras cada cambio.
- **Permisos**: el calendario solo lo ven usuarios con `status = 'aprobado'`; solo los coordinadores aprobados escriben. Las funciones de permisos viven en el esquema `private`.
- **Altas**: solo por enlace de invitación (`public.invitations`, `#invitacion=TOKEN`). El trigger `handle_new_user` rechaza registros sin invitación válida. No añadas formularios de registro abiertos. `public.invitation_info` es pública a propósito (aviso del linter aceptado).
- **Modo demo**: si `config.js` no tiene credenciales, `app.js` usa `makeLocalStore()` (localStorage) con usuarios de prueba. Cualquier función nueva del almacén debe existir en los dos almacenes (demo y Supabase).
- **Horarios**: todo en tramos de 15 minutos. En partidos, `start_min` es la hora del saque; el calentamiento se dibuja antes.
- **Móvil**: la página no hace scroll; solo se desplaza el calendario. El zoom está bloqueado. Comprueba cada cambio también a ~390 px de ancho.
- Documenta los cambios relevantes para el usuario en `README.md`.
