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
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // Carriles: 0=A1, 1=A2, 2=B1, 3=B2
  const ZONES = { full: [0, 1, 2, 3], A: [0, 1], B: [2, 3], A1: [0], A2: [1], B1: [2], B2: [3] };
  const ZONE_LABEL = { full: 'Campo entero', A: 'Mitad A', B: 'Mitad B', A1: 'Cuarto A1', A2: 'Cuarto A2', B1: 'Cuarto B1', B2: 'Cuarto B2' };
  const QUARTERS = ['A1', 'A2', 'B1', 'B2'];
  const KIND_LABEL = { entreno: 'Entrenamiento', partido: 'Partido' };

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
        if (m.margin) segs.push({ t: 'margin', from: cur, to: cur + m.margin, label: 'Margen' });
        return { start: s - m.warmup, kick: s, end: coreEnd + (m.margin || 0), coreEnd, segs };
      }
      const d = b.duration_min || 90;
      return { start: s, end: s + d, coreEnd: s + d, segs: [{ t: 'half', from: s, to: s + d, label: 'Partido' }] };
    }
    const d = b.duration_min || DEFAULT_DUR;
    return { start: s, end: s + d, coreEnd: s + d, segs: [{ t: 'training', from: s, to: s + d, label: 'Entrenamiento' }] };
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
      const t = tl.get(b.id), team = TEAM[b.team], name = teamOf(b.team).name;
      const lanes = ZONES[b.zone];
      if (!team) add('error', `Equipo desconocido: «${b.team}»`, [b]);
      if (!lanes) add('error', `${name}: zona del campo no válida`, [b]);
      if (b.start_min % SNAP || (b.kind === 'entreno' && (b.duration_min || DEFAULT_DUR) % SNAP)) add('warn', `${name}: horario fuera de los tramos de ${SNAP} minutos`, [b]);
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
      }
    }

    // ---- Comparación por pares dentro de cada día ----
    // pieces: ocupación real de cada reserva a lo largo del tiempo (carriles por tramo).
    const pieces = new Map(list.map(b => [b.id, [{ from: tl.get(b.id).start, to: tl.get(b.id).end, lanes: ZONES[b.zone] || ZONES.full, shared: false }]]));
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
          const na = teamOf(a.team).name, nb = teamOf(b.team).name;

          if (a.team === b.team) {
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
          if (!overlap || a.kind !== 'entreno' || b.kind !== 'entreno') continue;
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
          const eL = ZONES[early.zone] || ZONES.full;
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
          if (resolved.has(pairKey(a, b))) continue;
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
          const na = teamOf(a.team).name, nb = teamOf(b.team).name;
          const where = lanesName([...shared].sort());
          if (core) add('error', `Conflicto: ${na} y ${nb} coinciden en ${where} (${fmt(from)}–${fmt(to)})`, [a, b], from);
          else add('warn', `${na} y ${nb} solo coinciden en el margen posterior (${fmt(from)}–${fmt(to)}, ${where})`, [a, b], from);
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

  const ICON = { error: '⛔', warn: '⚠', info: '½' };
  const worstLevel = issues => issues.some(i => i.level === 'error') ? 'error' : issues.some(i => i.level === 'warn') ? 'warn' : '';

  /** Normaliza una reserva antes de guardarla. */
  function cleanRow(b) {
    const r = {
      day: b.day, start_min: b.start_min, team: b.team, kind: b.kind, zone: b.zone,
      duration_min: b.kind === 'entreno' ? (b.duration_min || DEFAULT_DUR) : null,
      format: b.kind === 'partido' ? (b.format || null) : null,
      opponent: b.kind === 'partido' ? (b.opponent || null) : null,
      notes: b.notes || null,
    };
    return r;
  }

  // ================================================================
  //  Almacenamiento: Demo (localStorage) y Supabase
  // ================================================================
  function makeLocalStore() {
    const KEY = 'planificador-campo-demo-v2';
    let mem = null;
    const read = () => {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { mem = null; }
      return mem;
    };
    const write = a => { mem = a; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* sin almacenamiento */ } };
    if (!read()) write(demoSeed());
    const listeners = [];
    window.addEventListener('storage', e => { if (e.key === KEY) { mem = null; listeners.forEach(f => f()); } });
    return {
      mode: 'demo',
      async list(from, to) { return read().filter(b => b.day >= from && b.day <= to).map(b => ({ ...b })); },
      async insert(row) { const r = { ...cleanRow(row), id: uid() }; write([...read(), r]); return r; },
      async insertMany(rows) { const rs = rows.map(r => ({ ...cleanRow(r), id: uid() })); write([...read(), ...rs]); return rs; },
      async update(id, row) { write(read().map(b => b.id === id ? { ...cleanRow(row), id } : b)); },
      async remove(id) { write(read().filter(b => b.id !== id)); },
      subscribe(cb) { listeners.push(cb); },
      auth: {
        // En demo se entra directamente como coordinador para poder probar la edición.
        async current() { let r = null; try { r = sessionStorage.getItem('demo-role'); } catch { } return r === 'viewer' ? null : { user: { email: 'coordinador@demo' }, role: 'coordinador' }; },
        async signIn() { try { sessionStorage.setItem('demo-role', 'coordinador'); } catch { } return { user: { email: 'coordinador@demo' }, role: 'coordinador' }; },
        async signOut() { try { sessionStorage.setItem('demo-role', 'viewer'); } catch { } },
        onChange() { },
      },
    };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  async function makeSupabaseStore() {
    if (!window.supabase) await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    const T = 'bookings';
    const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    async function roleOf(user) {
      if (!user) return null;
      const { data, error } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (error) console.warn(error);
      return { user, role: data?.role || 'lector' };
    }
    return {
      mode: 'supabase',
      async list(from, to) { return chk(await sb.from(T).select('*').gte('day', from).lte('day', to).order('start_min')); },
      async insert(row) { return chk(await sb.from(T).insert(cleanRow(row)).select().single()); },
      async insertMany(rows) { return chk(await sb.from(T).insert(rows.map(cleanRow)).select()); },
      async update(id, row) { chk(await sb.from(T).update(cleanRow(row)).eq('id', id).select()); },
      async remove(id) { chk(await sb.from(T).delete().eq('id', id)); },
      subscribe(cb) {
        let t;
        sb.channel('bookings-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: T }, () => { clearTimeout(t); t = setTimeout(cb, 250); })
          .subscribe();
      },
      auth: {
        async current() { const { data } = await sb.auth.getSession(); return roleOf(data.session?.user); },
        async signIn(email, password) {
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message);
          return roleOf(data.user);
        },
        async signOut() { await sb.auth.signOut(); },
        onChange(cb) { sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' || ev === 'TOKEN_REFRESHED') cb(); }); },
      },
    };
  }

  function demoSeed() {
    const mon = mondayOf(new Date());
    const k = i => keyOf(addDays(mon, i));
    const E = (d, team, start, dur, zone, notes) => ({ id: uid(), day: k(d), team, kind: 'entreno', start_min: toMin(start), duration_min: dur, zone, notes: notes || null, format: null, opponent: null });
    const P = (d, team, start, format, zone, opponent) => ({ id: uid(), day: k(d), team, kind: 'partido', start_min: toMin(start), duration_min: null, zone, format, opponent, notes: null });
    return [
      E(0, 'alevin-a', '17:30', 60, 'A'), E(0, 'alevin-b', '17:30', 60, 'B'),
      E(0, 'infantil-a', '18:30', 90, 'A'), E(0, 'infantil-b', '18:30', 90, 'B'),
      E(0, 'juvenil', '20:00', 90, 'full'),
      E(1, 'tec-1', '17:00', 60, 'A1'), E(1, 'tec-2', '17:00', 60, 'A2'),
      E(1, 'cadete', '18:00', 90, 'A'), E(1, 'senior-b', '18:00', 90, 'B'),
      E(1, 'infantil-a', '19:00', 60, 'A1', 'Sesión de porteros'),
      E(1, 'senior-a', '20:00', 90, 'full'),
      E(2, 'alevin-a', '17:30', 60, 'A'), E(2, 'alevin-b', '17:30', 60, 'B'),
      E(2, 'juvenil', '18:30', 90, 'A'), E(2, 'cadete', '18:30', 105, 'B'),
      E(2, 'senior-a', '20:00', 90, 'full'),
      E(3, 'infantil-a', '17:00', 75, 'A'), E(3, 'infantil-b', '17:00', 75, 'B'),
      E(3, 'senior-b', '18:30', 90, 'A'), E(3, 'juvenil', '18:30', 90, 'B'),
      E(3, 'senior-a', '20:00', 90, 'full'),
      E(4, 'tec-1', '17:00', 60, 'B1'), E(4, 'tec-2', '17:00', 60, 'B2'),
      E(4, 'alevin-a', '17:00', 60, 'A'), E(4, 'cadete', '18:15', 90, 'full'),
      // Partidos: hora = saque inicial
      P(5, 'alevin-a', '10:00', 'F8', 'A', 'CF Montaña'), P(5, 'alevin-b', '10:00', 'F8', 'B', 'UD Riera'),
      P(5, 'infantil-a', '11:45', 'F11', 'full', 'AE Llevant'),
      P(5, 'cadete', '16:30', 'F11', 'full', 'CE Poble Nou'),
      P(5, 'juvenil', '19:00', 'F11', 'full', 'FC Turó'),
      P(6, 'senior-a', '10:30', 'F11', 'full', 'CD Sant Joan'),
      P(6, 'senior-b', '13:00', 'F11', 'full', 'AE Martinenc'),
      P(6, 'infantil-b', '17:00', 'F11', 'full', 'EF Gràcia'),
    ];
  }

  // ================================================================
  //  Estado
  // ================================================================
  const state = {
    weekStart: mondayOf(new Date()),
    bookings: [],
    issues: { byId: new Map(), all: [], pieces: new Map() },
    role: 'viewer',
    user: null,
    edit: true,
    view: window.innerWidth < 820 ? 'day' : 'week',
    dayIndex: (new Date().getDay() + 6) % 7,
    filter: null,
    selectedId: null,
    loading: false,
  };
  let store;
  const isCoord = () => state.role === 'coordinador';
  const isEditor = () => isCoord() && state.edit;

  // ================================================================
  //  Render
  // ================================================================
  function render() {
    state.issues = computeIssues(state.bookings);
    renderHeader();
    renderLegend();
    renderDayTabs();
    renderCalendar();
    renderIssues();
    renderSummary();
  }

  function renderHeader() {
    const a = state.weekStart, b = addDays(a, 6);
    const sameMonth = a.getMonth() === b.getMonth();
    $('#week-label').textContent = sameMonth
      ? `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
      : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
    $$('#view-toggle button').forEach(x => x.classList.toggle('on', x.dataset.view === state.view));
    const coord = isCoord();
    $('.coord-only').hidden = !coord;
    $$('.edit-only').forEach(x => x.hidden = !state.edit);
    $('.edit-hint').hidden = !isEditor();
    $('#edit-toggle').checked = state.edit;
    const badge = $('#role-badge');
    const mail = state.user?.email ? `<span class="badge-mail"> · ${esc(state.user.email)}</span>` : '';
    badge.innerHTML = (coord ? 'Coordinador' : 'Solo lectura') + mail;
    badge.classList.toggle('coord', coord);
    $('#login-btn').textContent = state.user ? 'Salir' : 'Acceso coordinador';
  }

  function renderLegend() {
    const el = $('#legend');
    el.classList.toggle('filtering', !!state.filter);
    el.innerHTML = TEAMS.map(t => `<button class="chip ${state.filter === t.id ? 'on' : ''}" data-team="${t.id}" style="--c:${t.color}" title="Resaltar ${esc(t.name)}"><span class="dot"></span><span class="nm-full">${esc(t.name)}</span><span class="nm-short">${esc(t.short)}</span></button>`).join('');
  }

  function renderDayTabs() {
    const el = $('#day-tabs');
    el.hidden = state.view !== 'day';
    if (el.hidden) return;
    el.innerHTML = DAYS_SHORT.map((d, i) => {
      const k = keyOf(addDays(state.weekStart, i));
      const lvl = worstLevel(state.issues.all.filter(x => x.day === k));
      const dot = lvl ? `<span class="mini-dot" style="background:var(--${lvl === 'error' ? 'err' : 'warn'})"></span>` : '';
      return `<button data-day="${i}" class="${i === state.dayIndex ? 'on' : ''}">${d} ${parseKey(k).getDate()}${dot}</button>`;
    }).join('');
  }

  function blockGeom(t, lanes) {
    let vs = Math.max(t.start, DAY_START), ve = Math.min(t.end, DAY_END);
    if (ve - vs < 15) {
      if (t.start >= DAY_END - 15) { vs = DAY_END - 15; ve = DAY_END; }
      else if (t.end <= DAY_START + 15) { vs = DAY_START; ve = DAY_START + 15; }
    }
    return { vs, top: (vs - DAY_START) * PX, height: Math.max((ve - vs) * PX, 16), left: lanes[0] * 25, width: lanes.length * 25 };
  }
  const geomStyle = g => `top:${g.top}px;height:${g.height}px;left:calc(${g.left}% + 2px);width:calc(${g.width}% - 4px)`;

  function subLabel(b) {
    if (b.kind === 'partido') return `Partido ${b.format || ''}${b.opponent ? ' · vs ' + b.opponent : ''}`;
    return 'Entreno' + (b.zone && ZONES[b.zone]?.length === 1 ? ` · ${b.zone}` : '') + (b.notes ? ' · ' + b.notes : '');
  }

  const matchText = t => `partido ${fmt(t.kick)}–${fmt(t.coreEnd)} (campo ${fmt(t.start)}–${fmt(t.end)})`;
  const timeText = (b, t) => b.kind === 'partido' && t.kick != null ? matchText(t) : `${fmt(t.start)}–${fmt(t.end)}`;

  function blockTitle(b, t, issues) {
    const team = teamOf(b.team);
    const lines = [`${team.name} — ${KIND_LABEL[b.kind]}${b.format ? ' ' + b.format : ''}${b.opponent ? ' vs ' + b.opponent : ''}`,
      `${timeText(b, t)} · ${ZONE_LABEL[b.zone] || b.zone}`];
    if (b.kind === 'partido') lines.push(t.segs.map(s => `${s.label} ${fmt(s.from)}–${fmt(s.to)}`).join('\n'));
    if (b.notes) lines.push('Notas: ' + b.notes);
    for (const i of issues) lines.push(ICON[i.level] + ' ' + i.msg);
    return lines.join('\n');
  }

  function blockHTML(b) {
    const t = timeline(b), team = teamOf(b.team);
    const issues = state.issues.byId.get(b.id) || [];
    const lvl = worstLevel(issues);
    const title = esc(blockTitle(b, t, issues));
    const ps = b.kind === 'entreno' ? (state.issues.pieces.get(b.id) || []) : [];
    const parts = ps.length ? ps : [{ from: t.start, to: t.end, lanes: ZONES[b.zone] || ZONES.full, shared: false }];
    return parts.map((p, n) => {
      const g = blockGeom({ start: p.from, end: p.to }, p.lanes);
      const narrow = p.lanes.length === 1;
      const first = n === 0, last = n === parts.length - 1;
      const cls = ['block', 'kind-' + b.kind, lvl && 'lvl-' + lvl, narrow && 'narrow', g.height < 50 && 'short',
        !first && 'cont-up', !last && 'cont-down', p.shared && 'shared',
        state.filter && state.filter !== b.team && 'dim', state.selectedId === b.id && 'selected'].filter(Boolean).join(' ');
      const segs = b.kind === 'partido'
        ? `<div class="segs" style="top:${(t.start - g.vs) * PX}px">${t.segs.map(s => `<div class="seg seg-${s.t}" style="top:${(s.from - t.start) * PX}px;height:${(s.to - s.from) * PX}px"></div>`).join('')}</div>`
        : '';
      const sub = p.shared ? `Comparte · ${lanesName(p.lanes)}` : subLabel(b);
      const time = p.shared ? `${fmt(p.from)}–${fmt(p.to)}` : b.kind === 'partido' && t.kick != null ? `${fmt(t.kick)}–${fmt(t.coreEnd)}` : `${fmt(t.start)}–${fmt(t.end)}`;
      const labelTop = b.kind === 'partido' && t.kick != null ? Math.max(0, (t.kick - g.vs) * PX) : 0;
      return `<div class="${cls}" data-id="${esc(b.id)}" style="--c:${team.color};${geomStyle(g)}" title="${title}">
      ${segs}
      <div class="b-label" style="${labelTop ? `margin-top:${labelTop + 3}px` : ''}"><span class="b-name">${esc(narrow ? team.short : team.name)}</span><span class="b-sub">${esc(sub)}</span><span class="b-time">${time}</span></div>
      ${lvl && first ? `<span class="b-flag">!</span>` : ''}
      ${b.kind === 'entreno' && isEditor() && last ? '<div class="resize" data-resize="1"></div>' : ''}
    </div>`;
    }).join('');
  }

  function renderCalendar() {
    const cal = $('#calendar');
    const days = state.view === 'week' ? [0, 1, 2, 3, 4, 5, 6] : [state.dayIndex];
    const H = (DAY_END - DAY_START) * PX;
    const todayKey = keyOf(new Date());
    cal.style.setProperty('--ncols', days.length);
    cal.style.setProperty('--hour', 60 * PX + 'px');
    cal.style.setProperty('--q30', 30 * PX + 'px');
    cal.classList.toggle('single', days.length === 1);
    cal.classList.toggle('editing', isEditor());

    let html = '<div class="cal-head"><div class="corner"></div>';
    for (const i of days) {
      const d = addDays(state.weekStart, i), k = keyOf(d);
      const iss = state.issues.all.filter(x => x.day === k);
      const ne = iss.filter(x => x.level === 'error').length, nw = iss.filter(x => x.level === 'warn').length;
      html += `<div class="day-head ${k === todayKey ? 'today' : ''} ${i >= 5 ? 'weekend' : ''}" data-day="${i}">
        <div class="dh-top"><span class="dh-name">${state.view === 'week' ? DAYS_SHORT[i] : DAYS[i]}</span><span class="dh-date">${d.getDate()} ${MONTHS[d.getMonth()]}</span>
        ${ne ? `<span class="pill err" title="${ne} conflicto(s)">${ne}</span>` : ''}${nw ? `<span class="pill warn" title="${nw} aviso(s)">${nw}</span>` : ''}</div>
        <div class="lanes-head"><span>A1</span><span>A2</span><span>B1</span><span>B2</span></div></div>`;
    }
    html += '</div><div class="cal-body"><div class="time-axis" style="height:' + H + 'px">';
    for (let m = DAY_START; m <= DAY_END; m += 30) html += `<span class="${m % 60 ? 'half' : ''}" style="top:${(m - DAY_START) * PX}px">${fmt(m)}</span>`;
    html += '</div>';
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    for (const i of days) {
      const k = keyOf(addDays(state.weekStart, i));
      html += `<div class="day-col ${k === todayKey ? 'today' : ''} ${i >= 5 ? 'weekend' : ''} ${isEditor() ? 'editable' : ''}" data-day="${i}" data-key="${k}" style="height:${H}px">
        <div class="lane l0"></div><div class="lane l1"></div><div class="lane l2"></div><div class="lane l3"></div>`;
      for (const b of state.bookings.filter(x => x.day === k).sort((a, c) => a.start_min - c.start_min)) html += blockHTML(b);
      if (k === todayKey && nowMin >= DAY_START && nowMin <= DAY_END) html += `<div class="now-line" style="top:${(nowMin - DAY_START) * PX}px"></div>`;
      html += '</div>';
    }
    html += '</div>';
    cal.innerHTML = html;
  }

  function renderIssues() {
    const all = state.issues.all;
    const ne = all.filter(i => i.level === 'error').length, nw = all.filter(i => i.level === 'warn').length, ni = all.length - ne - nw;
    $('#issue-count').innerHTML = `${ne ? `<span class="pill err">${ne} conflicto${ne > 1 ? 's' : ''}</span>` : ''}${nw ? `<span class="pill warn">${nw} aviso${nw > 1 ? 's' : ''}</span>` : ''}${ni ? `<span class="pill info">${ni} compartido${ni > 1 ? 's' : ''}</span>` : ''}`;
    $('#side-toggle-count').innerHTML = ne ? `<span class="pill err">${ne}</span>` : nw ? `<span class="pill warn">${nw}</span>` : '';
    $('#issues').innerHTML = all.length
      ? all.map((it, n) => `<li class="${it.level}" data-n="${n}" tabindex="0"><span class="ic">${it.level === 'info' ? '½' : '!'}</span><div><span class="when">${dayLabel(it.day)} · ${fmt(it.at)}</span>${esc(it.msg)}</div></li>`).join('')
      : '<li class="empty">Sin conflictos ni avisos esta semana ✓</li>';
  }

  function renderSummary() {
    const rows = TEAMS.map(t => {
      const bs = state.bookings.filter(b => b.team === t.id);
      const tr = bs.filter(b => b.kind === 'entreno');
      const mins = tr.reduce((s, b) => s + (b.duration_min || DEFAULT_DUR), 0);
      const pm = bs.filter(b => b.kind === 'partido').length;
      return `<tr><td><span class="dot" style="--c:${t.color}"></span>${esc(t.name)}</td>
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
    try { state.bookings = await store.list(from, to); }
    catch (e) { toast('Error al cargar: ' + e.message, true); state.bookings = []; }
    state.loading = false;
    render();
  }

  function setWeek(d) {
    state.weekStart = mondayOf(d);
    try { history.replaceState(null, '', '#semana=' + keyOf(state.weekStart)); } catch { }
    load();
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
    if (!opts.includes(draft.zone)) draft.zone = opts.includes('A') && draft.zone && draft.zone.startsWith('B') ? 'B' : opts[0] === 'full' && draft.kind === 'entreno' ? 'A' : opts[0];

    $('#f-team').value = draft.team;
    $$('#f-kind button').forEach(x => { x.classList.toggle('on', x.dataset.v === draft.kind); x.disabled = x.dataset.v === 'partido' && !team.match; });
    $$('#f-kind button')[1].title = team.match ? '' : `${team.name} no juega partidos`;
    $$('#f-format button').forEach(x => x.classList.toggle('on', x.dataset.v === draft.format));
    $$('.match-only', dlg()).forEach(x => x.hidden = draft.kind !== 'partido');
    $$('.training-only', dlg()).forEach(x => x.hidden = draft.kind !== 'entreno');
    $('#f-start-label').textContent = draft.kind === 'partido' ? 'Hora del partido (saque)' : 'Hora de inicio';
    $('#f-zone').innerHTML = opts.map(z => `<button type="button" class="zone-opt ${z === draft.zone ? 'on' : ''}" data-v="${z}">${zoneSVG(z)}${ZONE_LABEL[z]}</button>`).join('');
    $('#f-date').value = draft.day;
    $('#f-start').value = fmt(draft.start_min);
    $('#f-dur').value = draft.duration_min || DEFAULT_DUR;
    $('#f-opp').value = draft.opponent || '';
    $('#f-notes').value = draft.notes || '';
    renderPreview();
  }

  function readInputs() {
    draft.team = $('#f-team').value;
    if ($('#f-date').value) draft.day = $('#f-date').value;
    if ($('#f-start').value) draft.start_min = snap(toMin($('#f-start').value));
    const dur = parseInt($('#f-dur').value, 10);
    if (dur > 0) draft.duration_min = clamp(snap(dur), 15, 600);
    draft.opponent = $('#f-opp').value.trim();
    draft.notes = $('#f-notes').value.trim();
  }

  function draftIssues() {
    const cand = { ...draft, id: '__draft__' };
    const others = state.bookings.filter(b => b.id !== editingId);
    return computeIssues([...others, cand]).byId.get('__draft__') || [];
  }

  function renderPreview() {
    const t = timeline(draft), team = teamOf(draft.team);
    const total = t.end - t.start;
    const bar = t.segs.map(s => `<div class="tl-${s.t}" style="flex:${s.to - s.from}" title="${s.label} ${fmt(s.from)}–${fmt(s.to)}">${(s.to - s.from) / total > .12 ? s.label : ''}</div>`).join('');
    const issues = draftIssues();
    const weekEnd = keyOf(addDays(state.weekStart, 6));
    const outside = draft.day < keyOf(state.weekStart) || draft.day > weekEnd;
    const detail = draft.kind === 'partido'
      ? t.segs.map(s => `${s.label}: <b>${fmt(s.from)}–${fmt(s.to)}</b>`).join(' · ')
      : `Ocupa <b>${fmt(t.start)}–${fmt(t.end)}</b> (${total} min)`;
    $('#f-preview').innerHTML = `<div><b>${esc(team.name)}</b> · ${KIND_LABEL[draft.kind]}${draft.kind === 'partido' ? ' ' + (draft.format || '') : ''} · ${ZONE_LABEL[draft.zone]} · ${dayLabel(draft.day)}</div>
      <div class="tl" style="--c:${team.color}">${bar}</div>
      <div class="tl-times"><span>${fmt(t.start)}</span><span>${fmt(t.end)}</span></div>
      <div style="margin-top:4px">${detail}</div>
      <ul class="pv-issues">${outside ? '<li class="warn">Fecha fuera de la semana visible: solo se comprueban las reservas de esta semana.</li>' : ''}
      ${issues.map(i => `<li class="${i.level}">${ICON[i.level]} ${esc(i.msg)}</li>`).join('')}${!worstLevel(issues) && !outside ? '<li class="ok">✓ Sin conflictos</li>' : ''}</ul>`;
    return issues;
  }

  function openEditor(b, isNew) {
    draft = { ...b };
    editingId = isNew ? null : b.id;
    $('#f-title').textContent = isNew ? 'Nueva reserva' : 'Editar reserva';
    $('#f-delete').hidden = isNew;
    $('#f-dup').hidden = isNew;
    syncForm();
    if (!dlg().open) dlg().showModal();
  }

  function newDraft(dayKey, startMin, zone) {
    const team = state.filter || TEAMS[0].id;
    return { team, kind: 'entreno', day: dayKey, start_min: startMin, duration_min: DEFAULT_DUR, zone: zone || 'A', format: null, opponent: '', notes: '' };
  }

  async function saveDraft() {
    readInputs();
    const issues = renderPreview();
    const errs = issues.filter(i => i.level === 'error');
    if (errs.length && !(await askConfirm(`Hay ${errs.length} conflicto(s):\n\n• ${errs.map(e => e.msg).join('\n• ')}\n\n¿Guardar igualmente?`, 'Guardar igualmente'))) return;
    try {
      if (editingId) await store.update(editingId, draft);
      else await store.insert(draft);
      dlg().close();
      toast(editingId ? 'Reserva actualizada' : 'Reserva creada');
      const ws = mondayOf(parseKey(draft.day));
      if (keyOf(ws) !== keyOf(state.weekStart)) setWeek(ws); else await load();
    } catch (e) { toast('No se pudo guardar: ' + e.message, true); }
  }

  async function deleteDraft() {
    if (!editingId) return;
    if (!(await askConfirm(`¿Eliminar la reserva de ${teamOf(draft.team).name} (${dayLabel(draft.day)} ${fmt(draft.start_min)})?`, 'Eliminar', true))) return;
    try { await store.remove(editingId); dlg().close(); toast('Reserva eliminada'); await load(); }
    catch (e) { toast('No se pudo eliminar: ' + e.message, true); }
  }

  // ================================================================
  //  Detalle (solo lectura)
  // ================================================================
  function openDetail(b) {
    const t = timeline(b), team = teamOf(b.team);
    const issues = state.issues.byId.get(b.id) || [];
    $('#d-title').innerHTML = `<span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${team.color}"></span>${esc(team.name)}`;
    const rows = [
      ['Tipo', KIND_LABEL[b.kind] + (b.format ? ' ' + b.format : '')],
      ['Día', dayLabel(b.day)],
      ...(t.kick != null ? [['Partido', `${fmt(t.kick)} – ${fmt(t.coreEnd)}`], ['Ocupa el campo', `${fmt(t.start)} – ${fmt(t.end)}`]] : [['Horario', `${fmt(t.start)} – ${fmt(t.end)}`]]),
      ['Zona', ZONE_LABEL[b.zone] || b.zone],
    ];
    if (b.kind === 'partido') {
      if (b.opponent) rows.push(['Rival', b.opponent]);
      for (const s of t.segs) rows.push([s.label, `${fmt(s.from)} – ${fmt(s.to)}`]);
    }
    if (b.notes) rows.push(['Notas', b.notes]);
    $('#d-body').innerHTML = `<dl class="detail-rows">${rows.map(([a, v]) => `<dt>${esc(a)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${issues.length ? `<ul class="pv-issues">${issues.map(i => `<li class="${i.level}">${ICON[i.level]} ${esc(i.msg)}</li>`).join('')}</ul>` : ''}`;
    $('#detail-dialog').showModal();
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
    e.preventDefault();
    drag = {
      el, b, x0: e.clientX, y0: e.clientY, moved: false,
      resize: !!e.target.dataset.resize,
      cand: { ...b },
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragCancel, { once: true });
  }

  function onDragMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
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
        const lane = clamp(Math.floor((e.clientX - r.left) / r.width * 4), 0, 3);
        cand.day = col.dataset.key;
        cand.zone = laneZone(b.zone, lane);
        if (el.parentElement !== col) col.appendChild(el);
      }
    }
    drag.cand = cand;
    // Actualiza posición y estado de avisos en vivo
    const t = timeline(cand);
    const g = blockGeom(t, ZONES[cand.zone] || ZONES.full);
    el.style.cssText = `--c:${teamOf(b.team).color};${geomStyle(g)}`;
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
    if (!d.moved) { openEditor(d.b, false); return; }
    suppressClickUntil = Date.now() + 400;
    const c = d.cand, b = d.b;
    if (c.day === b.day && c.start_min === b.start_min && c.zone === b.zone && c.duration_min === b.duration_min) { render(); return; }
    // Actualización optimista
    Object.assign(state.bookings.find(x => x.id === b.id), c);
    state.selectedId = b.id;
    render();
    try {
      await store.update(b.id, c);
      const iss = state.issues.byId.get(b.id) || [];
      const ne = iss.filter(i => i.level === 'error').length;
      toast(ne ? `Movido · ${ne} conflicto(s) pendiente(s)` : `Movido a ${dayLabel(c.day)} ${fmt(c.start_min)}`, false);
    } catch (e) { toast('No se pudo mover: ' + e.message, true); await load(); }
  }

  function onDragCancel() {
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
    const rows = prev.map(b => ({ ...b, day: keyOf(addDays(parseKey(b.day), 7)) })).filter(r => !existing.has(sig(r)));
    if (!rows.length) return toast('Esos entrenamientos ya están en esta semana');
    if (!(await askConfirm(`Se copiarán ${rows.length} entrenamiento(s) de la semana anterior a esta semana.`, 'Copiar'))) return;
    try { await store.insertMany(rows); toast(`${rows.length} entrenamiento(s) copiados`); await load(); }
    catch (e) { toast('No se pudo copiar: ' + e.message, true); }
  }

  // ================================================================
  //  Acceso
  // ================================================================
  function openLogin() {
    const body = $('#login-body');
    if (store.mode === 'demo') {
      body.innerHTML = `<p class="login-note">Estás en <b>modo demo</b>: no hay usuarios reales. Pulsa «Entrar» para probar las funciones de coordinador. Al conectar Supabase se pedirá email y contraseña.</p>`;
    } else {
      body.innerHTML = `<div class="field"><label for="l-email">Email</label><input type="email" id="l-email" autocomplete="username" required></div>
        <div class="field"><label for="l-pass">Contraseña</label><input type="password" id="l-pass" autocomplete="current-password" required></div>
        <p class="login-error" id="l-err" hidden></p>`;
    }
    $('#login-dialog').showModal();
    $('#l-email')?.focus();
  }

  async function doLogin(e) {
    e.preventDefault();
    const err = $('#l-err');
    try {
      const res = await store.auth.signIn($('#l-email')?.value.trim(), $('#l-pass')?.value);
      applySession(res);
      $('#login-dialog').close();
      toast(isCoord() ? 'Sesión iniciada como coordinador' : 'Sesión iniciada (sin permisos de edición)');
      render();
    } catch (ex) { if (err) { err.textContent = ex.message; err.hidden = false; } }
  }

  function applySession(s) {
    state.user = s?.user || null;
    state.role = s?.role === 'coordinador' ? 'coordinador' : 'viewer';
  }

  // ================================================================
  //  Eventos
  // ================================================================
  function bind() {
    $('#prev-week').onclick = () => setWeek(addDays(state.weekStart, -7));
    $('#next-week').onclick = () => setWeek(addDays(state.weekStart, 7));
    $('#today-btn').onclick = () => { state.dayIndex = (new Date().getDay() + 6) % 7; setWeek(new Date()); };
    $('#view-toggle').onclick = e => { const v = e.target.closest('button')?.dataset.view; if (v) { state.view = v; render(); } };
    $('#day-tabs').onclick = e => { const d = e.target.closest('button')?.dataset.day; if (d != null) { state.dayIndex = +d; render(); } };
    $('#legend').onclick = e => { const t = e.target.closest('.chip')?.dataset.team; if (t) { state.filter = state.filter === t ? null : t; render(); } };
    $('#print-btn').onclick = () => window.print();
    $('#edit-toggle').onchange = e => { state.edit = e.target.checked; render(); };
    $('#new-btn').onclick = () => {
      const i = state.view === 'day' ? state.dayIndex : ((new Date().getDay() + 6) % 7);
      openEditor(newDraft(keyOf(addDays(state.weekStart, i)), toMin('17:00'), 'A'), true);
    };
    $('#copy-week-btn').onclick = copyPrevWeek;
    $('#login-btn').onclick = async () => {
      if (state.user) { await store.auth.signOut(); applySession(null); render(); toast('Sesión cerrada'); }
      else openLogin();
    };
    $('#login-form').addEventListener('submit', doLogin);

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
        else { toast('Entra como coordinador para mover las reservas'); $('#login-btn').classList.add('pulse'); setTimeout(() => $('#login-btn').classList.remove('pulse'), 1500); }
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
        const lane = clamp(Math.floor((e.clientX - r.left) / r.width * 4), 0, 3);
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
    $('#side-toggle').onclick = () => setSide(!$('#side').classList.contains('open'));
    $('#side-close').onclick = () => setSide(false);
    $('#side-backdrop').onclick = () => setSide(false);

    // Incidencias
    $('#issues').addEventListener('click', e => {
      const li = e.target.closest('li[data-n]'); if (!li) return;
      setSide(false);
      const it = state.issues.all[+li.dataset.n]; if (it) focusBooking(it.ids[0]);
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
    $('#f-dur').addEventListener('change', () => { readInputs(); $('#f-dur').value = draft.duration_min; renderPreview(); });
    $('#f-delete').onclick = deleteDraft;
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
  async function init() {
    $('#club-name').textContent = CFG.CLUB_NAME || 'Campo';
    document.title = `${CFG.CLUB_NAME || 'Campo'} · Planificador`;
    fillTeamSelect();
    const m = location.hash.match(/semana=(\d{4}-\d{2}-\d{2})/);
    if (m) state.weekStart = mondayOf(parseKey(m[1]));

    const banner = $('#banner');
    try {
      store = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY ? await makeSupabaseStore() : makeLocalStore();
    } catch (e) {
      banner.hidden = false; banner.classList.add('error');
      banner.textContent = 'No se pudo conectar con Supabase (' + e.message + '). Se muestra el modo demo.';
      store = makeLocalStore();
    }
    if (store.mode === 'demo' && banner.hidden) {
      banner.hidden = false;
      banner.innerHTML = '<b>Modo demo:</b> los datos se guardan solo en este navegador. Rellena <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code> en <code>config.js</code> para compartirlos.';
    }
    try { applySession(await store.auth.current()); } catch { applySession(null); }
    store.auth.onChange(async () => { try { applySession(await store.auth.current()); } catch { applySession(null); } render(); });
    store.subscribe(() => { if (!drag) load(); });
    bind();
    render();
    await load();
    // Desplaza a la tarde (horario habitual de entrenos) en la primera carga
    const wrap = $('#cal-wrap');
    if (wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop = Math.max(0, (toMin('16:30') - DAY_START) * PX);
  }

  init();
})();
