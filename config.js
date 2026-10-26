// ============================================================
//  CONFIGURACIÓN DEL PLANIFICADOR DE CAMPO
//  Edita este archivo para conectar Supabase y ajustar equipos.
// ============================================================
window.APP_CONFIG = {
  // --- Supabase -------------------------------------------------
  // Déjalos vacíos para usar el MODO DEMO (datos solo en este navegador).
  // Los encontrarás en Supabase > Project Settings > API.
  // La clave "anon"/"publishable" es pública por diseño: la seguridad
  // la ponen las políticas RLS de supabase/schema.sql.
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // --- General --------------------------------------------------
  CLUB_NAME: 'Castalla C.F.',
  DAY_START: '09:00',
  DAY_END: '21:30',
  DEFAULT_TRAINING_MIN: 90,

  // --- Equipos --------------------------------------------------
  // id: identificador que se guarda en la base de datos (no lo cambies
  //     una vez haya reservas guardadas).
  // match: null si el equipo no juega partidos.
  //   warmup = calentamiento, half = minutos por parte, halves = nº de partes,
  //   break = descanso, margin = margen posterior, format = formato por defecto.
  TEAMS: [
    { id: 'senior-a',   name: 'Senior A',        short: 'SEN A', color: '#b42318',
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'senior-b',   name: 'Senior B',        short: 'SEN B', color: '#c2410c',
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'juvenil',    name: 'Juvenil',         short: 'JUV',   color: '#6d28d9',
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'cadete',     name: 'Cadete',          short: 'CAD',   color: '#1d4ed8',
      match: { warmup: 30, half: 40, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'infantil-a', name: 'Infantil A',      short: 'INF A', color: '#0f766e',
      match: { warmup: 30, half: 35, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'infantil-b', name: 'Infantil B',      short: 'INF B', color: '#0e7490',
      match: { warmup: 30, half: 35, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'alevin-a',   name: 'Alevín A',        short: 'ALE A', color: '#a15c07',
      match: { warmup: 20, half: 30, halves: 2, break: 10, margin: 15, format: 'F8' } },
    { id: 'alevin-b',   name: 'Alevín B',        short: 'ALE B', color: '#4d7c0f',
      match: { warmup: 20, half: 30, halves: 2, break: 10, margin: 15, format: 'F8' } },
    { id: 'tec-1',      name: 'Tecnificación 1', short: 'TEC 1', color: '#be185d', match: null },
    { id: 'tec-2',      name: 'Tecnificación 2', short: 'TEC 2', color: '#475569', match: null },
  ],
};
