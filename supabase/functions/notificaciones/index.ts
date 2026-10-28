// Notificaciones push para la coordinación (Web Push a la app instalada / navegador).
//  - mode "tick"   (tarea programada cada 15 min, cabecera x-cron-secret): resumen diario a la hora de cada coordinador.
//  - mode "altas"  (trigger al crearse un perfil, x-cron-secret): aviso inmediato de altas de entrenadores.
//  - mode "config" (coordinador con su sesión): devuelve la clave pública VAPID (la genera la primera vez).
//  - mode "test"   (coordinador): notificación de prueba a sus dispositivos.
//  - mode "preview"(coordinador): le envía ahora su resumen de hoy.
// Las claves VAPID y el secreto de la tarea viven en Vault (public.notif_config, solo clave de servicio).
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKeys, sendPush } from "./webpush.js";

const TZ = "Europe/Madrid";
const SUBJECT = "https://intranet.cfcastalla.com";
const HORIZON = 14;            // días de conflictos que se avisan
const CATCH_UP_MIN = 120;      // si se pierde un tramo, se envía hasta 2 h después

// Nombres de los equipos (mismos id que config.js)
const TEAM_NAME: Record<string, string> = {
  "senior-a": "Senior A", "senior-b": "Senior B", "veteranos": "Veteranos", "juvenil": "Juvenil", "cadete": "Cadete",
  "infantil-a": "Infantil A", "infantil-b": "Infantil B", "alevin-a": "Alevín A", "alevin-b": "Alevín B",
  "tec-1": "Tecnificación 1", "tec-2": "Tecnificación 2",
};
const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- Fechas en Madrid ----------
function nowMadrid() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : +p.hour;
  return { today: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + +p.minute };
}
const parseKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (k: string, n: number) => { const d = parseKey(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shortDate = (k: string) => { const d = parseKey(k); return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeToMin = (t: string) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const daysBetween = (a: string, b: string) => Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 864e5);
const lines = (arr: string[], max = 5) => arr.length <= max ? arr.join("\n") : arr.slice(0, max).join("\n") + `\n…y ${arr.length - max} más`;

type Sb = ReturnType<typeof createClient>;
type Msg = { title: string; body: string; url?: string; tag?: string };

async function getVapid(sb: Sb) {
  let { data: cfg } = await sb.rpc("notif_config");
  if (!cfg?.vapid_private) {
    const k = await generateVapidKeys();
    await sb.rpc("notif_set_vapid", { p_private: k.privateJwk, p_public: k.publicKey });
    ({ data: cfg } = await sb.rpc("notif_config"));
  }
  return { cfg, vapid: { privateJwk: cfg.vapid_private as string, publicKey: cfg.vapid_public as string, subject: SUBJECT } };
}

/** Envía los mensajes a todos los dispositivos del usuario; limpia los que ya no existen */
async function sendToUser(sb: Sb, vapid: any, userId: string, msgs: Msg[]) {
  if (!msgs.length) return { sent: 0, devices: 0 };
  const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth, fail_count").eq("user_id", userId);
  let sent = 0;
  for (const s of subs || []) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    let ok = true, gone = false;
    for (const m of msgs) {
      try {
        const r = await sendPush(sub, JSON.stringify(m), vapid, { urgency: "high", topic: m.tag });
        if (r.ok) sent++; else { ok = false; gone = gone || r.gone; console.error("push", r.status, r.text); }
        if (r.gone) break;
      } catch (e) { ok = false; console.error("push", e); }
    }
    if (gone || (!ok && s.fail_count >= 9)) await sb.from("push_subscriptions").delete().eq("id", s.id);
    else await sb.from("push_subscriptions").update(ok ? { last_ok_at: new Date().toISOString(), fail_count: 0 } : { fail_count: s.fail_count + 1 }).eq("id", s.id);
  }
  return { sent, devices: (subs || []).length };
}

/** Resumen del día para un coordinador según sus preferencias */
async function buildDigest(sb: Sb, kinds: Record<string, boolean>, today: string, teams: string[] | null = null): Promise<Msg[]> {
  const out: Msg[] = [];
  const k = { recordatorios: true, conflictos: true, resumen: true, ...(kinds || {}) };
  // Cada coordinador recibe lo de sus equipos (y lo que no es de ningún equipo); sin equipos asignados, todo el club
  const mine = (t: string | null | undefined) => !teams || !t || teams.includes(t);
  const mineItem = (x: any) => { const ts: string[] = Array.isArray(x.teams) ? x.teams : (x.team ? [x.team] : []); return !ts.length || ts.some(mine); };

  if (k.recordatorios) {
    const { data: remsAll } = await sb.from("reminders").select("title, team, due_date, alert_date, waiting_on").eq("done", false);
    const rems = (remsAll || []).filter((r) => mine(r.team));
    const tn = (r: any) => (r.team ? ` (${TEAM_NAME[r.team] || r.team})` : "") + (r.waiting_on ? ` · ⏳ ${r.waiting_on}` : "");
    const overdue = (rems || []).filter((r) => r.due_date && r.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const dueToday = (rems || []).filter((r) => r.due_date === today);
    const newUrgent = (rems || []).filter((r) => r.alert_date === today && (!r.due_date || r.due_date > today));
    const stillUrgent = (rems || []).filter((r) => r.alert_date && r.alert_date < today && (!r.due_date || r.due_date > today));
    const l = [
      ...overdue.map((r) => `🔴 ${r.title}${tn(r)} · venció ${shortDate(r.due_date)}`),
      ...dueToday.map((r) => `❗ Hoy: ${r.title}${tn(r)}`),
      ...newUrgent.map((r) => `⏰ ${r.title}${tn(r)}${r.due_date ? " · hasta " + shortDate(r.due_date) : ""}`),
      ...stillUrgent.map((r) => `⏳ ${r.title}${tn(r)}${r.due_date ? " · hasta " + shortDate(r.due_date) : ""}`),
    ];
    if (l.length) {
      const n = overdue.length + dueToday.length + newUrgent.length + stillUrgent.length;
      const head = [overdue.length && `${overdue.length} vencido${overdue.length > 1 ? "s" : ""}`, dueToday.length && `${dueToday.length} para hoy`, (newUrgent.length + stillUrgent.length) && `${newUrgent.length + stillUrgent.length} urgente${newUrgent.length + stillUrgent.length > 1 ? "s" : ""}`].filter(Boolean).join(", ");
      out.push({ title: `⏰ Recordatorios: ${head}`, body: lines(l), url: "./#inicio", tag: "recordatorios" });
      void n;
    }
  }

  const { data: snap } = await sb.from("issue_snapshot").select("computed_at, items").eq("id", 1).maybeSingle();
  const items: any[] = (Array.isArray(snap?.items) ? snap!.items : []).filter(mineItem);
  const age = snap?.computed_at ? daysBetween(new Date(snap.computed_at).toISOString().slice(0, 10), today) : null;

  if (k.conflictos) {
    const limit = addDays(today, HORIZON);
    const errs = items.filter((x) => x.level === "error" && x.day >= today && x.day <= limit);
    if (errs.length) {
      out.push({
        title: `⛔ ${errs.length} conflicto${errs.length > 1 ? "s" : ""} en el calendario`,
        body: lines(errs.map((x) => `${shortDate(x.day)}${x.at ? " " + hhmm(x.at) : ""} · ${x.msg}`), 4) + (age && age > 2 ? `\n(revisado hace ${age} días)` : ""),
        url: "./#inicio", tag: "conflictos",
      });
    }
    // Horarios confirmados sin comunicar (a la directiva o al grupo del equipo) en los próximos días
    const comm = items.filter((x) => x.kind === "comm" && x.day >= today && x.day <= addDays(today, 7));
    if (comm.length) {
      out.push({
        title: `📣 ${comm.length} horario${comm.length > 1 ? "s" : ""} por comunicar`,
        body: lines(comm.map((x) => `${shortDate(x.day)}${x.at ? " " + hhmm(x.at) : ""} · ${x.msg}`), 4),
        url: "./#inicio", tag: "comunicar",
      });
    }
  }

  if (k.resumen) {
    const { data: bk } = await sb.from("bookings").select("team, kind, start_min, opponent, away, title, confirmed").eq("day", today).order("start_min");
    const list = (bk || []).filter((b) => mine(b.team));
    const matches = list.filter((b) => b.kind === "partido");
    const events = list.filter((b) => b.kind === "evento");
    const trainings = list.filter((b) => b.kind === "entreno").length;
    const changes = items.filter((x) => x.level === "change" && x.day === today);
    const l: string[] = [];
    for (const m of matches) l.push(`⚽ ${hhmm(m.start_min)} ${TEAM_NAME[m.team] || m.team} vs ${m.opponent || "rival por definir"} ${m.away ? "✈️" : "🏠"}${m.confirmed || m.away ? "" : " (por confirmar)"}`);
    for (const e of events) l.push(`📌 ${hhmm(e.start_min)} ${e.title || "Reserva extraordinaria"}`);
    if (trainings) l.push(`🏃 ${trainings} entreno${trainings > 1 ? "s" : ""}`);
    for (const c of changes) l.push(`↻ ${c.msg}`);
    if (l.length) out.push({ title: `📅 Hoy, ${shortDate(today)}`, body: lines(l, 6), url: "./", tag: "hoy" });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "");
  const { cfg, vapid } = await getVapid(sb);
  const { today, minutes } = nowMadrid();

  // ---- Llamadas del sistema (tarea programada y trigger) ----
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    if (!cfg?.cron_secret || cron !== cfg.cron_secret) return json({ error: "No autorizado" }, 401);

    if (mode === "tick") {
      const { data: rows } = await sb.from("notify_settings").select("user_id, notify_time, kinds, last_digest_on").eq("enabled", true);
      let users = 0, sent = 0;
      for (const s of rows || []) {
        if (s.last_digest_on && s.last_digest_on >= today) continue;
        const t = timeToMin(s.notify_time);
        if (minutes < t || minutes - t > CATCH_UP_MIN) continue;
        const { data: prof } = await sb.from("profiles").select("role, status, teams").eq("id", s.user_id).maybeSingle();
        if (prof?.role !== "coordinador" || prof?.status !== "aprobado") continue;
        await sb.from("notify_settings").update({ last_digest_on: today }).eq("user_id", s.user_id);
        const msgs = await buildDigest(sb, s.kinds, today, prof.teams?.length ? prof.teams : null);
        const r = await sendToUser(sb, vapid, s.user_id, msgs);
        users++; sent += r.sent;
      }
      return json({ ok: true, users, sent });
    }

    if (mode === "altas") {
      const { data: p } = await sb.from("profiles").select("id, full_name, email, role, status, teams").eq("id", body.profile_id).maybeSingle();
      if (!p) return json({ ok: false, error: "perfil no encontrado" });
      const { data: coords } = await sb.from("profiles").select("id").eq("role", "coordinador").eq("status", "aprobado").neq("id", p.id);
      const { data: prefs } = await sb.from("notify_settings").select("user_id, kinds, enabled");
      const pref = new Map((prefs || []).map((x) => [x.user_id, x]));
      const teams = (p.teams || []).map((t: string) => TEAM_NAME[t] || t).join(", ");
      const msg: Msg = {
        title: p.role === "coordinador" ? "👤 Nuevo coordinador" : "👤 Nuevo entrenador",
        body: `${p.full_name || p.email} se ha registrado${teams ? ` (${teams})` : ""}${p.status === "pendiente" ? " y está pendiente de aprobar" : ""}.`,
        url: "./", tag: "altas",
      };
      let sent = 0;
      for (const c of coords || []) {
        const s = pref.get(c.id);
        if (s && (!s.enabled || s.kinds?.altas === false)) continue;
        const { error } = await sb.from("push_log").insert({ user_id: c.id, kind: "altas", ref: p.id, sent_on: today });
        if (error) continue;   // ya avisado
        sent += (await sendToUser(sb, vapid, c.id, [msg])).sent;
      }
      return json({ ok: true, sent });
    }
    return json({ error: "Modo desconocido" }, 400);
  }

  // ---- Llamadas de un coordinador desde la herramienta ----
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user) return json({ error: "Inicia sesión" }, 401);
  const { data: prof } = await sb.from("profiles").select("role, status, teams").eq("id", u.user.id).maybeSingle();
  if (prof?.role !== "coordinador" || prof?.status !== "aprobado") return json({ error: "Solo para coordinadores" }, 403);

  if (mode === "config") return json({ publicKey: vapid.publicKey });
  if (mode === "test") {
    const r = await sendToUser(sb, vapid, u.user.id, [{ title: "✅ Notificaciones activadas", body: "Así te llegarán los avisos del Castalla C.F.", url: "./#inicio", tag: "prueba" }]);
    return json({ ok: true, ...r });
  }
  if (mode === "preview") {
    const { data: s } = await sb.from("notify_settings").select("kinds").eq("user_id", u.user.id).maybeSingle();
    const msgs = await buildDigest(sb, s?.kinds || {}, today, prof.teams?.length ? prof.teams : null);
    if (!msgs.length) msgs.push({ title: "👌 Todo en orden", body: "Hoy no hay recordatorios urgentes, conflictos ni actividad que avisar.", url: "./#inicio", tag: "resumen" });
    const r = await sendToUser(sb, vapid, u.user.id, msgs);
    return json({ ok: true, messages: msgs.length, ...r });
  }
  return json({ error: "Modo desconocido" }, 400);
});
