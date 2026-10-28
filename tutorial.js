/* Tutorial guiado del planificador.
 *
 * CÓMO AÑADIR UNA FUNCIONALIDAD AL TUTORIAL
 * -----------------------------------------
 * Añade un objeto a TUTORIAL_STEPS en el lugar que le corresponda:
 *   id:     identificador único
 *   since:  versión del tutorial en la que aparece (súbela en 1 respecto al
 *           valor más alto actual). Quien ya vio el tutorial verá al entrar
 *           solo los pasos nuevos, como «Novedades».
 *   roles:  ['coordinador'], ['entrenador'] o sin definir (todos)
 *   target: selector CSS del elemento a señalar. Admite varios separados por
 *           comas: se usa el primero visible (útil para escritorio / móvil).
 *           Sin target, la tarjeta sale centrada.
 *   title, body: texto (body admite HTML sencillo).
 */
'use strict';
window.TUTORIAL_STEPS = [
  {
    id: 'bienvenida', since: 1, target: null,
    title: 'Bienvenido al planificador del campo',
    body: 'Aquí se organiza la ocupación semanal del campo: entrenamientos y partidos de todos los equipos del club, de lunes a domingo y de 09:00 a 23:00. Te enseñamos lo básico en un minuto.',
  },
  {
    id: 'semana', since: 1, target: '.week-nav',
    title: 'Moverse entre semanas',
    body: 'Con las flechas pasas a la semana anterior o siguiente. «Hoy» te devuelve a la semana actual.',
  },
  {
    id: 'vista', since: 1, target: '#view-toggle, #day-tabs',
    title: 'Semana o día',
    body: 'La vista <b>Semana</b> muestra los siete días a la vez. La vista <b>Día</b> amplía un solo día; en el móvil se usa siempre y cambias de día con las pestañas.',
  },
  {
    id: 'carriles', since: 1, target: '.cal-head .day-head',
    title: 'El campo, dividido en cuatro',
    body: 'Cada día tiene cuatro carriles: <b>A1 A2</b> forman la mitad A y <b>B1 B2</b> la mitad B. Un bloque ancho ocupa el campo entero; uno de media anchura, una mitad; uno estrecho, un cuarto (solo excepcionalmente).',
  },
  {
    id: 'bloques', since: 1, target: '#cal-wrap',
    title: 'Entrenamientos y partidos',
    body: 'Los <b>entrenamientos</b> son bloques de color claro. Los <b>partidos</b> muestran el calentamiento rayado antes de la hora del saque, las dos partes, el descanso y el margen final. F11 ocupa el campo entero y F8 una mitad. Todo va en tramos de 15 minutos.',
  },
  {
    id: 'solapes', since: 1, target: '#cal-wrap',
    title: 'Cuando dos entrenos se solapan',
    body: 'Si un equipo llega mientras otro sigue entrenando, comparten la zona del que llega: si es campo entero, una mitad cada uno; si es media, un cuarto cada uno. El tramo compartido se ve rayado y no cuenta como conflicto.',
  },
  {
    id: 'equipos', since: 1, target: '#legend, #legend-btn',
    title: 'Resaltar un equipo',
    body: 'Pulsa un equipo para resaltar sus bloques y atenuar el resto. Vuelve a pulsarlo para quitar el filtro. Si eres entrenador, tus equipos aparecen primero y marcados con ★.',
  },
  {
    id: 'incidencias', since: 1, target: '.issues-panel, #side-toggle',
    title: 'Incidencias',
    body: 'En rojo los <b>conflictos</b> (dos equipos en el mismo sitio a la vez, fuera de horario…), en naranja los <b>avisos</b> y en violeta los tramos <b>compartidos</b>. Pulsa una incidencia para ir a la reserva.',
  },
  {
    id: 'mis-incidencias', since: 1, roles: ['entrenador'], target: '.issues-panel, #side-toggle',
    title: 'Solo las de tus equipos',
    body: 'Como entrenador ves el calendario de todo el club, pero en Incidencias solo aparecen las que afectan a tus equipos. Con «Ver las de todos los equipos» puedes consultarlas todas.',
  },
  {
    id: 'detalle', since: 1, roles: ['entrenador'], target: '#cal-wrap',
    title: 'Ver el detalle',
    body: 'Pulsa cualquier reserva para ver su horario completo, zona, rival y notas. Los cambios de horario los hace la coordinación.',
  },
  {
    id: 'resumen', since: 1, target: '.tabs-panel, #side-toggle',
    title: 'Resumen y leyenda',
    body: '<b>Resumen</b> cuenta los entrenos, horas y partidos de cada equipo en la semana. <b>Cómo leer</b> recuerda qué significa cada color y trama.',
  },
  {
    id: 'edicion', since: 1, roles: ['coordinador'], target: '.switch',
    title: 'Modo edición',
    body: 'Con el modo edición activo puedes cambiar el calendario. Desactívalo cuando solo quieras consultar, para no mover nada sin querer.',
  },
  {
    id: 'nueva', since: 1, roles: ['coordinador'], target: '#new-btn',
    title: 'Crear reservas',
    body: 'Pulsa <b>+ Nueva reserva</b> o directamente un hueco del calendario. Elige equipo, entreno o partido, hora y zona. Antes de guardar verás si choca con algo.',
  },
  {
    id: 'arrastrar', since: 1, roles: ['coordinador'], target: '#cal-wrap',
    title: 'Mover y alargar',
    body: 'Arrastra un bloque para cambiarlo de hora, de día o de mitad. Tira del borde inferior de un entreno para cambiar su duración. Mientras arrastras ves al momento los conflictos que provocaría.',
  },
  {
    id: 'copiar', since: 1, roles: ['coordinador'], target: '#copy-week-btn, #user-btn',
    title: 'Copiar la semana anterior',
    body: 'Copia de golpe los entrenamientos de la semana anterior a la actual (no los partidos). En el móvil está en tu menú de usuario.',
  },
  {
    id: 'invitar', since: 2, roles: ['coordinador'], target: '#people-btn, #user-btn',
    title: 'Invitar a los entrenadores',
    body: 'Nadie puede registrarse sin invitación. En <b>Entrenadores › Invitar</b> marcas los equipos (o el rol de coordinador), creas un enlace y lo envías por <b>WhatsApp</b>. Quien lo abre elige su contraseña y entra directamente con esos equipos. Cada enlace caduca y se puede anular.',
  },
  {
    id: 'gestionar', since: 2, roles: ['coordinador'], target: '#people-btn, #user-btn',
    title: 'Gestionar el acceso',
    body: 'En <b>Con acceso</b> cambias los equipos de cada entrenador, nombras a otro coordinador o quitas el acceso. Los que no tienen acceso quedan en <b>Sin acceso</b> por si quieres devolvérselo.',
  },
  {
    id: 'habitual', since: 3, target: '#mode-toggle, #user-btn',
    title: 'Horario habitual',
    body: 'Es la semana tipo de entrenamientos del club. Pulsa <b>Horario habitual</b> para verla (en el móvil, desde tu menú) y <b>Semana</b> para volver a las fechas reales.',
  },
  {
    id: 'cambios', since: 3, target: '#cal-wrap',
    title: 'Cambios respecto a lo habitual',
    body: 'Si una semana un entreno cambia de <b>día, horario o campo</b>, se marca con <b>↻</b> y un borde verde azulado, y queda un hueco punteado donde iba lo habitual. Si no se entrena, el hueco dice «No entrena». Un <b>+</b> indica un entreno extra. Todo aparece también en Incidencias como «cambio».',
  },
  {
    id: 'aplicar', since: 3, roles: ['coordinador'], target: '#week-strip, #cal-wrap',
    title: 'Publicar los entrenos de una semana',
    body: 'Las semanas nuevas empiezan vacías. Cuando ya sepas los horarios de una semana, ve a ella y pulsa <b>Aplicar horario habitual</b>: se añaden todos los entrenos habituales y luego cambias solo lo que sea distinto esa semana. Los entrenadores ven el aviso de que está pendiente hasta que la publiques.',
  },
  {
    id: 'editar-habitual', since: 3, roles: ['coordinador'], target: '#mode-toggle, #user-btn',
    title: 'Cambios para siempre',
    body: 'Si cambia algo para toda la temporada, edítalo en <b>Horario habitual</b> igual que una semana: arrastrar, crear o borrar. Se aplica desde hoy en las semanas ya publicadas, salvo en los entrenos que hayas cambiado a mano. Al editar un entreno cambiado, <b>Volver a lo habitual</b> lo deja como siempre.',
  },
  {
    id: 'borrar-semana', since: 4, roles: ['coordinador'], target: '#clear-week-btn, #user-btn',
    title: 'Borrar los eventos de una semana',
    body: '<b>Borrar semana</b> elimina de golpe todos los entrenos y partidos de la semana que estás viendo (en el móvil, desde tu menú). Te pide confirmación y la semana vuelve a quedar sin publicar, así que puedes aplicar de nuevo el horario habitual.',
  },
  {
    id: 'extraordinaria', since: 5, target: '#cal-wrap',
    title: 'Reservas extraordinarias',
    body: 'Los bloques dorados rayados con <b>◆</b> son reservas extraordinarias: un torneo, el mantenimiento del césped, un acto… No son de ningún equipo, pero ocupan campo y cuentan para los conflictos. La coordinación las crea en <b>Nueva reserva › Extraordinaria</b> poniéndoles un nombre.',
  },
  {
    id: 'confirmar-partidos', since: 6, target: '#cal-wrap',
    title: 'Partidos por confirmar',
    body: 'Un partido con <b>borde discontinuo</b> y «Por confirmar» aún no tiene la hora definitiva. Cuando lo esté, la coordinación lo marca como <b>Horario confirmado</b> en el editor (o confirma todos los de la semana de golpe desde Incidencias). Las <b>observaciones</b> del partido aparecen en su detalle.',
  },
  {
    id: 'propuestas', since: 6, target: '#cal-wrap',
    title: 'Proponer otro horario',
    body: 'Pulsa un partido de tu equipo y, en <b>Propuestas de horario</b>, indica el día, la hora (o «por la mañana», «por la tarde»…) y el motivo; por ejemplo: «5 bajas por un torneo escolar». Junto a cada propuesta se ve si ese hueco está libre. Un partido con propuestas lleva la marca <b>⇄</b>.',
  },
  {
    id: 'aplicar-propuesta', since: 6, roles: ['coordinador'], target: '#cal-wrap',
    title: 'Aplicar o descartar propuestas',
    body: 'En el editor del partido verás las propuestas de los entrenadores. <b>Aplicar</b> mueve el partido a ese día y hora (si la propuesta es por franja, a la primera hora libre); <b>Descartar</b> la deja registrada sin cambiar nada.',
  },
  {
    id: 'horario-federativo', since: 7, target: '#cal-wrap',
    title: 'Horario federativo y aprobación del rival',
    body: 'Cada categoría tiene una franja permitida para el saque (por ejemplo, juveniles y seniors: sábado de 15:00 a 19:30 y domingo de 9:00 a 19:30). Un partido fuera de su franja lleva la marca <b>⚑</b> y «Falta OK del rival» hasta que la coordinación marca en el editor que el rival lo ha <b>aprobado</b>. Si el rival lo rechaza, sale como conflicto. Si se mueve el partido, vuelve a quedar pendiente.',
  },
  {
    id: 'incidencias-orden', since: 8, target: '.issues-panel, #side-toggle',
    title: 'Incidencias por importancia',
    body: 'Las incidencias salen agrupadas: primero los <b>conflictos</b> (lo que no puede ser), luego avisos, pendientes y cambios. El <b>reparto del campo en entrenamientos</b> (tramos compartidos y entrenos en un cuarto) va al final, plegado; ábrelo si lo necesitas. Cuando dos entrenos comparten, cada equipo conserva su zona y solo gana o pierde campo, sin saltar de un lado a otro.',
  },
  {
    id: 'asumir-solape', since: 9, target: '.issues-panel, #side-toggle',
    title: 'Asumir un solape con un partido',
    body: 'Si un partido se solapa con un entreno y lo tenéis en cuenta, pulsa <b>Asumir</b> en la incidencia (o en el detalle de la reserva). Pueden hacerlo los entrenadores de los dos equipos y la coordinación. Deja de contar como conflicto y pasa a «Solapes asumidos» con el nombre de quien lo asumió. Si después cambia la hora o la zona de alguno, vuelve a ser conflicto.',
  },
  {
    id: 'partidos-fuera', since: 10, target: '#cal-wrap',
    title: 'Partidos fuera, de referencia',
    body: 'Los días en que algún equipo juega fuera aparece una columna estrecha <b>Fuera</b> a la derecha del día, con el partido rayado y la marca <b>↗</b>. No ocupa nuestro campo: sirve para ver de un vistazo quién está fuera. Ábrelo para ver el rival y dónde se juega. Si ese equipo tiene entreno a la misma hora, sale como aviso.',
  },
  {
    id: 'mover-movil', since: 10, roles: ['coordinador'], target: '#cal-wrap',
    title: 'Mover reservas en el móvil',
    body: 'En el móvil, deslizar sobre una reserva desplaza el calendario sin moverla. Para moverla, <b>mantén el dedo pulsado</b> medio segundo hasta que se levante y luego arrástrala. Un toque corto abre el detalle.',
  },
  {
    id: 'deslizar-dias', since: 11, target: '#cal-wrap',
    title: 'Cambiar de día deslizando',
    body: 'En el móvil, <b>desliza a izquierda o derecha</b> sobre el calendario para pasar al día siguiente o al anterior. Al pasar del domingo vas al lunes de la semana siguiente, y al revés.',
  },
  {
    id: 'partidos-equipo', since: 12, target: '#matches-btn, #user-btn',
    title: 'Partidos por equipo y por fin de semana',
    body: 'En <b>Partidos</b> (en el móvil, dentro de tu menú) eliges un equipo y ves todos sus partidos de la temporada, en casa y fuera, con la hora, el rival, dónde se juega y si falta algo por confirmar. El próximo partido sale resaltado. En la pestaña <b>Por fin de semana</b> tienes una tabla de toda la temporada con los equipos en columnas y los findes en filas, para ver la carga de partidos de cada finde: cuántos hay en casa y cuántos fuera. Toca un partido para ir a esa semana en el calendario.',
  },
  {
    id: 'resumen-plegado', since: 13, target: '#summary-toggle, #side-toggle',
    title: 'Incidencias primero',
    body: 'El panel lateral muestra primero las <b>incidencias</b>, con todo el alto disponible. El resumen de horas y la leyenda están plegados: ábrelos con <b>Ver resumen y leyenda</b> cuando los necesites.',
  },
  {
    id: 'instalar', since: 14, target: '#user-btn',
    title: 'Instálala para entrar más rápido',
    body: 'Puedes añadir la herramienta a la pantalla de inicio de tu móvil, tablet u ordenador: se abre de un toque, a pantalla completa y con el escudo como icono. Te lo sugerimos al entrar, y también lo tienes en tu menú → <b>Instalar la app</b>.',
  },
  {
    id: 'mantener-sesion', since: 15, target: '#user-btn',
    title: 'Mantener la sesión iniciada',
    body: 'Al entrar, la casilla <b>Mantener la sesión iniciada</b> (marcada por defecto) hace que no tengas que volver a escribir la contraseña en este dispositivo. Desmárcala en un ordenador o tablet compartidos: la sesión se cerrará al cerrar el navegador. Puedes salir cuando quieras desde aquí, con <b>Cerrar sesión</b>.',
  },
  {
    id: 'mensaje-finde', since: 17, target: '#matches-btn, #user-btn',
    title: 'Mensaje con los partidos del finde',
    body: 'En <b>Partidos → Por fin de semana</b>, el botón 💬 de cada finde prepara un mensaje con los partidos de ese finde, uno por equipo: rival, 🏠 en casa o ✈️ fuera, y día y hora. Incluye también los del lunes, martes y miércoles siguientes (y el jueves anterior), con su fecha. Puedes retocarlo y luego <b>Copiar</b> o enviarlo por <b>WhatsApp</b>.',
  },
  {
    id: 'inicio-coordinador', since: 18, roles: ['coordinador'], target: '#mode-toggle [data-mode=home], #user-btn',
    title: 'Tu Inicio: recordatorios y lo que se acerca',
    body: 'Al entrar verás <b>Inicio</b> (en el móvil, en tu menú). A la izquierda, tus <b>recordatorios</b>: pulsa <b>＋ Nuevo recordatorio</b> y escribe qué hay que hacer, el equipo, la <b>fecha máxima</b> y la <b>fecha de aviso</b> (se rellena sola 2 días antes); desde ese día pasa de pendiente a <b>urgente</b>, y si se pasa la fecha máxima, a <b>vencido</b>. Márcalos con la casilla cuando estén hechos. A la derecha, los <b>conflictos, avisos y pendientes</b> de los próximos 14 días; toca uno para ir al calendario. También puedes crear un recordatorio desde cualquier reserva con <b>🔔 Recordatorio</b>.',
  },
  {
    id: 'recordatorios-rapidos', since: 19, roles: ['coordinador'], target: '#mode-toggle [data-mode=home], #user-btn',
    title: 'Recordatorios sin escribir fechas',
    body: 'En Inicio, elige la fecha máxima con un botón (<b>Hoy, Mañana, En 3 días, Viernes, 1 semana, 2 semanas</b>): el aviso se pone solo <b>2 días antes</b> (puedes cambiarlo también con botones). Para retrasar un recordatorio, pulsa <b>⏰</b> y elige <b>+1 día, +2, +3, +1 semana o +2 semanas</b>: se mueven la fecha máxima y el aviso a la vez.',
  },
  {
    id: 'atajos-iphone', since: 20, roles: ['coordinador'], target: '#user-btn',
    title: 'Recordatorios desde el iPhone',
    body: 'En tu menú → <b>Conectar con Atajos del iPhone</b> generas un código y sigues los pasos para crear el atajo. Luego, compartes una <b>captura de WhatsApp</b> o un texto con el atajo (o se lo dictas a <b>Siri</b>) y se crean los recordatorios solos, con equipo y fecha. Los que vienen del atajo llevan la marca 📲.',
  },
  {
    id: 'notificaciones', since: 21, roles: ['coordinador'], target: '#user-btn',
    title: 'Notificaciones en el móvil',
    body: 'En tu menú → <b>🔔 Notificaciones</b> actívalas en cada dispositivo (en iPhone, con la herramienta instalada en la pantalla de inicio). Elige la <b>hora del aviso diario</b> y qué quieres recibir: recordatorios urgentes y vencidos, conflictos del calendario, resumen del día y altas de entrenadores (estas, al momento). Tocando el aviso se abre Inicio.',
  },
  {
    id: 'en-espera', since: 22, roles: ['coordinador'], target: '#mode-toggle [data-mode=home], #user-btn',
    title: 'Recordatorios en espera de otra persona',
    body: 'Si algo depende de otra persona (un entrenador, la Federación, el Ayuntamiento…), escríbelo en <b>En espera de</b> al crear o editar el recordatorio. Pasa al grupo <b>En espera de otros</b>, con desde cuándo esperas, y con <b>📨</b> le mandas un mensaje para reclamarlo. Los Atajos también lo detectan («cuando Paco me pase las fichas»).',
  },
  {
    id: 'no-depende', since: 23, roles: ['coordinador'], target: '#mode-toggle [data-mode=home], #user-btn',
    title: '«No depende de mí» con un toque',
    body: 'Cada recordatorio tiene, junto al reloj, el botón de la <b>persona con flecha</b> («No depende de mí»): elige de quién depende ahora (el entrenador del equipo, aunque no esté dado de alta, Club rival, Directivo, Federación, Ayuntamiento…) o escribe otro nombre. En los que ya están en espera, el mismo botón te deja cambiar la persona o volver a hacerlo tuyo.',
  },
  {
    id: 'compartir-horario', since: 24, target: '#cal-wrap',
    title: 'Compartir el horario de un partido',
    body: 'Abre un partido y pulsa <b>📣 Compartir horario</b>: prepara el mensaje para el grupo de WhatsApp (rival, local o visitante, día, hora del partido y de quedada, y el campo). En los de fuera hay que poner también la <b>hora de salida 🚗</b> y <b>confirmar el campo</b> antes de enviarlo. La coordinación rellena esos datos y se guardan en el partido; si cambia el día o la hora, se vuelven a pedir.',
  },
  {
    id: 'compartir-mapa', since: 25, target: '#cal-wrap',
    title: 'Ubicación del campo en el mensaje',
    body: 'En los partidos de fuera, en <b>📣 Compartir horario</b> pulsa <b>🗺️ Buscar en Google Maps</b>: se abre con el campo y la localidad. Toca <b>Compartir → Copiar enlace</b> y pégalo en la ventana; el mensaje añade la línea 🗺️ con el enlace para que todos lleguen sin perderse.',
  },
  {
    id: 'equipos', since: 26, roles: ['coordinador'], target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'Equipos y plantillas',
    body: 'En <b>Equipos</b> (en el móvil, en tu menú) ves todos los equipos con sus jugadores y entrenadores. Entra en uno para añadir jugadores con <b>dorsal y nombre</b>, de uno en uno o <b>pegando la lista entera</b> (un jugador por línea, «7 Iker Molina»). Cada entrenador ve y mantiene la plantilla de su equipo.',
  },
  {
    id: 'plantilla', since: 26, roles: ['entrenador'], target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'La plantilla de tu equipo',
    body: 'En <b>Plantilla</b> (en el móvil, en tu menú) tienes los jugadores de tu equipo con su dorsal. Puedes añadir, corregir o quitar jugadores, o pegar la lista entera de una vez (un jugador por línea, «7 Iker Molina»).',
  },
  {
    id: 'convocables-coord', since: 27, roles: ['coordinador'], target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'Convocables de equipos inferiores',
    body: 'Cada entrenador puede proponer como <b>convocables</b> a jugadores del equipo de debajo (p. ej., el Juvenil tira del Cadete). Te llegan a <b>Inicio</b> como «Convocables por aprobar» y los apruebas o rechazas con un toque. En <b>Equipos → Reglas de convocables</b> decides de qué equipo puede tirar cada uno y si solo valen los <b>sub-23</b> (Senior B → Senior A).',
  },
  {
    id: 'convocables-entrenador', since: 27, roles: ['entrenador'], target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'Convocables de otros equipos',
    body: 'En tu plantilla, en <b>Convocables</b>, pulsa <b>＋ Añadir convocables</b> para tener en cuenta a jugadores del equipo de debajo. La coordinación tiene que aprobarlos; mientras, salen como <b>⏳ Pendiente de aprobar</b>. En los Senior, marca con <b>S-23</b> a los jugadores sub-23.',
  },
  {
    id: 'estado-jugador', since: 28, target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'Estado de cada jugador',
    body: 'En la plantilla, toca un jugador para abrir su ficha y ponerle estado: <b>Molestias</b> (convocable, en duda), <b>Lesión leve</b>, <b>Lesión</b>, <b>Lesión grave</b> o <b>No disponible</b> (con el motivo), con la vuelta prevista si la sabes. En <b>A tener en cuenta</b> apunta lo que no cambia, como «el domingo por la mañana no puede». El resumen del equipo cuenta los convocables y las bajas.',
  },
  {
    id: 'condicion-subir', since: 29, target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'Condición para subir de equipo',
    body: 'Algunos equipos tienen una condición para que sus jugadores puedan ser convocables arriba: <b>Sub-23</b> en los Senior (Senior B → Senior A), <b>15 cumplidos</b> en el Cadete (→ Juvenil) y <b>2º año</b> en el Infantil A (→ Cadete). Márcala en la plantilla con el botón de cada jugador o en su ficha; solo los marcados aparecen al proponer convocables.',
  },
  {
    id: 'comunicar-horario', since: 30, roles: ['coordinador'], target: '#matches-btn, #user-btn',
    title: 'Comunicar los horarios cada semana',
    body: 'Después de <b>confirmar</b> un partido hay que <b>comunicarlo</b>. La semana del partido aparece en Inicio como «horario confirmado sin comunicar» (aviso fuerte a 2 días). Se comunica a la directiva con el mensaje del finde (<b>Partidos → Por fin de semana → 💬</b>, el número indica cuántos faltan) y al grupo del equipo con <b>📣 Compartir horario</b>; también se puede marcar a mano en la ficha. Si luego cambia el día, la hora o el campo, te avisa para volver a comunicarlo.',
  },
  {
    id: 'quedada-equipo', since: 30, roles: ['coordinador'], target: '#mode-toggle [data-mode="teams"], #user-btn',
    title: 'Hora de quedada por equipo',
    body: 'En <b>Equipos → Hora de quedada</b> decides cuánto antes del partido queda cada equipo en el campo (p. ej., 1 h 15 min el Senior y 1 h el Cadete). Se usa para proponer la hora de quedada al compartir el horario.',
  },
  {
    id: 'comunicar-dos-canales', since: 31, roles: ['coordinador'], target: '#matches-btn, #user-btn',
    title: 'Directiva y grupos de cada equipo',
    body: 'El horario confirmado se comunica por dos vías, y cada una tiene su aviso: a la <b>directiva</b>, con el mensaje semanal que incluye todos los partidos (<b>Partidos → Por fin de semana → 💬</b>), y al <b>grupo del equipo</b> (padres, jugadores y entrenadores), con el mensaje detallado de <b>📣 Compartir horario</b>. En la ficha del partido ves cómo está cada una y puedes marcarlas a mano.',
  },
  {
    id: 'coordinadores-equipos', since: 32, roles: ['coordinador'], target: '#people-btn, #user-btn',
    title: 'Varios coordinadores, cada uno con sus equipos',
    body: 'En <b>Entrenadores → Con acceso</b> marca los <b>equipos a tu cargo</b> (y los de cada coordinador). Inicio, los avisos, «Confirmar partidos de la semana», el mensaje a la directiva y las notificaciones del móvil se centran en esos equipos; lo que no es de ningún equipo os llega a todos. Con «Ver todo el club» ves lo de los demás. Sin equipos marcados, te ocupas de todo. Para dar de alta a otro coordinador: <b>Invitar → Coordinador</b>, marca sus equipos y envíale el enlace.',
  },
  {
    id: 'version', since: 18, target: '#app-ver, #app-ver-top',
    title: 'Versión de la herramienta',
    body: 'Aquí ves la versión que estás usando (día y hora de publicación). Si alguien tiene un problema, comprobad que tenéis la misma; la herramienta se actualiza sola cuando hay una nueva.',
  },
  {
    id: 'ayuda', since: 1, target: '#help-btn, #user-btn',
    title: 'Volver a ver esta guía',
    body: 'Puedes repetir el tutorial cuando quieras desde aquí. Cuando añadamos funciones nuevas, te las enseñaremos al entrar.',
  },
];

(function () {
  const STEPS = window.TUTORIAL_STEPS;
  const VERSION = Math.max(1, ...STEPS.map(s => s.since || 1));
  const ROLE_LABEL = { coordinador: 'Coordinador', entrenador: 'Entrenador' };
  let root, hole, card, list = [], idx = 0, opts = {};

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function visibleTarget(sel) {
    if (!sel || opts.intro) return null;
    for (const one of sel.split(',')) {
      const el = document.querySelector(one.trim());
      if (!el || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) return el;
    }
    return null;
  }

  function build() {
    root = document.createElement('div');
    root.className = 'tt-root';
    root.innerHTML = '<div class="tt-hole"></div><div class="tt-card" role="dialog" aria-modal="true" aria-labelledby="tt-title"></div>';
    document.body.appendChild(root);
    hole = root.querySelector('.tt-hole');
    card = root.querySelector('.tt-card');
    card.addEventListener('click', e => {
      const a = e.target.closest('[data-tt]')?.dataset.tt;
      if (a === 'next') go(idx + 1);
      if (a === 'prev') go(idx - 1);
      if (a === 'skip') end();
    });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
  }

  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(idx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
  }

  function go(n) {
    if (n >= list.length) return end();
    idx = Math.max(0, n);
    const s = list[idx];
    const novelty = opts.onlySince > 0;
    const roleTag = opts.intro && s.roles ? `<span class="tt-tag">Solo ${s.roles.map(r => ROLE_LABEL[r]).join(' / ')}</span>` : '';
    card.innerHTML = `
      <div class="tt-top"><span class="tt-step">${novelty ? 'Novedad · ' : ''}${idx + 1} de ${list.length}</span>${roleTag}</div>
      <h3 id="tt-title">${esc(s.title)}</h3>
      <p>${s.body}</p>
      <div class="tt-dots" aria-hidden="true">${list.map((_, i) => `<span class="${i === idx ? 'on' : ''}"></span>`).join('')}</div>
      <div class="tt-actions">
        <button type="button" class="link" data-tt="skip">${idx === list.length - 1 ? 'Cerrar' : 'Saltar tutorial'}</button>
        <span class="tt-sp"></span>
        ${idx > 0 ? '<button type="button" class="ghost" data-tt="prev">Atrás</button>' : ''}
        <button type="button" class="primary" data-tt="next">${idx === list.length - 1 ? 'Empezar' : 'Siguiente'}</button>
      </div>`;
    const t = visibleTarget(s.target);
    if (t && t.closest('#cal-wrap') && t.id !== 'cal-wrap') t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    place();
    card.querySelector('[data-tt="next"]').focus({ preventScroll: true });
  }

  function place() {
    if (!root) return;
    const s = list[idx];
    const t = visibleTarget(s.target);
    const pad = 6, vw = innerWidth, vh = innerHeight;
    const cw = Math.min(360, vw - 24);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight;
    if (!t) {
      root.classList.add('tt-center'); hole.style.cssText = 'display:none';
      card.style.left = (vw - cw) / 2 + 'px';
      card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
      return;
    }
    root.classList.remove('tt-center');
    let r = t.getBoundingClientRect();
    // Recorta objetivos muy grandes al área visible
    const top = Math.max(r.top, 4), bottom = Math.min(r.bottom, vh - 4);
    const left = Math.max(r.left, 4), right = Math.min(r.right, vw - 4);
    r = { top, bottom, left, right, width: right - left, height: bottom - top };
    hole.style.cssText = `display:block;top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    // En pantallas pequeñas, la tarjeta va abajo (o arriba si el objetivo está abajo)
    let x, y;
    if (vw < 600) {
      x = (vw - cw) / 2;
      y = r.top + r.height / 2 > vh / 2 ? 12 : vh - ch - 12;
    } else if (vh - r.bottom > ch + 20) { y = r.bottom + 14; x = r.left; }
    else if (r.top > ch + 20) { y = r.top - ch - 14; x = r.left; }
    else if (vw - r.right > cw + 20) { x = r.right + 14; y = r.top; }
    else if (r.left > cw + 20) { x = r.left - cw - 14; y = r.top; }
    else { x = (vw - cw) / 2; y = vh - ch - 12; }
    card.style.left = Math.max(12, Math.min(x, vw - cw - 12)) + 'px';
    card.style.top = Math.max(12, Math.min(y, vh - ch - 12)) + 'px';
  }

  function end() {
    if (!root) return;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    root.remove(); root = null;
    const cb = opts.onEnd; opts = {};
    if (cb) cb();
  }

  /**
   * start({ role, onlySince, intro, onEnd })
   *   role: 'coordinador' | 'entrenador' | null (null = todos los pasos)
   *   onlySince: muestra solo los pasos con since > onlySince (novedades)
   *   intro: true para mostrarlo sin señalar elementos (desde la pantalla de acceso)
   */
  function start(o = {}) {
    if (root) end();
    opts = o;
    list = STEPS.filter(s => (!s.roles || !o.role || s.roles.includes(o.role)) && (s.since || 1) > (o.onlySince || 0));
    if (!list.length) { if (o.onEnd) o.onEnd(); return; }
    build();
    go(0);
  }

  window.Tutorial = { start, VERSION };
})();
