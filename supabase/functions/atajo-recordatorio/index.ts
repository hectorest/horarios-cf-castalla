// Atajos del iPhone → recordatorios de la coordinación.
// Recibe una captura (imagen), un texto o lo dictado por voz, lo interpreta con Claude y crea uno o
// varios recordatorios en public.reminders a nombre del coordinador dueño del código.
// Responde con texto plano, pensado para mostrarlo tal cual en la notificación del Atajo.
//
// Autenticación: cabecera «Authorization: Bearer cfc_…» (código generado en la herramienta, en
// «Conectar con Atajos»). Se despliega con verify_jwt = false porque la comprobación la hace esta función.
// Secretos: ANTHROPIC_API_KEY (obligatorio), ANTHROPIC_MODEL (opcional).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "Europe/Madrid";
const MAX_BYTES = 8 * 1024 * 1024;
const DAILY_LIMIT = 60;
const ALERT_DAYS = 2;
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

// Equipos (mismos id que config.js) y cómo se les suele llamar
const TEAMS = [
  { id: "senior-a", name: "Senior A", alias: "primer equipo, senior, sénior A, Segona" },
  { id: "senior-b", name: "Senior B", alias: "sénior B, filial, Tercera" },
  { id: "veteranos", name: "Veteranos", alias: "veteranos, vets" },
  { id: "juvenil", name: "Juvenil", alias: "juveniles" },
  { id: "cadete", name: "Cadete", alias: "cadetes" },
  { id: "infantil-a", name: "Infantil A", alias: "infantiles A" },
  { id: "infantil-b", name: "Infantil B", alias: "infantiles B, Jocs Escolars" },
  { id: "alevin-a", name: "Alevín A", alias: "alevines A, alevín de 2º año" },
  { id: "alevin-b", name: "Alevín B", alias: "alevines B, alevín de 1er año" },
  { id: "tec-1", name: "Tecnificación 1", alias: "tecni 1" },
  { id: "tec-2", name: "Tecnificación 2", alias: "tecni 2" },
];
const TEAM_IDS = new Set(TEAMS.map((t) => t.id));
const TEAM_NAME = Object.fromEntries(TEAMS.map((t) => [t.id, t.name]));
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-atajo-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (text: string, status = 200) =>
  new Response(text, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });

// ---------- Fechas (en hora de Madrid) ----------
const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const parseKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (k: string, n: number) => { const d = parseKey(k); d.setUTCDate(d.getUTCDate() + n); return keyOf(d); };
const shortDate = (k: string) => { const d = parseKey(k); return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const longDate = (k: string) => { const d = parseKey(k); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const isKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseKey(s).getTime());
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function sniffImage(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  if (b.length > 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp" && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(String.fromCharCode(...b.subarray(8, 12)))) return "image/heic";
  return null;
}

type Input = { text?: string; image?: { data: string; type: string } };

// Acepta: JSON {texto, imagen(base64), tipo}, formulario (texto / archivo), imagen o texto en bruto
async function readInput(req: Request): Promise<Input | string> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const fromBytes = (bytes: Uint8Array, declared = ""): Input | string => {
    if (!bytes.length) return "No ha llegado nada. Comparte una captura o un texto, o dicta el recordatorio.";
    if (bytes.length > MAX_BYTES) return "La imagen es demasiado grande (máx. 8 MB).";
    const kind = sniffImage(bytes) || (declared.startsWith("image/") ? declared : null);
    if (kind === "image/heic" || kind === "image/heif") return "La imagen está en formato HEIC. Añade al atajo «Convertir imagen» a JPEG, o usa una captura de pantalla.";
    if (kind) return { image: { data: b64(bytes), type: kind } };
    return { text: new TextDecoder().decode(bytes) };
  };
  if (ct.includes("application/json")) {
    const j = await req.json().catch(() => null);
    if (!j || typeof j !== "object") return "El cuerpo JSON no es válido.";
    const text = typeof j.texto === "string" ? j.texto : typeof j.text === "string" ? j.text : undefined;
    let img = typeof j.imagen === "string" ? j.imagen : typeof j.image === "string" ? j.image : undefined;
    if (img) {
      img = img.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
      const bytes = Uint8Array.from(atob(img), (c) => c.charCodeAt(0));
      const r = fromBytes(bytes, String(j.tipo || j.type || ""));
      if (typeof r === "string") return r;
      return { ...r, text: text ?? r.text };
    }
    return text ? { text } : "No ha llegado ni texto ni imagen.";
  }
  if (ct.includes("multipart/form-data")) {
    const f = await req.formData();
    const text = f.get("texto") ?? f.get("text");
    const file = f.get("archivo") ?? f.get("file") ?? f.get("imagen");
    if (file && typeof file !== "string") {
      const r = fromBytes(new Uint8Array(await file.arrayBuffer()), file.type || "");
      if (typeof r === "string") return r;
      return { ...r, text: typeof text === "string" && text ? text : r.text };
    }
    if (typeof file === "string" && file) return { text: file };
    return typeof text === "string" && text ? { text } : "No ha llegado ni texto ni imagen.";
  }
  return fromBytes(new Uint8Array(await req.arrayBuffer()), ct);
}

const TOOL = {
  name: "guardar_recordatorios",
  description: "Guarda los recordatorios (tareas pendientes para la coordinación) que salen del mensaje.",
  input_schema: {
    type: "object",
    properties: {
      recordatorios: {
        type: "array",
        description: "Una entrada por cada tarea distinta. Vacío si no hay nada que hacer.",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string", description: "Qué hay que hacer, en infinitivo y en español, claro y corto (máx. 90 caracteres). Ej.: «Enviar al Cadete el cambio de hora del partido»." },
            equipo: { type: ["string", "null"], enum: [...TEAM_IDS, null], description: "id del equipo afectado, o null si es de todo el club o no está claro." },
            fecha_maxima: { type: ["string", "null"], description: "AAAA-MM-DD: el día límite para hacerlo. Si se refiere a un partido, el día del partido (o antes si lo dice). null si no hay ninguna pista de fecha." },
            fecha_aviso: { type: ["string", "null"], description: "AAAA-MM-DD solo si el mensaje pide expresamente que se avise un día concreto; si no, null." },
            notas: { type: ["string", "null"], description: "Contexto útil y breve (quién lo pide, detalles, teléfonos…). Máx. 300 caracteres." },
          },
          required: ["titulo", "equipo", "fecha_maxima", "fecha_aviso", "notas"],
        },
      },
      texto_leido: { type: "string", description: "Transcripción breve del contenido relevante que has leído (de la captura o del texto). Máx. 1000 caracteres." },
      motivo_si_vacio: { type: ["string", "null"], description: "Si no hay recordatorios, por qué (una frase)." },
    },
    required: ["recordatorios", "texto_leido", "motivo_si_vacio"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply("Usa POST desde el Atajo.", 405);

  // 1) Código del Atajo
  const auth = req.headers.get("authorization") || "";
  const token = (auth.match(/^Bearer\s+(\S+)$/i)?.[1] || req.headers.get("x-atajo-token") || "").trim();
  if (!/^cfc_[0-9a-f]{64}$/.test(token)) return reply("⚠️ Falta el código del Atajo o no es válido. Genéralo en la herramienta: menú → Conectar con Atajos.", 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: tok } = await sb.from("shortcut_tokens").select("id, user_id, uses_day, uses_count").eq("token_hash", await sha256hex(token)).maybeSingle();
  if (!tok) return reply("⚠️ Este código ya no es válido (puede que se revocara). Genera uno nuevo en la herramienta.", 401);
  const { data: prof } = await sb.from("profiles").select("role, status, full_name").eq("id", tok.user_id).maybeSingle();
  if (!prof || prof.role !== "coordinador" || prof.status !== "aprobado") return reply("⚠️ Tu cuenta ya no tiene permiso de coordinación.", 403);

  const today = todayKey();
  const used = tok.uses_day === today ? tok.uses_count : 0;
  if (used >= DAILY_LIMIT) return reply(`⚠️ Has llegado al límite de ${DAILY_LIMIT} recordatorios por Atajo hoy.`, 429);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply("⚠️ Falta configurar la clave de Claude en Supabase (secreto ANTHROPIC_API_KEY).", 503);

  // 2) Lo que llega del Atajo
  const input = await readInput(req).catch(() => "No he podido leer lo que ha enviado el Atajo.");
  if (typeof input === "string") return reply("⚠️ " + input, 400);
  if (input.text && input.text.length > 8000) input.text = input.text.slice(0, 8000);

  await sb.from("shortcut_tokens").update({ last_used_at: new Date().toISOString(), uses_day: today, uses_count: used + 1 }).eq("id", tok.id);

  // 3) Contexto: equipos y próximos partidos
  const { data: matches } = await sb.from("bookings")
    .select("day, team, start_min, opponent, away")
    .eq("kind", "partido").gte("day", addDays(today, -2)).lte("day", addDays(today, 35))
    .order("day").order("start_min").limit(120);
  const matchLines = (matches || []).map((m) =>
    `- ${shortDate(m.day)} (${m.day}) ${hhmm(m.start_min)} · ${TEAM_NAME[m.team] || m.team} vs ${m.opponent || "rival por definir"} · ${m.away ? "fuera" : "en casa"}`).join("\n");
  const teamLines = TEAMS.map((t) => `- ${t.id}: ${t.name} (también: ${t.alias})`).join("\n");

  const system = `Eres el asistente de la coordinación deportiva del Castalla C.F. (fútbol base y sénior).
Te llega un mensaje (a menudo una captura de WhatsApp, un texto reenviado o algo dictado por voz) y tienes que sacar las tareas que la coordinación no debe olvidar, y guardarlas con la herramienta.

Hoy es ${longDate(today)} (${today}), zona horaria de Madrid.

Equipos del club (usa el id):
${teamLines}

Próximos partidos (para entender «el partido del sábado», «contra Onil», etc.):
${matchLines || "- (no hay partidos cargados)"}

Reglas:
- Una entrada por cada tarea distinta. Si no hay nada que hacer (un saludo, una información sin acción), devuelve la lista vacía y explica por qué.
- Título en infinitivo, claro y corto, sin fechas (la fecha va aparte). Incluye el detalle que lo identifica (rival, persona, objeto).
- Fechas relativas («el viernes», «la semana que viene», «antes del partido») se resuelven respecto a hoy. «El viernes» es el próximo viernes (hoy incluido si hoy es viernes). «Mañana» es ${addDays(today, 1)}.
- Si la tarea está ligada a un partido, la fecha máxima es el día del partido salvo que se diga otra cosa.
- No inventes fechas: si no hay ninguna pista, fecha_maxima = null.
- fecha_aviso solo si se pide expresamente; si no, null (la herramienta lo pone 2 días antes).
- En capturas de WhatsApp, fíjate en quién escribe cada mensaje y en la hora/fecha de los mensajes; las tareas suelen ser peticiones hechas a la coordinación.
- Todo en español de España.`;

  const content: unknown[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.type, data: input.image.data } });
  content.push({ type: "text", text: input.text ? `Mensaje:\n${input.text}` : "Interpreta la captura adjunta." });

  // 4) Claude
  let out: { recordatorios?: any[]; texto_leido?: string; motivo_si_vacio?: string | null };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1500, system,
        tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Anthropic", r.status, t.slice(0, 500));
      return reply(r.status === 401 ? "⚠️ La clave de Claude no es válida. Revísala en Supabase." : `⚠️ Claude no ha podido responder (${r.status}). Prueba de nuevo en un momento.`, 502);
    }
    const j = await r.json();
    out = (j.content || []).find((c: any) => c.type === "tool_use")?.input || {};
  } catch (e) {
    console.error(e);
    return reply("⚠️ No he podido conectar con Claude. Prueba de nuevo en un momento.", 502);
  }

  // 5) Validar y guardar
  const sourceText = String(out.texto_leido || input.text || "").slice(0, 2000) || null;
  const rows = (Array.isArray(out.recordatorios) ? out.recordatorios : []).slice(0, 10).map((x) => {
    const title = String(x?.titulo || "").trim().slice(0, 200);
    if (!title) return null;
    const team = TEAM_IDS.has(x?.equipo) ? x.equipo : null;
    let due: string | null = isKey(x?.fecha_maxima) ? x.fecha_maxima : null;
    if (due && due < today) due = today;
    let alert: string | null = isKey(x?.fecha_aviso) ? x.fecha_aviso : null;
    if (due) {
      if (!alert || alert > due) alert = addDays(due, -ALERT_DAYS);
      if (alert < today) alert = today;
    } else if (alert && alert < today) alert = today;
    const notes = x?.notas ? String(x.notas).trim().slice(0, 1000) : null;
    return { title, team, due_date: due, alert_date: alert, notes, source: "atajo", source_text: sourceText, created_by: tok.user_id };
  }).filter(Boolean) as any[];

  if (!rows.length) return reply(`🤷 No he encontrado ninguna tarea${out.motivo_si_vacio ? ": " + out.motivo_si_vacio : "."}`);

  const { error } = await sb.from("reminders").insert(rows);
  if (error) { console.error(error); return reply("⚠️ No se ha podido guardar el recordatorio: " + error.message, 500); }

  const line = (r: any) => `${r.title}${r.team ? " · " + TEAM_NAME[r.team] : ""}${r.due_date ? " · hasta " + shortDate(r.due_date) + (r.alert_date && r.alert_date !== r.due_date ? " (aviso " + shortDate(r.alert_date) + ")" : "") : " · sin fecha"}`;
  return reply(rows.length === 1 ? `✅ ${line(rows[0])}` : `✅ ${rows.length} recordatorios:\n` + rows.map((r) => "• " + line(r)).join("\n"));
});
