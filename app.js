/* Planificador de Campo — vista semanal de ocupación del campo.
 * Funciona como web estática (GitHub Pages). Datos en Supabase, o en
 * localStorage en modo demo si config.js no tiene credenciales. */
'use strict';
(function () {
  // ================================================================
  //  Configuración y constantes
  // ================================================================
  const CFG = window.APP_CONFIG || {};
  const TEAMS = CFG.TEAMS || [];
  const TEAM = Object.fromEntries(TEAMS.map(t => [t.id, t]));
  const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const pad = n => String(n).padStart(2, '0');
  const fmt = m => `${pad(Math.floor(m / 60))}:${pad(((m % 60) + 60) % 60)}`;

  const DAY_START = toMin(CFG.DAY_START || '09:00');
  const DAY_END = toMin(CFG.DAY_END || '21:30');
  const DEFAULT_DUR = CFG.DEFAULT_TRAINING_MIN || 90;
  const PX = 1.2;     // píxeles por minuto
  const SNAP = 15;    // todas las horas y duraciones van de 15 en 15 minutos

  const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // Carriles: 0=A1, 1=A2, 2=B1, 3=B2
  const ZONES = { full: [0, 1, 2, 3], A: [0, 1], B: [2, 3], A1: [0], A2: [1], B1: [2], B2: [3] };
  const ZONE_LABEL = { full: 'Campo entero', A: 'Mitad A', B: 'Mitad B', A1: 'Cuarto A1', A2: 'Cuarto A2', B1: 'Cuarto B1', B2: 'Cuarto B2' };
  const QUARTERS = ['A1', 'A2', 'B1', 'B2'];
  const KIND_LABEL = { entreno: 'Entrenamiento', partido: 'Partido', evento: 'Reserva extraordinaria' };

  // ================================================================
  //  Utilidades
  // ================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
  const dayIndexOf = k => (parseKey(k).getDay() + 6) % 7;
  const snap = (m, s = SNAP) => Math.round(m / s) * s;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const EVENT_COLOR = '#a87b00';
  /** Quién ocupa el campo: un equipo o, en reservas extraordinarias, su nombre */
  const whoOf = b => b.kind === 'evento'
    ? { id: null, name: b.title || 'Reserva extraordinaria', short: (b.title || 'Reserva').slice(0, 10), color: EVENT_COLOR, match: null }
    : teamOf(b.team);
  // ---- Horario federativo de saque por categoría ----
  const FEDW = CFG.FED_WINDOWS || {};
  const fedWindows = team => { const t = TEAM[team]; return t && t.fed ? FEDW[t.fed] || null : null; };
  /** ¿El saque está dentro del horario federativo del equipo? (sin franjas definidas: siempre sí) */
  const inFedWindow = (team, day, start) => {
    const w = fedWindows(team); if (!w) return true;
    const wd = dayIndexOf(day);
    return w.some(x => x.day === wd && start >= toMin(x.from) && start <= toMin(x.to));
  };
  const fedText = team => (fedWindows(team) || []).map(x => `${DAYS_SHORT[x.day].toLowerCase()} ${x.from}–${x.to}`).join(', ');
  // Comunicación del horario confirmado: firma de lo que se comunicó; si cambia, hay que volver a comunicarlo
  const commSig = b => [b.day, b.start_min, b.away ? 1 : 0, b.away ? (b.venue || '') : ''].join('|');
  // Dos canales: «board» = directiva (mensaje semanal con todos los partidos), «group» = grupo del equipo
  // (padres, jugadores y entrenadores; mensaje detallado de «📣 Compartir horario»)
  const COMM = {
    board: { at: 'board_communicated_at', sig: 'board_communicated_sig', label: 'Directiva', to: 'a la directiva' },
    group: { at: 'communicated_at', sig: 'communicated_sig', label: 'Grupo del equipo', to: 'al grupo del equipo' },
  };
  /** null (sin confirmar) · 'pending' (confirmado, sin comunicar) · 'changed' (cambió tras comunicarlo) · 'done' */
  const commState = (b, ch = 'group') => b.kind !== 'partido' || !b.confirmed ? null : !b[COMM[ch].at] ? 'pending' : b[COMM[ch].sig] !== commSig(b) ? 'changed' : 'done';
  const commTodo = (b, ch) => ['pending', 'changed'].includes(commState(b, ch));
  const joinY = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] : a[0] || '';
  const COMM_DAYS = 7, COMM_URGENT = 2;
  /** Minutos antes del saque para quedar en el campo: ajuste de la coordinación (team_settings) o config.js > match.meet */
  const meetBefore = team => (state.teamSettings || []).find(x => x.team === team)?.meet_before_min ?? TEAM[team]?.match?.meet ?? 60;
  const durTxt = m => m % 60 ? (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`) : `${m / 60} h`;
  async function loadTeamSettings() {
    try { state.teamSettings = await store.teamSettings.list(); } catch { state.teamSettings = state.teamSettings || []; }
    if (isTeams()) renderTeams();
  }   // se avisa la semana del partido; a 2 días, aviso fuerte
  const needsRival = b => b.kind === 'partido' && !b.away && !inFedWindow(b.team, b.day, b.start_min);
  const RIVAL_LABEL = { pendiente: 'pendiente de aprobación del rival', aprobado: 'aprobado por el rival', rechazado: 'rechazado por el rival' };
  const teamOf = id => TEAM[id] || { id, name: id || '¿?', short: id || '¿?', color: '#64748b', match: null };
  const dayLabel = k => { const d = parseKey(k); return `${DAYS_SHORT[dayIndexOf(k)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const lanesName = lanes => {
    const s = lanes.join('');
    if (s === '0123') return 'campo entero';
    if (s === '01') return 'mitad A';
    if (s === '23') return 'mitad B';
    if (lanes.length === 1) return 'cuarto ' + QUARTERS[lanes[0]];
    return lanes.map(l => QUARTERS[l]).join('+');
  };

  // ================================================================
  //  Lógica de horarios
  // ================================================================
  /** Devuelve inicio, fin, fin "útil" (sin margen) y segmentos de una reserva. */
  function timeline(b) {
    const s = b.start_min;
    if (b.kind === 'partido') {
      const m = teamOf(b.team).match;
      if (m) {
        // En partidos, start_min es la hora del partido (saque inicial); el calentamiento va antes.
        const segs = [{ t: 'warmup', from: s - m.warmup, to: s, label: 'Calentamiento' }];
        let cur = s;
        for (let i = 0; i < (m.halves || 2); i++) {
          if (i > 0) { segs.push({ t: 'break', from: cur, to: cur + m.break, label: 'Descanso' }); cur += m.break; }
          segs.push({ t: 'half', from: cur, to: cur + m.half, label: `${i + 1}ª parte` }); cur += m.half;
        }
        const coreEnd = cur;
        // Partido fuera: solo de referencia, se dibuja el partido en sí (sin calentamiento ni margen)
        if (b.away) return { start: s, kick: s, end: coreEnd, coreEnd, segs: segs.slice(1) };
        if (m.margin) segs.push({ t: 'margin', from: cur, to: cur + m.margin, label: 'Margen' });
        return { start: s - m.warmup, kick: s, end: coreEnd + (m.margin || 0), coreEnd, segs };
      }
      const d = b.duration_min || 90;
      return { start: s, end: s + d, coreEnd: s + d, segs: [{ t: 'half', from: s, to: s + d, label: 'Partido' }] };
    }
    const d = b.duration_min || DEFAULT_DUR;
    return { start: s, end: s + d, coreEnd: s + d, segs: [{ t: 'training', from: s, to: s + d, label: b.kind === 'evento' ? 'Reserva' : 'Entrenamiento' }] };
  }

  /** Calcula conflictos (error) y avisos (warn) de un conjunto de reservas. */
  function computeIssues(list) {
    const byId = new Map();
    const all = [];
    const tl = new Map(list.map(b => [b.id, timeline(b)]));
    const add = (level, msg, items, at) => {
      const it = { level, msg, ids: items.map(b => b.id), day: items[0].day, at: at ?? tl.get(items[0].id).start };
      all.push(it);
      for (const id of it.ids) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(it); }
    };

    for (const b of list) {
      const t = tl.get(b.id), team = TEAM[b.team], name = whoOf(b).name;
      const lanes = ZONES[b.zone];
      if (b.kind === 'evento') { if (!b.title) add('error', 'Reserva extraordinaria sin nombre', [b]); }
      else if (!team) add('error', `Equipo desconocido: «${b.team}»`, [b]);
      if (b.away) {   // fuera de casa: no ocupa nuestro campo; solo cuenta para el propio equipo
        if (team && !team.match) add('error', `${name} no juega partidos`, [b]);
        continue;
      }
      if (!lanes) add('error', `${name}: zona del campo no válida`, [b]);
      if (b.start_min % SNAP || (b.kind !== 'partido' && (b.duration_min || DEFAULT_DUR) % SNAP)) add('warn', `${name}: horario fuera de los tramos de ${SNAP} minutos`, [b]);
      if (t.start < DAY_START || t.coreEnd > DAY_END) {
        add('error', `${name}: fuera del horario del campo (${fmt(DAY_START)}–${fmt(DAY_END)})`, [b]);
      } else if (t.end > DAY_END) {
        add('warn', `${name}: el margen posterior acaba a las ${fmt(t.end)}, después del cierre`, [b]);
      }
      if (b.kind === 'partido') {
        if (team && !team.match) add('error', `${name} no juega partidos`, [b]);
        if (b.format === 'F11' && b.zone !== 'full') add('error', `${name}: un partido F11 necesita el campo entero`, [b]);
        if (b.format === 'F8' && lanes && lanes.length < 2) add('error', `${name}: un partido F8 necesita media campo completo`, [b]);
        if (b.format === 'F8' && b.zone === 'full') add('warn', `${name}: partido F8 ocupando el campo entero (bloquea la otra mitad)`, [b]);
        if (!b.format) add('warn', `${name}: partido sin formato (F8/F11)`, [b]);
      } else if (lanes && lanes.length === 1) {
        add('warn', `${name}: entrena en un cuarto de campo (división excepcional)`, [b]);
        all[all.length - 1].minor = true;
      }
    }

    // ---- Comparación por pares dentro de cada día ----
    // pieces: ocupación real de cada reserva a lo largo del tiempo (carriles por tramo).
    const pieces = new Map(list.map(b => [b.id, [{ from: tl.get(b.id).start, to: tl.get(b.id).end, lanes: b.away ? [] : (ZONES[b.zone] || ZONES.full), shared: false }]]));
    const restrict = (id, from, to, lanes) => {
      let ok = true;
      const out = [];
      for (const p of pieces.get(id)) {
        if (p.to <= from || p.from >= to) { out.push(p); continue; }
        if (p.from < from) out.push({ ...p, to: from });
        const inter = p.lanes.filter(l => lanes.includes(l));
        if (!inter.length) ok = false;
        out.push({ from: Math.max(p.from, from), to: Math.min(p.to, to), lanes: inter.length ? inter : lanes, shared: true });
        if (p.to > to) out.push({ ...p, from: to });
      }
      pieces.set(id, out);
      return ok;
    };
    const resolved = new Set();
    const pairKey = (a, b) => a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;

    const byDay = new Map();
    for (const b of list) { if (!byDay.has(b.day)) byDay.set(b.day, []); byDay.get(b.day).push(b); }
    for (const items of byDay.values()) {
      items.sort((a, b) => a.start_min - b.start_min);

      // 1) Mismo equipo y solapes entre entrenamientos (se comparte la zona del posterior)
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j], ta = tl.get(a.id), tb = tl.get(b.id);
          const from = Math.max(ta.start, tb.start), to = Math.min(ta.end, tb.end);
          const overlap = from < to;
          const coreOverlap = Math.max(ta.start, tb.start) < Math.min(ta.coreEnd, tb.coreEnd);
          const na = whoOf(a).name, nb = whoOf(b).name;

          if (a.kind !== 'evento' && b.kind !== 'evento' && a.team === b.team) {
            resolved.add(pairKey(a, b));
            if (overlap) {
              add(coreOverlap ? 'error' : 'warn', `${na}: tiene dos actividades a la vez (${fmt(from)}–${fmt(to)})`, [a, b], from);
            } else if (a.kind === 'entreno' && b.kind === 'entreno') {
              add('warn', `${na}: dos entrenamientos el mismo día`, [a, b]);
            } else if (a.kind === 'partido' && b.kind === 'partido') {
              add('warn', `${na}: dos partidos el mismo día`, [a, b]);
            } else {
              add('warn', `${na}: entrena y juega partido el mismo día`, [a, b]);
            }
            continue;
          }
          if (!overlap || a.kind !== 'entreno' || b.kind !== 'entreno') continue;   // (los partidos fuera no llegan aquí: son partidos)
          const la = ZONES[a.zone] || [], lb = ZONES[b.zone] || [];
          if (!la.some(l => lb.includes(l))) continue;

          resolved.add(pairKey(a, b));
          if (ta.start === tb.start) {
            add('error', `Conflicto: ${na} y ${nb} empiezan a la vez en ${lanesName(la.filter(l => lb.includes(l)))}`, [a, b], from);
            continue;
          }
          const [early, late] = ta.start < tb.start ? [a, b] : [b, a];
          const Z = ZONES[late.zone] || ZONES.full;
          const nE = teamOf(early.team).name, nL = teamOf(late.team).name;
          if (Z.length < 2) {
            add('error', `Conflicto: ${nL} entra a las ${fmt(from)} en ${lanesName(Z)} con ${nE} dentro; un cuarto no se puede compartir`, [early, late], from);
            continue;
          }
          const h1 = Z.slice(0, Z.length / 2), h2 = Z.slice(Z.length / 2);
          // Continuidad: el que ya estaba conserva la mitad en la que se encontraba justo antes del solape
          const before = pieces.get(early.id).find(p => p.from < from && p.to >= from);
          const eL = before ? before.lanes : (ZONES[early.zone] || ZONES.full);
          const score = h => h.filter(l => eL.includes(l)).length;
          const [hE, hL] = score(h2) > score(h1) ? [h2, h1] : [h1, h2];
          const okE = restrict(early.id, from, to, hE);
          const okL = restrict(late.id, from, to, hL);
          if (!okE || !okL) {
            add('error', `Conflicto: no hay sitio para que ${nE} y ${nL} compartan ${lanesName(Z)} (${fmt(from)}–${fmt(to)}); ya hay otro equipo en esa zona`, [early, late], from);
          } else {
            add('info', `${nE} y ${nL} comparten ${lanesName(Z)} de ${fmt(from)} a ${fmt(to)}: ${nE} en ${lanesName(hE)}, ${nL} en ${lanesName(hL)}`, [early, late], from);
          }
        }
      }

      // 2) Colisiones reales sobre la ocupación resultante
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (resolved.has(pairKey(a, b)) || a.away || b.away) continue;
          const ta = tl.get(a.id), tb = tl.get(b.id);
          let from = Infinity, to = -Infinity, core = false;
          const shared = new Set();
          for (const pa of pieces.get(a.id)) for (const pb of pieces.get(b.id)) {
            const f = Math.max(pa.from, pb.from), t = Math.min(pa.to, pb.to);
            if (f >= t) continue;
            const sh = pa.lanes.filter(l => pb.lanes.includes(l));
            if (!sh.length) continue;
            from = Math.min(from, f); to = Math.max(to, t);
            sh.forEach(l => shared.add(l));
            if (f < Math.min(t, ta.coreEnd, tb.coreEnd)) core = true;
          }
          if (!shared.size) continue;
          const na = whoOf(a).name, nb = whoOf(b).name;
          const where = lanesName([...shared].sort());
          if (core) add('error', `Conflicto: ${na} y ${nb} coinciden en ${where} (${fmt(from)}–${fmt(to)})`, [a, b], from);
          else add('warn', `${na} y ${nb} solo coinciden en el margen posterior (${fmt(from)}–${fmt(to)}, ${where})`, [a, b], from);
          all[all.length - 1].overlap = true;   // solape entre dos reservas distintas (se puede asumir si es partido–entreno)
        }
      }
    }

    // Une tramos contiguos con los mismos carriles
    for (const [id, ps] of pieces) {
      const merged = [];
      for (const p of ps.sort((x, y) => x.from - y.from)) {
        const last = merged[merged.length - 1];
        if (last && last.to === p.from && last.lanes.join() === p.lanes.join()) last.to = p.to;
        else merged.push({ ...p });
      }
      pieces.set(id, merged);
    }

    const rank = { error: 0, warn: 1, info: 2 };
    all.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0) || rank[x.level] - rank[y.level] || x.at - y.at);
    return { byId, all, pieces };
  }

  const ICON = { error: '⛔', warn: '⚠', info: '½', change: '↻', pending: '?', ack: '✓' };
  const pendingProps = id => (state.proposals.get(id) || []).filter(p => p.status === 'pendiente');
  // Los avisos «menores» (reparto del campo en entrenos) no marcan los bloques
  const worstLevel = issues => issues.some(i => i.level === 'error') ? 'error' : issues.some(i => i.level === 'warn' && !i.minor) ? 'warn' : '';
  /** Grupo de importancia de una incidencia: 0 conflictos … 4 reparto del campo en entrenos */
  const ISSUE_GROUPS = ['Conflictos', 'Avisos', 'Pendientes', 'Cambios respecto a lo habitual', 'Solapes asumidos', 'Reparto del campo en entrenamientos'];
  const MINOR_GROUP = 5;
  const issueGroup = it => it.level === 'error' ? 0 : it.level === 'warn' ? (it.minor ? MINOR_GROUP : 1) : it.level === 'pending' ? 2 : it.level === 'change' ? 3 : it.level === 'ack' ? 4 : MINOR_GROUP;
  /** Firma de una reserva para saber si un solape asumido sigue siendo el mismo */
  const ackSig = b => `${b.day}|${b.start_min}|${b.duration_min || ''}|${b.zone}`;

  /** Normaliza una reserva antes de guardarla. */
  /** Igual que el trigger private.match_share_reset: si cambia día/hora se borran quedada y salida; si cambia el campo, deja de estar confirmado */
  function shareReset(old, n) {
    if (n.kind !== 'partido') return n;
    if (n.day !== old.day || n.start_min !== old.start_min) {
      if ((n.meet_min ?? null) === (old.meet_min ?? null)) n.meet_min = null;
      if ((n.depart_min ?? null) === (old.depart_min ?? null)) n.depart_min = null;
    }
    if ((n.venue || null) !== (old.venue || null)) {
      if (!!n.venue_confirmed === !!old.venue_confirmed) n.venue_confirmed = false;
      if ((n.venue_map_url || null) === (old.venue_map_url || null)) n.venue_map_url = null;
    }
    return n;
  }
  function cleanRow(b) {
    const ev = b.kind === 'evento';
    const r = {
      day: b.day, start_min: b.start_min, team: ev ? null : b.team, kind: b.kind, zone: b.zone,
      title: ev ? (b.title || '').trim().slice(0, 80) : null,
      duration_min: b.kind !== 'partido' ? (b.duration_min || DEFAULT_DUR) : null,
      format: b.kind === 'partido' ? (b.format || null) : null,
      opponent: b.kind === 'partido' ? (b.opponent || null) : null,
      notes: b.notes || null,
      template_id: b.template_id || null,
      confirmed: b.kind === 'partido' ? !!b.confirmed : true,
      rival_status: b.kind === 'partido' ? (b.rival_status || 'pendiente') : 'pendiente',
      away: b.kind === 'partido' ? !!b.away : false,
      venue: b.kind === 'partido' && b.away ? ((b.venue || '').trim().slice(0, 120) || null) : null,
      observations: b.kind === 'partido' ? ((b.observations || '').trim().slice(0, 500) || null) : null,
      matchday: b.kind === 'partido' ? (b.matchday || null) : null,
      meet_min: b.kind === 'partido' ? (b.meet_min ?? null) : null,
      depart_min: b.kind === 'partido' && b.away ? (b.depart_min ?? null) : null,
      venue_confirmed: b.kind === 'partido' && b.away ? !!b.venue_confirmed : false,
      venue_map_url: b.kind === 'partido' && b.away ? (b.venue_map_url || null) : null,
      communicated_at: b.kind === 'partido' ? (b.communicated_at || null) : null,
      communicated_sig: b.kind === 'partido' ? (b.communicated_sig || null) : null,
      board_communicated_at: b.kind === 'partido' ? (b.board_communicated_at || null) : null,
      board_communicated_sig: b.kind === 'partido' ? (b.board_communicated_sig || null) : null,
    };
    return r;
  }

  // ================================================================
  //  Almacenamiento: Demo (localStorage) y Supabase
  // ================================================================
  // «Mantener la sesión iniciada»: con la casilla marcada la sesión se guarda en localStorage
  // (sobrevive a cerrar el navegador o la app); sin marcar, en sessionStorage (se cierra con él).
  const KEEP_KEY = 'mantener-sesion';
  const keepSession = () => { try { return localStorage.getItem(KEEP_KEY) !== '0'; } catch { return true; } };
  const setKeepSession = v => { try { localStorage.setItem(KEEP_KEY, v ? '1' : '0'); } catch { } };
  const sessionStore = {
    getItem(k) { try { return (keepSession() ? localStorage : sessionStorage).getItem(k); } catch { return null; } },
    setItem(k, v) {
      try {
        const [use, other] = keepSession() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
        use.setItem(k, v); other.removeItem(k);
      } catch { }
    },
    removeItem(k) { try { localStorage.removeItem(k); } catch { } try { sessionStorage.removeItem(k); } catch { } },
  };

  function makeLocalStore() {
    const KEY = 'planificador-campo-demo-v8';
    const TKEY = 'planificador-campo-demo-template-v3';
    const GKEY = 'planificador-campo-demo-weeks-v3';
    const UKEY = 'planificador-campo-demo-users-v2';
    const SKEY = 'planificador-campo-demo-session';
    let mem = null, umem = null;
    const ls = {
      get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
    };
    const read = () => mem || (mem = ls.get(KEY));
    const write = a => { mem = a; ls.set(KEY, a); };
    const users = () => umem || (umem = ls.get(UKEY));
    const writeUsers = a => { umem = a; ls.set(UKEY, a); peopleListeners.forEach(f => f()); };
    const listeners = [], peopleListeners = [];
    const tpl = () => ls.get(TKEY) || [];
    const writeTpl = a => { ls.set(TKEY, a); };
    const weeks = () => ls.get(GKEY) || [];
    const writeWeeks = a => ls.set(GKEY, a);
    if (!read() || !ls.get(TKEY)) {
      const seed = demoSeed();
      writeTpl(seed.template); write(seed.bookings); writeWeeks([seed.week]); ls.set('planificador-campo-demo-proposals-v1', seed.proposals);
    }
    const thisMonday = () => keyOf(mondayOf(new Date()));
    const today = () => keyOf(new Date());
    const mondayKey = k => keyOf(mondayOf(parseKey(k)));
    const sameAsTpl = (b, t) => b.team === t.team && b.start_min === t.start_min && b.duration_min === t.duration_min && b.zone === t.zone && dayIndexOf(b.day) === t.weekday;
    if (!users()) writeUsers(demoUsers());
    window.addEventListener('storage', e => {
      if (e.key === KEY) { mem = null; listeners.forEach(f => f()); }
      if (e.key === UKEY) { umem = null; peopleListeners.forEach(f => f()); }
    });
    let sid = null;
    sid = sessionStore.getItem(SKEY);
    const setSid = v => { sid = v; v ? sessionStore.setItem(SKEY, v) : sessionStore.removeItem(SKEY); };
    const sessionOf = u => u ? { user: { id: u.id, email: u.email }, profile: { full_name: u.full_name, role: u.role, status: u.status, teams: u.teams || [], requested_teams: u.requested_teams || [] } } : null;
    const PKEY = 'planificador-campo-demo-proposals-v1';
    const AKEY = 'planificador-campo-demo-acks-v1';
    const RKEY = 'planificador-campo-demo-reminders-v2';
    const demoReminders = () => {
      const d = n => keyOf(addDays(new Date(), n)), now = new Date().toISOString();
      const r = (title, team, due, alert, extra = {}) => ({ id: uid(), title, team, due_date: due, alert_date: alert, notes: null, booking_id: null, done: false, done_at: null, created_by: 'demo-coord', created_at: now, updated_at: now, ...extra });
      return [
        r('Entregar las fichas médicas a la federación', 'cadete', d(-1), d(-4)),
        r('Pedir el campo al Ayuntamiento para el torneo de Navidad', null, d(3), d(0)),
        r('Confirmar árbitro del amistoso', 'juvenil', d(10), d(7)),
        r('Encargar balones nuevos', 'alevin-a', d(20), d(15), { notes: 'Talla 4, 10 unidades' }),
        r('Recibir las fichas firmadas del Cadete', 'cadete', d(4), d(2), { waiting_on: 'Laura Martí', waiting_since: d(-3) }),
        r('Revisar redes de las porterías', null, d(-3), d(-5), { done: true, done_at: now }),
      ];
    };
    const rems = () => { let a = ls.get(RKEY); if (!a) { a = demoReminders(); ls.set(RKEY, a); } return a; };
    const remListeners = [];
    const writeRems = a => { ls.set(RKEY, a); remListeners.forEach(cb => setTimeout(cb, 0)); };
    const PLKEY = 'planificador-campo-demo-players-v4';
    const demoPlayers = () => {
      const mk = (team, list) => list.map(([number, name, sub23]) => ({ id: uid(), team, number, name, sub23: !!sub23, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
      return [
        ...mk('cadete', [[1, 'Hugo Sanchis', true], [2, 'Marc Pastor'], [4, 'Pablo Rico', true], [5, 'Álex Verdú'], [7, 'Iker Molina', true], [8, 'Jorge Bernabeu'], [9, 'Adrián Payá'], [10, 'Dani Amorós'], [11, 'Leo Navarro'], [14, 'Rubén Gisbert'], [17, 'Nico Ferrándiz'], [null, 'Sergio Coloma']]),
        ...mk('juvenil', [[1, 'Carlos Mira'], [3, 'Javi Sempere'], [6, 'Raúl Vidal'], [9, 'Mario Albero'], [10, 'Óscar Brotons']]),
        ...mk('senior-b', [[1, 'Toni Payá', true], [4, 'Fran Guill'], [8, 'Edu Ribera', true], [11, 'Quique Sanz'], [19, 'Lucas Barceló', true]]),
        ...mk('infantil-a', [[3, 'Aitor Pla', true], [6, 'Biel Moltó'], [9, 'Gael Castelló', true], [10, 'Unai Reig']]),
      ];
    };
    const demoStatus = a => {
      const set = (name, o) => { const p = a.find(x => x.name === name); if (p) Object.assign(p, o); };
      const d = n => keyOf(addDays(new Date(), n));
      set('Iker Molina', { status: 'lesion', status_note: 'Esguince de tobillo', status_since: d(-6), status_until: d(10) });
      set('Pablo Rico', { status: 'molestias', status_note: 'Carga en el gemelo', status_since: d(-2) });
      set('Leo Navarro', { status: 'no_disponible', status_note: 'De viaje con la familia', status_since: d(-1), status_until: d(5) });
      set('Dani Amorós', { notes: 'El domingo por la mañana no puede' });
      set('Edu Ribera', { status: 'lesion_grave', status_note: 'Rotura de ligamento cruzado', status_since: d(-40) });
      return a;
    };
    const players = () => { let a = ls.get(PLKEY); if (!a) { a = demoStatus(demoPlayers()); ls.set(PLKEY, a); } return a; };
    const plListeners = [];
    const writePlayers = a => { ls.set(PLKEY, a); plListeners.forEach(cb => setTimeout(cb, 0)); };
    const me = () => (users() || []).find(x => x.id === sid);
    const canRoster = team => { const u = me(); return !!u && u.status === 'aprobado' && (u.role === 'coordinador' || (u.teams || []).includes(team)); };
    const isCoordDemo = () => me()?.role === 'coordinador' && me()?.status === 'aprobado';
    const CRKEY = 'planificador-campo-demo-callup-rules-v2', CUKEY = 'planificador-campo-demo-callups-v2';
    const cRules = () => ls.get(CRKEY) || (CFG.CALLUPS || []).map(r => ({ team: r.team, from: r.from, sub23: !!r.sub23 }));
    const cups = () => ls.get(CUKEY) || [];
    const cuListeners = [], crListeners = [], tsListeners = [];
    const writeCups = a => { ls.set(CUKEY, a); cuListeners.forEach(cb => setTimeout(cb, 0)); };
    const writeRules = a => { ls.set(CRKEY, a); crListeners.forEach(cb => setTimeout(cb, 0)); };
    const canSeeLower = p => cRules().some(r => r.from === p.team && (!r.sub23 || p.sub23) && canRoster(r.team));
    const callupOk = (pid, team) => { const p = players().find(x => x.id === pid); return !!p && canRoster(team) && cRules().some(r => r.team === team && r.from === p.team && (!r.sub23 || p.sub23)); };
    const canSeeCallup = c => canRoster(c.team) || canRoster(players().find(x => x.id === c.player_id)?.team);
    const dorsalTaken = (p, skipId) => p.number != null && players().some(x => x.id !== skipId && x.team === p.team && x.number === p.number);
    const props = () => ls.get(PKEY) || [];
    const writeProps = a => ls.set(PKEY, a);
    const IKEY = 'planificador-campo-demo-invites-v1';
    let imem = null;
    const invites = () => imem || (imem = ls.get(IKEY) || demoInvites());
    const writeInvites = a => { imem = a; ls.set(IKEY, a); };
    const validInvite = t => invites().find(i => i.token === t && !i.revoked && i.uses < i.max_uses && new Date(i.expires_at) > new Date());
    const byEmail = e => users().find(u => u.email.toLowerCase() === String(e || '').trim().toLowerCase());
    return {
      mode: 'demo',
      async list(from, to) { return read().filter(b => b.day >= from && b.day <= to).map(b => ({ ...b })); },
      async listAllMatches() { return read().filter(b => b.kind === 'partido').sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min).map(b => ({ ...b })); },
      async listMatches(team) { return read().filter(b => b.kind === 'partido' && b.team === team).sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min).map(b => ({ ...b })); },
      async insert(row) { const r = { ...cleanRow(row), id: uid() }; write([...read(), r]); return r; },
      async insertMany(rows) { const rs = rows.map(r => ({ ...cleanRow(r), id: uid() })); write([...read(), ...rs]); return rs; },
      async update(id, row) { write(read().map(b => b.id === id ? shareReset(b, { ...cleanRow(row), id }) : b)); },
      async remove(id) { write(read().filter(b => b.id !== id)); },
      subscribe(cb) { listeners.push(cb); },
      async applyTemplate(dayKey) {
        const m = mondayKey(dayKey);
        if (m < thisMonday()) throw new Error('No se puede aplicar el horario habitual a semanas pasadas');
        if (weeks().includes(m)) return false;
        writeWeeks([...weeks(), m]);
        const end = keyOf(addDays(parseKey(m), 6));
        let all = read();
        const linked = new Set(all.filter(b => b.template_id && b.day >= m && b.day <= end).map(b => b.template_id));
        for (const t of tpl()) {
          if (linked.has(t.id)) continue;
          const d = keyOf(addDays(parseKey(m), t.weekday));
          const manual = all.find(b => b.day === d && b.team === t.team && b.kind === 'entreno' && !b.template_id);
          if (manual) { manual.template_id = t.id; continue; }
          all.push({ ...cleanRow({ ...t, kind: 'entreno', day: d, template_id: t.id }), id: uid() });
        }
        write([...all]);
        return true;
      },
      async weekGenerated(mondayK) { return weeks().includes(mondayK); },
      async confirmMatches(from, to, teams) {
        let n = 0;
        write(read().map(b => b.kind === 'partido' && !b.confirmed && b.day >= from && b.day <= to && (!teams || teams.includes(b.team)) ? (n++, { ...b, confirmed: true }) : b));
        return n;
      },
      notify: {
        async getSettings() { return ls.get('planificador-campo-demo-avisos-v1') || null; },
        async saveSettings(x) { ls.set('planificador-campo-demo-avisos-v1', x); return x; },
        async listDevices() { return []; },
        async addDevice() { },
        async removeDevice() { },
        async call() { return { ok: true, sent: 0, demo: true }; },
        async saveSnapshot() { },
      },
      shortcuts: {
        async list() { return (ls.get('planificador-campo-demo-atajos-v1') || []).filter(t => t.user_id === sid); },
        async create(label) {
          const hex = () => uid().replace(/[^0-9a-f]/g, '').padEnd(32, '0').slice(0, 32);
          const token = 'cfc_' + hex() + hex();
          const a = ls.get('planificador-campo-demo-atajos-v1') || [];
          a.push({ id: uid(), user_id: sid, label: label || 'iPhone', hint: token.slice(-4), created_at: new Date().toISOString(), last_used_at: null });
          ls.set('planificador-campo-demo-atajos-v1', a);
          return token;
        },
        async revoke(id) { ls.set('planificador-campo-demo-atajos-v1', (ls.get('planificador-campo-demo-atajos-v1') || []).filter(t => t.id !== id)); },
        endpoint: null,
      },
      reminders: {
        async list() { return rems().map(r => ({ ...r })); },
        async insert(r) { const now = new Date().toISOString(); const x = { done: false, done_at: null, notes: null, booking_id: null, team: null, due_date: null, alert_date: null, ...r, id: uid(), created_by: sid, created_at: now, updated_at: now }; writeRems([...rems(), x]); return x; },
        async update(id, r) {
          const now = new Date().toISOString();
          writeRems(rems().map(x => x.id !== id ? x : { ...x, ...r, updated_at: now, done_at: ('done' in r) ? (r.done ? (x.done ? x.done_at : now) : null) : x.done_at }));
        },
        async remove(id) { writeRems(rems().filter(x => x.id !== id)); },
        subscribe(cb) { remListeners.push(cb); },
      },
      players: {
        async list() { return players().filter(x => canRoster(x.team) || canSeeLower(x)).map(x => ({ sub23: false, ...x })); },
        async insertMany(rows) {
          const now = new Date().toISOString(), out = [];
          for (const r of rows) {
            if (!canRoster(r.team)) throw new Error('No tienes permiso para esta plantilla.');
            if (dorsalTaken(r) || out.some(o => o.team === r.team && r.number != null && o.number === r.number)) throw new Error(`El dorsal ${r.number} ya está en la plantilla.`);
            out.push({ number: null, sub23: false, ...r, id: uid(), created_by: sid, created_at: now, updated_at: now });
          }
          writePlayers([...players(), ...out]); return out;
        },
        async update(id, r) {
          const x = players().find(p => p.id === id);
          if (!x || !canRoster(x.team)) throw new Error('No tienes permiso para esta plantilla.');
          if (dorsalTaken({ ...x, ...r }, id)) throw new Error(`El dorsal ${r.number} ya está en la plantilla.`);
          writePlayers(players().map(p => p.id === id ? { ...p, ...r, updated_at: new Date().toISOString() } : p));
        },
        async remove(id) { writePlayers(players().filter(p => p.id !== id)); writeCups(cups().filter(c => c.player_id !== id)); },
        subscribe(cb) { plListeners.push(cb); },
      },
      callups: {
        async list() { return cups().filter(canSeeCallup).map(c => ({ ...c })); },
        async add(rows) {
          const now = new Date().toISOString(), out = [];
          for (const r of rows) {
            if (!callupOk(r.player_id, r.team)) throw new Error('Ese jugador no puede ser convocable de este equipo.');
            if (r.status !== 'pendiente' && !isCoordDemo()) throw new Error('Solo la coordinación puede aprobar convocables.');
            if (cups().some(c => c.player_id === r.player_id && c.team === r.team)) throw new Error('Ese jugador ya está como convocable.');
            out.push({ status: 'pendiente', ...r, id: uid(), created_by: sid, created_at: now, resolved_at: r.status === 'aprobado' ? now : null });
          }
          writeCups([...cups(), ...out]); return out;
        },
        async setStatus(id, status) {
          if (!isCoordDemo()) throw new Error('Solo la coordinación puede aprobar convocables.');
          writeCups(cups().map(c => c.id === id ? { ...c, status, resolved_at: new Date().toISOString() } : c));
        },
        async remove(id) { writeCups(cups().filter(c => c.id !== id)); },
        subscribe(cb) { cuListeners.push(cb); },
      },
      teamSettings: {
        async list() { return ls.get('planificador-campo-demo-team-settings-v1') || []; },
        async set(team, patch) {
          if (!isCoordDemo()) throw new Error('Solo la coordinación cambia los ajustes de equipo.');
          const a = (ls.get('planificador-campo-demo-team-settings-v1') || []).filter(x => x.team !== team);
          a.push({ team, ...patch }); ls.set('planificador-campo-demo-team-settings-v1', a); tsListeners.forEach(cb => setTimeout(cb, 0));
        },
        subscribe(cb) { tsListeners.push(cb); },
      },
      callupRules: {
        async list() { return cRules().map(r => ({ ...r })); },
        async set(r) { if (!isCoordDemo()) throw new Error('Solo la coordinación cambia las reglas.'); writeRules([...cRules().filter(x => !(x.team === r.team && x.from === r.from)), { team: r.team, from: r.from, sub23: !!r.sub23 }]); },
        async remove(team, from) { if (!isCoordDemo()) throw new Error('Solo la coordinación cambia las reglas.'); writeRules(cRules().filter(x => !(x.team === team && x.from === from))); },
        subscribe(cb) { crListeners.push(cb); },
      },
      acks: {
        async list(ids) { return (ls.get(AKEY) || []).filter(a => ids.includes(a.entreno_id)); },
        async add(r) { const a = { ...r, id: uid(), created_by: sid, created_at: new Date().toISOString() }; ls.set(AKEY, [...(ls.get(AKEY) || []), a]); return a; },
        async remove(id) { ls.set(AKEY, (ls.get(AKEY) || []).filter(a => a.id !== id)); },
        subscribe() { },
      },
      proposals: {
        async list(ids) { return props().filter(p => ids.includes(p.booking_id)).map(p => ({ ...p })); },
        async add(p) { const r = { ...p, id: uid(), status: 'pendiente', created_by: sid, created_at: new Date().toISOString() }; writeProps([...props(), r]); return r; },
        async setStatus(id, status) { writeProps(props().map(p => p.id === id ? { ...p, status, resolved_at: new Date().toISOString() } : p)); },
        async remove(id) { writeProps(props().filter(p => p.id !== id)); },
        subscribe() { },
      },
      async clearWeek(dayKey) {
        const m = mondayKey(dayKey), end = keyOf(addDays(parseKey(m), 6));
        const before = read().length;
        write(read().filter(b => b.day < m || b.day > end));
        writeWeeks(weeks().filter(w => w !== m));
        return before - read().length;
      },
      template: {
        async list() { return tpl().map(t => ({ ...t })); },
        async insert(row) {
          const t = { ...row, id: uid() }; writeTpl([...tpl(), t]);
          const add = weeks().map(w => keyOf(addDays(parseKey(w), t.weekday))).filter(d => d >= today())
            .map(d => ({ ...cleanRow({ ...t, kind: 'entreno', day: d, template_id: t.id }), id: uid() }));
          write([...read(), ...add]); listeners.forEach(f => f()); return t;
        },
        async update(id, row) {
          const old = tpl().find(t => t.id === id); if (!old) return;
          const nu = { ...old, ...row };
          writeTpl(tpl().map(t => t.id === id ? nu : t));
          write(read().map(b => b.template_id === id && b.day >= today() && sameAsTpl(b, old)
            ? { ...b, team: nu.team, start_min: nu.start_min, duration_min: nu.duration_min, zone: nu.zone, notes: nu.notes || null, day: keyOf(addDays(mondayOf(parseKey(b.day)), nu.weekday)) } : b));
        },
        async remove(id) {
          const old = tpl().find(t => t.id === id); if (!old) return;
          writeTpl(tpl().filter(t => t.id !== id));
          write(read().filter(b => !(b.template_id === id && b.day >= today() && sameAsTpl(b, old)))
            .map(b => b.template_id === id ? { ...b, template_id: null } : b));
        },
        subscribe() { },
      },
      auth: {
        async current() { return sessionOf(users().find(u => u.id === sid)); },
        async signIn(email) {
          const u = byEmail(email);
          if (!u) throw new Error('No hay ninguna cuenta con ese email. En la demo puedes usar los accesos rápidos de abajo.');
          setSid(u.id); return sessionOf(u);
        },
        async signUp({ email, full_name, invite }) {
          if (byEmail(email)) throw new Error('Ya hay una cuenta con ese email. Inicia sesión.');
          const inv = validInvite(invite);
          if (!inv) throw new Error(INVITE_BAD);
          writeInvites(invites().map(i => i.id === inv.id ? { ...i, uses: i.uses + 1, last_used_at: new Date().toISOString() } : i));
          const now = new Date().toISOString();
          const u = { id: uid(), email: email.trim(), full_name, role: inv.role, status: 'aprobado', teams: [...inv.teams], requested_teams: [...inv.teams], created_at: now, reviewed_at: now };
          writeUsers([...users(), u]); setSid(u.id);
          return { session: sessionOf(u) };
        },
        async resetPassword() { },
        async updatePassword() { },
        async signOut() { setSid(null); },
        onChange() { },
      },
      people: {
        async list() { return users().map(u => ({ ...u })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); },
        async update(id, patch) { writeUsers(users().map(u => u.id === id ? { ...u, ...patch } : u)); },
        subscribe(cb) { peopleListeners.push(cb); },
      },
      invites: {
        async check(token) { const i = validInvite(token); return i ? { valid: true, role: i.role, teams: i.teams, label: i.label, expires_at: i.expires_at } : { valid: false }; },
        async list() { return invites().map(i => ({ ...i })).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
        async create({ label, role, teams, max_uses, days }) {
          const i = { id: uid(), token: uid().replace(/-/g, '').slice(0, 32), label: label || null, role, teams, max_uses, uses: 0, revoked: false,
            expires_at: new Date(Date.now() + days * 864e5).toISOString(), created_at: new Date().toISOString() };
          writeInvites([i, ...invites()]); return { ...i };
        },
        async revoke(id) { writeInvites(invites().map(i => i.id === id ? { ...i, revoked: true } : i)); },
      },
    };
  }

  function demoInvites() {
    const at = h => new Date(Date.now() + h * 3600e3).toISOString();
    return [
      { id: 'demo-i1', token: 'demoinvitacionmarcosalevina00001', label: 'Marcos Pérez', role: 'entrenador', teams: ['alevin-a'], max_uses: 1, uses: 0, revoked: false, expires_at: at(24 * 6), created_at: at(-2) },
      { id: 'demo-i2', token: 'demoinvitacionusada0000000000002', label: 'Sara Gil', role: 'entrenador', teams: ['infantil-b', 'tec-1'], max_uses: 1, uses: 1, revoked: false, expires_at: at(24 * 3), created_at: at(-30) },
    ];
  }

  function demoUsers() {
    const ago = d => new Date(Date.now() - d * 3600e3).toISOString();
    return [
      { id: 'demo-coord', email: 'coordinador@demo', full_name: 'Coordinación deportiva', role: 'coordinador', status: 'aprobado', teams: [], requested_teams: [], created_at: ago(500) },
      { id: 'demo-entre', email: 'entrenador@demo', full_name: 'Laura Martí', role: 'entrenador', status: 'aprobado', teams: ['juvenil', 'cadete'], requested_teams: ['juvenil', 'cadete'], created_at: ago(300) },
      { id: 'demo-e2', email: 'sara@demo', full_name: 'Sara Gil', role: 'entrenador', status: 'aprobado', teams: ['infantil-b', 'tec-1'], requested_teams: ['infantil-b', 'tec-1'], created_at: ago(30) },
    ];
  }

  const tplRow = r => ({ weekday: r.weekday, team: r.team, start_min: r.start_min, duration_min: r.duration_min || DEFAULT_DUR, zone: r.zone, notes: r.notes || null });
  const INVITE_BAD = 'Este enlace de invitación no es válido, ya se ha usado o ha caducado. Pide uno nuevo a la coordinación.';
  const INV_COLS = 'id, token, label, role, teams, max_uses, uses, expires_at, revoked, created_at, last_used_at';

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  async function makeSupabaseStore() {
    if (!window.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js');
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { storage: sessionStore, persistSession: true, autoRefreshToken: true } });
    const T = 'bookings';
    const here = () => location.origin + location.pathname;
    const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    const authMsg = m => ({
      'Invalid login credentials': 'Email o contraseña incorrectos.',
      'Email not confirmed': 'Aún no has confirmado tu email. Busca el correo de confirmación.',
      'User already registered': 'Ya hay una cuenta con ese email. Inicia sesión.',
      'Signup requires a valid password': 'Escribe una contraseña.',
      'Signups not allowed for this instance': 'El registro está desactivado en Supabase. Avisa a la coordinación.',
      'Database error saving new user': INVITE_BAD,
    })[m] || (/at least 6/.test(m) ? 'La contraseña debe tener al menos 6 caracteres.' : /rate limit/i.test(m) ? 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.' : m);
    async function sessionOf(user) {
      if (!user) return null;
      const data = chk(await sb.from('profiles').select('full_name, role, status, teams, requested_teams').eq('id', user.id).maybeSingle());
      return { user: { id: user.id, email: user.email }, profile: data || { role: 'entrenador', status: 'pendiente', teams: [], requested_teams: [] } };
    }
    let debounce = (cb, t) => () => { clearTimeout(t); t = setTimeout(cb, 250); };
    return {
      mode: 'supabase',
      async list(from, to) { return chk(await sb.from(T).select('*').gte('day', from).lte('day', to).order('start_min')); },
      async listAllMatches() { return chk(await sb.from(T).select('*').eq('kind', 'partido').order('day').order('start_min')); },
      async listMatches(team) { return chk(await sb.from(T).select('*').eq('kind', 'partido').eq('team', team).order('day').order('start_min')); },
      async insert(row) { return chk(await sb.from(T).insert(cleanRow(row)).select().single()); },
      async insertMany(rows) { return chk(await sb.from(T).insert(rows.map(cleanRow)).select()); },
      async update(id, row) { chk(await sb.from(T).update(cleanRow(row)).eq('id', id).select()); },
      async remove(id) { chk(await sb.from(T).delete().eq('id', id)); },
      subscribe(cb) {
        sb.channel('bookings-changes').on('postgres_changes', { event: '*', schema: 'public', table: T }, debounce(cb)).subscribe();
      },
      async applyTemplate(dayKey) {
        const { data, error } = await sb.rpc('apply_template', { p_day: dayKey });
        if (error) throw new Error(error.message);
        return !!data;
      },
      async weekGenerated(mondayK) {
        const rows = chk(await sb.from('generated_weeks').select('week_start').eq('week_start', mondayK));
        return rows.length > 0;
      },
      async confirmMatches(from, to, teams) {
        let q = sb.from(T).update({ confirmed: true }).eq('kind', 'partido').eq('confirmed', false).gte('day', from).lte('day', to);
        if (teams) q = q.in('team', teams);
        return chk(await q.select('id')).length;
      },
      notify: {
        async getSettings() { return chk(await sb.from('notify_settings').select('notify_time, kinds, enabled').maybeSingle()); },
        async saveSettings(x) {
          return chk(await sb.from('notify_settings').upsert({ notify_time: x.notify_time, kinds: x.kinds, enabled: x.enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select('notify_time, kinds, enabled').single());
        },
        async listDevices() { return chk(await sb.from('push_subscriptions').select('endpoint, device, created_at, last_ok_at').order('created_at')); },
        async addDevice(d) { chk(await sb.from('push_subscriptions').upsert(d, { onConflict: 'endpoint' }).select('id')); },
        async removeDevice(endpoint) { chk(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },
        async call(mode) {
          const { data, error } = await sb.functions.invoke('notificaciones', { body: { mode } });
          if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch { } throw new Error(m); }
          return data;
        },
        async saveSnapshot(items) { chk(await sb.from('issue_snapshot').upsert({ id: 1, computed_at: new Date().toISOString(), items }).select('id')); },
      },
      shortcuts: {
        async list() { return chk(await sb.from('shortcut_tokens').select('id, label, hint, created_at, last_used_at, uses_day, uses_count').order('created_at')); },
        async create(label) { return chk(await sb.rpc('create_shortcut_token', { p_label: label || 'iPhone' })); },
        async revoke(id) { chk(await sb.from('shortcut_tokens').delete().eq('id', id)); },
        endpoint: CFG.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/atajo-recordatorio',
      },
      reminders: {
        async list() { return chk(await sb.from('reminders').select('id, title, team, due_date, alert_date, notes, booking_id, done, done_at, created_by, created_at, updated_at, source, source_text, waiting_on, waiting_since, alert_time, alert_sent_sig').order('due_date', { nullsFirst: false }).order('created_at')); },
        async insert(r) { return chk(await sb.from('reminders').insert(r).select().single()); },
        async update(id, r) {
          const rows = chk(await sb.from('reminders').update(r).eq('id', id).select('id'));
          if (!rows.length) throw new Error('No tienes permiso para cambiar este recordatorio.');
        },
        async remove(id) { chk(await sb.from('reminders').delete().eq('id', id)); },
        subscribe(cb) {
          sb.channel('reminders-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, debounce(cb)).subscribe();
        },
      },
      players: {
        async list() { return chk(await sb.from('players').select('id, team, number, name, sub23, status, status_note, status_until, status_since, status_team, notes, created_at, updated_at').order('team').order('number', { nullsFirst: false }).order('name')); },
        async insertMany(rows) { return chk(await sb.from('players').insert(rows).select('id, team, number, name, sub23, status, status_note, status_until, status_since, status_team, notes, created_at, updated_at')); },
        async update(id, r) {
          const rows = chk(await sb.from('players').update(r).eq('id', id).select('id'));
          if (!rows.length) throw new Error('No tienes permiso para esta plantilla.');
        },
        async remove(id) { chk(await sb.from('players').delete().eq('id', id)); },
        subscribe(cb) {
          sb.channel('players-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, debounce(cb)).subscribe();
        },
      },
      callups: {
        async list() { return chk(await sb.from('player_callups').select('id, player_id, team, status, created_by, created_at, resolved_at').order('created_at')); },
        async add(rows) { return chk(await sb.from('player_callups').insert(rows).select('id, player_id, team, status, created_by, created_at, resolved_at')); },
        async setStatus(id, status) {
          const rows = chk(await sb.from('player_callups').update({ status, resolved_at: new Date().toISOString(), resolved_by: (await sb.auth.getUser()).data.user?.id }).eq('id', id).select('id'));
          if (!rows.length) throw new Error('Solo la coordinación puede aprobar convocables.');
        },
        async remove(id) { chk(await sb.from('player_callups').delete().eq('id', id)); },
        subscribe(cb) {
          sb.channel('callups-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'player_callups' }, debounce(cb)).subscribe();
        },
      },
      teamSettings: {
        async list() { return chk(await sb.from('team_settings').select('team, meet_before_min')); },
        async set(team, patch) { chk(await sb.from('team_settings').upsert({ team, ...patch, updated_at: new Date().toISOString() }).select('team')); },
        subscribe(cb) {
          sb.channel('team-settings-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'team_settings' }, debounce(cb)).subscribe();
        },
      },
      callupRules: {
        async list() { return chk(await sb.from('callup_rules').select('team, from_team, sub23_only')).map(r => ({ team: r.team, from: r.from_team, sub23: r.sub23_only })); },
        async set(r) { chk(await sb.from('callup_rules').upsert({ team: r.team, from_team: r.from, sub23_only: !!r.sub23 }).select('team')); },
        async remove(team, from) { chk(await sb.from('callup_rules').delete().eq('team', team).eq('from_team', from)); },
        subscribe(cb) {
          sb.channel('callup-rules-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'callup_rules' }, debounce(cb)).subscribe();
        },
      },
      acks: {
        async list(ids) {
          if (!ids.length) return [];
          return chk(await sb.from('overlap_acks').select('id, entreno_id, partido_id, entreno_sig, partido_sig, author_name, created_by, created_at').in('entreno_id', ids));
        },
        async add(r) { return chk(await sb.from('overlap_acks').insert(r).select().single()); },
        async remove(id) {
          const rows = chk(await sb.from('overlap_acks').delete().eq('id', id).select('id'));
          if (!rows.length) throw new Error('Solo puede deshacerlo quien lo asumió o la coordinación.');
        },
        subscribe(cb) {
          sb.channel('acks-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'overlap_acks' }, debounce(cb)).subscribe();
        },
      },
      proposals: {
        async list(ids) {
          if (!ids.length) return [];
          return chk(await sb.from('match_proposals').select('id, booking_id, day, start_min, slot, reason, status, created_by, author_name, created_at, resolved_at').in('booking_id', ids).order('created_at'));
        },
        async add(p) { return chk(await sb.from('match_proposals').insert(p).select().single()); },
        async setStatus(id, status) {
          const rows = chk(await sb.from('match_proposals').update({ status, resolved_at: new Date().toISOString() }).eq('id', id).select('id'));
          if (!rows.length) throw new Error('No tienes permiso para resolver esta propuesta.');
        },
        async remove(id) { chk(await sb.from('match_proposals').delete().eq('id', id)); },
        subscribe(cb) {
          sb.channel('proposals-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'match_proposals' }, debounce(cb)).subscribe();
        },
      },
      async clearWeek(dayKey) {
        const { data, error } = await sb.rpc('clear_week', { p_day: dayKey });
        if (error) throw new Error(error.message);
        return data || 0;
      },
      template: {
        async list() { return chk(await sb.from('schedule_template').select('id, weekday, team, start_min, duration_min, zone, notes').order('weekday').order('start_min')); },
        async insert(row) { return chk(await sb.from('schedule_template').insert(tplRow(row)).select().single()); },
        async update(id, row) {
          const rows = chk(await sb.from('schedule_template').update(tplRow(row)).eq('id', id).select('id'));
          if (!rows.length) throw new Error('No tienes permiso para cambiar el horario habitual.');
        },
        async remove(id) { chk(await sb.from('schedule_template').delete().eq('id', id)); },
        subscribe(cb) {
          sb.channel('template-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_template' }, debounce(cb)).subscribe();
        },
      },
      auth: {
        async current() { const { data } = await sb.auth.getSession(); return sessionOf(data.session?.user); },
        async signIn(email, password) {
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(authMsg(error.message));
          return sessionOf(data.user);
        },
        async signUp({ email, password, full_name, invite }) {
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, invite }, emailRedirectTo: here() } });
          if (error) throw new Error(authMsg(error.message));
          // Con confirmación de email activa, un email ya registrado vuelve sin identidades
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error(authMsg('User already registered'));
          return { session: data.session ? await sessionOf(data.user) : null };
        },
        async resetPassword(email) {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() });
          if (error) throw new Error(authMsg(error.message));
        },
        async updatePassword(password) {
          const { error } = await sb.auth.updateUser({ password });
          if (error) throw new Error(authMsg(error.message));
        },
        async signOut() { await sb.auth.signOut(); },
        // setTimeout: supabase-js no admite otras llamadas suyas dentro de este callback
        onChange(cb) { sb.auth.onAuthStateChange(ev => setTimeout(() => cb(ev), 0)); },
      },
      people: {
        async list() { return chk(await sb.from('profiles').select('id, email, full_name, role, status, teams, requested_teams, created_at, reviewed_at').order('created_at', { ascending: false })); },
        async update(id, patch) {
          const rows = chk(await sb.from('profiles').update(patch).eq('id', id).select('id'));
          if (!rows.length) throw new Error('No tienes permiso para cambiar este usuario.');
        },
        subscribe(cb) {
          sb.channel('profiles-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, debounce(cb)).subscribe();
        },
      },
      invites: {
        async check(token) {
          const { data, error } = await sb.rpc('invitation_info', { p_token: token });
          if (error) throw new Error(error.message);
          return data || { valid: false };
        },
        async list() { return chk(await sb.from('invitations').select(INV_COLS).order('created_at', { ascending: false })); },
        async create({ label, role, teams, max_uses, days }) {
          const expires_at = new Date(Date.now() + days * 864e5).toISOString();
          return chk(await sb.from('invitations').insert({ label: label || null, role, teams, max_uses, expires_at }).select(INV_COLS).single());
        },
        async revoke(id) {
          const rows = chk(await sb.from('invitations').update({ revoked: true }).eq('id', id).select('id'));
          if (!rows.length) throw new Error('No tienes permiso para anular esta invitación.');
        },
      },
    };
  }

  function demoSeed() {
    const mon = mondayOf(new Date());
    const k = i => keyOf(addDays(mon, i));
    // Horario habitual real del club
    const T = (weekday, team, start, dur, zone) => ({ id: 'tpl-' + weekday + '-' + team, weekday, team, start_min: toMin(start), duration_min: dur, zone, notes: null });
    const template = [
      T(0, 'alevin-a', '17:00', 90, 'A'), T(0, 'alevin-b', '17:00', 90, 'B1'), T(0, 'tec-1', '17:00', 90, 'B2'), T(0, 'cadete', '18:00', 90, 'A'), T(0, 'senior-a', '19:30', 90, 'full'),
      T(1, 'tec-2', '17:00', 90, 'A'), T(1, 'infantil-a', '17:30', 90, 'A'), T(1, 'infantil-b', '17:30', 90, 'B'), T(1, 'juvenil', '18:30', 120, 'A'), T(1, 'senior-b', '20:00', 90, 'full'),
      T(2, 'alevin-a', '17:00', 90, 'A'), T(2, 'alevin-b', '17:00', 90, 'B'), T(2, 'senior-a', '19:30', 90, 'full'),
      T(3, 'tec-1', '17:00', 90, 'A'), T(3, 'tec-2', '17:00', 90, 'B'), T(3, 'juvenil', '18:30', 90, 'A'), T(3, 'cadete', '18:30', 90, 'B'), T(3, 'senior-a', '20:00', 90, 'A'), T(3, 'senior-b', '20:00', 90, 'B'),
      T(4, 'infantil-a', '17:30', 90, 'A'), T(4, 'infantil-b', '17:30', 90, 'B'),
      T(0, 'veteranos', '20:00', 90, 'full'), T(4, 'veteranos', '20:00', 90, 'full'),
    ];
    // Esta semana: lo habitual con algunos cambios de ejemplo
    const changes = {
      'tpl-2-senior-a': { start_min: toMin('20:00') },          // cambio de horario
      'tpl-2-alevin-b': { zone: 'B1' },                        // cambio de campo
      'tpl-4-infantil-b': { start_min: toMin('18:00') },       // cambio de horario
    };
    const cancelled = ['tpl-3-tec-2'];                          // no entrena esta semana
    const E = t => ({ id: uid(), day: k(t.weekday), team: t.team, kind: 'entreno', start_min: t.start_min, duration_min: t.duration_min, zone: t.zone, notes: null, format: null, opponent: null, template_id: t.id, ...(changes[t.id] || {}) });
    const P = (d, team, start, format, zone, opponent, confirmed = true) => ({ id: 'demo-p-' + team + '-' + d, day: k(d), team, kind: 'partido', start_min: toMin(start), duration_min: null, zone, format, opponent, notes: null, template_id: null, confirmed });
    const bookings = [
      ...template.filter(t => !cancelled.includes(t.id)).map(E),
      { id: uid(), day: k(5), team: 'tec-1', kind: 'entreno', start_min: toMin('10:00'), duration_min: 60, zone: 'A', notes: 'Sesión extra', format: null, opponent: null, template_id: null },
      { id: uid(), day: k(6), team: null, kind: 'evento', title: 'Mantenimiento del césped', start_min: toMin('09:00'), duration_min: 60, zone: 'full', notes: null, format: null, opponent: null, template_id: null },
      // Partidos: hora = saque inicial
      P(5, 'alevin-a', '11:30', 'F8', 'A', 'CF Montaña'), P(5, 'alevin-b', '11:30', 'F8', 'B', 'UD Riera'),
      P(5, 'cadete', '16:30', 'F11', 'full', 'CE Poble Nou'),
      { ...P(5, 'juvenil', '19:00', 'F11', 'full', 'FC Turó', false), observations: 'La entrenadora avisa de 5 bajas el sábado por un torneo escolar; pide adelantar el partido.' },
      P(6, 'senior-a', '10:30', 'F11', 'full', 'CD Sant Joan'),
      P(6, 'senior-b', '13:00', 'F11', 'full', 'AE Martinenc'),
      P(6, 'infantil-a', '20:00', 'F11', 'full', 'EF Gràcia', false),
      // Partidos fuera (solo referencia)
      { ...P(5, 'senior-a', '17:00', 'F11', 'full', 'CD Biarense'), away: true, venue: 'Biar · Polideportivo Mpal.' },
      { ...P(5, 'infantil-b', '10:00', 'F11', 'full', 'CE Sant Roc', false), away: true, venue: 'Alcoi · Polideportivo F. Laporta' },
      { ...P(6, 'veteranos', '11:00', 'F11', 'full', 'Veteranos Onil'), away: true, venue: 'Onil · Estadio Mpal.' },
    ];
    const proposals = [
      { id: 'demo-prop-1', booking_id: 'demo-p-juvenil-5', day: k(4), start_min: null, slot: null, reason: '5 bajas el sábado por un torneo escolar', status: 'pendiente', created_by: 'demo-entre', author_name: 'Laura Martí', created_at: new Date().toISOString() },
      { id: 'demo-prop-2', booking_id: 'demo-p-juvenil-5', day: k(5), start_min: null, slot: 'manana', reason: 'Alternativa si el viernes no puede el rival', status: 'pendiente', created_by: 'demo-entre', author_name: 'Laura Martí', created_at: new Date().toISOString() },
    ];
    return { template, bookings, week: k(0), proposals };
  }

  // ================================================================
  //  Estado
  // ================================================================
  const state = {
    weekStart: mondayOf(new Date()),
    bookings: [],
    issues: { byId: new Map(), all: [], pieces: new Map() },
    role: null,          // 'coordinador' | 'entrenador' | null
    user: null,
    profile: null,
    people: [],
    peopleTab: 'invitaciones',
    invites: [],
    inviteDraft: { label: '', role: 'entrenador', teams: [], max_uses: 1, days: 7 },
    newInviteId: null,
    inviteToken: null,   // token del enlace de invitación abierto
    mode: 'week',        // 'week' | 'template' (horario habitual)
    template: [],
    weekGenerated: false,
    proposals: new Map(),   // id de partido → propuestas de horario
    acks: [],               // solapes partido–entreno asumidos
    summaryOpen: false,     // resumen y leyenda desplegados (plegados por defecto)
    reminders: [],          // recordatorios de la coordinación (Inicio)
    upcoming: [],           // incidencias de los próximos días (Inicio)
    homeLoading: false,
    issueScope: 'mine',
    homeScope: 'mine',      // Inicio del coordinador: sus equipos o todo el club
    minorOpen: false,     // grupo «reparto del campo en entrenamientos» desplegado  // entrenadores: 'mine' | 'all'
    edit: true,
    view: window.innerWidth < 820 ? 'day' : 'week',
    dayIndex: (new Date().getDay() + 6) % 7,
    filter: null,
    selectedId: null,
    loading: false,
  };
  let store;
  const isCoord = () => state.role === 'coordinador';
  const isCoach = () => state.role === 'entrenador';
  /** Equipos del entrenador (null si no aplica el filtro) */
  // Equipos propios: los del entrenador o, en un coordinador, los que tiene a su cargo (sin equipos = todo el club)
  const myTeams = () => state.role && state.profile?.teams?.length ? state.profile.teams : null;
  /** ¿Le toca a este coordinador? (sin equipos asignados, todo; reservas sin equipo, a todos) */
  const myResp = (team, scope = state.homeScope) => !myTeams() || scope === 'all' || !team || myTeams().includes(team);
  const myRespAny = (teams, scope) => !teams?.length ? true : teams.some(t => myResp(t, scope));
  const isMine = team => !!myTeams()?.includes(team);
  // Horario habitual: se dibuja sobre la semana visible como una semana tipo
  const isTpl = () => state.mode === 'template';
  const tplToBooking = t => ({ id: t.id, day: keyOf(addDays(state.weekStart, t.weekday)), team: t.team, kind: 'entreno', start_min: t.start_min, duration_min: t.duration_min, zone: t.zone, notes: t.notes || null, format: null, opponent: null, template_id: null });
  const bookingToTpl = b => ({ weekday: dayIndexOf(b.day), team: b.team, start_min: b.start_min, duration_min: b.duration_min || DEFAULT_DUR, zone: b.zone, notes: b.notes || null });
  const api = () => isTpl()
    ? { insert: b => store.template.insert(bookingToTpl(b)), update: (id, b) => store.template.update(id, bookingToTpl(b)), remove: id => store.template.remove(id) }
    : store;
  const dayText = k => isTpl() ? DAYS[dayIndexOf(k)] : dayLabel(k);
  const isPastWeek = () => keyOf(state.weekStart) < keyOf(mondayOf(new Date()));
  const habText = t => `${DAYS[t.weekday].toLowerCase()} ${fmt(t.start_min)}–${fmt(t.start_min + t.duration_min)}, ${ZONE_LABEL[t.zone].replace(/^./, c => c.toLowerCase())}`;
  const isEditor = () => isCoord() && state.edit;

  // ================================================================
  //  Render
  // ================================================================
  /** Para entrenadores: deja solo las incidencias en las que interviene alguno de sus equipos */
  function scopeIssues(full) {
    const mine = myTeams();
    if (!mine || state.issueScope === 'all') return full;
    const teamOfId = new Map(state.bookings.map(b => [b.id, b.team]));
    const all = full.all.filter(it => it.ids.some(id => mine.includes(teamOfId.get(id))) || (it.team && mine.includes(it.team)));
    const byId = new Map();
    for (const it of all) for (const id of it.ids) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(it); }
    return { ...full, all, byId };
  }

  /** Compara la semana con el horario habitual: cambios de día/horario/campo, entrenos que no se hacen y extras */
  function addChanges(full) {
    full.ghosts = []; full.changed = new Map();
    if (isTpl()) return full;
    const tpl = new Map(state.template.map(t => [t.id, t]));
    const add = (msg, items, day, at, team, tplId) => {
      const it = { level: 'change', msg, ids: items.map(b => b.id), day, at, team, tplId };
      full.all.push(it);
      for (const b of items) { if (!full.byId.has(b.id)) full.byId.set(b.id, []); full.byId.get(b.id).push(it); }
    };
    const used = new Set();
    for (const b of state.bookings) {
      if (b.kind !== 'entreno') continue;
      const t = b.template_id && tpl.get(b.template_id);
      if (t) {
        used.add(t.id);
        const habDay = keyOf(addDays(state.weekStart, t.weekday));
        const d = [];
        if (b.day !== habDay) d.push('día');
        if (b.start_min !== t.start_min || (b.duration_min || DEFAULT_DUR) !== t.duration_min) d.push('horario');
        if (b.zone !== t.zone) d.push('campo');
        if (d.length) {
          full.changed.set(b.id, { what: d, tpl: t });
          add(`${teamOf(b.team).name}: cambio de ${d.join(' y ')} (lo habitual es ${habText(t)})`, [b], b.day, b.start_min, b.team, t.id);
          full.ghosts.push({ t, day: habDay, type: 'moved' });
        }
      } else if (state.weekGenerated && state.template.length) {
        full.changed.set(b.id, { what: ['extra'] });
        add(`${teamOf(b.team).name}: entreno extra, fuera del horario habitual`, [b], b.day, b.start_min, b.team);
      }
    }
    if (state.weekGenerated) for (const t of state.template) {
      if (used.has(t.id)) continue;
      const day = keyOf(addDays(state.weekStart, t.weekday));
      add(`${teamOf(t.team).name}: esta semana no entrena (lo habitual es ${habText(t)})`, [], day, t.start_min, t.team, t.id);
      full.ghosts.push({ t, day, type: 'cancel' });
    }
    // Partidos por confirmar y propuestas de horario pendientes
    const today = keyOf(new Date());
    for (const b of state.bookings) {
      if (b.kind !== 'partido') continue;
      const nm = `${teamOf(b.team).name}${b.opponent ? ' vs ' + b.opponent : ''}`;
      const push = msg => { const it = { level: 'pending', msg, ids: [b.id], day: b.day, at: b.start_min, team: b.team }; full.all.push(it); if (!full.byId.has(b.id)) full.byId.set(b.id, []); full.byId.get(b.id).push(it); };
      if (!b.confirmed && !b.away && b.day >= today) push(`${nm}: horario por confirmar`);
      const dleft = Math.round((parseKey(b.day) - parseKey(today)) / 864e5);
      const chg = Object.keys(COMM).filter(ch => commState(b, ch) === 'changed');
      const pend = Object.keys(COMM).filter(ch => commState(b, ch) === 'pending');
      if (b.day >= today && (chg.length || (pend.length && dleft <= COMM_DAYS))) {
        const lvl = chg.length || dleft <= COMM_URGENT ? 'warn' : 'pending';
        const msg = chg.length ? `${nm}: el horario cambió después de comunicarlo; vuelve a comunicarlo ${joinY([...chg, ...pend].map(ch => COMM[ch].to))}`
          : `${nm}: horario confirmado sin comunicar ${joinY(pend.map(ch => COMM[ch].to))}`;
        const it = { level: lvl, kind: 'comm', msg, ids: [b.id], day: b.day, at: b.start_min, team: b.team };
        full.all.push(it); if (!full.byId.has(b.id)) full.byId.set(b.id, []); full.byId.get(b.id).push(it);
      }
      if (needsRival(b) && b.day >= today) {
        const fed = fedText(b.team);
        if (b.rival_status === 'rechazado') {
          const it = { level: 'error', msg: `${nm}: el rival no acepta jugar fuera del horario federativo (${fed})`, ids: [b.id], day: b.day, at: b.start_min, team: b.team };
          full.all.push(it); if (!full.byId.has(b.id)) full.byId.set(b.id, []); full.byId.get(b.id).push(it);
        } else if (b.rival_status !== 'aprobado') push(`${nm}: fuera del horario federativo (${fed}); pendiente de aprobación del rival`);
      }
      const np = pendingProps(b.id).length;
      if (np) push(`${teamOf(b.team).name}: ${np} propuesta${np > 1 ? 's' : ''} de horario pendiente${np > 1 ? 's' : ''}`);
    }
    const rank = { error: 0, warn: 1, change: 2, pending: 3, info: 4 };
    full.all.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0) || rank[x.level] - rank[y.level] || x.at - y.at);
    return full;
  }

  /** Solapes partido–entreno asumidos: dejan de ser conflicto mientras no cambien los horarios */
  function applyAcks(full) {
    if (isTpl()) return full;
    const bk = new Map(state.bookings.map(b => [b.id, b]));
    for (const it of full.all) {
      if (!it.overlap || it.ids.length !== 2) continue;
      const [x, y] = it.ids.map(id => bk.get(id)); if (!x || !y) continue;
      const e = [x, y].find(b => b.kind === 'entreno'), m = [x, y].find(b => b.kind === 'partido');
      if (!e || !m) continue;
      it.pair = { e: e.id, m: m.id, teams: [e.team, m.team] };
      const a = state.acks.find(k => k.entreno_id === e.id && k.partido_id === m.id && k.entreno_sig === ackSig(e) && k.partido_sig === ackSig(m));
      if (a) { it.level = 'ack'; it.ack = a; it.msg = it.msg.replace(/^Conflicto: /, '') + ` · asumido por ${a.author_name || 'un entrenador'}`; }
    }
    return full;
  }

  const canAck = it => it.pair && (isCoord() || it.pair.teams.some(t => isMine(t)));
  function ackButton(it) {
    if (!it.pair) return '';
    if (it.level === 'ack') return (isCoord() || it.ack.created_by === state.user?.id) ? `<button type="button" class="link ack-btn" data-ack="del" data-id="${esc(it.ack.id)}">Deshacer</button>` : '';
    return canAck(it) ? `<button type="button" class="ghost ack-btn" data-ack="add" data-e="${esc(it.pair.e)}" data-m="${esc(it.pair.m)}" title="Indica que lo tenéis en cuenta">Asumir</button>` : '';
  }

  async function onAck(btn) {
    const bk = id => state.bookings.find(b => b.id === id);
    try {
      if (btn.dataset.ack === 'add') {
        const e = bk(btn.dataset.e), m = bk(btn.dataset.m); if (!e || !m) return;
        await store.acks.add({ entreno_id: e.id, partido_id: m.id, entreno_sig: ackSig(e), partido_sig: ackSig(m), author_name: displayName().slice(0, 80) || null });
        toast('Solape asumido: ya no cuenta como conflicto');
      } else {
        await store.acks.remove(btn.dataset.id);
        toast('El solape vuelve a contar como conflicto');
      }
      const openDetailId = $('#detail-dialog').open && $('#detail-dialog').dataset.id;
      await load();
      if (openDetailId) { const b = bk(openDetailId); if (b) { $('#detail-dialog').close(); openDetail(b); } }
    } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
  }

  function render() {
    state.issues = scopeIssues(applyAcks(addChanges(computeIssues(state.bookings))));
    renderHeader();
    renderLegend();
    renderDayTabs();
    renderCalendar();
    renderIssues();
    renderSummary();
    if (isHome()) renderHome();
    if (isTeams()) renderTeams();
  }

  function renderHeader() {
    const a = state.weekStart, b = addDays(a, 6);
    const sameMonth = a.getMonth() === b.getMonth();
    const yr = window.innerWidth <= 720 && b.getFullYear() === new Date().getFullYear() ? '' : ` ${b.getFullYear()}`;   // en móvil, sin el año en curso
    $('#week-label').textContent = isTpl() ? 'Horario habitual' : sameMonth
      ? `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]}${yr}`
      : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}${yr}`;
    document.body.classList.toggle('tpl-mode', isTpl());
    document.body.classList.toggle('home-mode', isHome() || isTeams());   // páginas sin calendario: Inicio y Equipos
    $('#home').hidden = !isHome();
    $('#teams').hidden = !isTeams();
    const rt = rosterTeams().length;
    $$('#mode-toggle [data-mode="teams"]').forEach(x => { x.hidden = !rt; x.textContent = isCoord() ? 'Equipos' : rt > 1 ? 'Plantillas' : 'Plantilla'; });
    $('#m-teams').hidden = !rt || isTeams();
    $('#m-teams').textContent = isCoord() ? 'Equipos y plantillas' : rt > 1 ? 'Plantillas de mis equipos' : 'Plantilla de mi equipo';
    $$('.home-only-coord').forEach(x => x.hidden = !isCoord());
    $$('#mode-toggle button').forEach(x => { const on = x.dataset.mode === state.mode; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    $('#m-mode').textContent = isTpl() ? 'Volver a la semana' : 'Ver horario habitual';
    $('#m-home').hidden = !isCoord() || isHome();
    $('#m-shortcuts').hidden = !isCoord();
    $('#m-notif').hidden = !isCoord();
    $('#new-btn').innerHTML = `+<span class="hide-sm"> ${isTpl() ? 'Nuevo entreno habitual' : 'Nueva reserva'}</span>`;
    renderStrip();
    $$('#view-toggle button').forEach(x => x.classList.toggle('on', x.dataset.view === state.view));
    const coord = isCoord();
    $('.coord-only').hidden = !coord;
    $$('.edit-only').forEach(x => x.hidden = !state.edit);
    $('#copy-week-btn').hidden = !state.edit || isTpl();
    $('#clear-week-btn').hidden = !state.edit || isTpl();
    $('.edit-hint').hidden = !isEditor();
    $('#edit-toggle').checked = state.edit;
    renderUser();
  }

  const initials = s => String(s || '').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const displayName = () => state.profile?.full_name || state.user?.email || '';

  function renderUser() {
    const coord = isCoord();
    const pending = state.people.filter(p => p.status === 'pendiente').length;
    $('#user-initials').textContent = initials(state.profile?.full_name || state.user?.email);
    $('#user-name').textContent = displayName();
    $('#up-name').textContent = displayName();
    $('#up-email').textContent = state.user?.email || '';
    const roleEl = $('#up-role');
    roleEl.textContent = coord ? 'Coordinador' : 'Entrenador';
    roleEl.classList.toggle('coord', coord);
    const teams = state.profile?.teams || [];
    $('#up-teams').innerHTML = isCoach()
      ? (teams.length ? 'Tus equipos: ' + teams.map(t => `<span class="mini-chip" style="--c:${teamOf(t).color}">${esc(teamOf(t).name)}</span>`).join(' ') : 'Aún no tienes equipos asignados.')
      : '';
    $('#up-teams').hidden = !isCoach();
    $('#people-btn').hidden = !coord;
    $('#m-people').hidden = !coord;
    $('#m-copy').hidden = !coord || isTpl();
    $('#m-clear').hidden = !coord || isTpl();
    const badge = pending ? `<span class="pill err">${pending}</span>` : '';
    $('#people-count').innerHTML = badge;
    $('#m-people-count').innerHTML = badge;
    $('#user-dot').hidden = !(coord && pending);
  }

  function renderLegend() {
    const el = $('#legend');
    el.classList.toggle('filtering', !!state.filter);
    const ordered = myTeams() ? [...TEAMS.filter(t => isMine(t.id)), ...TEAMS.filter(t => !isMine(t.id))] : TEAMS;
    el.innerHTML = ordered.map(t => `<button class="chip ${state.filter === t.id ? 'on' : ''} ${isMine(t.id) ? 'mine' : ''}" data-team="${t.id}" style="--c:${t.color}" title="${isMine(t.id) ? 'Tu equipo · ' : ''}Resaltar ${esc(t.name)}"><span class="dot"></span>${isMine(t.id) ? '<span class="star" aria-hidden="true">★</span>' : ''}<span class="nm-full">${esc(t.name)}</span><span class="nm-short">${esc(t.short)}</span></button>`).join('');
    const f = state.filter && teamOf(state.filter);
    $('#legend-btn-text').textContent = f ? f.name : 'Equipos';
    $('#legend-btn-dot').style.background = f ? f.color : 'transparent';
    $('#legend-btn-dot').hidden = !f;
  }

  function renderDayTabs() {
    const el = $('#day-tabs');
    el.hidden = state.view !== 'day';
    if (el.hidden) return;
    el.innerHTML = DAYS_SHORT.map((d, i) => {
      const k = keyOf(addDays(state.weekStart, i));
      const lvl = worstLevel(state.issues.all.filter(x => x.day === k));
      const dot = lvl ? `<span class="mini-dot" style="background:var(--${lvl === 'error' ? 'err' : 'warn'})"></span>` : '';
      const chg = !lvl && state.issues.all.some(x => x.day === k && x.level === 'change');
      return `<button data-day="${i}" class="${i === state.dayIndex ? 'on' : ''}">${d}${isTpl() ? '' : ' ' + parseKey(k).getDate()}${dot || (chg ? '<span class="mini-dot" style="background:var(--chg)"></span>' : '')}</button>`;
    }).join('');
  }

  /** Ancho (%) que ocupa el campo en un día: si hay partidos fuera, se reserva una columna a la derecha */
  const AWAY_W = 20;
  const fieldW = day => state.awayDays?.has(day) ? 100 - AWAY_W : 100;
  function blockGeom(t, lanes, fw = 100) {
    let vs = Math.max(t.start, DAY_START), ve = Math.min(t.end, DAY_END);
    if (ve - vs < 15) {
      if (t.start >= DAY_END - 15) { vs = DAY_END - 15; ve = DAY_END; }
      else if (t.end <= DAY_START + 15) { vs = DAY_START; ve = DAY_START + 15; }
    }
    return { vs, top: (vs - DAY_START) * PX, height: Math.max((ve - vs) * PX, 16), left: lanes[0] * 25 * fw / 100, width: lanes.length * 25 * fw / 100 };
  }
  const geomStyle = g => `top:${g.top}px;height:${g.height}px;left:calc(${g.left}% + 2px);width:calc(${g.width}% - 4px)`;

  function subLabel(b) {
    if (b.kind === 'partido' && b.away) return `Fuera${b.opponent ? ' · vs ' + b.opponent : ''}${b.venue ? ' · ' + b.venue : ''}`;
    if (b.kind === 'partido') return `Partido ${b.format || ''}${b.opponent ? ' · vs ' + b.opponent : ''}`;
    if (b.kind === 'evento') return 'Extraordinaria' + (b.notes ? ' · ' + b.notes : '');
    return 'Entreno' + (b.zone && ZONES[b.zone]?.length === 1 ? ` · ${b.zone}` : '') + (b.notes ? ' · ' + b.notes : '');
  }

  const matchText = t => `partido ${fmt(t.kick)}–${fmt(t.coreEnd)} (campo ${fmt(t.start)}–${fmt(t.end)})`;
  const timeText = (b, t) => b.kind === 'partido' && t.kick != null ? matchText(t) : `${fmt(t.start)}–${fmt(t.end)}`;

  function blockTitle(b, t, issues) {
    const team = whoOf(b);
    const lines = [`${team.name} — ${KIND_LABEL[b.kind]}${b.format ? ' ' + b.format : ''}${b.opponent ? ' vs ' + b.opponent : ''}`,
      `${timeText(b, t)} · ${ZONE_LABEL[b.zone] || b.zone}`];
    if (b.kind === 'partido') lines.push(t.segs.map(s => `${s.label} ${fmt(s.from)}–${fmt(s.to)}`).join('\n'));
    if (b.notes) lines.push('Notas: ' + b.notes);
    for (const i of issues) lines.push(ICON[i.level] + ' ' + i.msg);
    return lines.join('\n');
  }

  function blockHTML(b) {
    const t = timeline(b), team = whoOf(b);
    const issues = state.issues.byId.get(b.id) || [];
    const lvl = worstLevel(issues);
    const title = esc(blockTitle(b, t, issues));
    const ps = b.kind === 'entreno' ? (state.issues.pieces.get(b.id) || []) : [];
    const chg = state.issues.changed?.get(b.id);
    const parts = ps.length ? ps : [{ from: t.start, to: t.end, lanes: ZONES[b.zone] || ZONES.full, shared: false }];
    return parts.map((p, n) => {
      const g = b.away ? awayGeom(b) : blockGeom({ start: p.from, end: p.to }, p.lanes, fieldW(b.day));
      const narrow = b.away || p.lanes.length === 1;
      const first = n === 0, last = n === parts.length - 1;
      const unconf = b.kind === 'partido' && !b.confirmed;
      const rivalPend = needsRival(b) && b.rival_status !== 'aprobado';
      const cls = ['block', 'kind-' + b.kind, b.away && 'away', lvl && 'lvl-' + lvl, narrow && 'narrow', g.height < 50 && 'short', chg && (chg.what[0] === 'extra' ? 'extra' : 'changed'), unconf && 'unconfirmed',
        !first && 'cont-up', !last && 'cont-down', p.shared && 'shared',
        state.filter && state.filter !== b.team && 'dim', state.selectedId === b.id && 'selected'].filter(Boolean).join(' ');
      const segs = b.kind === 'partido' && !b.away
        ? `<div class="segs" style="top:${(t.start - g.vs) * PX}px">${t.segs.map(s => `<div class="seg seg-${s.t}" style="top:${(s.from - t.start) * PX}px;height:${(s.to - s.from) * PX}px"></div>`).join('')}</div>`
        : '';
      const sub = p.shared ? `Comparte · ${lanesName(p.lanes)}` : (rivalPend ? 'Falta OK del rival · ' : '') + (unconf ? 'Por confirmar · ' : '') + subLabel(b);
      const np = b.kind === 'partido' ? pendingProps(b.id).length : 0;
      const time = p.shared ? `${fmt(p.from)}–${fmt(p.to)}` : b.kind === 'partido' && t.kick != null ? `${fmt(t.kick)}–${fmt(t.coreEnd)}` : `${fmt(t.start)}–${fmt(t.end)}`;
      const labelTop = b.kind === 'partido' && !b.away && t.kick != null ? Math.max(0, (t.kick - g.vs) * PX) : 0;
      return `<div class="${cls}" data-id="${esc(b.id)}" style="--c:${team.color};${geomStyle(g)}" title="${title}">
      ${segs}
      <div class="b-label" style="${labelTop ? `margin-top:${labelTop + 3}px` : ''}"><span class="b-name">${isMine(b.team) ? '★ ' : ''}${esc(narrow ? team.short : team.name)}</span><span class="b-sub">${esc(sub)}</span><span class="b-time">${time}</span></div>
      ${lvl && first ? `<span class="b-flag">!</span>` : ''}
      ${rivalPend && first ? `<span class="b-rival" title="Fuera del horario federativo: ${RIVAL_LABEL[b.rival_status || 'pendiente']}">⚑</span>` : ''}
      ${np && first ? `<span class="b-prop" title="${np} propuesta(s) de horario">⇄${np}</span>` : ''}
      ${chg && first ? `<span class="b-chg" title="${chg.what[0] === 'extra' ? 'Entreno extra' : 'Cambio respecto a lo habitual'}">${chg.what[0] === 'extra' ? '+' : '↻'}</span>` : ''}
      ${b.kind !== 'partido' && isEditor() && last ? '<div class="resize" data-resize="1"></div>' : ''}
    </div>`;
    }).join('');
  }

  /** Partidos fuera: en la columna «Fuera»; si coinciden varios, se reparten el ancho */
  function awayGeom(b) {
    const t = timeline(b);
    const same = state.bookings.filter(x => x.away && x.kind === 'partido' && x.day === b.day && x.id !== b.id)
      .filter(x => { const u = timeline(x); return u.start < t.end && t.start < u.end; });
    const group = [b, ...same].sort((x, y) => x.start_min - y.start_min || String(x.id).localeCompare(String(y.id)));
    const w = AWAY_W / group.length, i = group.findIndex(x => x.id === b.id);
    const g = blockGeom(t, [0]);
    return { ...g, left: 100 - AWAY_W + i * w, width: w };
  }

  function ghostHTML(g) {
    const t = g.t, team = teamOf(t.team), lanes = ZONES[t.zone] || ZONES.full;
    const geo = blockGeom({ start: t.start_min, end: t.start_min + t.duration_min }, lanes, fieldW(g.day));
    const dim = state.filter && state.filter !== t.team ? ' dim' : '';
    return `<div class="hab-ghost hab-ghost-${g.type}${dim}" style="--c:${team.color};${geomStyle(geo)}" aria-hidden="true">
      <span class="g-name">${esc(lanes.length === 1 ? team.short : team.name)}</span><span class="g-sub">${g.type === 'cancel' ? 'No entrena' : 'Lo habitual'}</span></div>`;
  }

  function renderStrip() {
    const el = $('#week-strip');
    const back = '<button type="button" class="ghost" data-strip="week">Volver a la semana</button>';
    if (isTpl()) {
      el.className = 'week-strip tpl';
      el.innerHTML = isCoord()
        ? `<span><b>Horario habitual.</b> <span class="hide-sm">Si lo cambias, se aplica desde hoy en las semanas ya publicadas, sin tocar los entrenos que hayas cambiado a mano.</span></span>${back}`
        : `<span><b>Horario habitual</b> de entrenamientos del club.</span>${back}`;
      el.hidden = false; return;
    }
    if (appOpen && !state.loading && !state.weekGenerated && !isPastWeek() && state.template.length) {
      el.className = 'week-strip pending';
      el.innerHTML = isCoord()
        ? `<span>Esta semana aún no tiene los <b>entrenos habituales</b>.</span><button type="button" class="primary" data-strip="apply">Aplicar horario habitual</button>`
        : '<span>La coordinación aún no ha publicado los entrenamientos de esta semana.</span>';
      el.hidden = false; return;
    }
    el.hidden = true;
  }

  async function applyTemplateWeek() {
    const a = state.weekStart;
    const manual = state.bookings.filter(b => b.kind === 'entreno').length;
    const msg = `Se añadirán los ${state.template.length} entrenos del horario habitual a la semana del ${a.getDate()} de ${MONTHS[a.getMonth()]}.`
      + (manual ? ' Los entrenos que ya hayas puesto a mano para el mismo equipo y día se mantienen y se comparan con lo habitual.' : '')
      + ' Después podrás cambiar lo que haga falta solo para esa semana.';
    if (!(await askConfirm(msg, 'Aplicar horario habitual'))) return;
    try { await store.applyTemplate(keyOf(a)); toast('Horario habitual aplicado a esta semana'); await load(); }
    catch (e) { toast('No se pudo aplicar: ' + e.message, true); }
  }

  async function clearWeekEvents() {
    closeUserMenu();
    const a = state.weekStart;
    const ne = state.bookings.filter(b => b.kind === 'entreno').length, np = state.bookings.filter(b => b.kind === 'partido').length;
    if (!ne && !np) { toast('Esta semana no tiene eventos'); return; }
    const parts = [ne && `${ne} entreno${ne > 1 ? 's' : ''}`, np && `${np} partido${np > 1 ? 's' : ''}`].filter(Boolean).join(' y ');
    const msg = `Se borrarán ${parts} de la semana del ${a.getDate()} de ${MONTHS[a.getMonth()]}. No se puede deshacer.`
      + (state.weekGenerated ? ' La semana quedará sin publicar y podrás volver a aplicar el horario habitual.' : '');
    if (!(await askConfirm(msg, 'Borrar la semana', true))) return;
    try { const n = await store.clearWeek(keyOf(a)); toast(`Semana vaciada: ${n} evento${n === 1 ? '' : 's'} borrado${n === 1 ? '' : 's'}`); await load(); }
    catch (e) { toast('No se pudo borrar: ' + e.message, true); }
  }

  function setMode(m) {
    if (state.mode === m) return;
    if (m === 'home' && !isCoord()) return;
    if (m === 'teams' && !rosterTeams().length) return;
    state.mode = m; state.selectedId = null;
    closeUserMenu();
    render();
    if (m === 'home') { $('#home').scrollTop = 0; loadHome(); return; }
    if (m === 'teams') { $('#teams').scrollTop = 0; loadTeams(); return; }
    load();
  }

  function renderCalendar() {
    const cal = $('#calendar');
    state.awayDays = new Set(isTpl() ? [] : state.bookings.filter(b => b.kind === 'partido' && b.away).map(b => b.day));
    const days = state.view === 'week' ? [0, 1, 2, 3, 4, 5, 6] : [state.dayIndex];
    const H = (DAY_END - DAY_START) * PX;
    const todayKey = isTpl() ? '' : keyOf(new Date());
    cal.style.setProperty('--ncols', days.length);
    cal.style.setProperty('--hour', 60 * PX + 'px');
    cal.style.setProperty('--q30', 30 * PX + 'px');
    cal.classList.toggle('single', days.length === 1);
    cal.classList.toggle('editing', isEditor());

    let html = '<div class="cal-head"><div class="corner"></div>';
    for (const i of days) {
      const d = addDays(state.weekStart, i), k = keyOf(d);
      const iss = state.issues.all.filter(x => x.day === k);
      const ne = iss.filter(x => x.level === 'error').length, nw = iss.filter(x => x.level === 'warn' && !x.minor).length, nc = iss.filter(x => x.level === 'change').length;
      html += `<div class="day-head ${k === todayKey ? 'today' : ''} ${i >= 5 ? 'weekend' : ''}" data-day="${i}">
        <div class="dh-top"><span class="dh-name">${state.view === 'week' ? DAYS_SHORT[i] : DAYS[i]}</span>${isTpl() ? '' : `<span class="dh-date">${d.getDate()} ${MONTHS[d.getMonth()]}</span>`}
        ${ne ? `<span class="pill err" title="${ne} conflicto(s)">${ne}</span>` : ''}${nw ? `<span class="pill warn" title="${nw} aviso(s)">${nw}</span>` : ''}${nc ? `<span class="pill chg" title="${nc} cambio(s) respecto a lo habitual">↻${nc}</span>` : ''}</div>
        <div class="lanes-head${state.awayDays.has(k) ? ' with-away' : ''}"><span>A1</span><span>A2</span><span>B1</span><span>B2</span>${state.awayDays.has(k) ? '<span class="away-h">Fuera</span>' : ''}</div></div>`;
    }
    html += '</div><div class="cal-body"><div class="time-axis" style="height:' + H + 'px">';
    for (let m = DAY_START; m <= DAY_END; m += 30) html += `<span class="${m % 60 ? 'half' : ''}" style="top:${(m - DAY_START) * PX}px">${fmt(m)}</span>`;
    html += '</div>';
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    for (const i of days) {
      const k = keyOf(addDays(state.weekStart, i));
      html += `<div class="day-col ${k === todayKey ? 'today' : ''} ${i >= 5 ? 'weekend' : ''} ${isEditor() ? 'editable' : ''}" data-day="${i}" data-key="${k}" style="height:${H}px">
        ${[0, 1, 2, 3].map(i => `<div class="lane l${i}" style="left:${i * fieldW(k) / 4}%;width:${fieldW(k) / 4}%"></div>`).join('')}${state.awayDays.has(k) ? `<div class="lane away-lane" style="left:${100 - AWAY_W}%;width:${AWAY_W}%"></div>` : ''}`;
      for (const g of (state.issues.ghosts || []).filter(x => x.day === k)) html += ghostHTML(g);
      for (const b of state.bookings.filter(x => x.day === k).sort((a, c) => a.start_min - c.start_min)) html += blockHTML(b);
      if (todayKey && k === todayKey && nowMin >= DAY_START && nowMin <= DAY_END) html += `<div class="now-line" style="top:${(nowMin - DAY_START) * PX}px"></div>`;
      html += '</div>';
    }
    html += '</div>';
    cal.innerHTML = html;
  }

  function renderIssues() {
    const all = state.issues.all;
    const cnt = l => all.filter(i => i.level === l).length;
    const ne = cnt('error'), nw = all.filter(i => i.level === 'warn' && !i.minor).length, nc = cnt('change'), np = cnt('pending');
    const nm = all.filter(i => issueGroup(i) === MINOR_GROUP).length;
    $('#issue-count').innerHTML = `${ne ? `<span class="pill err">${ne} conflicto${ne > 1 ? 's' : ''}</span>` : ''}${nw ? `<span class="pill warn">${nw} aviso${nw > 1 ? 's' : ''}</span>` : ''}${np ? `<span class="pill pend">${np} pendiente${np > 1 ? 's' : ''}</span>` : ''}${nc ? `<span class="pill chg">${nc} cambio${nc > 1 ? 's' : ''}</span>` : ''}`;
    $('#side-toggle-count').innerHTML = ne ? `<span class="pill err">${ne}</span>` : nw ? `<span class="pill warn">${nw}</span>` : '';
    // Agrupadas por importancia; dentro de cada grupo, por día y hora
    const item = (it, n) => `<li class="${it.level}${it.minor ? ' minor' : ''}" data-n="${n}" tabindex="0"><span class="ic">${{ info: '½', change: '↻', pending: '?', ack: '✓' }[it.level] || '!'}</span><div><span class="when">${dayText(it.day)} · ${fmt(it.at)}</span>${esc(it.msg)}${ackButton(it)}</div></li>`;
    const groups = ISSUE_GROUPS.map((title, g) => ({ title, g, items: all.map((it, n) => [it, n]).filter(([it]) => issueGroup(it) === g) })).filter(x => x.items.length);
    const major = groups.filter(x => x.g < MINOR_GROUP);
    const minorG = groups.find(x => x.g === MINOR_GROUP);
    let html = '';
    if (!major.some(x => x.g < 4)) html += `<li class="empty">${myTeams() && state.issueScope === 'mine' ? 'Tus equipos no tienen conflictos ni avisos esta semana ✓' : 'Sin conflictos ni avisos esta semana ✓'}</li>`;
    html += major.map(x => `<li class="ig-head g${x.g}">${x.title} <span>${x.items.length}</span></li>` + x.items.map(([it, n]) => item(it, n)).join('')).join('');
    if (minorG) html += `<li class="ig-head g4 ig-toggle" data-minor tabindex="0" aria-expanded="${state.minorOpen ? 'true' : 'false'}">${state.minorOpen ? '▾' : '▸'} ${minorG.title} <span>${minorG.items.length}</span></li>`
      + (state.minorOpen ? minorG.items.map(([it, n]) => item(it, n)).join('') : '');
    $('#issues').innerHTML = html;
    const unconf = state.bookings.filter(b => b.kind === 'partido' && !b.confirmed && b.day >= keyOf(new Date()) && myResp(b.team, state.issueScope)).length;
    const cb = $('#confirm-week');
    cb.hidden = !(isEditor() && !isTpl() && unconf);
    cb.textContent = `Confirmar los ${unconf} partido${unconf > 1 ? 's' : ''} de la semana`;
    $('#m-confirm').hidden = !(isCoord() && !isTpl() && unconf);
    const scoped = !!myTeams();
    $('#issues-title').textContent = scoped && state.issueScope === 'mine' ? 'Tus incidencias' : 'Incidencias';
    const sc = $('#issue-scope');
    sc.hidden = !scoped;
    sc.textContent = state.issueScope === 'mine' ? 'Ver las de todos los equipos' : 'Ver solo las de mis equipos';
  }

  function renderSummary() {
    const rows = TEAMS.map(t => {
      const bs = state.bookings.filter(b => b.team === t.id);
      const tr = bs.filter(b => b.kind === 'entreno');
      const mins = tr.reduce((s, b) => s + (b.duration_min || DEFAULT_DUR), 0);
      const pm = bs.filter(b => b.kind === 'partido').length;
      return `<tr class="${isMine(t.id) ? 'mine' : ''}"><td><span class="dot" style="--c:${t.color}"></span>${isMine(t.id) ? '★ ' : ''}${esc(t.name)}</td>
        <td class="n ${tr.length ? '' : 'zero'}">${tr.length}</td><td class="n">${mins ? (mins / 60).toFixed(mins % 60 ? 1 : 0).replace('.', ',') + ' h' : '—'}</td><td class="n">${t.match ? pm : '—'}</td></tr>`;
    }).join('');
    $('#summary').innerHTML = `<thead><tr><th>Equipo</th><th class="n">Entrenos</th><th class="n">Horas</th><th class="n">Partidos</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ================================================================
  //  Carga de datos y navegación
  // ================================================================
  async function load() {
    state.loading = true;
    const from = keyOf(state.weekStart), to = keyOf(addDays(state.weekStart, 6));
    try {
      if (isTpl()) {
        state.template = await store.template.list();
        state.bookings = state.template.map(tplToBooking);
        state.weekGenerated = false;
      } else {
        const [bk, tp, gen] = await Promise.all([store.list(from, to), store.template.list(), store.weekGenerated(from)]);
        state.bookings = bk; state.template = tp; state.weekGenerated = gen;
        const ids = bk.filter(b => b.kind === 'partido').map(b => b.id);
        const ps = await store.proposals.list(ids).catch(() => []);
        state.acks = await store.acks.list(bk.filter(b => b.kind === 'entreno').map(b => b.id)).catch(() => []);
        state.proposals = new Map();
        for (const p of ps) { if (!state.proposals.has(p.booking_id)) state.proposals.set(p.booking_id, []); state.proposals.get(p.booking_id).push(p); }
      }
    }
    catch (e) { toast('Error al cargar: ' + e.message, true); state.bookings = []; }
    state.loading = false;
    render();
  }

  function setWeek(d) {
    state.weekStart = mondayOf(d);
    try { history.replaceState(null, '', '#semana=' + keyOf(state.weekStart)); } catch { }
    return load();
  }

  function stepDay(dir) {
    let i = state.dayIndex + dir, week = null;
    if (i > 6 || i < 0) {
      if (isTpl()) i = (i + 7) % 7;
      else { week = addDays(state.weekStart, dir * 7); i = dir > 0 ? 0 : 6; }
    }
    state.dayIndex = i;
    const cal = $('#calendar');
    if (week) setWeek(week); else render();
    cal.classList.remove('slide-next', 'slide-prev'); void cal.offsetWidth;
    cal.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
    setTimeout(() => cal.classList.remove('slide-next', 'slide-prev'), 260);
  }

  function focusBooking(id) {
    const b = state.bookings.find(x => x.id === id);
    if (!b) return;
    state.selectedId = id;
    if (state.view === 'day') state.dayIndex = dayIndexOf(b.day);
    render();
    const el = $(`.block[data-id="${CSS.escape(id)}"]`);
    if (el) {
      // Desplaza solo el calendario (la página no se mueve)
      const wrap = $('#cal-wrap'), wr = wrap.getBoundingClientRect(), er = el.getBoundingClientRect();
      wrap.scrollTo({ top: wrap.scrollTop + er.top - wr.top - wr.height / 2 + er.height / 2, left: wrap.scrollLeft + er.left - wr.left - wr.width / 2 + er.width / 2, behavior: 'smooth' });
      el.classList.add('flash');
    }
  }

  // ================================================================
  //  Toast
  // ================================================================
  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2600);
  }

  // ================================================================
  //  Confirmación dentro de la página (sin confirm() nativo)
  // ================================================================
  function askConfirm(msg, okLabel = 'Continuar', danger = false) {
    return new Promise(resolve => {
      const d = $('#confirm-dialog');
      $('#c-msg').textContent = msg;
      const ok = $('#c-ok');
      ok.textContent = okLabel;
      ok.className = danger ? 'danger-solid' : 'primary';
      const done = v => { d.removeEventListener('close', onClose); ok.onclick = null; if (d.open) d.close(); resolve(v); };
      const onClose = () => done(false);
      ok.onclick = () => done(true);
      d.addEventListener('close', onClose);
      d.showModal();
    });
  }

  // ================================================================
  //  Diálogo de reserva (coordinador)
  // ================================================================
  let draft = null, editingId = null;
  const dlg = () => $('#booking-dialog');

  function fillTeamSelect() {
    $('#f-team').innerHTML = TEAMS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  }

  function zoneOptions(kind, format) {
    if (kind === 'partido') return format === 'F11' ? ['full'] : ['A', 'B', 'full'];
    return ['full', 'A', 'B', 'A1', 'A2', 'B1', 'B2'];
  }

  function zoneSVG(zone) {
    const lanes = ZONES[zone];
    const rects = lanes.map(l => `<rect class="sel" x="${2 + l * 13}" y="2" width="13" height="32"/>`).join('');
    return `<svg viewBox="0 0 56 36" aria-hidden="true"><rect class="pitch" x="2" y="2" width="52" height="32"/>${rects}
      <line class="mark" x1="28" y1="2" x2="28" y2="34"/><circle class="mark" cx="28" cy="18" r="5"/>
      <line class="mark" x1="15" y1="2" x2="15" y2="34" stroke-dasharray="2 2"/><line class="mark" x1="41" y1="2" x2="41" y2="34" stroke-dasharray="2 2"/></svg>`;
  }

  function syncForm() {
    const team = teamOf(draft.team);
    if (!team.match && draft.kind === 'partido') draft.kind = 'entreno';
    if (draft.kind === 'partido' && !draft.format) draft.format = team.match?.format || 'F11';
    const opts = zoneOptions(draft.kind, draft.format);
    const ev = draft.kind === 'evento';
    $$('.team-only', dlg()).forEach(x => x.hidden = ev);
    $$('.evento-only', dlg()).forEach(x => x.hidden = !ev);
    $('#f-ev-title').value = draft.title || '';
    if (!opts.includes(draft.zone)) draft.zone = opts.includes('A') && draft.zone && draft.zone.startsWith('B') ? 'B' : opts[0] === 'full' && draft.kind === 'entreno' ? 'A' : opts[0];

    if (isTpl()) draft.kind = 'entreno';
    $$('.week-only', dlg()).forEach(x => x.hidden = isTpl());
    $$('.tpl-only', dlg()).forEach(x => x.hidden = !isTpl());
    $('#f-weekday').value = String(dayIndexOf(draft.day));
    $('#f-team').value = draft.team;
    $$('#f-kind button').forEach(x => { x.classList.toggle('on', x.dataset.v === draft.kind); x.disabled = x.dataset.v === 'partido' && !team.match; });
    $$('#f-kind button')[1].title = team.match ? '' : `${team.name} no juega partidos`;
    $$('#f-format button').forEach(x => x.classList.toggle('on', x.dataset.v === draft.format));
    $$('.match-only', dlg()).forEach(x => x.hidden = draft.kind !== 'partido');
    $$('.duration-field', dlg()).forEach(x => x.hidden = draft.kind === 'partido');
    $('#f-start-label').textContent = draft.kind === 'partido' ? 'Hora del partido (saque)' : 'Hora de inicio';
    $('#f-zone').innerHTML = opts.map(z => `<button type="button" class="zone-opt ${z === draft.zone ? 'on' : ''}" data-v="${z}">${zoneSVG(z)}${ZONE_LABEL[z]}</button>`).join('');
    $('#f-date').value = draft.day;
    $('#f-start').value = fmt(draft.start_min);
    $('#f-dur').value = draft.duration_min || DEFAULT_DUR;
    $('#f-opp').value = draft.opponent || '';
    $('#f-notes').value = draft.notes || '';
    $('#f-confirmed').checked = !!draft.confirmed;
    for (const [id, ch] of [['#f-comm', 'group'], ['#f-comm-board', 'board']]) { $(id).checked = commState(draft, ch) === 'done'; delete $(id).dataset.touched; }
    renderCommField();
    const away = draft.kind === 'partido' && !!draft.away;
    $$('#f-where button').forEach(x => x.classList.toggle('on', (x.dataset.v === 'fuera') === away));
    $$('.away-only', dlg()).forEach(x => x.hidden = !away);
    $('#f-zone-field').hidden = away;
    $('#f-venue').value = draft.venue || '';
    renderRival();
    $('#f-obs').value = draft.observations || '';
    renderProposals($('#f-props'), editingId ? state.bookings.find(b => b.id === editingId) : null, true);
    renderPreview();
  }

  function readInputs() {
    draft.team = $('#f-team').value;
    if (isTpl()) draft.day = keyOf(addDays(state.weekStart, +$('#f-weekday').value));
    else if ($('#f-date').value) draft.day = $('#f-date').value;
    if ($('#f-start').value) draft.start_min = snap(toMin($('#f-start').value));
    const dur = parseInt($('#f-dur').value, 10);
    if (dur > 0) draft.duration_min = clamp(snap(dur), 15, 600);
    draft.opponent = $('#f-opp').value.trim();
    draft.notes = $('#f-notes').value.trim();
    draft.title = $('#f-ev-title').value.trim();
    draft.confirmed = $('#f-confirmed').checked;
    for (const [id, ch] of [['#f-comm', 'group'], ['#f-comm-board', 'board']]) {
      if (!$(id).dataset.touched) continue;
      const f = COMM[ch];
      if ($(id).checked && draft.confirmed) { if (commState(draft, ch) !== 'done') { draft[f.at] = new Date().toISOString(); draft[f.sig] = commSig(draft); } }
      else { draft[f.at] = null; draft[f.sig] = null; }
    }
    renderCommField();
    draft.venue = $('#f-venue').value.trim();
    draft.observations = $('#f-obs').value.trim();
  }

  function draftIssues() {
    const cand = { ...draft, id: '__draft__' };
    const others = state.bookings.filter(b => b.id !== editingId);
    return computeIssues([...others, cand]).byId.get('__draft__') || [];
  }

  /** Editor: muestra si el saque está en horario federativo y el estado de aprobación del rival */
  function renderRival() {
    if (draft.kind !== 'partido' || isTpl()) return;
    const w = fedWindows(draft.team);
    const out = needsRival(draft);
    $('#f-rival-wrap').hidden = !w || !!draft.away;
    $('#f-fed').innerHTML = !w ? '' : out
      ? `<b class="fed-out">Fuera del horario federativo</b> de ${esc(teamOf(draft.team).name)} (${esc(fedText(draft.team))}). Necesita la aprobación del rival.`
      : `<span class="fed-in">✓ Dentro del horario federativo</span> (${esc(fedText(draft.team))}).`;
    $('#f-rival').hidden = !out;
    $$('#f-rival button').forEach(x => x.classList.toggle('on', x.dataset.v === (draft.rival_status || 'pendiente')));
  }

  function renderPreview() {
    renderRival();
    const t = timeline(draft), team = whoOf(draft);
    const total = t.end - t.start;
    const bar = t.segs.map(s => `<div class="tl-${s.t}" style="flex:${s.to - s.from}" title="${s.label} ${fmt(s.from)}–${fmt(s.to)}">${(s.to - s.from) / total > .12 ? s.label : ''}</div>`).join('');
    const issues = draftIssues();
    const weekEnd = keyOf(addDays(state.weekStart, 6));
    const outside = !isTpl() && (draft.day < keyOf(state.weekStart) || draft.day > weekEnd);
    renderHabNote();
    const detail = draft.kind === 'partido'
      ? t.segs.map(s => `${s.label}: <b>${fmt(s.from)}–${fmt(s.to)}</b>`).join(' · ')
      : `Ocupa <b>${fmt(t.start)}–${fmt(t.end)}</b> (${total} min)`;
    $('#f-preview').innerHTML = `<div><b>${esc(team.name)}</b> · ${KIND_LABEL[draft.kind]}${draft.kind === 'partido' ? ' ' + (draft.format || '') : ''} · ${ZONE_LABEL[draft.zone]} · ${dayText(draft.day)}</div>
      <div class="tl" style="--c:${team.color}">${bar}</div>
      <div class="tl-times"><span>${fmt(t.start)}</span><span>${fmt(t.end)}</span></div>
      <div style="margin-top:4px">${detail}</div>
      <ul class="pv-issues">${outside ? '<li class="warn">Fecha fuera de la semana visible: solo se comprueban las reservas de esta semana.</li>' : ''}
      ${issues.map(i => `<li class="${i.level}">${ICON[i.level]} ${esc(i.msg)}</li>`).join('')}${!worstLevel(issues) && !outside ? '<li class="ok">✓ Sin conflictos</li>' : ''}</ul>`;
    return issues;
  }

  /** En una semana concreta: muestra lo habitual de ese entreno y permite volver a ello */
  function renderHabNote() {
    const el = $('#f-hab');
    const t = !isTpl() && draft.template_id && state.template.find(x => x.id === draft.template_id);
    if (!t) { el.hidden = true; return; }
    const habDay = keyOf(addDays(mondayOf(parseKey(draft.day)), t.weekday));
    const same = draft.day === habDay && draft.start_min === t.start_min && (draft.duration_min || DEFAULT_DUR) === t.duration_min && draft.zone === t.zone && draft.team === t.team;
    el.hidden = false;
    el.classList.toggle('diff', !same);
    el.innerHTML = `<span><b>Habitual:</b> ${esc(teamOf(t.team).name)}, ${esc(habText(t))}${same ? ' · <span class="ok-txt">sin cambios</span>' : ''}</span>
      ${same ? '' : '<button type="button" class="ghost" id="f-restore">Volver a lo habitual</button>'}`;
  }

  let rivalTouched = false;
  function openEditor(b, isNew) {
    rivalTouched = false;
    draft = { ...b };
    editingId = isNew ? null : b.id;
    $('#f-title').textContent = isTpl() ? (isNew ? 'Nuevo entreno habitual' : 'Editar entreno habitual') : (isNew ? (b.template_id ? 'Recuperar entreno habitual' : 'Nueva reserva') : 'Editar reserva');
    $('#f-delete').hidden = isNew;
    $('#f-dup').hidden = isNew;
    $('#f-rem').hidden = isNew || isTpl();
    $('#f-share').hidden = isNew || isTpl() || draft.kind !== 'partido';
    syncForm();
    if (!dlg().open) dlg().showModal();
    dlg().querySelector('.dlg-body').scrollTop = 0;
  }

  function newDraft(dayKey, startMin, zone) {
    const team = state.filter || TEAMS[0].id;
    return { team, kind: 'entreno', day: dayKey, start_min: startMin, duration_min: DEFAULT_DUR, zone: zone || 'A', format: null, opponent: '', notes: '' };
  }

  async function saveDraft() {
    readInputs();
    if (draft.kind === 'evento' && !draft.title) { toast('Escribe el nombre de la reserva extraordinaria', true); $('#f-ev-title').focus(); return; }
    const issues = renderPreview();
    const errs = issues.filter(i => i.level === 'error');
    if (errs.length && !(await askConfirm(`Hay ${errs.length} conflicto(s):\n\n• ${errs.map(e => e.msg).join('\n• ')}\n\n¿Guardar igualmente?`, 'Guardar igualmente'))) return;
    try {
      if (editingId) await api().update(editingId, draft);
      else await api().insert(draft);
      dlg().close();
      toast(isTpl() ? (editingId ? 'Horario habitual actualizado' : 'Entreno añadido al horario habitual') : (editingId ? 'Reserva actualizada' : 'Reserva creada'));
      const ws = mondayOf(parseKey(draft.day));
      if (!isTpl() && keyOf(ws) !== keyOf(state.weekStart)) setWeek(ws); else await load();
    } catch (e) { toast('No se pudo guardar: ' + e.message, true); }
  }

  async function deleteDraft() {
    if (!editingId) return;
    const msg = isTpl()
      ? `¿Quitar el entreno de ${whoOf(draft).name} (${dayText(draft.day)} ${fmt(draft.start_min)}) del horario habitual? También se quitará desde hoy de las semanas ya publicadas, salvo donde lo hayas cambiado a mano.`
      : `¿Eliminar la reserva de ${whoOf(draft).name} (${dayLabel(draft.day)} ${fmt(draft.start_min)})?${draft.template_id ? ' Quedará marcado como que esta semana no entrena.' : ''}`;
    if (!(await askConfirm(msg, isTpl() ? 'Quitar del habitual' : 'Eliminar', true))) return;
    try { await api().remove(editingId); dlg().close(); toast(isTpl() ? 'Quitado del horario habitual' : 'Reserva eliminada'); await load(); }
    catch (e) { toast('No se pudo eliminar: ' + e.message, true); }
  }

  // ================================================================
  //  Detalle (solo lectura)
  // ================================================================
  // ================================================================
  //  Propuestas de horario para un partido
  // ================================================================
  const weekCache = new Map();
  async function weekBookings(mondayK) {
    if (mondayK === keyOf(state.weekStart) && !isTpl()) return state.bookings;
    const c = weekCache.get(mondayK);
    if (c && Date.now() - c.at < 30000) return c.rows;
    const rows = await store.list(mondayK, keyOf(addDays(parseKey(mondayK), 6)));
    weekCache.set(mondayK, { at: Date.now(), rows });
    return rows;
  }

  const SLOT_RANGE = { manana: [toMin('09:30'), toMin('13:30')], tarde: [toMin('15:00'), toMin('20:30')], any: [toMin('09:30'), toMin('20:30')] };
  const SLOT_LABEL = { manana: 'por la mañana', tarde: 'por la tarde', any: 'a cualquier hora' };

  /** ¿Cabe el partido ese día? Con hora exacta la comprueba; sin ella busca el primer hueco libre de la franja.
   *  Devuelve { level: 'ok'|'warn'|'error', text, start } */
  async function checkSlot(b, day, start_min, slot) {
    try {
      const all = (await weekBookings(keyOf(mondayOf(parseKey(day))))).filter(x => x.id !== b.id);
      const test = st => {
        const cand = { ...b, day, start_min: st, id: '__prop__' };
        return (computeIssues([...all, cand]).byId.get('__prop__') || []).filter(i => i.level === 'error' || i.level === 'warn');
      };
      const fedNote = st => b.kind === 'partido' && !inFedWindow(b.team, day, st) ? ' · fuera del horario federativo: necesita OK del rival' : '';
      if (start_min != null) {
        const iss = test(start_min), err = iss.find(i => i.level === 'error');
        if (err) return { level: 'error', text: err.msg.replace(/^Conflicto: /, 'Choca: '), start: start_min };
        if (iss.length) return { level: 'warn', text: iss[0].msg + fedNote(start_min), start: start_min };
        if (fedNote(start_min)) return { level: 'warn', text: 'Hueco libre' + fedNote(start_min), start: start_min };
        return { level: 'ok', text: 'Hueco libre', start: start_min };
      }
      // Entre semana, «a cualquier hora» empieza por la tarde (horario escolar)
      const weekday = dayIndexOf(day) < 5;
      const [a, z] = !slot && weekday ? [toMin('16:00'), toMin('21:00')] : SLOT_RANGE[slot || 'any'];
      // Primero dentro del horario federativo; si no hay, cualquier hora libre (necesitará OK del rival)
      for (let st = a; st <= z; st += SNAP) if (!fedNote(st) && !test(st).some(i => i.level === 'error')) return { level: 'ok', text: `Hueco libre a las ${fmt(st)}`, start: st };
      for (let st = a; st <= z; st += SNAP) if (!test(st).some(i => i.level === 'error')) return { level: 'warn', text: `Hueco libre a las ${fmt(st)}${fedNote(st)}`, start: st };
      return { level: 'error', text: `No hay hueco libre ${SLOT_LABEL[slot || 'any']}`, start: null };
    } catch { return { level: 'warn', text: 'No se pudo comprobar', start: null }; }
  }

  function canProposeFor(b) { return !!b && b.kind === 'partido' && (isCoord() || isMine(b.team)); }

  function renderProposals(box, b, inEditor) {
    if (!box) return;
    if (!b) { box.innerHTML = '<p class="props-empty">Guarda el partido para poder añadir propuestas de horario.</p>'; return; }
    const list = state.proposals.get(b.id) || [];
    const fmtD = k => { const d = parseKey(k); return `${DAYS_SHORT[dayIndexOf(k)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
    const when = iso => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
    const order = { pendiente: 0, aceptada: 1, descartada: 2 };
    const rows = [...list].sort((x, y) => order[x.status] - order[y.status] || x.created_at.localeCompare(y.created_at)).map(p => {
      const mine = p.created_by && p.created_by === state.user?.id;
      const actions = p.status !== 'pendiente' ? `<span class="prop-st">${p.status === 'aceptada' ? 'Aplicada' : 'Descartada'}</span>`
        : [isCoord() && `<button type="button" class="primary" data-prop="apply">Aplicar</button>`, isCoord() && `<button type="button" class="ghost" data-prop="discard">Descartar</button>`,
          (mine || isCoord()) && `<button type="button" class="link danger-link" data-prop="delete">Borrar</button>`].filter(Boolean).join('');
      return `<li class="prop st-${p.status}" data-id="${esc(p.id)}">
        <div class="prop-main"><b>${fmtD(p.day)} · ${p.start_min != null ? fmt(p.start_min) : SLOT_LABEL[p.slot || 'any']}</b> ${p.status === 'pendiente' ? '<span class="prop-check" data-chk>Comprobando…</span>' : ''}
          ${p.reason ? `<p class="prop-reason">${esc(p.reason)}</p>` : ''}
          <span class="prop-meta">Propuesta por ${esc(p.author_name || 'la coordinación')} · ${when(p.created_at)}</span></div>
        <div class="prop-actions">${actions}</div></li>`;
    }).join('');
    const can = canProposeFor(b);
    box.innerHTML = `${rows ? `<ul class="props">${rows}</ul>` : '<p class="props-empty">Sin propuestas.</p>'}
      ${can ? `<div class="prop-form">
        <input type="date" aria-label="Día propuesto" data-pf="day" value="${b.day}">
        <select aria-label="Cuándo" data-pf="slot"><option value="exact">Hora exacta</option><option value="manana">Por la mañana</option><option value="tarde">Por la tarde</option><option value="any">A cualquier hora</option></select>
        <input type="time" aria-label="Hora de saque propuesta" data-pf="time" step="900" value="${fmt(b.start_min)}">
        <input type="text" aria-label="Motivo" data-pf="reason" maxlength="300" placeholder="Motivo (ej.: 5 bajas por un torneo escolar)">
        <button type="button" class="ghost" data-prop="add">Proponer</button>
      </div>` : ''}`;
    box.dataset.booking = b.id;
    box.dataset.editor = inEditor ? '1' : '';
    // Comprueba cada propuesta pendiente contra el calendario de su semana
    for (const li of box.querySelectorAll('.prop.st-pendiente')) {
      const p = list.find(x => x.id === li.dataset.id);
      checkSlot(b, p.day, p.start_min, p.slot).then(r => { const el = li.querySelector('[data-chk]'); if (el) { el.textContent = r.level === 'ok' ? '✓ ' + r.text : r.text; el.className = 'prop-check ' + r.level; } });
    }
  }

  async function onProposalClick(e) {
    const box = e.currentTarget;
    const btn = e.target.closest('[data-prop]'); if (!btn) return;
    const b = state.bookings.find(x => x.id === box.dataset.booking); if (!b) return;
    const act = btn.dataset.prop;
    const refresh = async () => { await load(); const nb = state.bookings.find(x => x.id === b.id); renderProposals(box, nb || null, !!box.dataset.editor); };
    try {
      if (act === 'add') {
        const day = box.querySelector('[data-pf=day]').value, time = box.querySelector('[data-pf=time]').value;
        const mode = box.querySelector('[data-pf=slot]').value;
        const reason = box.querySelector('[data-pf=reason]').value.trim();
        if (!day) { toast('Indica el día propuesto', true); return; }
        if (mode === 'exact' && !time) { toast('Indica la hora propuesta', true); return; }
        const start_min = mode === 'exact' ? snap(toMin(time)) : null;
        await store.proposals.add({ booking_id: b.id, day, start_min, slot: ['manana', 'tarde'].includes(mode) ? mode : null, reason: reason || null, author_name: displayName().slice(0, 80) || null });
        toast('Propuesta añadida'); await refresh(); return;
      }
      const li = btn.closest('.prop'); const p = (state.proposals.get(b.id) || []).find(x => x.id === li.dataset.id); if (!p) return;
      if (act === 'delete') { await store.proposals.remove(p.id); toast('Propuesta borrada'); await refresh(); }
      if (act === 'discard') { await store.proposals.setStatus(p.id, 'descartada'); toast('Propuesta descartada'); await refresh(); }
      if (act === 'apply') {
        const chk = await checkSlot(b, p.day, p.start_min, p.slot);
        const st = chk.start ?? p.start_min;
        if (st == null) { toast(`${chk.text}. Mueve el partido a mano o elige otra propuesta.`, true); return; }
        const extra = chk.level === 'error' ? `\n\nOjo: ${chk.text}` : p.start_min == null ? '\n\nEs la primera hora libre de esa franja; luego puedes ajustarla.' : '';
        if (!(await askConfirm(`¿Mover el partido de ${teamOf(b.team).name} al ${dayLabel(p.day)} a las ${fmt(st)}?${extra}`, 'Aplicar propuesta'))) return;
        await store.update(b.id, { ...b, day: p.day, start_min: st, rival_status: 'pendiente' });
        await store.proposals.setStatus(p.id, 'aceptada');
        if (box.dataset.editor && draft && editingId === b.id) { draft.day = p.day; draft.start_min = st; }
        toast('Partido movido a la hora propuesta');
        const ws = mondayOf(parseKey(p.day));
        if (keyOf(ws) !== keyOf(state.weekStart)) { dlg().open && dlg().close(); $('#detail-dialog').open && $('#detail-dialog').close(); setWeek(ws); return; }
        await refresh();
        if (box.dataset.editor && draft) syncForm();
      }
    } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
  }

  async function confirmWeekMatches() {
    closeUserMenu();
    const only = myTeams() && state.issueScope !== 'all' ? myTeams() : null;
    const n = state.bookings.filter(b => b.kind === 'partido' && !b.confirmed && b.day >= keyOf(new Date()) && (!only || only.includes(b.team))).length;
    if (!n) return;
    if (!(await askConfirm(`Se marcarán como confirmados los ${n} partidos pendientes de esta semana${only ? ' de tus equipos' : ''}.`, 'Confirmar partidos'))) return;
    try { await store.confirmMatches(keyOf(new Date()) > keyOf(state.weekStart) ? keyOf(new Date()) : keyOf(state.weekStart), keyOf(addDays(state.weekStart, 6)), only); toast('Partidos confirmados'); await load(); }
    catch (e) { toast('No se pudo confirmar: ' + e.message, true); }
  }

  function openDetail(b) {
    const t = timeline(b), team = whoOf(b);
    const issues = state.issues.byId.get(b.id) || [];
    $('#d-title').innerHTML = `<span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${team.color}"></span>${esc(team.name)}`;
    const rows = [
      ['Tipo', KIND_LABEL[b.kind] + (b.format ? ' ' + b.format : '')],
      ['Día', dayLabel(b.day)],
      ...(t.kick != null ? [['Partido', `${fmt(t.kick)} – ${fmt(t.coreEnd)}`], ['Ocupa el campo', `${fmt(t.start)} – ${fmt(t.end)}`]] : [['Horario', `${fmt(t.start)} – ${fmt(t.end)}`]]),
      ['Zona', ZONE_LABEL[b.zone] || b.zone],
      ...(() => {
        const t = b.template_id && state.template.find(x => x.id === b.template_id);
        const c = state.issues.changed?.get(b.id);
        if (c?.what[0] === 'extra') return [['Habitual', 'Entreno extra, no está en el horario habitual']];
        return t ? [['Habitual', habText(t) + (c ? ' · ↻ cambiado esta semana' : '')]] : [];
      })(),
    ];
    if (b.kind === 'partido') {
      if (b.opponent) rows.push(['Rival', b.opponent]);
      for (const s of t.segs) rows.push([s.label, `${fmt(s.from)} – ${fmt(s.to)}`]);
    }
    if (b.kind === 'partido') rows.splice(1, 0, ['Dónde', b.away ? `Fuera${b.venue ? ' · ' + b.venue : ''}` : 'En casa'], ['Horario', b.confirmed ? '✓ Confirmado' : 'Por confirmar'],
      ...(b.confirmed ? Object.entries(COMM).map(([ch, f]) => [f.label, ({ pending: 'Sin comunicar', changed: '⚠️ Cambió después de comunicarlo', done: `📣 Comunicado el ${shortDate(keyOf(new Date(b[f.at])))}` })[commState(b, ch)]]) : []),
      ...(fedWindows(b.team) ? [['Horario federativo', needsRival(b) ? `Fuera (${fedText(b.team)}) · ${RIVAL_LABEL[b.rival_status || 'pendiente']}` : '✓ Dentro']] : []));
    if (b.notes) rows.push(['Notas', b.notes]);
    if (b.kind === 'partido' && b.observations) rows.push(['Observaciones', b.observations]);
    if (b.kind === 'partido') {
      if (jornadaOf(b)) rows.push(['Jornada', String(jornadaOf(b))]);
      if (b.meet_min != null) rows.push(['Quedada', fmt(b.meet_min)]);
      if (b.away && b.depart_min != null) rows.push(['Salida', fmt(b.depart_min)]);
      if (b.away && b.venue) rows.push(['Campo', b.venue_confirmed ? '✓ Confirmado' : 'Sin confirmar']);
    }
    $('#d-body').innerHTML = `<dl class="detail-rows">${rows.map(([a, v]) => `<dt>${esc(a)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${issues.length ? `<ul class="pv-issues">${issues.map(i => `<li class="${i.level}">${ICON[i.level]} ${esc(i.msg)}${ackButton(i)}</li>`).join('')}</ul>` : ''}
      ${b.kind === 'partido' ? '<div class="field"><span class="lbl">Propuestas de horario</span><div id="d-props" class="props-box"></div></div>' : ''}`;
    if (b.kind === 'partido') renderProposals($('#d-props'), b, false);
    if (!isTpl()) $('#d-body').insertAdjacentHTML('beforeend', `<div class="d-rem">${b.kind === 'partido' ? '<button type="button" class="primary" id="d-share">📣 Compartir horario</button>' : ''}${isCoord() ? Object.entries(COMM).filter(([ch]) => commTodo(b, ch)).map(([ch, f]) => `<button type="button" class="ghost" data-d-comm="${ch}">✓ Ya comunicado ${f.to}</button>`).join('') : ''}${isCoord() ? '<button type="button" class="ghost" id="d-rem">🔔 Añadir recordatorio</button>' : ''}</div>`);
    $('#detail-dialog').dataset.id = b.id;
    $('#detail-dialog').showModal();
    $('#d-body').scrollTop = 0;
  }

  // ================================================================
  //  Arrastrar y redimensionar
  // ================================================================
  let drag = null;

  function laneZone(origZone, lane) {
    const n = (ZONES[origZone] || ZONES.full).length;
    if (n === 4) return 'full';
    if (n === 2) return lane < 2 ? 'A' : 'B';
    return QUARTERS[lane];
  }

  let suppressClickUntil = 0;
  function onBlockPointerDown(e, el) {
    if (!isEditor() || e.button > 0) return;
    const b = state.bookings.find(x => x.id === el.dataset.id);
    if (!b) return;
    const touch = e.pointerType === 'touch';
    if (!touch) e.preventDefault();
    drag = {
      el, b, x0: e.clientX, y0: e.clientY, moved: false,
      resize: !!e.target.dataset.resize,
      cand: { ...b },
      // En pantallas táctiles: deslizar desplaza el calendario; para mover hay que mantener pulsado
      touch, armed: !touch, timer: null,
    };
    if (touch) {
      drag.timer = setTimeout(() => {
        if (!drag) return;
        drag.armed = true;
        el.classList.add('lifted');
        try { navigator.vibrate?.(15); } catch { }
      }, 450);
    }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragCancel, { once: true });
  }

  function onDragMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.armed) {   // dedo en movimiento antes de la pulsación larga: es un desplazamiento, no un arrastre
      if (Math.hypot(dx, dy) > 8) abandonDrag();
      return;
    }
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.el.classList.add('dragging');
      drag.el.classList.remove('cont-up', 'cont-down', 'shared');
      $$('.block').forEach(x => { if (x.dataset.id === drag.b.id && x !== drag.el) x.hidden = true; });
      const sub = drag.el.querySelector('.b-sub'); if (sub) sub.textContent = subLabel(drag.b);
      document.body.style.userSelect = 'none';
    }
    const { b, el } = drag;
    const cand = { ...b };
    if (drag.resize) {
      cand.duration_min = clamp(snap((b.duration_min || DEFAULT_DUR) + dy / PX), 15, 600);
    } else {
      cand.start_min = clamp(snap(b.start_min + dy / PX), DAY_START - 60, DAY_END);
      const col = $$('.day-col').find(c => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
      if (col) {
        const r = col.getBoundingClientRect();
        const lane = clamp(Math.floor((e.clientX - r.left) / (r.width * fieldW(col.dataset.key) / 100) * 4), 0, 3);
        cand.day = col.dataset.key;
        if (!b.away) cand.zone = laneZone(b.zone, lane);
        if (el.parentElement !== col) col.appendChild(el);
      }
    }
    drag.cand = cand;
    // Actualiza posición y estado de avisos en vivo
    const t = timeline(cand);
    const g = b.away ? awayGeom(cand) : blockGeom(t, ZONES[cand.zone] || ZONES.full, fieldW(cand.day));
    el.style.cssText = `--c:${whoOf(b).color};${geomStyle(g)}`;
    const segs = el.querySelector('.segs');
    if (segs) segs.style.top = (t.start - g.vs) * PX + 'px';
    const bt = el.querySelector('.b-time'); if (bt) bt.textContent = t.kick != null ? `${fmt(t.kick)}–${fmt(t.coreEnd)}` : `${fmt(t.start)}–${fmt(t.end)}`;
    const others = state.bookings.filter(x => x.id !== b.id);
    const issues = computeIssues([...others, cand]).byId.get(cand.id) || [];
    const lvl = worstLevel(issues);
    el.classList.remove('lvl-error', 'lvl-warn');
    if (lvl) el.classList.add('lvl-' + lvl);
    const tip = $('#drag-tip');
    tip.hidden = false;
    tip.innerHTML = `<div class="t">${dayLabel(cand.day)} · ${timeText(cand, t)} · ${ZONE_LABEL[cand.zone]}</div>` +
      issues.slice(0, 4).map(i => `<div class="${{ error: 'e', warn: 'w', info: 'i' }[i.level]}">${ICON[i.level]} ${esc(i.msg)}</div>`).join('') + (issues.length > 4 ? `<div>… y ${issues.length - 4} más</div>` : '') + (worstLevel(issues) ? '' : '<div class="ok">✓ Sin conflictos</div>');
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tw - 8) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
  }

  async function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointercancel', onDragCancel);
    $('#drag-tip').hidden = true;
    document.body.style.userSelect = '';
    const d = drag; drag = null;
    if (!d) return;
    clearTimeout(d.timer); d.el.classList.remove('lifted');
    if (!d.moved) { openEditor(d.b, false); return; }
    suppressClickUntil = Date.now() + 400;
    const c = d.cand, b = d.b;
    if (b.kind === 'partido' && (c.day !== b.day || c.start_min !== b.start_min)) c.rival_status = 'pendiente';
    if (c.day === b.day && c.start_min === b.start_min && c.zone === b.zone && c.duration_min === b.duration_min) { render(); return; }
    // Actualización optimista
    Object.assign(state.bookings.find(x => x.id === b.id), c);
    state.selectedId = b.id;
    render();
    try {
      await api().update(b.id, c);
      const iss = state.issues.byId.get(b.id) || [];
      const ne = iss.filter(i => i.level === 'error').length;
      toast(ne ? `Movido · ${ne} conflicto(s) pendiente(s)` : `Movido a ${dayText(c.day)} ${fmt(c.start_min)}`, false);
    } catch (e) { toast('No se pudo mover: ' + e.message, true); await load(); }
  }

  /** Suelta el gesto sin hacer nada (el usuario estaba desplazando el calendario) */
  function abandonDrag() {
    if (!drag) return;
    clearTimeout(drag.timer);
    drag.el.classList.remove('lifted');
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    drag = null;
  }

  function onDragCancel() {
    if (drag && !drag.moved) { abandonDrag(); return; }
    if (drag) clearTimeout(drag.timer);
    window.removeEventListener('pointermove', onDragMove);
    $('#drag-tip').hidden = true;
    document.body.style.userSelect = '';
    drag = null;
    render();
  }

  // ================================================================
  //  Copiar semana anterior
  // ================================================================
  async function copyPrevWeek() {
    const pf = keyOf(addDays(state.weekStart, -7)), pt = keyOf(addDays(state.weekStart, -1));
    let prev;
    try { prev = (await store.list(pf, pt)).filter(b => b.kind === 'entreno'); }
    catch (e) { return toast('Error: ' + e.message, true); }
    if (!prev.length) return toast('La semana anterior no tiene entrenamientos');
    const sig = b => [b.day, b.team, b.start_min, b.zone, b.kind].join('|');
    const existing = new Set(state.bookings.map(sig));
    const rows = prev.map(b => ({ ...b, template_id: null, day: keyOf(addDays(parseKey(b.day), 7)) })).filter(r => !existing.has(sig(r)));
    if (!rows.length) return toast('Esos entrenamientos ya están en esta semana');
    if (!(await askConfirm(`Se copiarán ${rows.length} entrenamiento(s) de la semana anterior a esta semana.`, 'Copiar'))) return;
    try { await store.insertMany(rows); toast(`${rows.length} entrenamiento(s) copiados`); await load(); }
    catch (e) { toast('No se pudo copiar: ' + e.message, true); }
  }

  // ================================================================
  //  Acceso: inicio de sesión, registro y estado de la solicitud
  // ================================================================
  function applySession(s) {
    state.user = s?.user || null;
    state.profile = s?.profile || null;
    const ok = state.profile?.status === 'aprobado';
    state.role = ok ? (state.profile.role === 'coordinador' ? 'coordinador' : 'entrenador') : null;
  }

  let appOpen = false;
  async function refreshSession() {
    let s = null;
    try { s = await store.auth.current(); } catch (e) { toast('No se pudo comprobar la sesión: ' + e.message, true); }
    applySession(s);
    return route();
  }

  function route() {
    if (!state.user) return state.inviteToken ? showInvite() : showAuth('login');
    if (state.profile?.status === 'aprobado') return enterApp();
    if (state.profile?.status === 'rechazado') return showAuth('rejected');
    return showAuth('pending');
  }

  async function enterApp() {
    $('#auth').hidden = true;
    document.body.classList.remove('gated');
    const first = !appOpen;
    appOpen = true;
    if (first && isCoord() && !/semana=/.test(location.hash) && state.mode === 'week') state.mode = 'home';
    if (isCoord() && /#inicio/.test(location.hash)) { state.mode = 'home'; try { history.replaceState(null, '', location.pathname + location.search); } catch { } }
    if (!isCoord() && isHome()) state.mode = 'week';
    render();
    loadTeamSettings();
    await load();
    if (first) {
      const wrap = $('#cal-wrap');
      if (wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop = Math.max(0, (toMin('16:30') - DAY_START) * PX);
    }
    if (isCoord()) { await loadPeople(); loadHome(); swRegistration(); }
    maybeTutorial();
  }

  function leaveApp() {
    appOpen = false;
    document.body.classList.add('gated');
    state.bookings = []; state.people = []; state.players = null; state.callups = null; state.callupRules = null; state.teamOpen = null; if (state.mode === 'teams') state.mode = 'week';
    closeUserMenu();
    $$('dialog[open]').forEach(d => d.close());
  }

  const authField = (id, label, type, extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" ${extra}></div>`;

  function showAuth(view, msg) {
    leaveApp();
    $('#auth').hidden = false;
    const body = $('#auth-body');
    const demo = store.mode === 'demo';
    const name = esc(state.profile?.full_name || state.user?.email || '');
    const teamsTxt = t => (t || []).map(x => esc(teamOf(x).name)).join(', ');
    const views = {
      login: () => `
        <h2 class="auth-h">Iniciar sesión</h2>
        <form id="f-login" class="auth-form" novalidate>
          ${authField('a-email', 'Email', 'email', 'autocomplete="username" required')}
          ${authField('a-pass', 'Contraseña', 'password', 'autocomplete="current-password" required')}
          <label class="keep-check"><input type="checkbox" id="a-keep" ${keepSession() ? 'checked' : ''}><span>Mantener la sesión iniciada<small>Desmárcalo en un dispositivo compartido: la sesión se cerrará al cerrar el navegador.</small></span></label>
          <p class="auth-msg" id="a-msg" ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>
          <button type="submit" class="primary wide">Entrar</button>
          <button type="button" class="link" data-go="forgot">He olvidado mi contraseña</button>
          <p class="auth-note">¿Eres entrenador y aún no tienes cuenta? Pide a la coordinación tu enlace de invitación.</p>
        </form>
        ${demo ? `<div class="demo-quick"><p><b>Demo:</b> entra sin contraseña con un perfil de prueba</p>
          <div><button type="button" class="ghost" data-demo="coordinador@demo">Coordinador</button><button type="button" class="ghost" data-demo="entrenador@demo">Entrenadora (Juvenil y Cadete)</button></div></div>` : ''}`,
      invite: () => {
        const inv = state.invite || {};
        const coord = inv.role === 'coordinador';
        const teams = (inv.teams || []).map(t => `<span class="mini-chip" style="--c:${teamOf(t).color}">${esc(teamOf(t).name)}</span>`).join(' ');
        return `
        <div class="invite-box"><span class="invite-ic">✉</span><div>
          <b>Tienes una invitación</b>
          <p>${coord ? 'Entrarás como <b>coordinador</b>: podrás editar el calendario y gestionar a los entrenadores.' : `Entrarás como <b>entrenador</b>${teams ? ' de ' + teams : ''}.`}</p></div></div>
        <form id="f-invite" class="auth-form" novalidate>
          ${authField('r-name', 'Nombre y apellidos', 'text', `autocomplete="name" maxlength="80" required value="${esc(inv.label && !/coordinador/i.test(inv.label) ? inv.label : '')}"`)}
          ${authField('r-email', 'Email', 'email', 'autocomplete="email" required')}
          ${authField('r-pass', 'Elige una contraseña (mínimo 6 caracteres)', 'password', 'autocomplete="new-password" minlength="6" required')}
          <p class="auth-msg" id="a-msg" hidden></p>
          <button type="submit" class="primary wide">Crear mi cuenta y entrar</button>
          <button type="button" class="link" data-act="noinvite">Ya tengo cuenta</button>
        </form>`;
      },
      'invite-bad': () => `
        <div class="auth-state"><span class="state-ic no">×</span>
          <h2 class="auth-h">Enlace no válido</h2>
          <p>${INVITE_BAD}</p>
          <button type="button" class="ghost wide" data-act="noinvite">Ir a iniciar sesión</button></div>`,
      forgot: () => `
        <h2 class="auth-h">Recuperar contraseña</h2>
        <form id="f-forgot" class="auth-form" novalidate>
          ${authField('fg-email', 'Email de tu cuenta', 'email', 'autocomplete="email" required')}
          <p class="auth-msg" id="a-msg" hidden></p>
          <button type="submit" class="primary wide">Enviarme un enlace</button>
          <button type="button" class="link" data-go="login">Volver</button>
        </form>`,
      reset: () => `
        <h2 class="auth-h">Nueva contraseña</h2>
        <form id="f-reset" class="auth-form" novalidate>
          ${authField('rs-pass', 'Nueva contraseña (mínimo 6 caracteres)', 'password', 'autocomplete="new-password" minlength="6" required')}
          <p class="auth-msg" id="a-msg" hidden></p>
          <button type="submit" class="primary wide">Guardar contraseña</button>
        </form>`,
      sent: () => `
        <div class="auth-state"><span class="state-ic ok">✓</span>
          <h2 class="auth-h">Confirma tu email</h2>
          <p>Tu cuenta está creada. Te hemos enviado un correo para confirmar tu email: ábrelo y pulsa el enlace.</p>
          <p>Después podrás entrar con tu email y contraseña.</p>
          <button type="button" class="ghost wide" data-go="login">Ir a iniciar sesión</button></div>`,
      pending: () => `
        <div class="auth-state"><span class="state-ic wait">⏳</span>
          <h2 class="auth-h">Solicitud pendiente</h2>
          <p>Hola, <b>${name}</b>. Tu solicitud${state.profile?.requested_teams?.length ? ` para <b>${teamsTxt(state.profile.requested_teams)}</b>` : ''} está esperando a que el coordinador la acepte.</p>
          <p>Esta pantalla se abrirá sola en cuanto te den acceso.</p>
          ${demo ? '<p class="auth-note"><b>Demo:</b> cierra sesión, entra como Coordinador y acepta la solicitud desde «Entrenadores».</p>' : ''}
          <div class="auth-row"><button type="button" class="ghost" data-act="logout">Cerrar sesión</button><button type="button" class="primary" data-act="recheck">Comprobar ahora</button></div></div>`,
      rejected: () => `
        <div class="auth-state"><span class="state-ic no">×</span>
          <h2 class="auth-h">Sin acceso</h2>
          <p>El coordinador no ha aceptado tu solicitud o te ha retirado el acceso. Si crees que es un error, habla con la coordinación del club.</p>
          <button type="button" class="ghost wide" data-act="logout">Cerrar sesión</button></div>`,
    };
    body.innerHTML = views[view]();
    body.dataset.view = view;
    body.querySelector('input')?.focus();
  }

  function authMsg(text, ok) {
    const m = $('#a-msg'); if (!m) return;
    m.textContent = text; m.hidden = !text; m.classList.toggle('ok', !!ok);
  }

  async function withBusy(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Un momento…';
    try { await fn(); } catch (e) { authMsg(e.message); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  }

  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || (store.mode === 'demo' && /^[^\s@]+@[^\s@]+$/.test(e));

  // ---- Enlaces de invitación (#invitacion=TOKEN) ----
  const inviteLink = token => `${location.origin}${location.pathname}#invitacion=${token}`;
  function readInviteFromUrl() {
    const m = location.hash.match(/invitacion=([A-Za-z0-9-]{8,64})/);
    if (m) state.inviteToken = m[1];
  }
  function clearInvite() {
    state.inviteToken = null; state.invite = null;
    if (/invitacion=/.test(location.hash)) { try { history.replaceState(null, '', location.pathname); } catch { } }
  }
  async function showInvite() {
    let info = { valid: false };
    try { info = await store.invites.check(state.inviteToken); } catch (e) { toast('No se pudo comprobar la invitación: ' + e.message, true); }
    if (!info.valid) return showAuth('invite-bad');
    state.invite = info;
    showAuth('invite');
  }

  function bindAuth() {
    const body = $('#auth-body');
    body.addEventListener('click', async e => {
      const go = e.target.closest('[data-go]')?.dataset.go;
      if (go) { showAuth(go); return; }
      const demoEmail = e.target.closest('[data-demo]')?.dataset.demo;
      if (demoEmail) { if ($('#a-keep')) setKeepSession($('#a-keep').checked); applySession(await store.auth.signIn(demoEmail)); route(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'logout') { await store.auth.signOut(); applySession(null); showAuth('login'); }
      if (act === 'noinvite') { clearInvite(); showAuth('login'); return; }
      if (act === 'recheck') { await refreshSession(); if (state.profile?.status === 'pendiente') toast('Tu solicitud sigue pendiente'); }
    });
    body.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      if (f.id === 'f-login') withBusy(f, async () => {
        const email = $('#a-email').value.trim(), pass = $('#a-pass').value;
        if (!validEmail(email)) return authMsg('Escribe un email válido.');
        if (!pass && store.mode !== 'demo') return authMsg('Escribe tu contraseña.');
        setKeepSession($('#a-keep').checked);
        applySession(await store.auth.signIn(email, pass));
        route();
      });
      if (f.id === 'f-invite') withBusy(f, async () => {
        const full_name = $('#r-name').value.trim(), email = $('#r-email').value.trim(), password = $('#r-pass').value;
        if (full_name.length < 3) return authMsg('Escribe tu nombre y apellidos.');
        if (!validEmail(email)) return authMsg('Escribe un email válido.');
        if (password.length < 6) return authMsg('La contraseña debe tener al menos 6 caracteres.');
        const res = await store.auth.signUp({ email, password, full_name, invite: state.inviteToken });
        clearInvite();
        if (res.session) { applySession(res.session); route(); toast('Cuenta creada. ¡Bienvenido!'); }
        else showAuth('sent');
      });
      if (f.id === 'f-forgot') withBusy(f, async () => {
        const email = $('#fg-email').value.trim();
        if (!validEmail(email)) return authMsg('Escribe un email válido.');
        if (store.mode === 'demo') return authMsg('En la demo no se envían correos.', true);
        try { await store.auth.resetPassword(email); }
        catch (ex) { throw new Error('No se pudo enviar el correo (' + ex.message + '). Si no lo recibes, pide ayuda a la coordinación.'); }
        authMsg('Si el email tiene cuenta, recibirás un enlace para crear una contraseña nueva. Revisa también el correo no deseado.', true);
      });
      if (f.id === 'f-reset') withBusy(f, async () => {
        const pw = $('#rs-pass').value;
        if (pw.length < 6) return authMsg('La contraseña debe tener al menos 6 caracteres.');
        await store.auth.updatePassword(pw);
        toast('Contraseña cambiada');
        try { history.replaceState(null, '', location.pathname); } catch { }
        await refreshSession();
      });
    });
    $('#auth-tour').onclick = () => window.Tutorial?.start({ role: null, intro: true });
  }

  // ================================================================
  //  Entrenadores y solicitudes (coordinador)
  // ================================================================
  async function loadPeople() {
    if (!isCoord()) return;
    const before = new Set(state.people.filter(p => p.status === 'pendiente').map(p => p.id));
    try { [state.people, state.invites] = await Promise.all([store.people.list(), store.invites.list()]); }
    catch (e) { toast('No se pudo cargar la lista de entrenadores: ' + e.message, true); return; }
    const fresh = state.people.filter(p => p.status === 'pendiente' && !before.has(p.id));
    if (fresh.length && peopleLoadedOnce) toast(`Nueva solicitud de acceso: ${fresh[0].full_name || fresh[0].email}`);
    peopleLoadedOnce = true;
    renderUser();
    if ($('#people-dialog').open) renderPeople();
  }
  let peopleLoadedOnce = false;

  // ---------- Listados de partidos: por equipo y por fin de semana ----------
  const MATCH_TEAMS = () => TEAMS.filter(t => t.match);
  const mxDate = k => { const d = parseKey(k); return `<b>${DAYS_SHORT[dayIndexOf(k)]}</b> ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + String(d.getFullYear()).slice(2) : ''}`; };
  function mxRow(b, { showTeam = false, next = false } = {}) {
    const today = keyOf(new Date()), w = whoOf(b);
    const tags = [];
    for (const [ch, f] of Object.entries(COMM)) {
      const cs = commState(b, ch), nm = ch === 'board' ? 'Directiva' : 'Grupo';
      if (cs === 'done') tags.push(`<span class="mx-tag ok" title="Comunicado ${f.to}">📣 ${nm}</span>`);
      else if (cs && b.day >= todayKey()) tags.push(`<span class="mx-tag warn" title="${cs === 'changed' ? 'Cambió después de comunicarlo ' + f.to : 'Sin comunicar ' + f.to}">${nm}: ${cs === 'changed' ? 'volver a comunicar' : 'sin comunicar'}</span>`);
    }
    if (!b.confirmed && !b.away) tags.push('<span class="mx-tag warn">Por confirmar</span>');
    else if (!b.confirmed && b.away) tags.push('<span class="mx-tag">Hora sin confirmar</span>');
    if (needsRival(b)) tags.push(`<span class="mx-tag ${b.rival_status === 'rechazado' ? 'err' : b.rival_status === 'aprobado' ? '' : 'warn'}">⚑ ${b.rival_status === 'aprobado' ? 'OK del rival' : b.rival_status === 'rechazado' ? 'Rechazado' : 'Falta OK del rival'}</span>`);
    const where = b.away ? (b.venue ? esc(b.venue) : 'Fuera') : `Castalla · ${esc(ZONE_LABEL[b.zone] || b.zone)}`;
    const opp = `vs ${esc(b.opponent || 'rival por definir')}`;
    return `<li><button type="button" class="mx-row ${b.day < today ? 'past' : ''} ${next ? 'next' : ''} ${showTeam ? 'with-team' : ''}" style="--team:${w.color}" data-id="${esc(b.id)}" data-day="${b.day}">
        <span class="mx-date">${showTeam ? '' : mxDate(b.day)}<span class="mx-time">${fmt(b.start_min)}</span></span>
        <span class="mx-main"><span class="mx-opp"><span class="mx-ha ${b.away ? 'away' : 'home'}">${b.away ? 'Fuera' : 'Casa'}</span>${showTeam ? `<span class="mx-team">${esc(w.name)}</span> <span class="mx-vs">${opp}</span>` : opp}</span>
          <span class="mx-where">${where}${b.format ? ' · ' + esc(b.format) : ''}</span>${tags.length ? `<span class="mx-tags">${tags.join('')}</span>` : ''}</span>
        <span class="mx-go" aria-hidden="true">›</span></button></li>`;
  }

  function openMatches(tab) {
    closeUserMenu();
    const teams = MATCH_TEAMS();
    const pick = state.matchesTeam || (state.filter && TEAM[state.filter]?.match ? state.filter : null) || myTeams()?.find(t => TEAM[t]?.match) || teams[0].id;
    $('#mx-team').innerHTML = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    $('#mx-team').value = pick;
    state.matchesTeam = pick;
    $('#matches-dialog').showModal();
    setMatchesTab(tab || state.mxTab || 'team');
  }

  function setMatchesTab(tab) {
    state.mxTab = tab;
    $('#matches-dialog').classList.toggle('mx-wide', tab === 'weekend');
    $$('#mx-tabs button').forEach(b => { const on = b.dataset.mx === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('#mx-team-bar').hidden = tab !== 'team';
    if (tab === 'team') loadMatches(state.matchesTeam); else loadWeekend();
  }

  async function loadMatches(team) {
    state.matchesTeam = team;
    const body = $('#mx-body'), req = (state.mxReq = (state.mxReq || 0) + 1);
    body.innerHTML = '<p class="muted mx-empty">Cargando…</p>';
    let list;
    try { list = await store.listMatches(team); }
    catch (e) { body.innerHTML = `<p class="muted mx-empty">No se han podido cargar: ${esc(e.message)}</p>`; return; }
    if (state.mxReq !== req) return;
    const today = keyOf(new Date());
    const home = list.filter(b => !b.away).length;
    $('#mx-sum').innerHTML = list.length
      ? `<span><b>${list.length}</b> partidos</span><span>${home} en casa</span><span>${list.length - home} fuera</span>` : '';
    if (!list.length) { body.innerHTML = '<p class="muted mx-empty">Este equipo no tiene partidos guardados.</p>'; return; }
    let lastMonth = null;
    const nextId = list.find(b => b.day >= today)?.id;
    const rows = list.map(b => {
      const d = parseKey(b.day), mk = d.getFullYear() * 12 + d.getMonth();
      const head = mk !== lastMonth ? `<li class="mx-month">${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}</li>` : '';
      lastMonth = mk;
      return head + mxRow(b, { next: b.id === nextId });
    }).join('');
    body.innerHTML = `<ul class="mx-list">${rows}</ul>`;
    const nx = nextId && body.querySelector(`[data-id="${CSS.escape(nextId)}"]`);
    body.scrollTop = nx ? Math.max(0, nx.parentElement.offsetTop - body.offsetTop - 40) : body.scrollHeight;
  }

  // Cada finde abarca de jueves a miércoles: el jueves previo y lunes, martes y miércoles siguientes.
  // Clave = lunes de la semana del finde.
  const findeKey = day => { const d = parseKey(day); return keyOf(addDays(mondayOf(d), dayIndexOf(day) < 3 ? -7 : 0)); };
  const findeRange = monKey => [keyOf(addDays(parseKey(monKey), 3)), keyOf(addDays(parseKey(monKey), 9))];
  const DAY_ABBR = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const cellDay = day => { const i = dayIndexOf(day); return i >= 4 ? 'VSD'[i - 4] : `${DAY_ABBR[i]} ${parseKey(day).getDate()}`; };

  // Carga por fin de semana: equipos en columnas, findes (viernes a domingo) en filas
  async function loadWeekend() {
    const body = $('#mx-body'), req = (state.mxReq = (state.mxReq || 0) + 1);
    body.innerHTML = '<p class="muted mx-empty">Cargando…</p>';
    let list;
    try { list = await store.listAllMatches(); state.mxAll = list; }
    catch (e) { body.innerHTML = `<p class="muted mx-empty">No se han podido cargar: ${esc(e.message)}</p>`; return; }
    if (state.mxReq !== req) return;
    const teams = MATCH_TEAMS();
    // Partidos de viernes a domingo, agrupados por el lunes de su semana
    const wk = new Map();
    for (const b of list) {
      if (!TEAM[b.team]) continue;
      const mk = findeKey(b.day);
      if (!wk.has(mk)) wk.set(mk, []);
      wk.get(mk).push(b);
    }
    const shown = [...wk.values()].flat();
    const home = shown.filter(b => !b.away).length;
    $('#mx-sum').innerHTML = shown.length ? `<span><b>${shown.length}</b> partidos</span><span>${home} en casa</span><span>${shown.length - home} fuera</span>` : '';
    if (!wk.size) { body.innerHTML = '<p class="muted mx-empty">No hay partidos guardados.</p>'; return; }
    const keys = [...wk.keys()].sort();
    const weeks = [];
    for (let d = parseKey(keys[0]); keyOf(d) <= keys[keys.length - 1]; d = addDays(d, 7)) weeks.push(keyOf(d));
    const nowWk = keyOf(mondayOf(new Date()));
    const maxHome = Math.max(1, ...weeks.map(k => (wk.get(k) || []).filter(b => !b.away).length));
    const head = `<tr><th class="mx-g-wk">Fin de semana</th><th class="mx-g-tot" title="Partidos en casa">Casa</th><th class="mx-g-tot" title="Partidos fuera">Fuera</th>${teams.map(t => `<th class="mx-g-team" style="--team:${t.color}" title="${esc(t.name)}">${esc(t.short || t.name)}</th>`).join('')}</tr>`;
    const cell = b => {
      const cb = commState(b, 'board'), cg = commState(b, 'group');
      const tag = (b.confirmed ? '' : '?') + (needsRival(b) ? '⚑' : '') + (cb === 'changed' || cg === 'changed' ? '⚠️' : cb === 'done' && cg === 'done' ? '📣' : '');
      const st = (cs, f) => ({ pending: `sin comunicar ${f.to}`, changed: `cambió tras comunicarlo ${f.to}`, done: `comunicado ${f.to}` })[cs];
      const tip = `${whoOf(b).name} · ${DAYS[dayIndexOf(b.day)]} ${fmt(b.start_min)} · ${b.away ? 'fuera' : 'en casa'} · vs ${b.opponent || 'rival por definir'}${b.away && b.venue ? ' · ' + b.venue : ''}${b.confirmed ? ` · ${st(cb, COMM.board)} · ${st(cg, COMM.group)}` : ' · por confirmar'}`;
      return `<button type="button" class="mx-cell ${b.away ? 'away' : 'home'}" data-id="${esc(b.id)}" data-day="${b.day}" title="${esc(tip)}">
        <b>${cellDay(b.day)} ${fmt(b.start_min)}${tag ? `<i>${tag}</i>` : ''}</b><span>${esc(b.opponent || '—')}</span></button>`;
    };
    const rows = weeks.map(k => {
      const ms = wk.get(k) || [], fri = addDays(parseKey(k), 4), sun = addDays(parseKey(k), 6);
      const h = ms.filter(b => !b.away).length, f = ms.length - h;
      const lbl = fri.getMonth() === sun.getMonth() ? `${fri.getDate()}–${sun.getDate()} ${MONTHS[sun.getMonth()]}` : `${fri.getDate()} ${MONTHS[fri.getMonth()]}–${sun.getDate()} ${MONTHS[sun.getMonth()]}`;
      const yr = fri.getFullYear() !== new Date().getFullYear() ? ` <small>${fri.getFullYear()}</small>` : '';
      const heat = h ? 0.12 + 0.55 * h / maxHome : 0;
      return `<tr class="${k < nowWk ? 'past' : ''} ${k === nowWk ? 'now' : ''} ${ms.length ? '' : 'empty'}" data-wk="${k}">
        <th class="mx-g-wk"><div class="mx-wk-cell"><span>${lbl}${yr}${k === nowWk ? '<small class="mx-now">este finde</small>' : ''}</span><button type="button" class="mx-msg" data-msg="${k}" title="Mensaje para la directiva con los partidos de este finde" aria-label="Mensaje para la directiva de los partidos del ${lbl}">💬${(() => { const n = ms.filter(b => commTodo(b, 'board') && b.day >= todayKey()).length; return n ? `<span class="mx-msg-n" title="${n} confirmado${n > 1 ? 's' : ''} sin comunicar a la directiva">${n}</span>` : ''; })()}</button></div></th>
        <td class="mx-g-tot home" style="--heat:${heat.toFixed(2)}">${h || ''}</td><td class="mx-g-tot away">${f || ''}</td>
        ${teams.map(t => `<td class="mx-g-c" style="--team:${t.color}">${ms.filter(b => b.team === t.id).map(cell).join('')}</td>`).join('')}</tr>`;
    }).join('');
    body.innerHTML = `<div class="mx-grid-wrap"><table class="mx-grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
      <p class="mx-legend"><span class="mx-cell home"><b>S 10:00</b></span> en casa · <span class="mx-cell away"><b>D 12:00</b></span> fuera · <b>?</b> por confirmar · <b>⚑</b> falta OK del rival · Cada finde incluye también el jueves anterior y el lunes, martes y miércoles siguientes (con su fecha). La columna <b>Casa</b> es más intensa cuantos más partidos hay en nuestro campo.</p>`;
    const gw = body.querySelector('.mx-grid-wrap');
    const target = body.querySelector('tbody tr.now') || [...body.querySelectorAll('tbody tr')].find(r => r.dataset.wk >= nowWk);
    if (target) gw.scrollTop = Math.max(0, target.offsetTop - gw.querySelector('thead').offsetHeight - 4);
  }

  // ---------- Mensaje de los partidos de un finde (para WhatsApp) ----------
  // Nombre del rival tal como está en el calendario (sin acortar)
  const rivalName = n => (n && String(n).trim()) || '??';
  /** Marca partidos como comunicados a la directiva (mensaje semanal) o al grupo del equipo (compartir horario) */
  async function markCommunicated(list, ch, quiet) {
    const now = new Date().toISOString(), f = COMM[ch];
    const todo = list.filter(b => b.kind === 'partido' && b.confirmed && commState(b, ch) !== 'done');
    for (const b of todo) {
      const row = { ...b, [f.at]: now, [f.sig]: commSig(b) };
      await store.update(b.id, row);
      Object.assign(b, row);
      for (const arr of [state.bookings, state.mxAll || []]) { const x = arr.find(y => y.id === b.id); if (x && x !== b) Object.assign(x, row); }
    }
    if (todo.length) { if (!quiet) toast(`${plural(todo.length, 'partido marcado', 'partidos marcados')} como comunicado${todo.length === 1 ? '' : 's'} ${f.to}`); render(); if (isCoord()) loadHome(); }
    return todo.length;
  }
  function renderCommField() {
    const w = $('#f-comm-wrap'); if (!w) return;
    w.hidden = !draft || draft.kind !== 'partido' || !$('#f-confirmed').checked;
    if (!draft) return;
    const txt = ch => { const cs = commState(draft, ch), f = COMM[ch]; return cs === 'done' ? `${f.label}: comunicado el ${shortDate(keyOf(new Date(draft[f.at])))}.` : cs === 'changed' ? `${f.label}: cambió después de comunicarlo, hay que volver a hacerlo.` : ''; };
    $('#f-comm-hint').textContent = [txt('board'), txt('group')].filter(Boolean).join(' ') || 'Se marcan solos: la directiva al enviar el mensaje del finde y el grupo al usar «📣 Compartir horario».';
  }
  function weekMessage(monKey, only) {
    const [from, to] = findeRange(monKey);
    const all = state.mxAll || [];
    const ms = all.filter(b => b.day >= from && b.day <= to && TEAM[b.team]);
    const playing = new Set(all.map(b => b.team));   // equipos con partidos en la temporada
    const blocks = [];
    for (const t of MATCH_TEAMS().filter(t => !only || only.includes(t.id))) {
      if (!playing.has(t.id)) continue;
      const own = ms.filter(b => b.team === t.id).sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min);
      if (!own.length) { blocks.push(`${t.name} vs ??`); continue; }
      for (const b of own) {
        const di = dayIndexOf(b.day), d = parseKey(b.day);
        const when = di >= 4 ? `${DAYS[di]} ${fmt(b.start_min)}` : `${DAYS[di]} ${d.getDate()} - ${fmt(b.start_min)}`;
        blocks.push(`${t.name} vs ${rivalName(b.opponent)} ${b.away ? '✈️' : '🏠'}\n${when}${b.confirmed ? '' : ' (por confirmar)'}`);
      }
    }
    return blocks.join('\n\n');
  }
  let msgWeek = null;
  function openWeekMessage(monKey) {
    msgWeek = monKey;
    fillWeekMessage();
    $('#msg-share').hidden = !navigator.share;
    $('#msg-dialog').showModal();
    $('#msg-text').scrollTop = 0;
  }
  function fillWeekMessage() {
    const monKey = msgWeek, only = null;   // a la directiva van siempre todos los partidos del club
    const fri = addDays(parseKey(monKey), 4), sun = addDays(parseKey(monKey), 6);
    $('#msg-title').textContent = `Directiva · ${fri.getDate()}–${sun.getDate()} ${MONTHS[sun.getMonth()]}`;
    $('#msg-text').value = weekMessage(monKey, only);
    const [from, to] = findeRange(monKey);
    msgMatches = (state.mxAll || []).filter(b => b.day >= from && b.day <= to && TEAM[b.team] && commTodo(b, 'board') && (!only || only.includes(b.team)));
    $('#msg-comm-row').hidden = !isCoord() || !msgMatches.length;
    $('#msg-comm').checked = true;
    $('#msg-comm-n').textContent = plural(msgMatches.length, 'partido confirmado', 'partidos confirmados');
  }
  let msgMatches = [];
  /** Tras enviar o copiar el mensaje del finde, los confirmados quedan comunicados */
  async function weekMessageSent() {
    if (!isCoord() || !$('#msg-comm').checked || !msgMatches.length) return;
    try { await markCommunicated(msgMatches, 'board'); msgMatches = []; $('#msg-comm-row').hidden = true; if ($('#matches-dialog').open && state.mxTab === 'weekend') loadWeekend(); }
    catch (e) { toast('No se pudieron marcar como comunicados: ' + e.message, true); }
  }
  async function copyWeekMessage() {
    const txt = $('#msg-text').value;
    try { await navigator.clipboard.writeText(txt); toast('Mensaje copiado'); }
    catch { const ta = $('#msg-text'); ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Mensaje copiado'); } catch { toast('No se ha podido copiar: selecciónalo y cópialo a mano', true); return; } }
    weekMessageSent();
  }

  // ================================================================
  //  Inicio del coordinador: recordatorios propios y lo próximo del calendario
  // ================================================================
  const HOME_DAYS = 14;                  // horizonte de «próximamente»
  const isHome = () => state.mode === 'home';
  const todayKey = () => keyOf(new Date());
  const shortDate = k => { const d = parseKey(k); return `${DAYS_SHORT[dayIndexOf(k)].toLowerCase()} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const daysTo = k => Math.round((parseKey(k) - parseKey(todayKey())) / 864e5);
  const relDays = k => { const n = daysTo(k); return n === 0 ? 'hoy' : n === 1 ? 'mañana' : n === -1 ? 'ayer' : n > 0 ? `en ${n} días` : `hace ${-n} días`; };

  /** vencido (pasó la fecha máxima), urgente (llegó la fecha de aviso o vence hoy), pendiente, hecho */
  function remStatus(r) {
    if (r.done) return 'done';
    const t = todayKey();
    if (r.due_date && r.due_date < t) return 'overdue';
    if ((r.alert_date && r.alert_date <= t) || (r.due_date && r.due_date <= t)) return 'urgent';
    return 'pending';
  }
  const REM_GROUPS = [
    ['overdue', 'Vencidos', 'Ya pasó la fecha máxima'],
    ['urgent', 'Urgentes', 'Ha llegado la fecha de aviso'],
    ['waiting', 'En espera de otros', 'Depende de otra persona'],
    ['pending', 'Pendientes', 'Aún hay margen'],
  ];
  /** Grupo en Inicio: los que esperan a otra persona van aparte (salvo hechos) */
  const remGroup = r => r.done ? 'done' : r.waiting_on ? 'waiting' : remStatus(r);
  // Icono «pasar a otra persona»: persona con flecha (mismo tamaño que el ⏰)
  const ICON_HANDOFF = '<svg class="ico-handoff" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="7" r="3.2"/><path d="M9.5 20v-1.5a5.5 5.5 0 0 1 11 0V20"/><path d="M2.5 13h6.5"/><path d="M6.5 10l3 3-3 3"/></svg>';
  const WAIT_SUGGEST = ['Club rival', 'Directivo', 'Federación', 'Ayuntamiento', 'Árbitros'];
  const waitOptions = () => [...new Set(['Entrenador', ...(state.people || []).filter(p => p.status === 'aprobado' && p.id !== state.user?.id).map(p => p.full_name).filter(Boolean), ...WAIT_SUGGEST])]
    .map(n => `<option value="${esc(n)}"></option>`).join('');
  /** Personas sugeridas para «en espera de»: primero los entrenadores del equipo del recordatorio */
  function waitCandidates(r) {
    const ppl = (state.people || []).filter(p => p.status === 'aprobado' && p.id !== state.user?.id && p.full_name);
    const ofTeam = r.team ? ppl.filter(p => (p.teams || []).includes(r.team)) : [];
    const coach = r.team ? `Entrenador del ${teamOf(r.team).name}` : 'Entrenador';   // aunque no esté dado de alta
    const names = [coach, ...ofTeam.map(p => p.full_name), ...WAIT_SUGGEST, ...ppl.filter(p => !ofTeam.includes(p)).map(p => p.full_name)];
    return [...new Set(names)].filter(n => n !== r.waiting_on).slice(0, 11);
  }
  function waitPanel(r) {
    return `<div class="rem-snooze rem-waitp"><span>${r.waiting_on ? `Ahora depende de <b>${esc(r.waiting_on)}</b>` : '¿De quién depende ahora?'}</span>
      ${r.waiting_on ? '<button type="button" class="wp-me" data-wait-set="">✋ Vuelve a depender de mí</button>' : ''}
      ${waitCandidates(r).map(n => `<button type="button" data-wait-set="${esc(n)}">${esc(n)}</button>`).join('')}
      <form class="wp-other" data-wait-form><input maxlength="80" placeholder="Otra persona…" aria-label="Otra persona" list="wait-people"><button type="submit" class="primary">OK</button></form></div>`;
  }
  async function setWaiting(id, who) {
    const r = (state.reminders || []).find(x => x.id === id); if (!r) return;
    const waiting_on = (who || '').trim().slice(0, 80) || null;
    const row = { waiting_on, waiting_since: waiting_on ? (waiting_on === r.waiting_on && r.waiting_since ? r.waiting_since : todayKey()) : null };
    Object.assign(r, row); state.waitOpen = null; renderHome(); renderHomeBadge();
    try { await store.reminders.update(id, row); toast(waiting_on ? `En espera de ${waiting_on}` : 'Vuelve a depender de ti'); await loadReminders(); }
    catch (e) { toast('No se pudo guardar: ' + e.message, true); await loadReminders(); }
  }
  function claimText(r) {
    const first = String(r.waiting_on || '').split(/\s+/)[0];
    const generic = WAIT_SUGGEST.includes(r.waiting_on) || /^entrenador/i.test(r.waiting_on || '');
    const named = first && !generic ? ` ${first}` : '';
    return `Hola${named}, ¿cómo va lo de «${r.title}»?${r.due_date ? ` Lo necesitamos para el ${DAYS[dayIndexOf(r.due_date)].toLowerCase()} ${parseKey(r.due_date).getDate()}.` : ''} ¡Gracias!`;
  }
  async function claimReminder(r) {
    const text = claimText(r);
    if (navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent)) { try { await navigator.share({ text }); return; } catch { return; } }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  async function loadReminders() {
    if (!isCoord()) { state.reminders = []; return; }
    try { state.reminders = await store.reminders.list(); }
    catch (e) { state.reminders = state.reminders || []; toast('No se pudieron cargar los recordatorios: ' + e.message, true); }
    renderHomeBadge();
    if (isHome()) renderHome();
  }

  // Inicio de cada coordinador: solo lo de sus equipos (y lo que no es de ningún equipo), salvo «Ver todo el club»
  const homeRems = () => (state.reminders || []).filter(r => myResp(r.team));
  const homeUp = () => (state.upcoming || []).filter(x => myRespAny(x.teams));
  const homePendingCallups = () => pendingCallups().filter(c => myResp(c.team));
  function homeAlertCount() {
    const r = homeRems().filter(x => remStatus(x) === 'overdue' || (remStatus(x) === 'urgent' && !x.waiting_on)).length;
    const c = homeUp().filter(x => x.level === 'error').length;
    return r + c + homePendingCallups().length;
  }
  function renderHomeBadge() {
    const n = homeAlertCount();
    const txt = n ? String(n) : '';
    $$('.home-count').forEach(el => { el.textContent = txt; el.hidden = !n; });
  }

  /** Incidencias de las semanas que tocan los próximos días (sin tocar la semana que se está viendo) */
  const SNAP_DAYS = 21;   // la foto para las notificaciones cubre algo más que Inicio
  async function computeUpcoming() {
    const today = todayKey(), limit = keyOf(addDays(new Date(), SNAP_DAYS));
    const weeks = [];
    for (let w = mondayOf(new Date()); keyOf(w) <= limit; w = addDays(w, 7)) weeks.push(w);
    const template = await store.template.list().catch(() => state.template || []);
    const out = [];
    for (const ws of weeks) {
      const from = keyOf(ws), to = keyOf(addDays(ws, 6));
      const [bk, gen] = await Promise.all([store.list(from, to), store.weekGenerated(from).catch(() => true)]);
      const ps = await store.proposals.list(bk.filter(b => b.kind === 'partido').map(b => b.id)).catch(() => []);
      const acks = await store.acks.list(bk.filter(b => b.kind === 'entreno').map(b => b.id)).catch(() => []);
      const proposals = new Map();
      for (const p of ps) { if (!proposals.has(p.booking_id)) proposals.set(p.booking_id, []); proposals.get(p.booking_id).push(p); }
      // Calcula con el mismo motor que el calendario, cambiando el estado un momento
      const keep = { weekStart: state.weekStart, bookings: state.bookings, template: state.template, weekGenerated: state.weekGenerated, proposals: state.proposals, acks: state.acks, mode: state.mode };
      let full;
      try {
        Object.assign(state, { weekStart: ws, bookings: bk, template, weekGenerated: gen, proposals, acks, mode: 'week' });
        full = applyAcks(addChanges(computeIssues(bk)));
      } finally { Object.assign(state, keep); }
      const byId = new Map(bk.map(b => [b.id, b]));
      for (const it of full.all) {
        if (!['error', 'warn', 'pending', 'change'].includes(it.level) || it.minor) continue;
        if (!it.day || it.day < today || it.day > limit) continue;
        const teams = [...new Set([...it.ids.map(id => byId.get(id)?.team), it.team].filter(Boolean))];
        out.push({ ...it, teams, bookingId: it.ids.find(id => byId.has(id)) || null });
      }
      if (template.length && !gen && to >= today) {
        out.push({ level: 'pending', kind: 'publish', day: from < today ? today : from, at: 0, ids: [], week: from,
          msg: `Falta publicar el horario habitual de la semana del ${ws.getDate()} de ${MONTHS[ws.getMonth()]}` });
      }
    }
    const pend = (state.people || []).filter(p => p.status === 'pendiente');
    if (pend.length) out.push({ level: 'pending', kind: 'people', day: today, at: 0, ids: [], msg: `${pend.length} solicitud${pend.length > 1 ? 'es' : ''} de entrenador${pend.length > 1 ? 'es' : ''} por revisar` });
    const rank = { error: 0, warn: 1, pending: 2, change: 3 };
    out.sort((a, b) => rank[a.level] - rank[b.level] || a.day.localeCompare(b.day) || (a.at || 0) - (b.at || 0));
    return out;
  }

  let homeReq = 0;
  async function loadHome() {
    if (!isCoord()) return;
    const req = ++homeReq;
    state.homeLoading = true;
    if (isHome()) renderHome();
    try {
      const [all] = await Promise.all([computeUpcoming(), loadReminders(), fetchSquads().catch(() => { })]);
      if (req !== homeReq) return;
      const lim = keyOf(addDays(new Date(), HOME_DAYS));
      state.upcoming = all.filter(x => x.level !== 'change' && x.day <= lim);
      saveSnapshot(all);
    } catch (e) { toast('No se pudo cargar el inicio: ' + e.message, true); }
    state.homeLoading = false;
    renderHomeBadge();
    if (isHome()) renderHome();
  }

  function remRow(r) {
    const st = remStatus(r), t = r.team ? teamOf(r.team) : null;
    const when = [];
    if (r.due_date) when.push(`<span class="rem-due">Hasta ${shortDate(r.due_date)} <b>(${relDays(r.due_date)})</b></span>`);
    if (r.alert_date && st === 'pending') when.push(`<span>aviso ${shortDate(r.alert_date)}</span>`);
    if (!r.due_date && !r.alert_date) when.push('<span>Sin fecha</span>');
    if (r.alert_time && st !== 'done') {
      const d = r.alert_date || r.due_date, sent = r.alert_sent_sig === `${d}|${hhmm5(r.alert_time)}`;
      if (d) when.push(`<span class="rem-bell${sent ? ' sent' : ''}" title="${sent ? 'Notificación enviada' : 'Te llegará una notificación'}">🔔 ${d === todayKey() ? 'hoy' : shortDate(d)} ${hhmm5(r.alert_time)}${sent ? ' ✓' : ''}</span>`);
    }
    if (st === 'done' && r.done_at) when.push(`<span>hecho ${shortDate(keyOf(new Date(r.done_at)))}</span>`);
    const wait = r.waiting_on && st !== 'done'
      ? `<span class="rem-wait">⏳ En espera de <b>${esc(r.waiting_on)}</b>${r.waiting_since ? ` · ${r.waiting_since === todayKey() ? 'desde hoy' : 'desde ' + relDays(r.waiting_since).replace('hace ', 'hace ')}` : ''}</span>` : '';
    return `<li class="rem rem-${st}${r.waiting_on && st !== 'done' ? ' rem-waiting' : ''}" data-rem="${esc(r.id)}">
      <label class="rem-check" title="${st === 'done' ? 'Marcar como pendiente' : 'Marcar como hecho'}"><input type="checkbox" data-rem-done ${r.done ? 'checked' : ''}><span></span></label>
      <button type="button" class="rem-body" data-rem-edit>
        <span class="rem-title">${esc(r.title)}</span>
        ${wait}
        <span class="rem-meta">${t ? `<span class="mini-chip" style="--c:${t.color}">${esc(t.name)}</span>` : '<span class="mini-chip club">Club</span>'}${when.join(' · ')}${r.source === 'atajo' ? ' · <span class="rem-src" title="Creado desde un Atajo del iPhone">📲</span>' : ''}${r.booking_id ? ' · <span class="rem-link">📅 reserva</span>' : ''}${r.notes ? ' · <span class="rem-notes">📝</span>' : ''}</span>
      </button>
      <div class="rem-acts">
      ${r.waiting_on && st !== 'done' ? `<button type="button" class="rem-snz-btn" data-claim title="Reclamar a ${esc(r.waiting_on)}" aria-label="Reclamar">📨</button>` : ''}
      ${st === 'done' ? '' : `<button type="button" class="rem-snz-btn rem-wait-btn ${state.waitOpen === r.id ? 'on' : ''} ${r.waiting_on ? 'is-waiting' : ''}" data-wait-open title="${r.waiting_on ? 'Cambiar de quién depende' : 'Ya no depende de mí'}" aria-label="${r.waiting_on ? 'Cambiar de quién depende' : 'Ya no depende de mí'}" aria-expanded="${state.waitOpen === r.id}">${ICON_HANDOFF}</button>`}
      ${st === 'done' ? '' : `<button type="button" class="rem-snz-btn ${state.snoozeOpen === r.id ? 'on' : ''}" data-snooze-open title="Posponer" aria-label="Posponer" aria-expanded="${state.snoozeOpen === r.id}">⏰</button>`}
      </div>
      ${st !== 'done' && state.waitOpen === r.id ? waitPanel(r) : ''}
      ${st !== 'done' && state.snoozeOpen === r.id ? `<div class="rem-snooze"><span>Posponer</span>${SNOOZE.map(([d, l]) => `<button type="button" data-snooze="${d}">${l}</button>`).join('')}</div>` : ''}
    </li>`;
  }

  function renderHome() {
    const el = $('#home');
    if (!el || !isCoord()) return;
    const rems = homeRems();
    const up = homeUp();
    const by = k => rems.filter(r => remGroup(r) === k).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.alert_date || '9999').localeCompare(b.alert_date || '9999'));
    const done = rems.filter(r => r.done).sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || ''))).slice(0, 15);
    const n = { overdue: by('overdue').length, urgent: by('urgent').length, waiting: by('waiting').length, pending: by('pending').length };
    const nc = up.filter(x => x.level === 'error').length, nw = up.filter(x => x.level === 'warn').length, np = up.filter(x => x.level === 'pending').length;
    const now = new Date();
    const hello = (state.profile?.full_name || '').split(/\s+/)[0];
    const keepForm = el.querySelector('#rem-quick');
    if (keepForm && !state.remFormOpen && $('#rq-title').value.trim()) state.remFormOpen = true;
    const draft = keepForm ? { title: $('#rq-title').value, team: $('#rq-team').value, due: $('#rq-due').value, alert: $('#rq-alert').value, time: $('#rq-time').value, wait: $('#rq-wait').value, touched: $('#rq-alert').dataset.touched } : null;
    const teamOpts = `<option value="">Todo el club</option>${TEAMS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}`;
    const upGroups = [['error', 'Conflictos', '⛔'], ['warn', 'Avisos', '⚠️'], ['pending', 'Pendientes', '⏳']];
    el.innerHTML = `<div class="home-wrap">
      <div class="home-head">
        <div class="home-hello"><h2>${hello ? `Hola, ${esc(hello)}` : 'Inicio'}</h2><p>${DAYS[dayIndexOf(keyOf(now))]} ${now.getDate()} de ${MONTHS_LONG[now.getMonth()].toLowerCase()}</p>
          ${myTeams() ? `<p class="home-scope">${state.homeScope === 'all' ? 'Todo el club' : `Tus equipos: ${esc(myTeams().map(t => teamOf(t).short).join(', '))}`} · <button type="button" class="link" data-home-scope>${state.homeScope === 'all' ? 'Ver solo los míos' : 'Ver todo el club'}</button></p>` : ''}</div>
        <div class="home-stats">
          <button type="button" class="hs hs-err ${n.overdue ? '' : 'zero'}" data-jump="rem-overdue"><b>${n.overdue}</b><span>Vencidos</span></button>
          <button type="button" class="hs hs-urg ${n.urgent ? '' : 'zero'}" data-jump="rem-urgent"><b>${n.urgent}</b><span>Urgentes</span></button>
          <button type="button" class="hs hs-wait ${n.waiting ? '' : 'zero'}" data-jump="rem-waiting"><b>${n.waiting}</b><span>En espera</span></button>
          <button type="button" class="hs hs-err ${nc ? '' : 'zero'}" data-jump="up-error"><b>${state.homeLoading && !up.length ? '…' : nc}</b><span>Conflictos</span></button>
          <button type="button" class="hs hs-pend ${np + nw ? '' : 'zero'}" data-jump="up-pending"><b>${state.homeLoading && !up.length ? '…' : np + nw}</b><span>Avisos y pendientes</span></button>
        </div>
        <button type="button" class="ghost home-cal-btn" data-home-go="week">Ver calendario →</button>
      </div>
      ${(() => { const h = homeCallupsHTML(); return h ? `<section class="panel home-cu">${h}</section>` : ''; })()}
      <div class="home-grid">
        <section class="panel home-rem">
          <div class="rem-head"><h3>Recordatorios</h3>
            <button type="button" class="${state.remFormOpen ? 'ghost' : 'primary'} rem-new-btn" data-rem-form aria-expanded="${!!state.remFormOpen}" aria-controls="rem-quick">${state.remFormOpen ? 'Cerrar' : '＋ Nuevo recordatorio'}</button></div>
          <form id="rem-quick" class="rem-quick" autocomplete="off" ${state.remFormOpen ? '' : 'hidden'}>
            <input id="rq-title" class="rq-title" maxlength="200" placeholder="¿Qué no se te puede olvidar?" aria-label="Recordatorio" required>
            ${duePresetsHTML('rq-due-pre')}
            <div class="rq-presets" id="rq-presets" hidden><span>Aviso:</span>
              <button type="button" data-pre="0">el mismo día</button><button type="button" data-pre="1">1 día antes</button><button type="button" data-pre="2">2 días antes</button><button type="button" data-pre="7">1 semana antes</button>
            </div>
            <div class="rq-row">
              <label class="rq-f"><span>Equipo</span><select id="rq-team">${teamOpts}</select></label>
              <label class="rq-f"><span>Fecha máxima</span><input type="date" id="rq-due"></label>
              <label class="rq-f"><span>Aviso <small>(pasa a urgente)</small></span><input type="date" id="rq-alert"></label>
              <label class="rq-f rq-time"><span>🔔 Hora <small>(notificación)</small></span><input type="time" id="rq-time" step="300"></label>
              <label class="rq-f rq-wait"><span>En espera de <small>(opcional)</small></span><input id="rq-wait" maxlength="80" list="wait-people" placeholder="Nadie: depende de mí" autocomplete="off"></label>
              <button type="submit" class="primary rq-add">Añadir</button>
            </div>
          </form>
          <datalist id="wait-people">${waitOptions()}</datalist>
          ${REM_GROUPS.map(([k, label, hint]) => {
            const list = by(k);
            return `<div class="rem-group g-${k}" id="rem-${k}"><h4>${label} <span class="count">${list.length}</span><small>${hint}</small></h4>
              ${list.length ? `<ul class="rem-list">${list.map(remRow).join('')}</ul>` : `<p class="muted rem-empty">${k === 'overdue' ? 'Nada vencido 👍' : k === 'urgent' ? 'Nada urgente' : k === 'waiting' ? 'No esperas nada de nadie' : 'Sin pendientes'}</p>`}</div>`;
          }).join('')}
          ${done.length ? `<details class="rem-group g-done"><summary><h4>Hechos <span class="count">${rems.filter(r => r.done).length}</span><small>Los más recientes</small></h4></summary><ul class="rem-list">${done.map(remRow).join('')}</ul></details>` : ''}
        </section>
        <section class="panel home-up">
          <h3>Próximos ${HOME_DAYS} días <small>en el calendario</small></h3>
          ${state.homeLoading && !up.length ? '<p class="muted rem-empty">Revisando el calendario…</p>' : ''}
          ${!state.homeLoading && !up.length ? '<p class="muted rem-empty">Todo en orden: sin conflictos, avisos ni pendientes en los próximos días. 👌</p>' : ''}
          ${upGroups.map(([lv, label, ic]) => {
            const list = up.filter(x => x.level === lv);
            if (!list.length) return '';
            return `<div class="up-group up-${lv}" id="up-${lv === 'warn' ? 'pending-w' : lv}"><h4>${label} <span class="count">${list.length}</span></h4><ul class="up-list">${list.map((it, i) => `
              <li><button type="button" class="up-item lv-${lv}" data-up="${esc(it.kind || '')}" data-id="${esc(it.bookingId || '')}" data-day="${it.day}" data-week="${esc(it.week || '')}">
                <span class="up-ic">${ic}</span><span class="up-txt"><span class="up-when">${it.kind === 'people' ? 'Entrenadores' : `${shortDate(it.day)}${it.at ? ' · ' + fmt(it.at) : ''} <i>${relDays(it.day)}</i>`}</span>${esc(it.msg)}</span><span class="up-go">›</span></button></li>`).join('')}</ul></div>`;
          }).join('')}
        </section>
      </div>
    </div>`;
    if (draft) {
      $('#rq-title').value = draft.title; $('#rq-team').value = draft.team; $('#rq-due').value = draft.due; $('#rq-alert').value = draft.alert; $('#rq-time').value = draft.time || ''; $('#rq-wait').value = draft.wait || '';
      if (draft.touched) $('#rq-alert').dataset.touched = '1';
      $('#rq-presets').hidden = !draft.due;
    }
    markPresets();
  }

  // Alta rápida: al poner la fecha máxima, el aviso se rellena 2 días antes (sin pasar de hoy) salvo que ya lo hayas tocado
  // Botones de fecha máxima (sin escribir) y de posponer
  const DUE_PRESETS = [['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['Viernes', 'fri'], ['1 semana', 7], ['2 semanas', 14]];
  const SNOOZE = [[1, '+1 día'], [2, '+2 días'], [3, '+3 días'], [7, '+1 semana'], [14, '+2 semanas']];
  function dueFromPreset(v) {
    const now = new Date();
    if (v === 'fri') { const i = dayIndexOf(keyOf(now)); return keyOf(addDays(now, i <= 4 ? 4 - i : 11 - i)); }   // próximo viernes (hoy si es viernes)
    return keyOf(addDays(now, +v));
  }
  const duePresetsHTML = id => `<div class="rq-presets rq-due-pre" id="${id}"><span>Fecha máxima:</span>${DUE_PRESETS.map(([l, v]) => `<button type="button" data-due="${v}">${l}</button>`).join('')}</div>`;
  const ALERT_DAYS = 2;   // aviso por defecto: 2 días antes de la fecha máxima
  function autoAlert(due, days = ALERT_DAYS) {
    if (!due) return '';
    const t = todayKey();
    let a = keyOf(addDays(parseKey(due), -days));
    if (a < t) a = due < t ? due : t;
    return a;
  }

  /** Hora de aviso: si no hay fechas, hoy (o mañana si esa hora ya pasó) pasa a ser la fecha de aviso */
  function timedAlert(due, alert, time) {
    if (!time || alert || due) return alert;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    return toMin(time) > nowMin ? todayKey() : keyOf(addDays(now, 1));
  }
  const hhmm5 = t => t ? String(t).slice(0, 5) : '';
  async function quickAddReminder() {
    const title = $('#rq-title').value.trim();
    if (!title) { $('#rq-title').focus(); return; }
    const due = $('#rq-due').value || null;
    const time = $('#rq-time').value || null;
    let alert = timedAlert(due, $('#rq-alert').value || null, time);
    if (due && alert && alert > due) { toast('El aviso tiene que ser antes de la fecha máxima', true); $('#rq-alert').focus(); return; }
    try {
      const wait = $('#rq-wait').value.trim().slice(0, 80) || null;
      await store.reminders.insert({ title: title.slice(0, 200), team: $('#rq-team').value || null, due_date: due, alert_date: alert, alert_time: time, waiting_on: wait, waiting_since: wait ? todayKey() : null });
      $('#rq-title').value = ''; $('#rq-wait').value = ''; $('#rq-due').value = ''; $('#rq-alert').value = ''; $('#rq-time').value = ''; delete $('#rq-alert').dataset.touched;
      $('#rq-presets').hidden = true; markPresets();
      toast(time ? `Recordatorio añadido · te avisaremos ${alert === todayKey() ? 'hoy' : shortDate(alert)} a las ${hhmm5(time)}` : 'Recordatorio añadido');
      await loadReminders();
      $('#rq-title')?.focus();
    } catch (e) { toast('No se pudo guardar: ' + e.message, true); }
  }

  // ---------- Ventana de recordatorio (editar, o crear desde una reserva) ----------
  let remEditing = null;
  function openReminder(r) {
    remEditing = r;
    const isNew = !r.id;
    $('#rem-title-h').textContent = isNew ? 'Nuevo recordatorio' : 'Recordatorio';
    $('#rm-title').value = r.title || '';
    $('#rm-team').innerHTML = `<option value="">Todo el club</option>${TEAMS.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}`;
    $('#rm-team').value = r.team || '';
    $('#rm-due').value = r.due_date || '';
    $('#rm-alert').value = r.alert_date || '';
    $('#rm-time').value = hhmm5(r.alert_time);
    if (r.id && r.alert_date) $('#rm-alert').dataset.touched = '1'; else delete $('#rm-alert').dataset.touched;
    $('#rm-snooze').hidden = !r.id || r.done;
    fitAlertPresets('#rm-alert-pre', '#rm-due', '#rm-alert');
    $('#rm-notes').value = r.notes || '';
    $('#rm-wait').value = r.waiting_on || '';
    $('#rm-wait-list').innerHTML = waitOptions();
    $('#rm-claim').hidden = !(r.id && r.waiting_on && !r.done);
    $('#rm-delete').hidden = isNew;
    $('#rm-done').hidden = isNew;
    $('#rm-done').textContent = r.done ? 'Marcar como pendiente' : 'Marcar como hecho';
    const b = r.booking_id && (state.bookings.find(x => x.id === r.booking_id) || r._booking);
    $('#rm-source').hidden = !(r.source === 'atajo' && r.source_text);
    $('#rm-source-text').textContent = r.source_text || '';
    $('#rm-booking').hidden = !r.booking_id;
    $('#rm-booking').innerHTML = r.booking_id ? `📅 ${b ? esc(`${whoOf(b).name}${b.opponent ? ' vs ' + b.opponent : ''} · ${shortDate(b.day)} ${fmt(b.start_min)}`) : 'Reserva del calendario'} <button type="button" class="link" id="rm-goto">Ver en el calendario</button>` : '';
    $('#rem-dialog').showModal();
    if (isNew) setTimeout(() => $('#rm-title').focus(), 50);
  }
  function reminderFromBooking(b) {
    const who = whoOf(b).name;
    const what = b.kind === 'partido' ? `${who}${b.opponent ? ' vs ' + b.opponent : ''}: ` : b.kind === 'evento' ? `${who}: ` : `${who} (entreno ${shortDate(b.day)}): `;
    const due = b.day < todayKey() ? todayKey() : b.day;
    openReminder({ title: what, team: b.team || null, due_date: due, alert_date: autoAlert(due), booking_id: b.id, _booking: b });
  }
  async function saveReminder() {
    const r = remEditing; if (!r) return;
    const row = {
      title: $('#rm-title').value.trim().slice(0, 200), team: $('#rm-team').value || null,
      due_date: $('#rm-due').value || null, alert_date: $('#rm-alert').value || null, alert_time: $('#rm-time').value || null,
      notes: $('#rm-notes').value.trim().slice(0, 1000) || null,
      waiting_on: $('#rm-wait').value.trim().slice(0, 80) || null,
    };
    row.alert_date = timedAlert(row.due_date, row.alert_date, row.alert_time);
    row.waiting_since = !row.waiting_on ? null : (r.waiting_on === row.waiting_on && r.waiting_since) ? r.waiting_since : todayKey();
    if (!row.title) { toast('Escribe qué hay que hacer', true); $('#rm-title').focus(); return; }
    if (row.due_date && row.alert_date && row.alert_date > row.due_date) { toast('El aviso tiene que ser antes de la fecha máxima', true); return; }
    try {
      if (r.id) await store.reminders.update(r.id, row);
      else await store.reminders.insert({ ...row, booking_id: r.booking_id || null });
      $('#rem-dialog').close();
      toast(r.id ? 'Recordatorio guardado' : 'Recordatorio añadido: lo verás en Inicio');
      await loadReminders();
    } catch (e) { toast('No se pudo guardar: ' + e.message, true); }
  }
  async function setReminderDone(id, done) {
    const r = (state.reminders || []).find(x => x.id === id);
    if (r) { r.done = done; r.done_at = done ? new Date().toISOString() : null; renderHome(); renderHomeBadge(); }
    try { await store.reminders.update(id, { done }); toast(done ? 'Hecho ✓' : 'Vuelve a pendientes'); await loadReminders(); }
    catch (e) { toast('No se pudo guardar: ' + e.message, true); await loadReminders(); }
  }
  async function deleteReminder() {
    const r = remEditing; if (!r?.id) return;
    $('#rem-dialog').close();
    if (!(await askConfirm(`¿Borrar el recordatorio «${r.title}»?`, 'Borrar'))) { $('#rem-dialog').showModal(); return; }
    try { await store.reminders.remove(r.id); toast('Recordatorio borrado'); await loadReminders(); }
    catch (e) { toast('No se pudo borrar: ' + e.message, true); }
  }

  function markPresets() {
    const due = $('#rq-due')?.value, alert = $('#rq-alert')?.value;
    $$('#rq-due-pre [data-due]').forEach(b => b.classList.toggle('on', !!due && dueFromPreset(b.dataset.due) === due));
    $$('#rq-presets [data-pre]').forEach(b => b.classList.toggle('on', !!due && keyOf(addDays(parseKey(due), -b.dataset.pre)) === alert));
    fitAlertPresets('#rq-presets', '#rq-due', '#rq-alert');
  }
  /** Oculta los botones de aviso que caerían antes de hoy y limita la casilla de aviso a [hoy, fecha máxima] */
  function fitAlertPresets(box, dueSel, alertSel) {
    const due = $(dueSel)?.value, t = todayKey();
    let any = false;
    $$(box + ' [data-pre]').forEach(b => {
      const ok = !!due && keyOf(addDays(parseKey(due), -b.dataset.pre)) >= t;
      b.hidden = !ok; any = any || ok;
    });
    const boxEl = $(box); if (boxEl && box !== '#rq-presets') boxEl.hidden = !any;
    if (box === '#rq-presets' && boxEl) boxEl.hidden = !due || !any;
    const a = $(alertSel); if (a) { a.min = t < (due || t) ? t : (due || t); if (due) a.max = due; else a.removeAttribute('max'); }
  }
  function setQuickDue(due) {
    $('#rq-due').value = due;
    $('#rq-presets').hidden = !due;
    if (!$('#rq-alert').dataset.touched) $('#rq-alert').value = autoAlert(due);
    markPresets();
  }

  /** Pospone X días: mueve la fecha máxima (desde hoy si ya estaba vencido) y el aviso, conservando la distancia entre ambos */
  async function snoozeReminder(id, days) {
    const r = (state.reminders || []).find(x => x.id === id); if (!r) return;
    const t = todayKey();
    const gap = r.due_date && r.alert_date ? Math.max(0, Math.round((parseKey(r.due_date) - parseKey(r.alert_date)) / 864e5)) : ALERT_DAYS;
    let due = null, alert;
    if (r.due_date) {
      due = keyOf(addDays(parseKey(r.due_date < t ? t : r.due_date), days));
      alert = keyOf(addDays(parseKey(due), -gap));
    } else {
      alert = keyOf(addDays(parseKey(r.alert_date && r.alert_date > t ? r.alert_date : t), days));
    }
    if (alert < t) alert = t;
    try {
      await store.reminders.update(id, { due_date: due, alert_date: alert });
      toast(`Pospuesto ${days === 1 ? '1 día' : days === 7 ? '1 semana' : days === 14 ? '2 semanas' : days + ' días'}${due ? ': hasta ' + shortDate(due) : ''}`);
      state.snoozeOpen = null;
      await loadReminders();
    } catch (e) { toast('No se pudo posponer: ' + e.message, true); }
  }

  function bindHome() {
    const home = $('#home');
    home.addEventListener('submit', e => {
      if (e.target.id === 'rem-quick') { e.preventDefault(); quickAddReminder(); }
      if (e.target.matches('[data-wait-form]')) { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) setWaiting(e.target.closest('[data-rem]').dataset.rem, v); }
    });
    home.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('[data-rem-done]')) { const id = t.closest('[data-rem]').dataset.rem; setReminderDone(id, t.checked); }
      if (t.id === 'rq-due') setQuickDue(t.value);
      if (t.id === 'rq-alert') { $('#rq-alert').dataset.touched = '1'; markPresets(); }
    });
    home.addEventListener('click', e => {
      const pre = e.target.closest('[data-pre]');
      if (pre) { const due = $('#rq-due').value; if (due) { $('#rq-alert').value = autoAlert(due, +pre.dataset.pre); $('#rq-alert').dataset.touched = '1'; markPresets(); } return; }
      const dp = e.target.closest('#rq-due-pre [data-due]');
      if (dp) { setQuickDue(dueFromPreset(dp.dataset.due)); return; }
      if (e.target.closest('[data-rem-form]')) {
        state.remFormOpen = !state.remFormOpen;
        const f = $('#rem-quick'), b = e.target.closest('[data-rem-form]');
        f.hidden = !state.remFormOpen;
        b.textContent = state.remFormOpen ? 'Cerrar' : '＋ Nuevo recordatorio';
        b.className = (state.remFormOpen ? 'ghost' : 'primary') + ' rem-new-btn';
        b.setAttribute('aria-expanded', String(state.remFormOpen));
        if (state.remFormOpen) setTimeout(() => $('#rq-title')?.focus(), 30);
        return;
      }
      const wo = e.target.closest('[data-wait-open]');
      if (wo) { const id = wo.closest('[data-rem]').dataset.rem; state.waitOpen = state.waitOpen === id ? null : id; state.snoozeOpen = null; renderHome(); const inp = $(`[data-rem="${CSS.escape(id)}"] .wp-other input`); if (inp && !isIOS()) inp.focus({ preventScroll: true }); return; }
      const ws = e.target.closest('[data-wait-set]');
      if (ws) { setWaiting(ws.closest('[data-rem]').dataset.rem, ws.dataset.waitSet); return; }
      const cl = e.target.closest('[data-claim]');
      if (cl) { const r = (state.reminders || []).find(x => x.id === cl.closest('[data-rem]').dataset.rem); if (r) claimReminder(r); return; }
      const so = e.target.closest('[data-snooze-open]');
      if (so) { const id = so.closest('[data-rem]').dataset.rem; state.snoozeOpen = state.snoozeOpen === id ? null : id; state.waitOpen = null; renderHome(); return; }
      const sz = e.target.closest('[data-snooze]');
      if (sz) { snoozeReminder(sz.closest('[data-rem]').dataset.rem, +sz.dataset.snooze); return; }
      const ed = e.target.closest('[data-rem-edit]');
      if (ed) { const r = (state.reminders || []).find(x => x.id === ed.closest('[data-rem]').dataset.rem); if (r) openReminder(r); return; }
      const jump = e.target.closest('[data-jump]');
      if (jump) { const t = $('#' + jump.dataset.jump) || (jump.dataset.jump === 'up-pending' && $('#up-pending-w')); t?.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (t?.tagName === 'DETAILS') t.open = true; return; }
      if (e.target.closest('[data-home-go]')) { setMode('week'); return; }
      if (e.target.closest('[data-home-scope]')) { state.homeScope = state.homeScope === 'all' ? 'mine' : 'all'; renderHome(); renderHomeBadge(); return; }
      const up = e.target.closest('.up-item');
      if (up) {
        if (up.dataset.up === 'people') { openPeople('pendiente'); return; }
        if (up.dataset.up === 'publish') { state.mode = 'week'; setWeek(parseKey(up.dataset.week)); return; }
        if (up.dataset.id) goToBooking(up.dataset.id, up.dataset.day);
        else { state.mode = 'week'; state.dayIndex = dayIndexOf(up.dataset.day); setWeek(parseKey(up.dataset.day)); }
      }
    });
    $('#rem-form').addEventListener('submit', e => { e.preventDefault(); saveReminder(); });
    $('#rm-delete').onclick = deleteReminder;
    $('#rm-claim').onclick = () => { if (remEditing) claimReminder({ ...remEditing, waiting_on: $('#rm-wait').value.trim() || remEditing.waiting_on, title: $('#rm-title').value.trim() || remEditing.title }); };
    $('#rm-wait').addEventListener('input', () => { $('#rm-claim').hidden = !(remEditing?.id && $('#rm-wait').value.trim()); });
    $('#rm-done').onclick = async () => { const r = remEditing; if (!r?.id) return; $('#rem-dialog').close(); await setReminderDone(r.id, !r.done); };
    $('#rm-booking').addEventListener('click', e => {
      if (e.target.id !== 'rm-goto') return;
      const r = remEditing; $('#rem-dialog').close();
      const b = r._booking || state.bookings.find(x => x.id === r.booking_id);
      if (b) goToBooking(b.id, b.day); else toast('La reserva ya no está en el calendario', true);
    });
    $('#rm-alert-pre').addEventListener('click', e => {
      const p = e.target.closest('[data-pre]'); if (!p) return;
      const due = $('#rm-due').value; if (!due) { toast('Pon primero la fecha máxima', true); return; }
      $('#rm-alert').value = autoAlert(due, +p.dataset.pre); $('#rm-alert').dataset.touched = '1';
    });
    const setDlgDue = due => { $('#rm-due').value = due; if (!$('#rm-alert').dataset.touched) $('#rm-alert').value = autoAlert(due); fitAlertPresets('#rm-alert-pre', '#rm-due', '#rm-alert'); };
    $('#rm-due-pre').addEventListener('click', e => { const b = e.target.closest('[data-due]'); if (b) setDlgDue(dueFromPreset(b.dataset.due)); });
    $('#rm-due').addEventListener('change', e => setDlgDue(e.target.value));
    $('#rm-alert').addEventListener('change', () => { $('#rm-alert').dataset.touched = '1'; });
    $('#rm-snooze').addEventListener('click', async e => {
      const b = e.target.closest('[data-snooze]'); const r = remEditing; if (!b || !r?.id) return;
      $('#rem-dialog').close(); await snoozeReminder(r.id, +b.dataset.snooze);
    });
    $('#m-home').onclick = () => { closeUserMenu(); setMode('home'); };
  }

  // ================================================================
  //  Atajos del iPhone: códigos personales para crear recordatorios
  // ================================================================
  const SHORTCUT_EXAMPLE = 'https://…/functions/v1/atajo-recordatorio';
  async function openShortcuts() {
    closeUserMenu();
    state.newToken = null;
    $('#sc-label').value = `iPhone de ${(state.profile?.full_name || '').split(/\s+/)[0] || 'coordinación'}`.slice(0, 60);
    $('#shortcuts-dialog').showModal();
    $('#sc-body').scrollTop = 0;
    await loadShortcuts();
  }
  async function loadShortcuts() {
    try { state.shortcuts = await store.shortcuts.list(); }
    catch (e) { state.shortcuts = []; toast('No se pudieron cargar los códigos: ' + e.message, true); }
    renderShortcuts();
  }
  function renderShortcuts() {
    const url = store.shortcuts.endpoint || SHORTCUT_EXAMPLE;
    const list = state.shortcuts || [];
    const tok = state.newToken;
    $('#sc-new').innerHTML = tok ? `
      <div class="sc-token">
        <b>Tu código nuevo</b> <small>(solo se muestra ahora: cópialo en el atajo)</small>
        <div class="sc-copy"><code id="sc-token-val">Bearer ${esc(tok)}</code><button type="button" class="primary" data-copy="sc-token-val">Copiar</button></div>
        <p class="muted">En el atajo, cabecera <b>Authorization</b> con este valor (incluida la palabra «Bearer»).</p>
      </div>` : '';
    $('#sc-list').innerHTML = list.length
      ? list.map(t => `<li><div><b>${esc(t.label)}</b> <span class="muted">· …${esc(t.hint || '')}</span><small>Creado ${shortDate(keyOf(new Date(t.created_at)))}${t.last_used_at ? ` · último uso ${shortDate(keyOf(new Date(t.last_used_at)))}` : ' · sin usar todavía'}</small></div><button type="button" class="danger" data-sc-revoke="${esc(t.id)}">Revocar</button></li>`).join('')
      : '<li class="muted">Aún no has conectado ningún iPhone.</li>';
    $('#sc-url').textContent = url;
  }
  async function createShortcutToken() {
    const label = $('#sc-label').value.trim().slice(0, 60) || 'iPhone';
    try {
      state.newToken = await store.shortcuts.create(label);
      toast('Código creado: cópialo en el atajo');
      await loadShortcuts();
      $('#sc-new').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { toast('No se pudo crear: ' + e.message, true); }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado'); }
    catch { toast('No se ha podido copiar: selecciónalo y cópialo a mano', true); }
  }
  function bindShortcuts() {
    $('#m-shortcuts').onclick = openShortcuts;
    $('#sc-create').onclick = createShortcutToken;
    $('#shortcuts-dialog').addEventListener('click', async e => {
      const cp = e.target.closest('[data-copy]');
      if (cp) { copyText($('#' + cp.dataset.copy).textContent.trim()); return; }
      const rv = e.target.closest('[data-sc-revoke]');
      if (rv) {
        const t = (state.shortcuts || []).find(x => x.id === rv.dataset.scRevoke);
        $('#shortcuts-dialog').close();
        const ok = await askConfirm(`¿Revocar el código «${t?.label || ''}»? El atajo de ese iPhone dejará de funcionar hasta que le pongas un código nuevo.`, 'Revocar');
        if (ok) { try { await store.shortcuts.revoke(rv.dataset.scRevoke); toast('Código revocado'); } catch (ex) { toast('No se pudo revocar: ' + ex.message, true); } }
        state.newToken = null;
        $('#shortcuts-dialog').showModal(); await loadShortcuts();
      }
    });
    $('#shortcuts-dialog').addEventListener('close', () => { state.newToken = null; });
  }

  // Foto de incidencias para el resumen diario de las notificaciones (la calcula la herramienta con su motor)
  let lastSnap = '';
  async function saveSnapshot(all) {
    const items = all.filter(x => x.kind !== 'people').map(x => ({ level: x.level, kind: x.kind || null, msg: x.msg, day: x.day, at: x.at || 0, team: x.team || null, teams: x.teams || [] }));
    const sig = JSON.stringify(items);
    if (sig === lastSnap) return;
    try { await store.notify.saveSnapshot(items); lastSnap = sig; } catch (e) { console.warn('foto de incidencias', e); }
  }

  // ================================================================
  //  Notificaciones push (coordinación)
  // ================================================================
  const NOTIF_KINDS = [
    ['recordatorios', 'Recordatorios urgentes y vencidos', 'Los que pasan a urgente, vencen hoy o ya están vencidos'],
    ['conflictos', 'Conflictos del calendario', 'De los próximos 14 días'],
    ['resumen', 'Resumen del día', 'Partidos, reservas extraordinarias, entrenos y cambios de hoy'],
    ['altas', 'Altas de entrenadores', 'Al momento, cuando alguien se registra con una invitación'],
  ];
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64uBytes = s => { const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); return Uint8Array.from(atob(t), c => c.charCodeAt(0)); };
  const deviceName = () => {
    const ua = navigator.userAgent;
    const d = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Ordenador';
    const b = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : 'Safari';
    return `${d} · ${isStandalone() ? 'app' : b}`;
  };
  async function swRegistration() {
    if (!pushSupported() || store.mode === 'demo') return null;
    try { return await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('sw', e); return null; }
  }
  async function currentSubscription() {
    const reg = await swRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function openNotifications() {
    closeUserMenu();
    $('#notif-dialog').showModal();
    $('#nf-body').scrollTop = 0;
    $('#nf-status').innerHTML = '<span class="muted">Comprobando…</span>';
    try { state.notif = await store.notify.getSettings(); } catch (e) { state.notif = null; toast('No se pudieron cargar tus avisos: ' + e.message, true); }
    try { state.notifDevices = await store.notify.listDevices(); } catch { state.notifDevices = []; }
    state.notifSub = await currentSubscription().catch(() => null);
    renderNotifications();
  }

  function renderNotifications() {
    const s = state.notif || { notify_time: '08:30', kinds: {}, enabled: true };
    const sub = state.notifSub;
    const mine = sub && (state.notifDevices || []).some(d => d.endpoint === sub.endpoint);
    let status, canEnable = true;
    if (store.mode === 'demo') { status = '🧪 En la demo no se envían notificaciones. Funcionan en <b>intranet.cfcastalla.com</b>.'; canEnable = false; }
    else if (isIOS() && !isStandalone()) { status = '📲 En iPhone/iPad, las notificaciones solo funcionan con la herramienta <b>instalada en la pantalla de inicio</b> (Compartir → Añadir a pantalla de inicio). Ábrela desde ahí y vuelve aquí.'; canEnable = false; }
    else if (!pushSupported()) { status = '⚠️ Este navegador no admite notificaciones push.'; canEnable = false; }
    else if (Notification.permission === 'denied') { status = '🚫 Has bloqueado las notificaciones. Actívalas en los ajustes del dispositivo (Ajustes → Notificaciones → Castalla C.F.) y vuelve a intentarlo.'; canEnable = false; }
    else if (mine) status = '✅ <b>Activadas en este dispositivo.</b>';
    else status = '🔕 Aún no están activadas en este dispositivo.';
    $('#nf-status').innerHTML = status;
    $('#nf-enable').hidden = !canEnable || !!mine;
    $('#nf-disable').hidden = !mine;
    const n = (state.notifDevices || []).length;
    $('#nf-devices').innerHTML = n
      ? `<b>${n}</b> dispositivo${n > 1 ? 's' : ''} con avisos: ${(state.notifDevices || []).map(d => `<span class="mini-chip club">${esc(d.device || 'Dispositivo')}${sub && d.endpoint === sub.endpoint ? ' (este)' : ''}</span>`).join(' ')}`
      : 'Ningún dispositivo recibe avisos todavía.';
    const opts = [];
    for (let m = 6 * 60; m <= 22 * 60; m += 15) opts.push(`<option value="${fmt(m)}">${fmt(m)}</option>`);
    $('#nf-time').innerHTML = opts.join('');
    $('#nf-time').value = String(s.notify_time || '08:30').slice(0, 5);
    $('#nf-enabled').checked = s.enabled !== false;
    $('#nf-kinds').innerHTML = NOTIF_KINDS.map(([k, label, hint]) => `<label class="nf-kind"><input type="checkbox" data-kind="${k}" ${(s.kinds || {})[k] === false ? '' : 'checked'}><span><b>${label}</b><small>${hint}</small></span></label>`).join('');
    $('#nf-test').disabled = !n; $('#nf-preview').disabled = !n;
  }

  function readNotifForm() {
    const kinds = {};
    $$('#nf-kinds [data-kind]').forEach(c => { kinds[c.dataset.kind] = c.checked; });
    return { notify_time: $('#nf-time').value, enabled: $('#nf-enabled').checked, kinds };
  }
  async function saveNotifSettings(quiet) {
    try { state.notif = await store.notify.saveSettings(readNotifForm()); if (!quiet) toast('Avisos guardados'); }
    catch (e) { toast('No se pudo guardar: ' + e.message, true); }
  }

  async function enablePush() {
    // El permiso se pide lo primero, dentro del toque (iOS lo exige)
    let perm;
    try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; }
    if (perm !== 'granted') { toast('Sin permiso no se pueden mostrar avisos', true); renderNotifications(); return; }
    try {
      const reg = await swRegistration();
      if (!reg) throw new Error('el navegador no admite avisos');
      await navigator.serviceWorker.ready;
      const { publicKey } = await store.notify.call('config');
      let sub = await reg.pushManager.getSubscription();
      const key = b64uBytes(publicKey);
      if (sub) {
        const cur = sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
        if (!cur || cur.length !== key.length || cur.some((v, i) => v !== key[i])) { await sub.unsubscribe(); sub = null; }
      }
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const j = sub.toJSON();
      await store.notify.addDevice({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() });
      await saveNotifSettings(true);
      state.notifSub = sub;
      state.notifDevices = await store.notify.listDevices();
      renderNotifications();
      const r = await store.notify.call('test');
      toast(r?.sent ? 'Activadas: te hemos enviado una de prueba' : 'Activadas en este dispositivo');
    } catch (e) { toast('No se pudieron activar: ' + e.message, true); }
  }
  async function disablePush() {
    try {
      const sub = state.notifSub || await currentSubscription();
      if (sub) { await store.notify.removeDevice(sub.endpoint); await sub.unsubscribe().catch(() => { }); }
      state.notifSub = null;
      state.notifDevices = await store.notify.listDevices();
      renderNotifications();
      toast('Avisos desactivados en este dispositivo');
    } catch (e) { toast('No se pudo desactivar: ' + e.message, true); }
  }

  function bindNotifications() {
    $('#m-notif').onclick = openNotifications;
    $('#nf-enable').onclick = enablePush;
    $('#nf-disable').onclick = disablePush;
    $('#nf-time').onchange = () => saveNotifSettings();
    $('#nf-enabled').onchange = () => saveNotifSettings();
    $('#nf-kinds').addEventListener('change', () => saveNotifSettings());
    $('#nf-test').onclick = async () => { try { const r = await store.notify.call('test'); toast(r?.sent ? `Enviada a ${r.sent} dispositivo${r.sent > 1 ? 's' : ''}` : 'No hay dispositivos que la reciban'); } catch (e) { toast('No se pudo enviar: ' + e.message, true); } };
    $('#nf-preview').onclick = async () => { try { await saveNotifSettings(true); const r = await store.notify.call('preview'); toast(r?.sent ? 'Resumen de hoy enviado' : 'No hay dispositivos que lo reciban'); } catch (e) { toast('No se pudo enviar: ' + e.message, true); } };
    // Al tocar una notificación con la herramienta ya abierta
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'abrir' && /#inicio/.test(e.data.url || '') && isCoord()) setMode('home');
    });
  }

  // ================================================================
  //  Compartir el horario confirmado de un partido (WhatsApp)
  // ================================================================
  const HOME_TOWN = CFG.HOME_TOWN || 'Castalla';
  const HOME_VENUE = CFG.HOME_VENUE || 'Campo Municipal de Castalla';
  const hm = m => `${Math.floor(m / 60)}:${pad(m % 60)}`;              // 9:00, 10:00 (sin cero delante)
  const minOf = v => { if (!v) return null; const [h, m] = v.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
  const jornadaOf = b => b.matchday || (+(/(?:^|\s)J(\d{1,2})(?:\s|$)/.exec(b.notes || '') || [])[1] || null);
  // «Biar · Polideportivo Mpal. de Biar F-11» → localidad y campo
  const mapsSearchUrl = (field, town) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([field, town].filter(Boolean).join(', '));
  const validMapUrl = u => /^https:\/\/\S+$/.test(u || '');
  const splitVenue = v => { const s = String(v || ''); const i = s.indexOf(' · '); return i > 0 ? { town: s.slice(0, i).trim(), field: s.slice(i + 3).trim() } : { town: '', field: s.trim() }; };

  /** Texto del mensaje con el formato del club */
  function shareText(b, d) {
    const day = parseKey(b.day);
    const L = [`*HORARIO CONFIRMADO${d.matchday ? ` JORNADA ${d.matchday}` : ''}*`, `🆚 ${b.opponent || 'Rival por definir'}`];
    if (b.away) {
      L.push('✈️ Visitante');
      if (d.town) L.push(`📍${d.town}`);
    } else {
      L.push('🏠 Local', `📍${HOME_TOWN}`);
    }
    L.push(`📅 ${DAYS[dayIndexOf(b.day)]} ${day.getDate()}`);
    L.push(`⏰ ⚽️ ${hm(b.start_min)}`);
    if (d.meet != null) L.push(`⏰📍${hm(d.meet)}`);
    if (b.away && d.depart != null) L.push(`⏰🚗 ${hm(d.depart)}`);
    L.push(`🏟️ ${b.away ? (d.field || 'Campo por confirmar') : HOME_VENUE}`);
    if (b.away && (d.field || d.town)) L.push(`🗺️ ${validMapUrl(d.map) ? d.map : mapsSearchUrl(d.field, d.town)}`);
    return L.join('\n');
  }

  let shareB = null;
  function openShare(b) {
    shareB = b;
    const coord = isCoord();
    const v = splitVenue(b.venue);
    $('#sh-title').textContent = `📣 ${whoOf(b).name} vs ${b.opponent || 'rival'}`;
    $('#sh-info').innerHTML = `${esc(dayLabel(b.day))} · saque <b>${fmt(b.start_min)}</b> · ${b.away ? '✈️ Fuera' : '🏠 En casa'}<br><small>Mensaje detallado para el grupo del equipo (padres, jugadores y entrenadores).</small>`;
    $('#sh-matchday').value = jornadaOf(b) || '';
    const meet = b.meet_min ?? Math.max(0, b.start_min - meetBefore(b.team));
    $('#sh-meet-l').innerHTML = `Hora de quedada <small>(${durTxt(meetBefore(b.team))} antes)</small>`;
    $('#sh-meet').value = fmt(meet);
    $('#sh-depart').value = b.depart_min != null ? fmt(b.depart_min) : '';
    $('#sh-town').value = v.town; $('#sh-field').value = v.field;
    $('#sh-venue-ok').checked = !!b.venue_confirmed;
    $('#sh-map').value = b.venue_map_url || '';
    $('#sh-confirm').checked = !!b.confirmed;
    $$('.sh-away').forEach(x => x.hidden = !b.away);
    $('#sh-confirm-row').hidden = !!b.confirmed || !coord;
    $$('#share-dialog input').forEach(i => { i.disabled = !coord; });
    $('#sh-readonly').hidden = coord;
    $('#sh-save').hidden = !coord;
    $('#share-dialog').showModal();
    $('#sh-body').scrollTop = 0;
    renderShare();
  }
  function shareData() {
    return {
      matchday: +$('#sh-matchday').value || null,
      meet: minOf($('#sh-meet').value),
      depart: minOf($('#sh-depart').value),
      town: $('#sh-town').value.trim(), field: $('#sh-field').value.trim(),
      venueOk: $('#sh-venue-ok').checked,
      map: $('#sh-map').value.trim(),
      confirmed: shareB?.confirmed || $('#sh-confirm').checked,
    };
  }
  /** Qué falta para poder enviar */
  function shareMissing(b, d) {
    const m = [];
    if (!d.confirmed) m.push(isCoord() ? 'marca el horario como confirmado' : 'el horario aún no está confirmado');
    if (d.meet == null) m.push('pon la hora de quedada');
    if (b.away) {
      if (d.depart == null) m.push('pon la hora de salida');
      if (!d.field) m.push('escribe el campo');
      if (!d.venueOk) m.push('confirma el campo');
      if (d.map && !validMapUrl(d.map)) m.push('pega un enlace de Google Maps válido (o déjalo vacío)');
    }
    return m;
  }
  function renderShare() {
    const b = shareB; if (!b) return;
    const d = shareData();
    $('#sh-preview').textContent = shareText(b, d);
    const miss = shareMissing(b, d);
    $('#sh-missing').hidden = !miss.length;
    $('#sh-missing').textContent = miss.length ? 'Para enviarlo: ' + miss.join(', ') + '.' : '';
    $('#sh-wa').disabled = !!miss.length; $('#sh-copy').disabled = !!miss.length;
  }
  /** Guarda en el partido lo rellenado (solo coordinación) */
  async function saveShare(quiet) {
    const b = shareB; if (!b || !isCoord()) return true;
    const d = shareData();
    const venue = b.away ? ([d.town, d.field].filter(Boolean).join(' · ').slice(0, 120) || null) : b.venue;
    const row = { ...b, matchday: d.matchday, meet_min: d.meet, depart_min: b.away ? d.depart : null, venue, venue_confirmed: b.away ? d.venueOk : false, venue_map_url: b.away && validMapUrl(d.map) ? d.map.slice(0, 400) : null, confirmed: d.confirmed };
    try {
      await store.update(b.id, row);
      Object.assign(b, row);
      const s = state.bookings.find(x => x.id === b.id); if (s) Object.assign(s, row);
      if (!quiet) toast('Datos del partido guardados');
      render();
      return true;
    } catch (e) { toast('No se pudo guardar: ' + e.message, true); return false; }
  }
  async function sendShare(how) {
    const b = shareB; if (!b) return;
    const d = shareData();
    if (shareMissing(b, d).length) { renderShare(); return; }
    const text = shareText(b, d);
    if (!(await saveShare(true))) return;
    if (isCoord()) markCommunicated([b], 'group', true).catch(() => { });
    if (how === 'copy') { try { await navigator.clipboard.writeText(text); toast('Mensaje copiado'); } catch { toast('No se ha podido copiar', true); } return; }
    if (navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent)) { try { await navigator.share({ text }); } catch { } return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  // ================================================================
  //  Equipos y plantillas (jugadores con dorsal y nombre) y convocables
  // ================================================================
  const isTeams = () => state.mode === 'teams';
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  /** Equipos cuya plantilla puede ver el usuario: todos (coordinación) o los suyos (entrenador) */
  const rosterTeams = () => isCoord() ? TEAMS : TEAMS.filter(t => isMine(t.id));
  const byDorsal = (a, b) => (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name, 'es');
  const squadOf = team => (state.players || []).filter(p => p.team === team).sort(byDorsal);
  const playerById = id => (state.players || []).find(p => p.id === id);
  const coachesOf = team => (state.people || []).filter(p => p.status === 'aprobado' && p.role !== 'coordinador' && (p.teams || []).includes(team)).map(p => p.full_name || p.email).filter(Boolean);
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const dorsalOf = v => { const s = String(v ?? '').trim(); if (!s) return { ok: true, n: null }; const n = +s; return /^\d{1,2}$/.test(s) && n <= 99 ? { ok: true, n } : { ok: false }; };
  const playerErr = e => /players_dorsal_unico|duplicate key/.test(e.message) ? 'Ese dorsal ya lo lleva otro jugador del equipo.' : e.message;
  /** «7 Iker Molina», «7. Iker», «7 - Iker», «Iker Molina» → { number, name } */
  const parsePlayerLine = l => {
    const m = /^\s*(?:(\d{1,2})\s*[.\-–:)\s]\s*)?(.+?)\s*$/.exec(l);
    if (!m || !m[2].trim()) return null;
    return { number: m[1] != null ? +m[1] : null, name: m[2].replace(/\s+/g, ' ').slice(0, 80) };
  };
  // Convocables: reglas (qué equipo puede tirar de cuál) y propuestas pendientes/aprobadas/rechazadas
  const rulesFor = team => (state.callupRules || []).filter(r => r.team === team).sort((a, b) => TEAMS.findIndex(t => t.id === a.from) - TEAMS.findIndex(t => t.id === b.from));
  // Condición para subir de cada equipo (config.js > upFlag): Sub-23, 15 cumplidos, 2º año… Se guarda en players.sub23
  const upFlag = team => TEAM[team]?.upFlag || null;
  const upLabel = team => upFlag(team)?.label || 'cumple la condición';
  const ruleOk = (p, team) => !!p && (state.callupRules || []).some(r => r.team === team && r.from === p.team && (!r.sub23 || p.sub23));
  const callupsOf = team => (state.callups || []).filter(c => c.team === team);
  const pendingCallups = () => (state.callups || []).filter(c => c.status === 'pendiente');
  // Estado del jugador: null = disponible; molestias = convocable en duda; el resto, no convocable
  const PST = {
    molestias:     { label: 'Molestias',     cls: 'ps-mol', out: false },
    lesion_leve:   { label: 'Lesión leve',   cls: 'ps-lev', out: true },
    lesion:        { label: 'Lesión',        cls: 'ps-les', out: true },
    lesion_grave:  { label: 'Lesión grave',  cls: 'ps-gra', out: true },
    no_disponible: { label: 'No disponible', cls: 'ps-no',  out: true },
  };
  // «Va con el superior» es para un día concreto (status_until = día del partido de arriba). Solo es baja de su
  // equipo si su equipo también juega ese día; si juegan días distintos, puede jugar en los dos.
  const teamMatchesFrom = (team, from = todayKey()) => (state.allMatches || []).filter(b => b.team === team && b.day >= from).sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min);
  const upperDay = p => p.status === 'no_disponible' && p.status_team && p.status_until && p.status_until >= todayKey() ? p.status_until : null;
  const upperClash = p => { const d = upperDay(p); return !!d && teamMatchesFrom(p.team, d).some(b => b.day === d); };
  const isOut = p => p.status === 'no_disponible' && p.status_team ? (!upperDay(p) ? false : upperClash(p)) : !!PST[p.status]?.out;
  /** Equipos superiores con los que puede ir el jugador (reglas de convocables y su condición) */
  const upTargets = (p, cond = p.sub23) => (state.callupRules || []).filter(r => r.from === p.team && (!r.sub23 || cond)).map(r => r.team);
  const withUpper = p => p.status === 'no_disponible' && p.status_team ? p.status_team : null;
  const psBadge = p => {
    const up = withUpper(p);
    if (up) {
      const d = upperDay(p), clash = upperClash(p);
      if (!d) return `<span class="ps ps-no" title="El día con el ${esc(teamOf(up).name)} ya pasó: actualiza su estado">⬆️ ${esc(teamOf(up).short)} · revisar</span>`;
      return `<span class="ps ${clash ? 'ps-les' : 'ps-up'}" title="${esc(clash ? `Juega con el ${teamOf(up).name} el mismo día que su equipo: baja ese día` : `Juega con el ${teamOf(up).name} ese día; su equipo juega otro día, así que puede jugar en los dos`)}">⬆️ ${esc(teamOf(up).short)} ${shortDate(d)}${clash ? ' · baja' : ''}</span>`;
    }
    const st = PST[p.status]; if (!st) return '';
    const late = p.status_until && p.status_until < todayKey();
    const tip = [st.label, p.status_note, p.status_since ? 'desde ' + shortDate(p.status_since) : '', p.status_until ? 'vuelta prevista ' + shortDate(p.status_until) : ''].filter(Boolean).join(' · ');
    return `<span class="ps ${st.cls}" title="${esc(tip)}">${st.label}${p.status_until ? ` · ${late ? 'revisar' : 'hasta ' + shortDate(p.status_until)}` : ''}</span>`;
  };
  const playerSub = p => {
    const bits = [];
    if (p.status && p.status_note && !withUpper(p)) bits.push(`<span>${p.status === 'no_disponible' ? '🚫' : '🩹'} ${esc(p.status_note)}</span>`);
    if (p.notes) bits.push(`<span>📝 ${esc(p.notes)}</span>`);
    return bits.length ? `<span class="tm-sub">${bits.join('')}</span>` : '';
  };
  const squadSummary = sq => {
    const out = sq.filter(isOut).length, mol = sq.filter(p => p.status === 'molestias').length, up = sq.filter(p => upperDay(p)).length;
    return [`${sq.length - out} convocable${sq.length - out === 1 ? '' : 's'}`, mol ? `${mol} con molestias` : '', out ? `${plural(out, 'baja', 'bajas')}` : '', up ? `${up} también con el superior` : ''].filter(Boolean).join(' · ');
  };
  const canEditPlayer = p => isCoord() || isMine(p.team);
  const CU_ST = { pendiente: '⏳ Pendiente de aprobar', aprobado: '', rechazado: '✗ Rechazado' };
  const personName = id => { const p = (state.people || []).find(x => x.id === id); return p ? (p.full_name || p.email) : id === state.user?.id ? 'ti' : ''; };

  /** Jugadores, convocables y reglas de una vez (Equipos e Inicio) */
  async function fetchSquads() {
    const [pl, cu, ru, ms] = await Promise.all([store.players.list(), store.callups.list(), store.callupRules.list(), store.listAllMatches().catch(() => state.allMatches || [])]);
    state.players = pl; state.callups = cu; state.callupRules = ru; state.allMatches = ms;
  }

  async function loadTeams(quiet) {
    if (!rosterTeams().length) { renderTeams(); return; }
    if (!quiet) { state.teamsLoading = true; renderTeams(); }
    try { await fetchSquads(); }
    catch (e) { toast('No se pudo cargar la plantilla: ' + e.message, true); }
    state.teamsLoading = false;
    renderHomeBadge();
    if (isHome()) renderHome();
    // Si está escribiendo, no le borramos lo que tiene a medias: se pinta al terminar
    const a = document.activeElement;
    if (quiet && a && $('#teams').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { state.teamsStale = true; return; }
    renderTeams();
  }

  function renderTeams() {
    const el = $('#teams');
    if (!el || !isTeams()) return;
    state.teamsStale = false;
    const list = rosterTeams();
    if (!list.length) {
      el.innerHTML = `<div class="home-wrap"><div class="tm-head"><div class="tm-title"><h2>Plantilla</h2></div><button type="button" class="ghost home-cal-btn" data-tm-week>Ver calendario →</button></div>
        <div class="panel tm-empty">Aún no tienes ningún equipo asignado. Pide a la coordinación que te lo asigne.</div></div>`;
      return;
    }
    if (list.length === 1) state.teamOpen = list[0].id;
    const open = list.find(t => t.id === state.teamOpen);
    const sc = el.scrollTop, keep = keepFields(el);
    el.innerHTML = `<div class="home-wrap">${open ? rosterHTML(open, list.length > 1) : teamsGridHTML(list)}</div>`;
    keep();
    el.scrollTop = sc;
  }

  /** Al repintar (tiempo real, recarga del calendario…) no se pierde lo que se está escribiendo ni el foco */
  function keepFields(root) {
    const key = i => i.id ? '#' + i.id : null;
    const saved = [...root.querySelectorAll('input, textarea')].map(i => ({ k: key(i), v: i.value, c: i.checked, t: i.type })).filter(x => x.k && x.t !== 'checkbox' || x.k && x.c);
    const a = document.activeElement, fk = a && root.contains(a) ? key(a) : null;
    const sel = fk && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    return () => {
      for (const x of saved) {
        const i = root.querySelector(x.k); if (!i) continue;
        if (x.t === 'checkbox') i.checked = x.c; else i.value = x.v;
      }
      const f = fk && root.querySelector(fk);
      if (f) { f.focus({ preventScroll: true }); if (sel && f.setSelectionRange) try { f.setSelectionRange(...sel); } catch { } }
    };
  }

  function teamsGridHTML(list) {
    const loading = state.teamsLoading && !state.players;
    const total = list.reduce((n, t) => n + squadOf(t.id).length, 0);
    const pend = isCoord() ? pendingCallups().length : 0;
    const cards = list.map(t => {
      const n = squadOf(t.id).length, co = isCoord() ? coachesOf(t.id) : null;
      const cu = callupsOf(t.id), ok = cu.filter(c => c.status === 'aprobado').length, pe = cu.filter(c => c.status === 'pendiente').length;
      return `<button type="button" class="tm-card" data-team-open="${t.id}" style="--team:${t.color}">
        <span class="tm-card-name">${esc(t.name)}</span>
        <span class="tm-card-n ${n ? '' : 'zero'}"><b>${loading ? '…' : n}</b> ${n === 1 ? 'jugador' : 'jugadores'}${ok ? ` <span class="tm-card-cu">+${ok} conv.</span>` : ''}</span>
        ${(() => { const sq = squadOf(t.id), o = sq.filter(isOut).length, m = sq.filter(p => p.status === 'molestias').length; return o || m ? `<span class="tm-card-st">${o ? `<span class="ps ps-les">${plural(o, 'baja', 'bajas')}</span>` : ''}${m ? `<span class="ps ps-mol">${m} con molestias</span>` : ''}</span>` : ''; })()}
        ${pe ? `<span class="tm-card-pe">⏳ ${plural(pe, 'convocable por aprobar', 'convocables por aprobar')}</span>` : ''}
        ${co ? `<span class="tm-card-co">${co.length ? '👤 ' + esc(co.join(', ')) : '<i>Sin entrenador</i>'}</span>` : ''}
        <span class="tm-card-go" aria-hidden="true">›</span></button>`;
    }).join('');
    return `<div class="tm-head"><div class="tm-title"><h2>${isCoord() ? 'Equipos' : 'Mis equipos'}</h2><p>${loading ? 'Cargando plantillas…' : `${plural(total, 'jugador', 'jugadores')} en ${plural(list.length, 'equipo', 'equipos')} · pulsa un equipo para ver su plantilla`}</p></div>
      <button type="button" class="ghost home-cal-btn" data-tm-week>Ver calendario →</button></div>
      ${pend ? `<div class="tm-pend-note">⏳ Tienes ${plural(pend, 'convocable', 'convocables')} por aprobar. Entra en el equipo o apruébalos desde <button type="button" class="link" data-tm-home>Inicio</button>.</div>` : ''}
      <div class="tm-grid">${cards}</div>
      ${isCoord() ? meetHTML() + rulesHTML() : ''}`;
  }

  /** Hora de quedada por equipo (solo coordinación) */
  function meetHTML() {
    const opts = [30, 45, 60, 75, 90, 105, 120];
    const rows = MATCH_TEAMS().map(t => {
      const v = meetBefore(t.id), list = opts.includes(v) ? opts : [...opts, v].sort((a, b) => a - b);
      return `<li class="cr-row" style="--team:${t.color}"><span class="cr-team">${esc(t.name)}</span>
        <span class="cr-chips"><select class="ts-meet" data-ts-meet="${t.id}" aria-label="Quedada del ${esc(t.name)}">${list.map(m => `<option value="${m}" ${m === v ? 'selected' : ''}>${durTxt(m)} antes</option>`).join('')}</select></span></li>`;
    }).join('');
    return `<details class="panel cr-panel" ${state.meetOpen ? 'open' : ''} data-panel="meet"><summary><h3>Hora de quedada <small>cuánto antes del partido se queda en el campo</small></h3></summary>
      <p class="cr-help">Se usa para proponer la hora de quedada al compartir el horario de un partido (se puede cambiar en cada partido).</p>
      <ul class="cr-list">${rows}</ul></details>`;
  }

  /** Editor de reglas de convocables (solo coordinación) */
  function rulesHTML() {
    const rows = TEAMS.map(t => {
      const rs = rulesFor(t.id);
      const avail = TEAMS.filter(o => o.id !== t.id && !rs.some(r => r.from === o.id));
      return `<li class="cr-row" style="--team:${t.color}"><span class="cr-team">${esc(t.name)}</span>
        <span class="cr-chips">${rs.length ? rs.map(r => { const f = teamOf(r.from); return `<span class="cr-chip" style="--team:${f.color}" data-cr="${t.id}|${r.from}"><b>${esc(f.name)}</b>
            ${upFlag(r.from) || r.sub23 ? `<button type="button" class="cr-s23 ${r.sub23 ? 'on' : ''}" data-cr-s23 aria-pressed="${!!r.sub23}" title="Solo los jugadores marcados con «${esc(upLabel(r.from))}» en su plantilla">solo ${esc(upLabel(r.from).toLowerCase())}</button>` : ''}
            <button type="button" class="cr-del" data-cr-del aria-label="Quitar ${esc(f.name)}" title="Quitar">×</button></span>`; }).join('') : '<span class="muted cr-none">Nadie</span>'}
          <select class="cr-add" data-cr-add="${t.id}" aria-label="Añadir un equipo del que ${esc(t.name)} puede convocar"><option value="">＋ Equipo</option>${avail.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></span></li>`;
    }).join('');
    return `<details class="panel cr-panel" ${state.rulesOpen ? 'open' : ''}><summary><h3>Reglas de convocables <small>qué jugadores puede tener en cuenta cada equipo</small></h3></summary>
      <p class="cr-help">Cada fila dice de qué equipos puede proponer convocables el entrenador. Si el equipo de origen tiene condición para subir (<b>sub-23</b> en los Senior, <b>15 cumplidos</b> en el Cadete, <b>2º año</b> en el Infantil A), márcala para que solo valgan los jugadores que la cumplen. Tú apruebas cada propuesta.</p>
      <ul class="cr-list">${rows}</ul></details>`;
  }

  function rosterHTML(t, back) {
    const sq = squadOf(t.id);
    const loading = state.teamsLoading && !state.players;
    const noNum = sq.filter(p => p.number == null).length;
    const co = isCoord() ? coachesOf(t.id) : [];
    const s23 = !!upFlag(t.id), fl = upFlag(t.id);
    const ups = id => (state.callups || []).filter(c => c.player_id === id && c.status !== 'rechazado' && c.team !== t.id);
    const rows = sq.map(p => `<li class="tm-row ${isOut(p) ? 'is-out' : ''}" data-pl="${p.id}"><span class="tm-num ${p.number == null ? 'none' : ''}">${p.number ?? '—'}</span>
          <button type="button" class="tm-pname" data-pl-open title="Ver la ficha de ${esc(p.name)}"><span class="tm-pn">${esc(p.name)}</span>${psBadge(p)}${ups(p.id).map(c => `<span class="tm-up ${c.status}" title="${c.status === 'pendiente' ? 'Propuesto como convocable, pendiente de aprobar' : 'Convocable'} en ${esc(teamOf(c.team).name)}">↑ ${esc(teamOf(c.team).short)}${c.status === 'pendiente' ? ' ⏳' : ''}</span>`).join('')}${playerSub(p)}</button>
          ${s23 ? `<button type="button" class="tm-s23 ${p.sub23 ? 'on' : ''}" data-pl-s23 aria-pressed="${!!p.sub23}" title="${p.sub23 ? esc(fl.label) + ': sí' : 'Marcar: ' + esc(fl.label)}">${esc(fl.short)}</button>` : ''}
          <button type="button" class="icon-btn" data-pl-open title="Estado y datos" aria-label="Estado y datos de ${esc(p.name)}">✎</button></li>`).join('');
    return `<div class="tm-head" style="--team:${t.color}">
        ${back ? `<button type="button" class="ghost tm-back" data-team-open="">‹ Equipos</button>` : ''}
        <div class="tm-title"><h2><span class="tm-dot"></span>${esc(t.name)}</h2>
          <p>${loading ? 'Cargando…' : plural(sq.length, 'jugador', 'jugadores') + (sq.length ? ' · ' + squadSummary(sq) : '')}${noNum && !loading ? ` · ${noNum} sin dorsal` : ''}${s23 && !loading ? ` · ${sq.filter(p => p.sub23).length} con ${esc(fl.label.toLowerCase())}` : ''}${co.length ? ` · 👤 ${esc(co.join(', '))}` : ''}</p></div>
        <button type="button" class="ghost home-cal-btn" data-tm-week>Ver calendario →</button>
      </div>
      <section class="panel tm-roster" style="--team:${t.color}">
        <form class="tm-add ${s23 ? 'with-s23' : ''}" id="tm-add" autocomplete="off">
          <input id="tm-num" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="Dorsal" aria-label="Dorsal (opcional)">
          <input id="tm-name" maxlength="80" placeholder="Nombre y apellidos" aria-label="Nombre del jugador" required>
          ${s23 ? `<label class="tm-add-s23"><input type="checkbox" id="tm-s23"> ${esc(fl.label)}</label>` : ''}
          <button class="primary">Añadir</button>
        </form>
        <div class="tm-tools">
          <button type="button" class="link" data-bulk aria-expanded="${!!state.bulkOpen}">${state.bulkOpen ? 'Cerrar la lista' : '📋 Pegar una lista de jugadores'}</button>
          ${sq.length ? `<button type="button" class="link" data-tm-copy>Copiar plantilla</button>` : ''}
        </div>
        <div class="tm-bulk" ${state.bulkOpen ? '' : 'hidden'}>
          <textarea id="tm-bulk" rows="7" placeholder="Un jugador por línea, con el dorsal delante (si lo tiene):&#10;1 Hugo Sanchis&#10;7 Iker Molina&#10;Sergio Coloma">${esc(state.bulkDraft || '')}</textarea>
          <div class="tm-bulk-foot"><span id="tm-bulk-info" class="muted"></span><button type="button" class="primary" data-bulk-add disabled>Añadir</button></div>
        </div>
        ${loading ? '<p class="muted tm-loading">Cargando la plantilla…</p>'
          : sq.length ? `<ol class="tm-list">${rows}</ol>`
          : `<p class="tm-none">Todavía no hay jugadores. Añádelos uno a uno o pega la lista entera.</p>`}
      </section>
      ${callupsHTML(t)}`;
  }

  /** Convocables de equipos inferiores del equipo abierto */
  function callupsHTML(t) {
    const rs = rulesFor(t.id), cu = callupsOf(t.id);
    if (!rs.length && !cu.length) return '';
    const coord = isCoord();
    const order = { pendiente: 0, aprobado: 1, rechazado: 2 };
    const list = cu.map(c => ({ c, p: playerById(c.player_id) })).filter(x => x.p)
      .sort((a, b) => order[a.c.status] - order[b.c.status] || TEAMS.findIndex(x => x.id === a.p.team) - TEAMS.findIndex(x => x.id === b.p.team) || byDorsal(a.p, b.p));
    const from = rs.map(r => teamOf(r.from).name + (r.sub23 ? ` (${upLabel(r.from).toLowerCase()})` : '')).join(', ');
    const rows = list.map(({ c, p }) => {
      const f = teamOf(p.team), bad = !ruleOk(p, t.id);
      return `<li class="tm-row cu-row st-${c.status}" data-cu="${c.id}" style="--team:${f.color}">
        <span class="tm-num ${p.number == null ? 'none' : ''}">${p.number ?? '—'}</span>
        <button type="button" class="tm-pname" data-pl-open data-pl-id="${p.id}"><span class="tm-pn">${esc(p.name)}</span><span class="cu-from">${esc(f.name)}</span>${psBadge(p)}
          ${CU_ST[c.status] ? `<span class="cu-st">${CU_ST[c.status]}</span>` : ''}${bad ? '<span class="cu-st cu-bad" title="Las reglas o la condición del jugador han cambiado desde que se añadió">⚠️ Ya no cumple las reglas</span>' : ''}${playerSub(p)}</button>
        ${coord && c.status === 'pendiente' ? `<button type="button" class="cu-ok" data-cu-set="aprobado" title="Aprobar">✓<span class="hide-sm"> Aprobar</span></button><button type="button" class="cu-no" data-cu-set="rechazado" title="Rechazar">✗</button>` : ''}
        <button type="button" class="icon-btn tm-del" data-cu-del title="Quitar de convocables" aria-label="Quitar a ${esc(p.name)} de convocables">×</button></li>`;
    }).join('');
    return `<section class="panel tm-cu" style="--team:${t.color}">
      <div class="tm-cu-head"><h3>Convocables <small>${rs.length ? 'de ' + esc(from) : 'sin reglas ahora mismo'}</small></h3>
        ${rs.length ? `<button type="button" class="${state.pickOpen ? 'ghost' : 'primary'}" data-cu-pick aria-expanded="${!!state.pickOpen}">${state.pickOpen ? 'Cerrar' : '＋ Añadir convocables'}</button>` : ''}</div>
      ${!coord && rs.length ? '<p class="cu-help">Los que propongas los tiene que aprobar la coordinación.</p>' : ''}
      ${state.pickOpen && rs.length ? pickerHTML(t, rs) : ''}
      ${rows ? `<ol class="tm-list cu-list">${rows}</ol>` : `<p class="tm-none">Aún no hay convocables de otros equipos.</p>`}
    </section>`;
  }

  function pickerHTML(t, rs) {
    const taken = new Set(callupsOf(t.id).map(c => c.player_id));
    const sel = state.pickSel || new Set();
    const groups = rs.map(r => {
      const f = teamOf(r.from);
      const all = squadOf(r.from), ok = all.filter(p => !r.sub23 || p.sub23), free = ok.filter(p => !taken.has(p.id));
      const hidden = isCoord() ? all.length - ok.length : 0;
      return `<div class="pk-group" style="--team:${f.color}"><h4>${esc(f.name)}${r.sub23 ? ` <small>solo ${esc(upLabel(r.from).toLowerCase())}</small>` : ''}</h4>
        ${free.length ? `<div class="pk-list">${free.map(p => `<label class="pk-item"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}><span class="tm-num ${p.number == null ? 'none' : ''}">${p.number ?? '—'}</span><span class="pk-name">${esc(p.name)}</span>${psBadge(p)}</label>`).join('')}</div>`
          : `<p class="muted pk-none">${all.length ? 'No queda nadie más por añadir.' : 'Su plantilla está vacía.'}${r.sub23 && !ok.length && all.length ? ` Ninguno está marcado con «${esc(upLabel(r.from))}».` : ''}</p>`}
        ${hidden ? `<p class="muted pk-none">${plural(hidden, 'jugador no aparece', 'jugadores no aparecen')} por no estar marcado${hidden === 1 ? '' : 's'} con «${esc(upLabel(r.from))}».</p>` : ''}</div>`;
    }).join('');
    const n = sel.size;
    return `<div class="pk">${groups}
      <div class="pk-foot"><button type="button" class="primary" data-cu-add ${n ? '' : 'disabled'}>${isCoord() ? (n ? `Añadir ${n}` : 'Añadir') : (n ? `Proponer ${n} a la coordinación` : 'Proponer')}</button></div></div>`;
  }

  /** Inicio: convocables que esperan aprobación (solo coordinación) */
  function homeCallupsHTML() {
    const pend = homePendingCallups().map(c => ({ c, p: playerById(c.player_id) })).filter(x => x.p);
    if (!pend.length) return '';
    return `<div class="up-group up-callups" id="up-callups"><h4>Convocables por aprobar <span class="count">${pend.length}</span></h4><ul class="up-list">${pend.map(({ c, p }) => {
      const to = teamOf(c.team), f = teamOf(p.team), who = personName(c.created_by);
      return `<li class="hc-item" data-cu="${c.id}"><span class="up-ic">⬆️</span><span class="up-txt"><span class="up-when">${esc(f.name)} → ${esc(to.name)}${who ? ` · propuesto por ${esc(who)}` : ''}</span>${p.number != null ? `<b>${p.number}</b> · ` : ''}${esc(p.name)}${!ruleOk(p, c.team) ? ' <span class="cu-bad">⚠️ ya no cumple las reglas</span>' : ''}</span>
        <span class="hc-acts"><button type="button" class="cu-ok" data-cu-set="aprobado">✓ Aprobar</button><button type="button" class="cu-no" data-cu-set="rechazado" title="Rechazar">✗</button></span></li>`;
    }).join('')}</ul></div>`;
  }

  async function setCallup(id, status) {
    try {
      await store.callups.setStatus(id, status);
      const c = (state.callups || []).find(x => x.id === id); if (c) c.status = status;
      toast(status === 'aprobado' ? 'Convocable aprobado' : 'Convocable rechazado');
      renderTeams(); renderHomeBadge(); if (isHome()) renderHome();
    } catch (e) { toast('No se pudo cambiar: ' + e.message, true); }
  }


  /** Ficha del jugador: datos, estado (disponibilidad) y notas a tener en cuenta */
  let pdPlayer = null;
  function openPlayer(p) {
    pdPlayer = p;
    const t = teamOf(p.team), edit = canEditPlayer(p);
    $('#pd-title').textContent = p.name;
    $('#pd-team').innerHTML = `<span class="tm-dot" style="--team:${t.color}"></span>${esc(t.name)}`;
    $('#pd-num').value = p.number ?? ''; $('#pd-name').value = p.name;
    $('#pd-s23-row').hidden = !upFlag(p.team); $('#pd-s23').checked = !!p.sub23; $('#pd-s23-l').textContent = upLabel(p.team);
    $('#pd-st-note').value = withUpper(p) ? '' : (p.status_note || ''); $('#pd-until').value = p.status_until || '';
    pdUp = withUpper(p);
    $('#pd-notes').value = p.notes || '';
    setPdStatus(p.status || '');
    $$('#player-dialog input, #player-dialog textarea, #pd-st button, #pd-until-pre button').forEach(x => x.disabled = !edit);
    $('#pd-ro').hidden = edit;
    $('#pd-save').hidden = !edit; $('#pd-delete').hidden = !edit;
    $('#pd-since').textContent = p.status && p.status_since ? `Desde ${shortDate(p.status_since)}` : '';
    $('#player-dialog').showModal();
    $('#pd-body').scrollTop = 0;
  }
  function setPdStatus(st) {
    $$('#pd-st button').forEach(b => { const on = b.dataset.st === st; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    $('#pd-st-more').hidden = !st;
    $('#pd-st-note-l').textContent = st === 'no_disponible' ? 'Motivo' : 'Detalle';
    $('#pd-st-note').placeholder = st === 'no_disponible' ? 'Ej.: de viaje, sanción, exámenes…' : st === 'molestias' ? 'Ej.: carga en el gemelo' : 'Ej.: esguince de tobillo';
    $('#player-dialog').dataset.st = st;
    markUntilPresets();
    renderPdUp();
  }
  /** «Va con el superior»: solo si el jugador cumple las reglas de convocables */
  let pdUp = null;
  function renderPdUp() {
    const p = pdPlayer, box = $('#pd-up'); if (!p || !box) return;
    const st = $('#player-dialog').dataset.st;
    const cond = upFlag(p.team) ? $('#pd-s23').checked : !!p.sub23;
    const targets = upTargets(p, cond), anyRule = (state.callupRules || []).some(r => r.from === p.team);
    if (pdUp && !targets.includes(pdUp)) pdUp = null;
    box.hidden = st !== 'no_disponible' || !anyRule;
    box.innerHTML = targets.length
      ? `<span>Va con:</span>${targets.map(t => `<button type="button" data-up="${t}" class="${pdUp === t ? 'on' : ''}" aria-pressed="${pdUp === t}" ${canEditPlayer(p) ? '' : 'disabled'}>⬆️ ${esc(teamOf(t).name)}</button>`).join('')}`
      : `<span class="pd-up-no">Para marcar que va con el superior tiene que cumplir «${esc(upLabel(p.team))}».</span>`;
    $('#pd-st-note-f').hidden = !!pdUp;
    // Día con el superior: sus próximos partidos (y si coincide con un partido del propio equipo)
    const days = $('#pd-up-days');
    days.hidden = box.hidden || !pdUp;
    $('#pd-until-l').textContent = pdUp ? 'Día con el superior' : 'Vuelta prevista';
    const opt = $('#pd-until-l').parentElement.querySelector('small'); if (opt) opt.hidden = !!pdUp;
    $('#pd-until-pre').hidden = !!pdUp;
    if (pdUp) {
      const own = new Set(teamMatchesFrom(p.team).map(b => b.day));
      const ms = teamMatchesFrom(pdUp).slice(0, 4), v = $('#pd-until').value;
      days.innerHTML = ms.length
        ? `<span>Partido:</span>${ms.map(b => `<button type="button" data-up-day="${b.day}" class="${v === b.day ? 'on' : ''}">${shortDate(b.day)} ${fmt(b.start_min)} · ${esc(b.opponent || 'rival por definir')}${own.has(b.day) ? ' ⚠️' : ''}</button>`).join('')}
           <p class="pd-up-hint">${v ? (own.has(v) ? `⚠️ El ${esc(teamOf(p.team).name)} también juega ese día: cuenta como baja.` : `✓ El ${esc(teamOf(p.team).name)} no juega ese día: sigue siendo convocable.`) : 'Elige el partido (o pon el día abajo). Solo es baja si su equipo juega ese mismo día.'}</p>`
        : `<p class="pd-up-hint">El ${esc(teamOf(pdUp).name)} no tiene partidos cargados: pon el día abajo. Solo es baja si su equipo juega ese mismo día.</p>`;
    }
  }
  function markUntilPresets() {
    const v = $('#pd-until').value;
    $$('#pd-until-pre button').forEach(b => b.classList.toggle('on', b.dataset.until === '' ? !v : keyOf(addDays(new Date(), +b.dataset.until)) === v));
  }
  async function savePlayer() {
    const p = pdPlayer; if (!p || !canEditPlayer(p)) return;
    const name = $('#pd-name').value.trim().replace(/\s+/g, ' '), d = dorsalOf($('#pd-num').value);
    if (!name) { toast('Escribe el nombre', true); $('#pd-name').focus(); return; }
    if (!d.ok) { toast('El dorsal tiene que ser un número del 0 al 99', true); $('#pd-num').focus(); return; }
    const other = d.n != null && squadOf(p.team).find(x => x.number === d.n && x.id !== p.id);
    if (other) { toast(`El ${d.n} ya lo lleva ${other.name}`, true); return; }
    const st = $('#player-dialog').dataset.st || null;
    const row = {
      number: d.n, name, sub23: upFlag(p.team) ? $('#pd-s23').checked : !!p.sub23,
      status: st, status_note: st ? (st === 'no_disponible' && pdUp ? `Con el ${teamOf(pdUp).name}` : ($('#pd-st-note').value.trim() || null)) : null,
      status_team: st === 'no_disponible' && pdUp ? pdUp : null,

      status_until: st ? ($('#pd-until').value || null) : null,
      status_since: st ? (st === p.status && p.status_since ? p.status_since : todayKey()) : null,
      notes: $('#pd-notes').value.trim() || null,
    };
    if (row.status_team && !row.status_until) { toast('Elige el partido o el día con el superior', true); return; }
    try {
      await store.players.update(p.id, row);
      Object.assign(p, row);
      $('#player-dialog').close();
      toast(row.status_team ? `${name}: con el ${teamOf(row.status_team).name} el ${shortDate(row.status_until)}${upperClash(p) ? ' (baja ese día)' : ' (sigue convocable)'}` : row.status_team ? `${name}: va con el ${teamOf(row.status_team).name}` : st ? `${name}: ${PST[st].label.toLowerCase()}` : 'Jugador guardado');
      renderTeams();
    } catch (e) { toast('No se pudo guardar: ' + playerErr(e), true); }
  }
  function bindPlayerDialog() {
    $('#pd-st').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (!b || b.disabled) return; setPdStatus(b.dataset.st); if (b.dataset.st && !$('#pd-st-note').value && !coarse()) $('#pd-st-note').focus(); });
    $('#pd-until-pre').addEventListener('click', e => { const b = e.target.closest('[data-until]'); if (!b) return; $('#pd-until').value = b.dataset.until === '' ? '' : keyOf(addDays(new Date(), +b.dataset.until)); markUntilPresets(); });
    $('#pd-until').addEventListener('change', markUntilPresets);
    $('#pd-up').addEventListener('click', e => { const b = e.target.closest('[data-up]'); if (!b || b.disabled) return; pdUp = pdUp === b.dataset.up ? null : b.dataset.up; renderPdUp(); });
    $('#pd-s23').addEventListener('change', renderPdUp);
    $('#pd-up-days').addEventListener('click', e => { const b = e.target.closest('[data-up-day]'); if (!b) return; $('#pd-until').value = b.dataset.upDay; markUntilPresets(); renderPdUp(); });
    $('#pd-until').addEventListener('change', renderPdUp);
    $('#player-form').addEventListener('submit', e => { e.preventDefault(); savePlayer(); });
    $('#pd-delete').onclick = async () => {
      const p = pdPlayer; if (!p) return;
      const n = (state.callups || []).filter(c => c.player_id === p.id).length;
      if (!(await askConfirm(`¿Quitar a <b>${esc(p.name)}</b> de la plantilla del ${esc(teamOf(p.team).name)}?${n ? ' También deja de ser convocable de otros equipos.' : ''}`, 'Quitar', true))) return;
      try {
        await store.players.remove(p.id);
        state.players = state.players.filter(x => x.id !== p.id); state.callups = (state.callups || []).filter(c => c.player_id !== p.id);
        $('#player-dialog').close(); toast('Jugador quitado'); renderTeams();
      } catch (ex) { toast('No se pudo quitar: ' + ex.message, true); }
    };
  }

  /** Revisa la lista pegada: cuántos se añadirían y qué falla */
  function checkBulk(team) {
    const lines = ($('#tm-bulk')?.value || '').split(/\r?\n/).map(parsePlayerLine).filter(Boolean);
    const sq = squadOf(team), errs = [], seen = new Map();
    for (const p of lines) {
      if (p.number == null) continue;
      const other = sq.find(x => x.number === p.number);
      if (other) errs.push(`el ${p.number} ya es de ${other.name}`);
      else if (seen.has(p.number)) errs.push(`el ${p.number} sale dos veces`);
      seen.set(p.number, true);
    }
    const info = $('#tm-bulk-info'), btn = $('[data-bulk-add]');
    if (info) {
      info.textContent = !lines.length ? '' : errs.length ? 'Revisa los dorsales: ' + errs.join(', ') + '.' : `Se añadirán ${plural(lines.length, 'jugador', 'jugadores')}.`;
      info.classList.toggle('err', !!errs.length);
    }
    if (btn) { btn.disabled = !lines.length || !!errs.length; btn.textContent = lines.length ? `Añadir ${lines.length}` : 'Añadir'; }
    return { lines, errs };
  }

  async function addPlayers(team, rows) {
    try {
      const added = await store.players.insertMany(rows.map(r => ({ team, number: r.number, name: r.name, sub23: !!r.sub23 })));
      state.players = [...(state.players || []), ...added];
      return true;
    } catch (e) { toast('No se pudo añadir: ' + playerErr(e), true); return false; }
  }

  function bindTeams() {
    const el = $('#teams');
    el.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-tm-week]')) { setMode('week'); return; }
      if (t.closest('[data-tm-home]')) { setMode('home'); return; }
      const op = t.closest('[data-team-open]');
      if (op) {
        state.teamOpen = op.dataset.teamOpen || null; state.bulkOpen = false; state.bulkDraft = ''; state.pickOpen = false; state.pickSel = new Set();
        renderTeams(); el.scrollTop = 0; if (state.teamOpen && !coarse()) $('#tm-name')?.focus({ preventScroll: true }); return;
      }
      // Reglas de convocables (coordinación)
      const chip = t.closest('[data-cr]');
      if (chip) {
        const [team, from] = chip.dataset.cr.split('|'), r = rulesFor(team).find(x => x.from === from);
        try {
          if (t.closest('[data-cr-s23]')) { await store.callupRules.set({ team, from, sub23: !r?.sub23 }); if (r) r.sub23 = !r.sub23; }
          else if (t.closest('[data-cr-del]')) {
            const n = callupsOf(team).filter(c => playerById(c.player_id)?.team === from && c.status !== 'rechazado').length;
            if (!(await askConfirm(`¿${esc(teamOf(team).name)} deja de poder convocar del <b>${esc(teamOf(from).name)}</b>?${n ? ` Los ${n} convocables que ya tiene se quedan, marcados como «ya no cumple las reglas».` : ''}`, 'Quitar', true))) return;
            await store.callupRules.remove(team, from);
            state.callupRules = state.callupRules.filter(x => !(x.team === team && x.from === from));
          } else return;
          renderTeams();
        } catch (ex) { toast('No se pudo cambiar la regla: ' + ex.message, true); }
        return;
      }
      const team = state.teamOpen;
      if (t.closest('[data-bulk]')) { state.bulkOpen = !state.bulkOpen; state.bulkDraft = $('#tm-bulk')?.value || ''; renderTeams(); if (state.bulkOpen) { $('#tm-bulk').focus(); checkBulk(team); } return; }
      if (t.closest('[data-bulk-add]')) {
        const { lines, errs } = checkBulk(team);
        if (!lines.length || errs.length) return;
        if (await addPlayers(team, lines)) { toast(`${plural(lines.length, 'jugador añadido', 'jugadores añadidos')}`); state.bulkOpen = false; state.bulkDraft = ''; renderTeams(); }
        return;
      }
      if (t.closest('[data-tm-copy]')) {
        const ok = callupsOf(team).filter(c => c.status === 'aprobado').map(c => playerById(c.player_id)).filter(Boolean).sort(byDorsal);
        const text = `*${TEAM[team].name.toUpperCase()}*\n` + squadOf(team).map(p => `${p.number ?? '–'}. ${p.name}${upperDay(p) ? ` (con el ${teamOf(withUpper(p)).name} el ${shortDate(upperDay(p))}${upperClash(p) ? '' : ', disponible'})` : withUpper(p) ? '' : PST[p.status] ? ` (${PST[p.status].label.toLowerCase()})` : ''}`).join('\n')
          + (ok.length ? `\n\n_Convocables_\n` + ok.map(p => `${p.number ?? '–'}. ${p.name} (${teamOf(p.team).name})`).join('\n') : '');
        try { await navigator.clipboard.writeText(text); toast('Plantilla copiada'); } catch { toast('No se ha podido copiar', true); }
        return;
      }
      // Convocables
      if (t.closest('[data-cu-pick]')) { state.pickOpen = !state.pickOpen; state.pickSel = new Set(); renderTeams(); return; }
      if (t.closest('[data-cu-add]')) {
        const ids = [...(state.pickSel || [])]; if (!ids.length) return;
        const status = isCoord() ? 'aprobado' : 'pendiente';
        try {
          const added = await store.callups.add(ids.map(player_id => ({ player_id, team, status })));
          state.callups = [...(state.callups || []), ...added];
          state.pickOpen = false; state.pickSel = new Set();
          toast(isCoord() ? `${plural(ids.length, 'convocable añadido', 'convocables añadidos')}` : `${plural(ids.length, 'convocable propuesto', 'convocables propuestos')} · falta que lo apruebe la coordinación`);
          renderTeams();
        } catch (ex) { toast('No se pudo añadir: ' + (/duplicate key/.test(ex.message) ? 'alguno ya estaba como convocable.' : /row-level security/.test(ex.message) ? 'ese jugador no cumple las reglas de convocables.' : ex.message), true); }
        return;
      }
      const po = t.closest('[data-pl-open]');
      if (po) { const p = playerById(po.dataset.plId || po.closest('[data-pl]')?.dataset.pl); if (p) openPlayer(p); return; }
      const cuRow = t.closest('[data-cu]');
      if (cuRow) {
        const c = (state.callups || []).find(x => x.id === cuRow.dataset.cu); if (!c) return;
        const set = t.closest('[data-cu-set]');
        if (set) { await setCallup(c.id, set.dataset.cuSet); return; }
        if (t.closest('[data-cu-del]')) {
          const p = playerById(c.player_id);
          if (!(await askConfirm(`¿Quitar a <b>${esc(p?.name || 'este jugador')}</b> de los convocables del ${esc(teamOf(c.team).name)}? Sigue en la plantilla de su equipo.`, 'Quitar', true))) return;
          try { await store.callups.remove(c.id); state.callups = state.callups.filter(x => x.id !== c.id); toast('Quitado de convocables'); renderTeams(); renderHomeBadge(); }
          catch (ex) { toast('No se pudo quitar: ' + ex.message, true); }
        }
        return;
      }
      const row = t.closest('[data-pl]'); if (!row) return;
      const p = playerById(row.dataset.pl); if (!p) return;
      if (t.closest('[data-pl-s23]')) {
        try { await store.players.update(p.id, { sub23: !p.sub23 }); p.sub23 = !p.sub23; renderTeams(); }
        catch (ex) { toast('No se pudo cambiar: ' + ex.message, true); }
        return;
      }
    });
    el.addEventListener('change', async e => {
      const t = e.target;
      if (t.closest('.pk-item')) { const s = state.pickSel || (state.pickSel = new Set()); t.checked ? s.add(t.value) : s.delete(t.value); const b = $('[data-cu-add]'); if (b) { const n = s.size; b.disabled = !n; b.textContent = isCoord() ? (n ? `Añadir ${n}` : 'Añadir') : (n ? `Proponer ${n} a la coordinación` : 'Proponer'); } return; }
      if (t.dataset.tsMeet) {
        const team = t.dataset.tsMeet, v = +t.value;
        try {
          await store.teamSettings.set(team, { meet_before_min: v });
          state.teamSettings = [...(state.teamSettings || []).filter(x => x.team !== team), { team, meet_before_min: v }];
          toast(`${teamOf(team).name}: quedada ${durTxt(v)} antes`);
        } catch (ex) { toast('No se pudo guardar: ' + ex.message, true); }
        return;
      }
      if (t.dataset.crAdd && t.value) {
        try { await store.callupRules.set({ team: t.dataset.crAdd, from: t.value, sub23: false }); state.callupRules = [...(state.callupRules || []), { team: t.dataset.crAdd, from: t.value, sub23: false }]; t.blur(); renderTeams(); }
        catch (ex) { toast('No se pudo añadir la regla: ' + ex.message, true); }
      }
    });
    el.addEventListener('toggle', e => { if (e.target.classList?.contains('cr-panel')) state[e.target.dataset.panel === 'meet' ? 'meetOpen' : 'rulesOpen'] = e.target.open; }, true);
    el.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, team = state.teamOpen;
      if (f.id === 'tm-add') {
        const name = $('#tm-name').value.trim().replace(/\s+/g, ' '), d = dorsalOf($('#tm-num').value);
        if (!name) return;
        if (!d.ok) { toast('El dorsal tiene que ser un número del 0 al 99', true); $('#tm-num').focus(); return; }
        const other = d.n != null && squadOf(team).find(x => x.number === d.n);
        if (other) { toast(`El ${d.n} ya lo lleva ${other.name}`, true); $('#tm-num').select(); return; }
        if (await addPlayers(team, [{ number: d.n, name, sub23: !!$('#tm-s23')?.checked }])) {
          state.bulkDraft = $('#tm-bulk')?.value || '';
          $('#tm-num').value = ''; $('#tm-name').value = ''; if ($('#tm-s23')) $('#tm-s23').checked = false;
          renderTeams(); toast(`${name} añadido`);
          const n = $('#tm-num'); if (n && !coarse()) n.focus(); else $('#tm-name')?.focus({ preventScroll: true });
        }
        return;
      }
    });
    el.addEventListener('input', e => { if (e.target.id === 'tm-bulk') { state.bulkDraft = e.target.value; checkBulk(state.teamOpen); } });
    el.addEventListener('focusout', () => setTimeout(() => { if (state.teamsStale && !el.contains(document.activeElement)) renderTeams(); }, 0));
    // Aprobar o rechazar desde Inicio
    $('#home').addEventListener('click', e => {
      const b = e.target.closest('.hc-item [data-cu-set]'); if (!b) return;
      setCallup(b.closest('[data-cu]').dataset.cu, b.dataset.cuSet);
    });
    $('#m-teams').onclick = () => { closeUserMenu(); setMode('teams'); };
  }

  function bindShare() {
    $('#share-dialog').addEventListener('input', renderShare);
    $('#share-dialog').addEventListener('change', renderShare);
    $('#sh-wa').onclick = () => sendShare('wa');
    $('#sh-maps').onclick = () => { const d = shareData(); if (!d.field && !d.town) { toast('Escribe primero el campo o la localidad', true); return; } window.open(mapsSearchUrl(d.field, d.town), '_blank', 'noopener'); };
    $('#sh-map-paste').onclick = async () => { try { const t = (await navigator.clipboard.readText()).trim(); const u = (t.match(/https:\/\/\S+/) || [])[0]; if (!u) { toast('No hay ningún enlace copiado', true); return; } $('#sh-map').value = u; renderShare(); toast('Enlace pegado'); } catch { $('#sh-map').focus(); toast('Mantén pulsada la casilla y elige Pegar', true); } };
    $('#sh-copy').onclick = () => sendShare('copy');
    $('#sh-save').onclick = async () => { if (await saveShare()) $('#share-dialog').close(); };
    $('#d-body').addEventListener('click', async e => {
      const ch = e.target.dataset?.dComm; if (!ch) return;
      const b = state.bookings.find(x => x.id === $('#detail-dialog').dataset.id); if (!b) return;
      try { await markCommunicated([b], ch); $('#detail-dialog').close(); openDetail(b); } catch (ex) { toast('No se pudo marcar: ' + ex.message, true); }
    });
    $$('#f-comm, #f-comm-board').forEach(x => x.addEventListener('change', e => { e.target.dataset.touched = '1'; }));
    $('#d-body').addEventListener('click', e => { if (e.target.id === 'd-share') { const b = state.bookings.find(x => x.id === $('#detail-dialog').dataset.id); $('#detail-dialog').close(); if (b) openShare(b); } });
    $('#f-share').onclick = () => { const b = state.bookings.find(x => x.id === editingId); if (!b) return; $('#booking-dialog').close(); openShare(b); };
  }

  async function goToBooking(id, day) {
    $('#matches-dialog').close();
    state.filter = null;
    if (isTpl() || isHome()) state.mode = 'week';
    state.dayIndex = dayIndexOf(day);
    await setWeek(parseKey(day));
    focusBooking(id);
  }

  function openPeople(tab) {
    closeUserMenu();
    if (tab) state.peopleTab = tab;
    else state.peopleTab = state.people.some(p => p.status === 'pendiente') ? 'pendiente' : 'invitaciones';
    renderPeople();
    $('#people-dialog').showModal();
    loadPeople();
  }

  function renderPeople() {
    const tab = state.peopleTab;
    $$('#people-tabs button').forEach(b => { const on = b.dataset.pt === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const pend = state.people.filter(p => p.status === 'pendiente').length;
    $('#pt-pend').innerHTML = pend ? `<span class="pill err">${pend}</span>` : '';
    $('#people-tabs [data-pt="pendiente"]').hidden = !pend;
    if (tab === 'invitaciones') return renderInvites();
    const list = state.people.filter(p => p.status === tab);
    const me = state.user?.id;
    const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
    const empty = { pendiente: 'No hay solicitudes pendientes.', aprobado: 'Todavía no hay nadie con acceso. Invita a los entrenadores desde «Invitar».', rechazado: 'No hay nadie sin acceso.' }[tab];
    $('#people-body').innerHTML = list.length ? list.map(p => {
      const self = p.id === me;
      const teams = p.teams || [];
      const changed = tab === 'pendiente' && (p.requested_teams || []).join() !== teams.join();
      const actions = {
        pendiente: `<button type="button" class="danger" data-pa="reject">Rechazar</button><button type="button" class="primary" data-pa="approve">Aceptar</button>`,
        aprobado: self ? '<span class="p-self">Eres tú</span>' : `<select data-pa="role" aria-label="Rol de ${esc(p.full_name || p.email)}"><option value="entrenador" ${p.role === 'entrenador' ? 'selected' : ''}>Entrenador</option><option value="coordinador" ${p.role === 'coordinador' ? 'selected' : ''}>Coordinador</option></select><button type="button" class="danger" data-pa="revoke">Quitar acceso</button>`,
        rechazado: `<button type="button" class="ghost" data-pa="approve">Devolver acceso</button>`,
      }[tab];
      return `<article class="person" data-id="${esc(p.id)}">
        <div class="p-head"><span class="avatar">${esc(initials(p.full_name || p.email))}</span>
          <div class="p-who"><b>${esc(p.full_name || '(sin nombre)')}</b><span>${esc(p.email || '')}</span></div>
          <span class="p-date">${tab === 'pendiente' ? 'Solicitado' : 'Desde'} ${fmtDate(tab === 'pendiente' ? p.created_at : (p.reviewed_at || p.created_at))}</span></div>
        ${(() => {
          const coordRow = p.role === 'coordinador' && tab === 'aprobado';
          const lbl = coordRow ? 'Equipos a su cargo' : tab === 'pendiente' ? 'Equipos que pide' + (changed ? ' (modificados)' : '') : 'Equipos';
          return `<div class="p-teams"><span class="lbl">${lbl}</span>
          <div class="team-pick small">${TEAMS.map(t => `<button type="button" class="chip ${teams.includes(t.id) ? 'on' : ''}" data-pt-team="${t.id}" style="--c:${t.color}" aria-pressed="${teams.includes(t.id)}" ${self && !coordRow ? 'disabled' : ''}><span class="dot"></span>${esc(t.short)}</button>`).join('')}</div>
          ${coordRow ? `<p class="p-note">Coordinador: puede editar todo el club. ${teams.length ? 'Sus avisos, confirmaciones y comunicaciones son los de estos equipos.' : 'Sin equipos marcados, se ocupa de todo el club.'}</p>` : ''}</div>`;
        })()}
        <div class="p-actions">${actions}</div>
      </article>`;
    }).join('') : `<p class="people-empty">${empty}</p>`;
  }

  // ---- Invitaciones ----
  function inviteState(i) {
    if (i.revoked) return { key: 'off', text: 'Anulada' };
    if (i.uses >= i.max_uses) return { key: 'used', text: i.max_uses > 1 ? `Usada (${i.uses}/${i.max_uses})` : 'Usada' };
    if (new Date(i.expires_at) <= new Date()) return { key: 'off', text: 'Caducada' };
    const d = new Date(i.expires_at);
    return { key: 'on', text: `Activa · caduca el ${d.getDate()} ${MONTHS[d.getMonth()]}${i.max_uses > 1 ? ` · ${i.uses}/${i.max_uses} usos` : ''}` };
  }

  function inviteMessage(i) {
    const teams = (i.teams || []).map(t => teamOf(t).name);
    const who = i.label && !/coordinador/i.test(i.label) ? ` ${i.label.split(/\s+/)[0]}` : '';
    const what = i.role === 'coordinador' ? `como coordinador${teams.length ? ' de ' + teams.join(', ') : ''}` : teams.length ? `como entrenador de ${teams.join(', ')}` : 'como entrenador';
    return `Hola${who}. Te invito al planificador del campo del ${CFG.CLUB_NAME || 'club'} ${what}. Crea tu cuenta desde este enlace: ${inviteLink(i.token)}`;
  }

  function renderInvites() {
    const d = state.inviteDraft;
    const coord = d.role === 'coordinador';
    const list = [...state.invites].sort((a, b) => (inviteState(a).key === 'on' ? 0 : 1) - (inviteState(b).key === 'on' ? 0 : 1));
    $('#people-body').innerHTML = `
      <form class="inv-form" id="inv-form" novalidate>
        <p class="inv-intro">Crea un enlace y envíalo por WhatsApp. Quien lo abra crea su cuenta y entra directamente, con el rol y los equipos que marques aquí.</p>
        <div class="inv-row">
          <div class="field"><label for="inv-label">Para (opcional)</label><input id="inv-label" type="text" maxlength="80" placeholder="Nombre del entrenador" value="${esc(d.label)}"></div>
          <div class="field"><span class="lbl">Rol</span>
            <div class="segmented small" id="inv-role"><button type="button" data-v="entrenador" class="${coord ? '' : 'on'}">Entrenador</button><button type="button" data-v="coordinador" class="${coord ? 'on' : ''}">Coordinador</button></div></div>
        </div>
        ${`<div class="field"><span class="lbl">${coord ? 'Equipos a su cargo <small>(sin marcar = todo el club)</small>' : 'Equipos'}</span>
          <div class="team-pick small">${TEAMS.map(t => `<button type="button" class="chip ${d.teams.includes(t.id) ? 'on' : ''}" data-inv-team="${t.id}" style="--c:${t.color}" aria-pressed="${d.teams.includes(t.id)}"><span class="dot"></span>${esc(t.short)}</button>`).join('')}</div></div>`}
        <div class="inv-row">
          <div class="field"><label for="inv-uses">Lo pueden usar</label>
            <select id="inv-uses">${[[1, '1 persona'], [2, '2 personas'], [3, '3 personas'], [5, '5 personas'], [10, '10 personas']].map(([v, l]) => `<option value="${v}" ${d.max_uses === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="inv-days">Caduca en</label>
            <select id="inv-days">${[[1, '1 día'], [7, '7 días'], [30, '30 días']].map(([v, l]) => `<option value="${v}" ${d.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <button type="submit" class="primary">Crear enlace de invitación</button>
      </form>
      <h4 class="inv-h">Enlaces creados</h4>
      ${list.length ? list.map(i => {
        const st = inviteState(i);
        const teams = (i.teams || []).map(t => `<span class="mini-chip" style="--c:${teamOf(t).color}">${esc(teamOf(t).short)}</span>`).join(' ');
        const active = st.key === 'on';
        return `<article class="invite ${active ? '' : 'inactive'} ${i.id === state.newInviteId ? 'fresh' : ''}" data-inv="${esc(i.id)}">
          <div class="inv-top"><b>${esc(i.label || (i.role === 'coordinador' ? 'Coordinador' : 'Sin nombre'))}</b>
            <span class="inv-st ${st.key}">${st.text}</span></div>
          <div class="inv-meta">${i.role === 'coordinador' ? '<span class="mini-chip coord-chip">Coordinador</span>' : (teams || '<span class="muted">Sin equipos</span>')}</div>
          ${active ? `<div class="inv-link"><input type="text" readonly value="${esc(inviteLink(i.token))}" aria-label="Enlace de invitación">
            <div class="inv-actions">
              <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(inviteMessage(i))}" target="_blank" rel="noopener">WhatsApp</a>
              <button type="button" class="ghost" data-ia="copy">Copiar</button>
              ${store.mode === 'demo' ? '<button type="button" class="ghost" data-ia="try">Probar</button>' : ''}
              <button type="button" class="danger" data-ia="revoke">Anular</button>
            </div></div>` : ''}
        </article>`;
      }).join('') : '<p class="people-empty">Aún no has creado ningún enlace.</p>'}`;
  }

  function bindInvites() {
    const body = $('#people-body');
    body.addEventListener('click', async e => {
      if (state.peopleTab !== 'invitaciones') return;
      const d = state.inviteDraft;
      const role = e.target.closest('#inv-role button')?.dataset.v;
      if (role) { d.label = $('#inv-label').value; d.role = role; return renderInvites(); }
      const chip = e.target.closest('[data-inv-team]');
      if (chip) {
        const t = chip.dataset.invTeam;
        d.teams = d.teams.includes(t) ? d.teams.filter(x => x !== t) : TEAMS.map(x => x.id).filter(x => x === t || d.teams.includes(x));
        const on = d.teams.includes(t); chip.classList.toggle('on', on); chip.setAttribute('aria-pressed', String(on));
        return;
      }
      const card = e.target.closest('[data-inv]'); if (!card) return;
      const inv = state.invites.find(i => i.id === card.dataset.inv); if (!inv) return;
      const act = e.target.closest('[data-ia]')?.dataset.ia;
      if (act === 'copy') {
        const input = card.querySelector('input');
        try { await navigator.clipboard.writeText(inviteMessage(inv)); toast('Mensaje con el enlace copiado'); }
        catch { input.focus(); input.select(); toast('Enlace seleccionado: cópialo con el menú del navegador'); }
      }
      if (act === 'revoke') {
        if (!(await askConfirm(`¿Anular este enlace? Quien no lo haya usado ya no podrá registrarse con él.`, 'Anular enlace', true))) return;
        try { await store.invites.revoke(inv.id); inv.revoked = true; renderInvites(); toast('Enlace anulado'); }
        catch (ex) { toast('No se pudo anular: ' + ex.message, true); }
      }
      if (act === 'try') {
        $('#people-dialog').close();
        await store.auth.signOut(); applySession(null);
        state.inviteToken = inv.token; showInvite();
        toast('Demo: así ve el enlace la persona invitada');
      }
    });
    body.addEventListener('change', e => {
      if (e.target.id === 'inv-uses') state.inviteDraft.max_uses = +e.target.value;
      if (e.target.id === 'inv-days') state.inviteDraft.days = +e.target.value;
    });
    body.addEventListener('input', e => { if (e.target.id === 'inv-label') state.inviteDraft.label = e.target.value; });
    body.addEventListener('submit', async e => {
      if (e.target.id !== 'inv-form') return;
      e.preventDefault();
      const d = state.inviteDraft;
      d.label = $('#inv-label').value.trim();
      if (d.role === 'entrenador' && !d.teams.length && !(await askConfirm('No has marcado ningún equipo. Podrá ver el calendario, pero no tendrá incidencias propias.', 'Crear igualmente'))) return;
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const inv = await store.invites.create({ label: d.label, role: d.role, teams: d.teams, max_uses: d.max_uses, days: d.days });
        state.invites.unshift(inv); state.newInviteId = inv.id;
        state.inviteDraft = { label: '', role: 'entrenador', teams: [], max_uses: 1, days: 7 };
        renderInvites();
        $('#people-body').querySelector('.invite.fresh')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        toast('Enlace creado: envíalo por WhatsApp o cópialo');
      } catch (ex) { toast('No se pudo crear el enlace: ' + ex.message, true); btn.disabled = false; }
    });
  }

  async function updatePerson(id, patch, okMsg) {
    try {
      await store.people.update(id, patch);
      Object.assign(state.people.find(p => p.id === id) || {}, patch);
      if (id === state.user?.id && state.profile) { Object.assign(state.profile, patch); render(); if (isCoord()) loadHome(); }
      renderPeople(); renderUser();
      if (okMsg) toast(okMsg);
    } catch (e) { toast('No se pudo guardar: ' + e.message, true); loadPeople(); }
  }

  function bindPeople() {
    $('#people-tabs').addEventListener('click', e => { const t = e.target.closest('button[data-pt]'); if (t) { state.peopleTab = t.dataset.pt; renderPeople(); } });
    const body = $('#people-body');
    body.addEventListener('click', async e => {
      const card = e.target.closest('.person'); if (!card) return;
      const p = state.people.find(x => x.id === card.dataset.id); if (!p) return;
      const who = p.full_name || p.email;
      const chip = e.target.closest('[data-pt-team]');
      if (chip && !chip.disabled) {
        const t = chip.dataset.ptTeam;
        const teams = (p.teams || []).includes(t) ? p.teams.filter(x => x !== t) : [...(p.teams || []), t];
        const ordered = TEAMS.map(x => x.id).filter(x => teams.includes(x));
        return updatePerson(p.id, { teams: ordered }, p.status === 'aprobado' ? `Equipos de ${who} actualizados` : null);
      }
      const act = e.target.closest('button[data-pa]')?.dataset.pa;
      const reviewed = { reviewed_at: new Date().toISOString(), reviewed_by: state.user?.id || null };
      if (act === 'approve') {
        if (p.role !== 'coordinador' && !(p.teams || []).length && !(await askConfirm(`${who} no tiene ningún equipo marcado. Verá el calendario, pero no recibirá incidencias propias.`, 'Aceptar igualmente'))) return;
        return updatePerson(p.id, { status: 'aprobado', ...reviewed }, `${who} ya tiene acceso`);
      }
      if (act === 'reject') {
        if (!(await askConfirm(`¿Rechazar la solicitud de ${who}? No podrá entrar. Podrás darle acceso más tarde desde «Rechazados».`, 'Rechazar', true))) return;
        return updatePerson(p.id, { status: 'rechazado', ...reviewed }, `Solicitud de ${who} rechazada`);
      }
      if (act === 'revoke') {
        if (!(await askConfirm(`¿Quitar el acceso a ${who}? Dejará de ver el calendario.`, 'Quitar acceso', true))) return;
        return updatePerson(p.id, { status: 'rechazado', ...reviewed }, `${who} ya no tiene acceso`);
      }
    });
    body.addEventListener('change', async e => {
      if (e.target.dataset.pa !== 'role') return;
      const card = e.target.closest('.person');
      const p = state.people.find(x => x.id === card.dataset.id);
      const role = e.target.value;
      if (role === 'coordinador' && !(await askConfirm(`${p.full_name || p.email} podrá editar el calendario y gestionar entrenadores.`, 'Hacer coordinador'))) { e.target.value = p.role; return; }
      updatePerson(p.id, { role }, role === 'coordinador' ? 'Ahora es coordinador' : 'Ahora es entrenador');
    });
  }

  // ================================================================
  //  Menú de usuario y tutorial
  // ================================================================
  function closeUserMenu() { $('#user-pop').hidden = true; $('#user-btn').setAttribute('aria-expanded', 'false'); }

  function tutorialKey() { return 'tutorial-visto:' + (state.user?.id || 'anon'); }
  function startTutorial(onlySince = 0) {
    closeUserMenu();
    if (!window.Tutorial) return;
    if (window.innerWidth < 1000) { $('#side').classList.remove('open'); $('#side-backdrop').hidden = true; }
    window.Tutorial.start({
      role: state.role, onlySince,
      onEnd: () => { try { localStorage.setItem(tutorialKey(), String(window.Tutorial.VERSION)); } catch { } setTimeout(maybeInstall, 1500); },
    });
  }
  function maybeTutorial() {
    if (!window.Tutorial) return;
    let seen = 0;
    try { seen = parseInt(localStorage.getItem(tutorialKey()) || '0', 10) || 0; } catch { }
    if (seen < window.Tutorial.VERSION) setTimeout(() => startTutorial(seen), 400);
    else setTimeout(maybeInstall, 2500);
  }

  // ---------- Sugerir instalar la app (pantalla de inicio) ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; refreshInstallItem(); });
  window.addEventListener('appinstalled', () => { installEvt = null; hideInstall(); refreshInstallItem(); });
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canSuggestInstall = () => !isStandalone() && (!!installEvt || isIOS());
  const INSTALL_KEY = 'instalar-descartado';
  function refreshInstallItem() { const m = $('#m-install'); if (m) m.hidden = !canSuggestInstall(); }
  function maybeInstall() {
    if (!appOpen || !canSuggestInstall() || $('.tt-root')) return;
    let until = 0;
    try { until = parseInt(localStorage.getItem(INSTALL_KEY) || '0', 10) || 0; } catch { }
    if (Date.now() < until) return;
    showInstall();
  }
  function showInstall() {
    closeUserMenu();
    const card = $('#install-card');
    const ios = !installEvt && isIOS();
    const chromeIOS = /CriOS/.test(navigator.userAgent);
    $('#install-text').innerHTML = ios
      ? `Añádela a la pantalla de inicio para entrar de un toque, a pantalla completa:<ol><li>Pulsa <b>Compartir</b> <span class="ios-share" aria-hidden="true"></span>${chromeIOS ? ' (arriba, junto a la barra de direcciones)' : ''}.</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li></ol>`
      : 'Instálala en este dispositivo para entrar de un toque, a pantalla completa y con el escudo como icono.';
    $('#install-go').hidden = ios;
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('on'));
  }
  function hideInstall(days) {
    const card = $('#install-card');
    card.classList.remove('on');
    setTimeout(() => { card.hidden = true; }, 200);
    if (days) try { localStorage.setItem(INSTALL_KEY, String(Date.now() + days * 864e5)); } catch { }
  }
  async function doInstall() {
    if (!installEvt) return;
    const e = installEvt; installEvt = null;
    e.prompt();
    const r = await e.userChoice.catch(() => null);
    hideInstall(r?.outcome === 'accepted' ? 0 : 14);
    refreshInstallItem();
  }

  // ================================================================
  //  Eventos
  // ================================================================
  function bind() {
    bindHome();
    bindShare();
    bindTeams();
    bindPlayerDialog();
    bindShortcuts();
    bindNotifications();
    $('#d-body').addEventListener('click', e => { if (e.target.id === 'd-rem') { const b = state.bookings.find(x => x.id === $('#detail-dialog').dataset.id); $('#detail-dialog').close(); if (b) reminderFromBooking(b); } });
    $('#f-rem').onclick = () => { const b = state.bookings.find(x => x.id === editingId); if (!b) return; $('#booking-dialog').close(); reminderFromBooking(b); };
    $('#install-go').onclick = doInstall;
    $('#install-later').onclick = () => hideInstall(14);
    $('#install-close').onclick = () => hideInstall(14);
    $('#m-install').onclick = showInstall;
    refreshInstallItem();
    $('#prev-week').onclick = () => setWeek(addDays(state.weekStart, -7));
    $('#next-week').onclick = () => setWeek(addDays(state.weekStart, 7));
    $('#today-btn').onclick = () => { state.dayIndex = (new Date().getDay() + 6) % 7; setWeek(new Date()); };
    $('#view-toggle').onclick = e => { const v = e.target.closest('button')?.dataset.view; if (v) { state.view = v; render(); } };
    $('#day-tabs').onclick = e => { const d = e.target.closest('button')?.dataset.day; if (d != null) { state.dayIndex = +d; render(); } };
    $('#legend').onclick = e => { const t = e.target.closest('.chip')?.dataset.team; if (t) { state.filter = state.filter === t ? null : t; $('#legend').classList.remove('pop-open'); $('#legend-btn').setAttribute('aria-expanded', 'false'); render(); } };
    $('#print-btn').onclick = () => window.print();
    $('#edit-toggle').onchange = e => { state.edit = e.target.checked; render(); };
    $('#new-btn').onclick = () => {
      const i = state.view === 'day' ? state.dayIndex : ((new Date().getDay() + 6) % 7);
      openEditor(newDraft(keyOf(addDays(state.weekStart, i)), toMin('17:00'), 'A'), true);
    };
    $('#copy-week-btn').onclick = copyPrevWeek;

    // Menú de usuario
    $('#user-btn').onclick = e => {
      e.stopPropagation();
      const pop = $('#user-pop'), open = pop.hidden;
      pop.hidden = !open; $('#user-btn').setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', e => { if (!e.target.closest('.user-menu')) closeUserMenu(); if (!e.target.closest('#legend, #legend-btn')) setLegend(false); });
    $('#m-people').onclick = () => openPeople();
    $('#m-matches').onclick = () => openMatches();
    $('#matches-btn').onclick = () => openMatches();
    $('#mx-team').onchange = e => loadMatches(e.target.value);
    $('#mx-tabs').onclick = e => { const t = e.target.closest('button')?.dataset.mx; if (t) setMatchesTab(t); };
    $('#m-weekend').onclick = () => openMatches('weekend');
    $('#msg-copy').onclick = copyWeekMessage;
    $('#msg-share').onclick = async () => { try { await navigator.share({ text: $('#msg-text').value }); weekMessageSent(); } catch { } };
    $('#msg-wa').onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent($('#msg-text').value), '_blank', 'noopener'); weekMessageSent(); };
    $('#mx-body').onclick = e => { const m = e.target.closest('[data-msg]'); if (m) { openWeekMessage(m.dataset.msg); return; } const r = e.target.closest('.mx-row, .mx-grid .mx-cell'); if (r) goToBooking(r.dataset.id, r.dataset.day); };
    $('#people-btn').onclick = () => openPeople();
    $('#m-copy').onclick = () => { closeUserMenu(); copyPrevWeek(); };
    $('#m-clear').onclick = clearWeekEvents;
    $('#clear-week-btn').onclick = clearWeekEvents;
    $('#m-help').onclick = () => startTutorial(0);
    $('#help-btn').onclick = () => startTutorial(0);
    $('#m-logout').onclick = async () => { closeUserMenu(); await store.auth.signOut(); applySession(null); showAuth('login'); toast('Sesión cerrada'); };
    $('#banner-close').onclick = () => { $('#banner').hidden = true; try { sessionStorage.setItem('banner-oculto', '1'); } catch { } };
    $('#issue-scope').onclick = () => { state.issueScope = state.issueScope === 'mine' ? 'all' : 'mine'; render(); };

    // Lista de equipos plegable en móvil
    const setLegend = open => { $('#legend').classList.toggle('pop-open', open); $('#legend-btn').setAttribute('aria-expanded', String(open)); };
    $('#legend-btn').onclick = e => { e.stopPropagation(); setLegend(!$('#legend').classList.contains('pop-open')); };

    // Calendario: bloques y huecos
    const cal = $('#calendar');
    cal.addEventListener('pointerdown', e => {
      const block = e.target.closest('.block');
      if (!block) return;
      if (isEditor()) { onBlockPointerDown(e, block); return; }
      // Sin permisos: si intenta arrastrar, explica cómo habilitarlo
      const x0 = e.clientX, y0 = e.clientY;
      const mv = ev => {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
        window.removeEventListener('pointermove', mv);
        if (isCoord()) { toast('Activa «Modo edición» para mover las reservas'); $('.switch').classList.add('pulse'); setTimeout(() => $('.switch').classList.remove('pulse'), 1500); }
        else toast('Solo la coordinación puede mover reservas. Pulsa una reserva para ver su detalle.');
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true });
    });
    cal.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) return;
      const block = e.target.closest('.block');
      if (block) {
        if (!isEditor()) { const b = state.bookings.find(x => x.id === block.dataset.id); if (b) openDetail(b); }
        return;
      }
      const head = e.target.closest('.day-head');
      if (head && state.view === 'week') { state.view = 'day'; state.dayIndex = +head.dataset.day; render(); return; }
      const col = e.target.closest('.day-col');
      if (col && isEditor()) {
        const r = col.getBoundingClientRect();
        const m = clamp(Math.floor(((e.clientY - r.top) / PX + DAY_START) / 15) * 15, DAY_START, DAY_END - 15);
        const lane = clamp(Math.floor((e.clientX - r.left) / (r.width * fieldW(col.dataset.key) / 100) * 4), 0, 3);
        openEditor(newDraft(col.dataset.key, m, lane < 2 ? 'A' : 'B'), true);
      }
    });

    // Pestañas Resumen / Cómo leer
    $('.ptabs').addEventListener('click', e => {
      const t = e.target.closest('button[data-tab]'); if (!t) return;
      $$('.ptabs button').forEach(b => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      $$('.tabpane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t.dataset.tab));
    });

    // Panel lateral como cajón en pantallas estrechas
    const setSide = open => {
      $('#side').classList.toggle('open', open);
      $('#side-backdrop').hidden = !open;
      $('#side-toggle').setAttribute('aria-expanded', String(open));
    };
    $('#summary-toggle').onclick = () => {
      state.summaryOpen = !state.summaryOpen;
      $('#side').classList.toggle('show-summary', state.summaryOpen);
      $('#summary-toggle').setAttribute('aria-expanded', String(state.summaryOpen));
      $('#summary-toggle').textContent = state.summaryOpen ? 'Ocultar resumen y leyenda' : 'Ver resumen y leyenda';
    };
    $('#side-toggle').onclick = () => setSide(!$('#side').classList.contains('open'));
    $('#side-close').onclick = () => setSide(false);
    $('#side-backdrop').onclick = () => setSide(false);

    // Incidencias
    $('#issues').addEventListener('click', e => {
      if (e.target.closest('[data-minor]')) { state.minorOpen = !state.minorOpen; renderIssues(); return; }
      const ab = e.target.closest('[data-ack]'); if (ab) { onAck(ab); return; }
      const li = e.target.closest('li[data-n]'); if (!li) return;
      setSide(false);
      const it = state.issues.all[+li.dataset.n]; if (!it) return;
      if (it.ids.length) return focusBooking(it.ids[0]);
      const t = it.tplId && state.template.find(x => x.id === it.tplId);
      if (t && isEditor()) openEditor({ ...tplToBooking(t), id: undefined, template_id: t.id }, true);
      else if (state.view === 'day') { state.dayIndex = dayIndexOf(it.day); render(); }
    });
    $('#issues').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.click(); });

    // Diálogos
    $$('dialog').forEach(d => {
      d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    });

    // Formulario de reserva
    const form = $('#booking-form');
    form.addEventListener('submit', e => { e.preventDefault(); saveDraft(); });
    $('#f-team').addEventListener('change', () => {
      readInputs();
      const t = teamOf(draft.team);
      if (draft.kind === 'partido' && t.match) { draft.format = t.match.format; draft.zone = t.match.format === 'F11' ? 'full' : 'A'; }
      syncForm();
    });
    $('#f-kind').addEventListener('click', e => {
      const v = e.target.closest('button')?.dataset.v; if (!v || e.target.closest('button').disabled) return;
      readInputs(); draft.kind = v;
      if (v === 'evento') { draft.zone = 'full'; draft.duration_min = draft.duration_min || 120; setTimeout(() => $('#f-ev-title').focus(), 0); }
      if (v === 'partido') { const m = teamOf(draft.team).match; draft.format = m?.format || 'F11'; draft.zone = draft.format === 'F11' ? 'full' : (draft.zone?.startsWith('B') ? 'B' : 'A'); }
      syncForm();
    });
    $('#f-format').addEventListener('click', e => {
      const v = e.target.closest('button')?.dataset.v; if (!v) return;
      readInputs(); draft.format = v; draft.zone = v === 'F11' ? 'full' : (draft.zone?.startsWith('B') ? 'B' : 'A'); syncForm();
    });
    $('#f-zone').addEventListener('click', e => {
      const v = e.target.closest('button')?.dataset.v; if (!v) return;
      readInputs(); draft.zone = v; syncForm();
    });
    ['#f-date', '#f-start', '#f-dur', '#f-opp', '#f-notes'].forEach(s => $(s).addEventListener('input', () => { readInputs(); renderPreview(); }));
    // Al salir del campo, muestra la hora/duración ya redondeadas a 15 min
    $('#f-start').addEventListener('change', () => { readInputs(); $('#f-start').value = fmt(draft.start_min); renderPreview(); });
    $('#f-where').addEventListener('click', e => {
      const v = e.target.closest('button')?.dataset.v; if (!v) return;
      readInputs(); draft.away = v === 'fuera'; if (draft.away) draft.zone = 'full'; syncForm();
    });
    $('#f-rival').addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (v) { draft.rival_status = v; rivalTouched = true; renderRival(); } });
    // Si cambia el día o la hora de un partido, la aprobación del rival vuelve a pendiente (salvo que la marques tú)
    ['#f-date', '#f-start'].forEach(sel => $(sel).addEventListener('change', () => {
      const orig = editingId && state.bookings.find(x => x.id === editingId);
      if (draft.kind === 'partido' && orig && !rivalTouched && (draft.day !== orig.day || draft.start_min !== orig.start_min)) { draft.rival_status = 'pendiente'; renderRival(); }
    }));
    $('#f-dur').addEventListener('change', () => { readInputs(); $('#f-dur').value = draft.duration_min; renderPreview(); });
    $('#f-delete').onclick = deleteDraft;
    $('#f-props').addEventListener('click', onProposalClick);
    document.addEventListener('change', e => {
      if (e.target.matches('[data-pf=slot]')) e.target.parentElement.querySelector('[data-pf=time]').hidden = e.target.value !== 'exact';
    });
    $('#detail-dialog').addEventListener('click', e => { const ab = e.target.closest('[data-ack]'); if (ab) onAck(ab); });
    $('#detail-dialog').addEventListener('click', e => { const box = e.target.closest('#d-props'); if (box) onProposalClick({ currentTarget: box, target: e.target }); });
    $('#confirm-week').onclick = confirmWeekMatches;
    $('#m-confirm').onclick = confirmWeekMatches;
    $('#f-weekday').addEventListener('change', () => { readInputs(); renderPreview(); });
    $('#f-hab').addEventListener('click', e => {
      if (e.target.id !== 'f-restore') return;
      const t = state.template.find(x => x.id === draft.template_id); if (!t) return;
      readInputs();
      Object.assign(draft, { team: t.team, day: keyOf(addDays(mondayOf(parseKey(draft.day)), t.weekday)), start_min: t.start_min, duration_min: t.duration_min, zone: t.zone });
      syncForm();
    });
    $('#mode-toggle').addEventListener('click', e => { const m = e.target.closest('button')?.dataset.mode; if (m) setMode(m); });
    $('#m-mode').onclick = () => setMode(isTpl() ? 'week' : 'template');
    $('#week-strip').addEventListener('click', e => {
      const a = e.target.closest('[data-strip]')?.dataset.strip;
      if (a === 'week') setMode('week');
      if (a === 'apply') applyTemplateWeek();
    });
    $('#f-dup').onclick = () => { readInputs(); openEditor({ ...draft, id: undefined }, true); toast('Copia creada: ajusta día u hora y guarda'); };

    document.addEventListener('keydown', e => {
      if (e.target.closest('input, select, textarea, dialog')) return;
      if (e.key === 'ArrowLeft' && e.altKey) setWeek(addDays(state.weekStart, -7));
      if (e.key === 'ArrowRight' && e.altKey) setWeek(addDays(state.weekStart, 7));
      if (e.key === 'Escape' && state.selectedId) { state.selectedId = null; render(); }
    });

    let resizeT;
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (window.innerWidth < 820 && state.view === 'week') { state.view = 'day'; render(); } }, 200); });
  }

  // ================================================================
  //  Inicio
  // ================================================================
  // Bloquea el zoom (pellizco, doble toque y Ctrl + rueda / teclas)
  function lockZoom() {
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
    document.addEventListener('touchmove', e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
    let lastTouch = 0;
    document.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouch < 300 && !e.target.closest('input, select, textarea')) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
    window.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault(); });
  }

  // ---- Versión: si se publica una nueva, la página se recarga sola ----
  const APP_VERSION = '20261030125316';
  // Actualizaciones: si hay versión nueva, recarga pidiendo la página con una URL nueva (?v=) para
  // saltarse la caché del navegador y de GitHub Pages. Si se está editando, avisa y espera.
  let pendingVersion = null;
  const busy = () => !!drag || $$('dialog[open]').length > 0;
  function reloadTo(v) {
    let n = 0; try { n = parseInt(sessionStorage.getItem('recarga:' + v) || '0', 10) || 0; sessionStorage.setItem('recarga:' + v, String(n + 1)); } catch { }
    if (n >= 3) return;   // evita bucles si el servidor aún entrega la versión anterior
    const u = new URL(location.href);
    u.searchParams.set('v', v);
    location.replace(u.toString());
  }
  function showUpdateBar(v) {
    const bar = $('#update-bar');
    if (!bar || !bar.hidden) return;
    bar.hidden = false;
    try { bar.showPopover?.(); } catch { }   // por encima de las ventanas abiertas
    $('#update-now').onclick = () => reloadTo(v);
  }
  // Número de versión visible en la cabecera (la versión es la fecha de publicación en UTC: AAAAMMDDhhmmss)
  function showVersion() {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(APP_VERSION);
    let short = APP_VERSION, long = APP_VERSION;
    if (m) {
      const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
      short = `v${pad(d.getDate())}.${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      long = `Versión ${APP_VERSION}, publicada el ${d.getDate()} de ${MONTHS_LONG[d.getMonth()].toLowerCase()} de ${d.getFullYear()} a las ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const el = $('#app-ver'); if (el) { el.textContent = short; el.title = long; }
    const top = $('#app-ver-top'); if (top) { top.innerHTML = esc(short).replace(' · ', '<br>'); top.title = long; }
    const up = $('#up-ver'); if (up) up.textContent = long;
  }

  async function checkVersion() {
    if (store?.mode === 'demo') return;
    try {
      const r = await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.text()).trim();
      if (!v || v === APP_VERSION) return;
      pendingVersion = v;
      if (busy()) { showUpdateBar(v); return; }
      toast('Hay una versión nueva. Actualizando…');
      setTimeout(() => reloadTo(v), 600);
    } catch { /* sin conexión */ }
  }
  function watchVersion() {
    // Limpia el ?v= de la dirección (se mantiene la #semana)
    try { const u = new URL(location.href); if (u.searchParams.has('v')) { u.searchParams.delete('v'); history.replaceState(null, '', u.pathname + u.search + u.hash); } } catch { }
    checkVersion();
    const again = () => { if (document.visibilityState === 'visible') checkVersion(); };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pageshow', e => { if (e.persisted) checkVersion(); });   // vuelta desde la caché del navegador / app reanudada
    window.addEventListener('focus', again);
    window.addEventListener('online', checkVersion);
    setInterval(again, 2 * 60 * 1000);
    // Si había una versión pendiente mientras se editaba, se aplica al cerrar la ventana
    $$('dialog').forEach(d => d.addEventListener('close', () => { if (pendingVersion) setTimeout(checkVersion, 300); }));
  }

  async function init() {
    lockZoom();
    // Mientras se arrastra una reserva con el dedo, el calendario no debe desplazarse
    document.addEventListener('touchmove', e => { if (drag && drag.armed) e.preventDefault(); }, { passive: false });

    // Móvil (vista de día): deslizar a izquierda/derecha cambia de día; al pasar del domingo o del lunes, cambia de semana
    let sw = null;
    const wrap = $('#cal-wrap');
    wrap.addEventListener('touchstart', e => {
      sw = state.view === 'day' && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    }, { passive: true });
    wrap.addEventListener('touchmove', e => { if (sw && e.touches.length > 1) sw = null; }, { passive: true });
    wrap.addEventListener('touchend', e => {
      const s0 = sw; sw = null;
      if (!s0 || state.view !== 'day' || (drag && drag.armed) || $('.block.lifted')) return;
      const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y;
      if (Date.now() - s0.t > 800 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      stepDay(dx < 0 ? 1 : -1);
    }, { passive: true });
    $('#club-name').textContent = CFG.CLUB_NAME || 'Campo';
    $('#auth-club').textContent = CFG.CLUB_NAME || 'Campo';
    document.title = `${CFG.CLUB_NAME || 'Campo'} · Planificador`;
    fillTeamSelect();
    const m = location.hash.match(/semana=(\d{4}-\d{2}-\d{2})/);
    if (m) state.weekStart = mondayOf(parseKey(m[1]));

    const banner = $('#banner');
    const showBanner = (html, error) => { banner.hidden = false; banner.classList.toggle('error', !!error); $('#banner-text').innerHTML = html; };
    try {
      store = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY ? await makeSupabaseStore() : makeLocalStore();
    } catch (e) {
      showBanner('No se pudo conectar con la base de datos (' + esc(e.message) + '). Se muestra el modo demo.', true);
      store = makeLocalStore();
    }
    let hidden = false; try { hidden = sessionStorage.getItem('banner-oculto') === '1'; } catch { }
    if (store.mode === 'demo' && banner.hidden && !hidden) showBanner('<b>Modo demo:</b> los datos se guardan solo en este navegador.');

    bind();
    bindAuth();
    bindPeople();
    bindInvites();
    store.auth.onChange(async ev => {
      if (ev === 'PASSWORD_RECOVERY') { showAuth('reset'); return; }
      if (ev === 'SIGNED_OUT') { applySession(null); showAuth('login'); return; }
      if (ev === 'SIGNED_IN' && !appOpen && $('#auth-body').dataset.view === 'sent') await refreshSession();
    });
    store.subscribe(() => { if (!drag && appOpen) { load(); if (isCoord()) loadHome(); } });
    store.reminders.subscribe(() => { if (appOpen && isCoord()) loadReminders(); });
    const squadsChanged = () => { if (appOpen && (isTeams() || isCoord())) loadTeams(true); };
    store.players.subscribe(squadsChanged);
    store.callups.subscribe(squadsChanged);
    store.callupRules.subscribe(squadsChanged);
    store.teamSettings.subscribe(() => { if (appOpen) loadTeamSettings(); });
    store.template.subscribe(() => { if (!drag && appOpen) load(); });
    store.proposals.subscribe(() => { if (!drag && appOpen) load(); });
    store.acks.subscribe(() => { if (!drag && appOpen) load(); });
    // Cambios de perfiles: el coordinador ve solicitudes nuevas; el entrenador pendiente entra al ser aceptado
    store.people.subscribe(async () => {
      if (isCoord()) loadPeople();
      if (!state.user) return;
      const prev = JSON.stringify([state.profile?.status, state.profile?.role, state.profile?.teams]);
      let s = null; try { s = await store.auth.current(); } catch { return; }
      if (JSON.stringify([s?.profile?.status, s?.profile?.role, s?.profile?.teams]) === prev) return;
      applySession(s);
      if (appOpen && state.profile?.status === 'aprobado') { render(); toast('Tus permisos han cambiado'); if (isCoord()) loadPeople(); }
      else route();
    });
    readInviteFromUrl();
    window.addEventListener('hashchange', () => { readInviteFromUrl(); if (state.inviteToken && !state.user) showInvite(); });
    showVersion();
    watchVersion();
    await refreshSession();
    if (state.user && state.inviteToken) { clearInvite(); toast('Ya tienes sesión iniciada. Para usar la invitación, cierra sesión y abre el enlace otra vez.'); }
  }

  init();
})();
