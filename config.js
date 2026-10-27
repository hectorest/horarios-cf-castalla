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
  SUPABASE_URL: 'https://wwkfaxrmmbptuithqpxn.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3a2ZheHJtbWJwdHVpdGhxcHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5OTUyMzQsImV4cCI6MjEwODU3MTIzNH0.cwVMIeaOpb62mipGx95rV-5uof8gXHGaofnLj9QIf-c',

  // --- General --------------------------------------------------
  CLUB_NAME: 'Castalla C.F.',
  // Para el mensaje del horario de los partidos en casa
  HOME_TOWN: 'Castalla',
  HOME_VENUE: 'Campo Municipal de Castalla',
  DAY_START: '09:00',
  DAY_END: '23:00',
  DEFAULT_TRAINING_MIN: 90,

  // --- Horario federativo para el saque de los partidos ------------
  // Fuera de estas franjas el partido necesita la aprobación del rival.
  // day: 0 = lunes … 6 = domingo. «to» es la última hora de saque permitida.
  // Cada equipo indica su categoría con «fed»; sin «fed», no hay restricción.
  FED_WINDOWS: {
    alevin: [ { day: 4, from: '18:30', to: '19:30' }, { day: 5, from: '09:00', to: '19:30' }, { day: 6, from: '09:00', to: '19:30' } ],
    base:   [ { day: 5, from: '09:00', to: '19:30' }, { day: 6, from: '09:00', to: '19:30' } ],   // infantiles y cadete
    senior: [ { day: 5, from: '15:00', to: '19:30' }, { day: 6, from: '09:00', to: '19:30' } ],   // juveniles y seniors
    escolar: [ { day: 5, from: '09:00', to: '13:00' } ],                                           // Infantil B (Jocs Escolars): sábado por la mañana
  },

  // --- Equipos --------------------------------------------------
  // id: identificador que se guarda en la base de datos (no lo cambies
  //     una vez haya reservas guardadas).
  // match: null si el equipo no juega partidos.
  //   warmup = calentamiento, half = minutos por parte, halves = nº de partes,
  //   break = descanso, margin = margen posterior, format = formato por defecto.
  // Convocables (solo para el modo demo): el equipo «team» puede tener en cuenta a jugadores de «from».
  // sub23: solo si el jugador está marcado como sub-23. Con Supabase, las reglas están en public.callup_rules
  // y las ajusta la coordinación desde Equipos. El Infantil B no sube al Infantil A porque no está federado.
  CALLUPS: [
    { team: 'senior-a',   from: 'senior-b', sub23: true },
    { team: 'senior-a',   from: 'juvenil' },
    { team: 'senior-b',   from: 'juvenil' },
    { team: 'juvenil',    from: 'cadete' },
    { team: 'cadete',     from: 'infantil-a' },
    { team: 'infantil-a', from: 'alevin-a' },
    { team: 'alevin-a',   from: 'alevin-b' },
  ],

  TEAMS: [
    { id: 'senior-a',   name: 'Senior A',        short: 'SEN A', color: '#b42318', fed: 'senior', sub23: true,
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'senior-b',   name: 'Senior B',        short: 'SEN B', color: '#c2410c', fed: 'senior', sub23: true,
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'veteranos',  name: 'Veteranos',       short: 'VET',   color: '#1f2937',
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'juvenil',    name: 'Juvenil',         short: 'JUV',   color: '#6d28d9', fed: 'senior',
      match: { warmup: 30, half: 45, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'cadete',     name: 'Cadete',          short: 'CAD',   color: '#1d4ed8', fed: 'base',
      match: { warmup: 30, half: 40, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'infantil-a', name: 'Infantil A',      short: 'INF A', color: '#0f766e', fed: 'base',
      match: { warmup: 30, half: 35, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'infantil-b', name: 'Infantil B',      short: 'INF B', color: '#0e7490', fed: 'escolar',
      match: { warmup: 30, half: 35, halves: 2, break: 15, margin: 15, format: 'F11' } },
    { id: 'alevin-a',   name: 'Alevín A',        short: 'ALE A', color: '#a15c07', fed: 'alevin',
      match: { warmup: 20, half: 30, halves: 2, break: 10, margin: 15, format: 'F8' } },
    { id: 'alevin-b',   name: 'Alevín B',        short: 'ALE B', color: '#4d7c0f', fed: 'alevin',
      match: { warmup: 20, half: 30, halves: 2, break: 10, margin: 15, format: 'F8' } },
    { id: 'tec-1',      name: 'Tecnificación 1', short: 'TEC 1', color: '#be185d', match: null },
    { id: 'tec-2',      name: 'Tecnificación 2', short: 'TEC 2', color: '#475569', match: null },
  ],
};
