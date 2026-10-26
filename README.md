# Planificador de Campo

Herramienta web para organizar la ocupación semanal del campo de fútbol (lunes a domingo, 09:00–21:30) entre los 10 equipos del club. Es una página estática (HTML + CSS + JavaScript, sin compilación) pensada para alojarse en **GitHub Pages** y guardar los datos en **Supabase**.

## Qué hace

- Todas las horas y duraciones van en **tramos de 15 minutos** (al arrastrar, crear o editar).
- **Vista semanal** con las horas del día y, en cada día, el campo dividido en 4 carriles: `A1 A2 | B1 B2` (mitad A y mitad B). Vista **Día** para móvil.
- **Entrenamientos** en campo entero, en una mitad o, excepcionalmente, en un cuarto.
- **Partidos**: se introduce la hora del partido (saque inicial, en punto, y cuarto, y media o menos cuarto) y el calentamiento se reserva automáticamente antes. Formato F11 (campo entero) o F8 (media campo), con la duración calculada por equipo: calentamiento, partes, descanso y margen posterior se dibujan dentro del bloque.
- **Incidencias** en tiempo real:
  - ⛔ Conflictos: dos reservas en la misma zona a la vez, un equipo en dos sitios a la vez, fuera del horario del campo, F11 sin campo entero, F8 en un cuarto, tecnificación con partido.
  - ½ Solapes entre entrenamientos: si dos entrenos coinciden un rato, comparten la zona del equipo que llega después, partida en dos (campo entero → una mitad cada uno; media → un cuarto cada uno). El calendario lo dibuja así y no cuenta como conflicto. Si el que llega después tiene un cuarto, si empiezan a la vez o si no queda sitio por un tercer equipo, sí es conflicto.
  - ⚠ Avisos: solape solo en el margen posterior, margen que pasa del cierre, entreno en un cuarto, dos entrenos el mismo día, entreno y partido el mismo día, F8 ocupando el campo entero.
- **Roles**: cualquiera puede consultar (solo lectura). Un usuario **coordinador** inicia sesión y puede crear, editar, duplicar, eliminar, **arrastrar** bloques (día, hora y mitad), estirar la duración de un entreno y copiar los entrenos de la semana anterior. El interruptor «Modo edición» permite al coordinador consultar sin riesgo de mover nada.
- Resumen semanal por equipo, filtro por equipo, impresión en A4 apaisado, enlace directo a una semana (`#semana=2026-10-26`) y actualización en vivo entre navegadores.

Sin Supabase configurado funciona en **modo demo** (datos en el propio navegador, con una semana de ejemplo).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Estilos |
| `app.js` | Lógica: calendario, validaciones, arrastre, Supabase |
| `config.js` | **Lo que tienes que editar**: claves de Supabase, nombre del club, horario y equipos con sus duraciones |
| `supabase/schema.sql` | Tablas, seguridad (RLS) y roles |

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta `supabase/schema.sql` entero.
3. En **Authentication > Sign In / Providers**, desactiva *Allow new users to sign up* (así nadie puede registrarse por su cuenta).
4. En **Authentication > Users > Add user**, crea cada coordinador con email y contraseña (marca *Auto Confirm User*).
5. Dale el rol en el **SQL Editor**:
   ```sql
   update public.profiles set role = 'coordinador' where email = 'coordinador@miclub.com';
   ```
6. En **Project Settings > API** copia la *Project URL* y la clave *anon / publishable*.

### 2. Configuración

Edita `config.js`:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',   // clave anon/publishable (es pública por diseño)
CLUB_NAME: 'CF Mi Club',
```

> Nunca pongas aquí la clave `service_role`. La clave anon es segura porque las políticas RLS solo dejan escribir a los coordinadores.

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
| Senior A / Senior B / Juvenil | 30 | 45 + 15 + 45 | 15 | 2 h 30 |
| Cadete | 30 | 40 + 15 + 40 | 15 | 2 h 20 |
| Infantil A / B | 30 | 35 + 15 + 35 | 15 | 2 h 10 |
| Alevín A / B | 20 | 30 + 10 + 30 | 15 | 1 h 45 |

## Probar en local

Abre `index.html` directamente o sirve la carpeta:

```bash
python3 -m http.server 8000   # y abre http://localhost:8000
```
