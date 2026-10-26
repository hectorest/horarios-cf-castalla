# Planificador de Campo · Castalla C.F.

**En línea:** https://hectorest.github.io/horarios-cf-castalla/  
**Base de datos:** proyecto Supabase `horarios-cf-castalla` (`wwkfaxrmmbptuithqpxn`, región París), ya creado y conectado en `config.js`.

## Usuarios y acceso

Para usar la herramienta hay que **iniciar sesión**. Hay dos roles:

- **Coordinador**: ve todo, edita el calendario y gestiona a los entrenadores.
- **Entrenador**: ve el calendario de todos los equipos, pero en Incidencias solo le salen las de **sus equipos** (puede consultar las demás con un clic). No puede modificar nada.

**Alta por invitación (no hay registro abierto)**

La página de inicio solo permite entrar. Nadie puede crearse una cuenta sin un enlace de invitación, ni siquiera llamando directamente a Supabase: la base de datos rechaza cualquier registro sin invitación válida.

1. El coordinador abre **Entrenadores › Invitar**, escribe para quién es (opcional), marca los equipos o el rol de coordinador, cuántas personas pueden usarlo y cuándo caduca, y pulsa **Crear enlace de invitación**.
2. Lo envía con el botón **WhatsApp** (abre WhatsApp con el mensaje listo) o con **Copiar**.
3. El entrenador abre el enlace, ve qué equipos tendrá, escribe nombre, email y contraseña, y entra directamente.
4. Cada enlace se gasta al usarse, caduca y se puede **anular**.

En **Con acceso** el coordinador cambia los equipos, nombra a otro coordinador o quita el acceso (pasa a **Sin acceso**, desde donde se puede devolver).

**Primer coordinador**: ya existe una invitación de coordinador de un solo uso creada en la base de datos. Para otro proyecto, ver el final de `supabase/schema.sql`.

**Ajustes necesarios en Supabase > Authentication**

| Ajuste | Valor | Por qué |
|---|---|---|
| *Sign In / Providers > Allow new users to sign up* | **Activado** | Es lo que permite registrarse con un enlace de invitación. Sin invitación válida la base de datos rechaza el registro. |
| *Sign In / Providers > Email > Confirm email* | **Desactivado** (recomendado) | El correo integrado de Supabase solo envía a los miembros de tu organización de Supabase, así que los entrenadores no recibirían el correo de confirmación. La invitación ya hace de filtro. |
| *URL Configuration > Site URL* | `https://hectorest.github.io/horarios-cf-castalla/` | Para los enlaces de los correos (recuperar contraseña). |

> «He olvidado mi contraseña» envía un correo. Con el correo integrado de Supabase solo llega a direcciones de tu organización de Supabase. Para que llegue a cualquier entrenador, configura un SMTP propio en *Authentication > Emails > SMTP Settings* (por ejemplo, una cuenta de Gmail del club o Resend).

## Partidos: confirmación, observaciones y propuestas

- **Por confirmar / confirmado**: un partido por confirmar se ve con borde discontinuo y «Por confirmar», y sale en Incidencias. El coordinador lo marca con **Horario confirmado** en el editor, o confirma todos los de la semana con el botón de Incidencias (o el menú de usuario).
- **Horario federativo**: cada categoría tiene una franja permitida para el saque (en `config.js > FED_WINDOWS`; cada equipo indica la suya con `fed`):

  | Categoría | Viernes | Sábado | Domingo |
  |---|---|---|---|
  | Alevines | 18:30–19:30 | 09:00–19:30 | 09:00–19:30 |
  | Infantil A y cadete | — | 09:00–19:30 | 09:00–19:30 |
  | Infantil B (Jocs Escolars) | — | 09:00–13:00 | — |
  | Juveniles y seniors | — | 15:00–19:30 | 09:00–19:30 |

  Un partido fuera de su franja necesita la **aprobación del rival**: lleva la marca ⚑ y «Falta OK del rival», sale en Incidencias, y en el editor se marca como *Pendiente del rival*, *Aprobado por el rival* o *Rechazado* (este último cuenta como conflicto). Si se cambia el día o la hora, vuelve a quedar pendiente. Es independiente de «confirmado». Las propuestas de horario buscan primero huecos dentro de la franja federativa.
- **Partidos fuera**: se guardan como partido con *Dónde: Fuera* y el campo donde se juega. No ocupan nuestro campo ni generan conflictos de reparto; se dibujan rayados (↗) en una columna estrecha **Fuera** a la derecha del día, solo los días en que hay alguno, para tener de referencia quién está fuera. Si el mismo equipo tiene entreno o partido en casa a la misma hora, sale como aviso. No necesitan confirmación ni aprobación del rival en la herramienta. Están cargados los de toda la temporada (calendarios FFCV e Infantil B de Jocs Escolars; los del Infantil B sin hora publicada están a las 10:00 y «por confirmar»).
- **Listado por equipo**: el botón **Partidos** (en el móvil, en el menú de usuario → *Partidos de un equipo*) muestra todos los partidos de la temporada de un equipo, agrupados por mes, con casa/fuera, hora, rival, campo y avisos (por confirmar, OK del rival). El próximo sale resaltado y al tocar uno se abre esa semana con el partido señalado.
- **Carga por fin de semana**: en la misma ventana, la pestaña *Por fin de semana* (en el móvil, menú → *Partidos del fin de semana*) es una tabla de toda la temporada con los **equipos en columnas** y los **findes (viernes a domingo) en filas**. Cada celda muestra día, hora y rival (relleno = en casa, rayado = fuera; ? por confirmar, ⚑ falta OK del rival) y cada fila lleva el total en casa (más intenso cuantos más partidos en nuestro campo) y fuera. Se abre colocada en el finde actual; al tocar un partido se abre esa semana en el calendario.
- **Observaciones**: texto libre del partido (por ejemplo, «el entrenador pide jugar el viernes porque el sábado tiene 5 bajas»). Lo escribe el coordinador; todos lo ven en el detalle.
- **Propuestas de horario**: el coordinador y los entrenadores del equipo pueden proponer alternativas para un partido: día y hora exacta, «por la mañana», «por la tarde» o «a cualquier hora», con su motivo. Junto a cada propuesta se comprueba si el hueco está libre (sin hora exacta, se busca la primera hora libre de la franja; entre semana, a partir de las 16:00). El coordinador la **aplica** (mueve el partido) o la **descarta**. Los partidos con propuestas pendientes llevan la marca **⇄**.

## Instalar como app

La web se puede añadir a la pantalla de inicio y se abre a pantalla completa, con el escudo como icono:

- **iPhone / iPad** (Safari o Chrome): botón Compartir → *Añadir a pantalla de inicio*.
- **Android / ordenador** (Chrome o Edge): menú → *Instalar aplicación* (o *Añadir a pantalla de inicio*).

Los iconos están en `assets/` (`apple-touch-icon.png` 180 px, `icon-192/512.png` y versiones `maskable` con margen para Android) y la configuración en `manifest.webmanifest`. Al entrar desde el navegador, la web **sugiere instalarla** (botón *Instalar* en Android y ordenador; pasos de *Compartir → Añadir a pantalla de inicio* en iPhone/iPad). Si se pulsa *Ahora no*, no vuelve a salir en 14 días; siempre queda en el menú de usuario → *Instalar la app en este dispositivo*. No sale si ya está instalada.

Si ya la tenías instalada antes de este cambio, bórrala de la pantalla de inicio y vuelve a añadirla para que coja el icono nuevo.

### Actualizaciones

Cada publicación cambia `version.txt` (con `./release.sh`). La web lo comprueba al abrirse, cada vez que se vuelve a ella (cambiar de app, desbloquear el móvil, reanudar la app instalada), al recuperar la conexión y cada 2 minutos. Si hay versión nueva, se recarga sola pidiendo la página con una dirección nueva (`?v=…`), para que ni el navegador ni GitHub Pages sirvan la copia antigua. Si en ese momento hay una ventana abierta o se está moviendo una reserva, aparece arriba el aviso **Hay una versión nueva · Actualizar** y se actualiza al cerrar la ventana.

## Panel lateral

- Las **incidencias** ocupan todo el alto del panel; el resumen de horas y la leyenda están plegados en **Ver resumen y leyenda** (en móvil, tablet y escritorio).

## Móvil

- Desliza a izquierda o derecha sobre el calendario para cambiar de día (del domingo pasa al lunes de la semana siguiente, y al revés).
- La página no hace scroll: solo se desplaza el calendario. Deslizar sobre una reserva desplaza el calendario; para **moverla**, mantén el dedo pulsado medio segundo hasta que se levante y arrástrala. Un toque corto abre el detalle.

## Horario habitual y cambios semanales

- **Horario habitual**: es la semana tipo de entrenamientos. Se ve con el botón **Horario habitual** (en el móvil, desde el menú de usuario). El coordinador lo edita igual que una semana: crear, arrastrar, alargar o borrar.
- **Publicar una semana**: las semanas nuevas empiezan vacías. Cuando el coordinador ya sabe los horarios de una semana, entra en ella y pulsa **Aplicar horario habitual**. Mientras no lo haga, los entrenadores ven el aviso «La coordinación aún no ha publicado los entrenamientos de esta semana». Si ya había entrenos puestos a mano para el mismo equipo y día, se enlazan en vez de duplicarse.
- **Cambios de una semana concreta**: se hacen en esa semana. El entreno queda marcado con **↻** y borde verde azulado, y en su lugar habitual aparece un hueco punteado «Lo habitual». Si se borra, queda el hueco «No entrena». Un entreno que no está en el habitual se marca con **+** («extra»). Todo sale en Incidencias como **cambio**, también para los entrenadores de ese equipo. Al editarlo, el botón **Volver a lo habitual** lo restaura.
- **Borrar semana**: el coordinador puede borrar de golpe todos los entrenos y partidos de la semana visible (botón **Borrar semana**; en el móvil, en el menú de usuario). La semana queda sin publicar.
- **Cambios para siempre**: se hacen en el horario habitual y se aplican **desde hoy** en las semanas ya publicadas, sin tocar los entrenos cambiados a mano en una semana concreta.

## Tutorial

Al entrar por primera vez se muestra un tutorial guiado adaptado al rol (también desde la pantalla de inicio, en «¿Cómo funciona la herramienta?», y desde el botón **?** o el menú de usuario). Los pasos están en `tutorial.js`. **Cada funcionalidad nueva debe añadir su paso** con un `since` mayor: quien ya vio el tutorial verá solo las novedades la próxima vez que entre.

Herramienta web para organizar la ocupación semanal del campo de fútbol (lunes a domingo, 09:00–23:00) entre los 11 equipos del club. Es una página estática (HTML + CSS + JavaScript, sin compilación) pensada para alojarse en **GitHub Pages** y guardar los datos en **Supabase**.

## Qué hace

- Todas las horas y duraciones van en **tramos de 15 minutos** (al arrastrar, crear o editar).
- **Vista semanal** con las horas del día y, en cada día, el campo dividido en 4 carriles: `A1 A2 | B1 B2` (mitad A y mitad B). Vista **Día** para móvil.
- **Entrenamientos** en campo entero, en una mitad o, excepcionalmente, en un cuarto.
- **Partidos**: se introduce la hora del partido (saque inicial, en punto, y cuarto, y media o menos cuarto) y el calentamiento se reserva automáticamente antes. Formato F11 (campo entero) o F8 (media campo), con la duración calculada por equipo: calentamiento, partes, descanso y margen posterior se dibujan dentro del bloque.
- **Reservas extraordinarias**: torneos, mantenimiento del césped, actos… Llevan un nombre en lugar de equipo, ocupan la zona del campo elegida durante el tiempo indicado y cuentan para los conflictos como cualquier otra reserva. Se ven en dorado rayado con ◆. Se crean en **Nueva reserva › Extraordinaria**.
- **Incidencias agrupadas por importancia**: Conflictos → Avisos → Pendientes → Cambios respecto a lo habitual. El *reparto del campo en entrenamientos* (tramos compartidos y entrenos en un cuarto) va al final, plegado, y no marca los bloques.
- **Solapes asumidos**: si un partido se solapa con un entreno de otro equipo, los entrenadores de cualquiera de los dos equipos (o el coordinador) pueden pulsar **Asumir**. Deja de contar como conflicto y pasa al grupo «Solapes asumidos» con el nombre de quien lo asumió; se puede deshacer. Si cambia la hora o la zona de alguno de los dos, vuelve a ser conflicto.
- **Móvil**: en el panel de Incidencias las incidencias ocupan todo el espacio; el resumen y la leyenda se abren con «Ver resumen y leyenda».
- **Continuidad en los solapes**: cuando un entreno comparte campo, el equipo que ya estaba conserva la zona en la que se encontraba; solo gana o pierde campo, nunca salta de una mitad o cuarto a otro.
- **Incidencias** en tiempo real:
  - ⛔ Conflictos: dos reservas en la misma zona a la vez, un equipo en dos sitios a la vez, fuera del horario del campo, F11 sin campo entero, F8 en un cuarto, tecnificación con partido.
  - ½ Solapes entre entrenamientos: si dos entrenos coinciden un rato, comparten la zona del equipo que llega después, partida en dos (campo entero → una mitad cada uno; media → un cuarto cada uno). El calendario lo dibuja así y no cuenta como conflicto. Si el que llega después tiene un cuarto, si empiezan a la vez o si no queda sitio por un tercer equipo, sí es conflicto.
  - ⚠ Avisos: solape solo en el margen posterior, margen que pasa del cierre, entreno en un cuarto, dos entrenos el mismo día, entreno y partido el mismo día, F8 ocupando el campo entero.
- **Roles**: el **coordinador** puede crear, editar, duplicar, eliminar, **arrastrar** bloques (día, hora y mitad), estirar la duración de un entreno y copiar los entrenos de la semana anterior. El interruptor «Modo edición» le permite consultar sin riesgo de mover nada. Los **entrenadores** consultan y ven las incidencias de sus equipos.
- Pantalla de inicio de sesión, alta de entrenadores por enlace de invitación (WhatsApp) y tutorial guiado.
- Zoom bloqueado para que la herramienta se use como una app en el móvil.
- Resumen semanal por equipo, filtro por equipo, impresión en A4 apaisado, enlace directo a una semana (`#semana=2026-10-26`) y actualización en vivo entre navegadores.

Sin Supabase configurado funciona en **modo demo**: datos en el propio navegador, una semana de ejemplo y usuarios e invitaciones de prueba (el botón «Probar» de una invitación muestra lo que ve el entrenador).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Estilos |
| `app.js` | Lógica: calendario, validaciones, arrastre, acceso, entrenadores, Supabase |
| `tutorial.js` | Pasos del tutorial guiado (añade aquí cada funcionalidad nueva) |
| `CLAUDE.md` | Reglas para seguir desarrollando el proyecto |
| `config.js` | **Lo que tienes que editar**: claves de Supabase, nombre del club, horario y equipos con sus duraciones |
| `supabase/schema.sql` | Tablas, seguridad (RLS) y roles |

## Puesta en marcha desde cero (otro club u otro proyecto)

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta `supabase/schema.sql` entero.
3. Aplica los ajustes de *Authentication* de la sección «Usuarios y acceso».
4. Crea la invitación del primer coordinador con el SQL del final de `schema.sql` y regístrate con ese enlace.
5. En **Project Settings > API** copia la *Project URL* y la clave *anon / publishable*.

### 2. Configuración

Edita `config.js`:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',   // clave anon/publishable (es pública por diseño)
CLUB_NAME: 'CF Mi Club',
```

> Nunca pongas aquí la clave `service_role`. La clave anon es segura porque las políticas RLS solo dejan leer a usuarios aceptados y escribir a los coordinadores.

### 3. GitHub Pages

1. Crea un repositorio en GitHub y sube todos los archivos (incluido `.nojekyll`).
2. **Settings > Pages > Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. En un par de minutos estará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.
4. En Supabase, **Authentication > URL Configuration**, pon esa dirección como *Site URL*.

## Ajustar equipos y duraciones

Todo está en `config.js > TEAMS`. Cada equipo tiene un `id` (lo que se guarda en la base de datos, no lo cambies si ya hay reservas), nombre, abreviatura, color y la configuración de partido:

```js
{ id: 'cadete', name: 'Cadete', short: 'CAD', color: '#1d4ed8',
  match: { warmup: 30, half: 40, halves: 2, break: 15, margin: 15, format: 'F11' } },
```

`match: null` indica que el equipo no juega partidos (Tecnificación). Las duraciones de los partidos se calculan siempre desde aquí, así que si cambias una, los partidos ya guardados se redibujan con la nueva duración.

| Equipo | Calentamiento | Partido | Margen | Total |
|---|---|---|---|---|
| Senior A / Senior B / Veteranos / Juvenil | 30 | 45 + 15 + 45 | 15 | 2 h 30 |
| Cadete | 30 | 40 + 15 + 40 | 15 | 2 h 20 |
| Infantil A / B | 30 | 35 + 15 + 35 | 15 | 2 h 10 |
| Alevín A / B | 20 | 30 + 10 + 30 | 15 | 1 h 45 |

## Probar en local

Abre `index.html` directamente o sirve la carpeta:

```bash
python3 -m http.server 8000   # y abre http://localhost:8000
```
