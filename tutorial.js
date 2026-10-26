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
