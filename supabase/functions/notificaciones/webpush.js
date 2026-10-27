// Web Push sin dependencias: VAPID (RFC 8292) + cifrado aes128gcm (RFC 8188 / RFC 8291) con WebCrypto.
// Funciona en Deno (Supabase Edge Functions) y en Node ≥ 20 (para las pruebas).
const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = '';
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  },
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Genera un par de claves VAPID: privada como JWK (texto) y pública como base64url (65 bytes sin comprimir) */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { privateJwk: JSON.stringify(jwk), publicKey: b64u.encode(raw) };
}

/** Cabecera Authorization de VAPID para el servicio de push del endpoint */
export async function vapidAuthorization(endpoint, privateJwk, publicKey, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${publicKey}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Cifra el mensaje para una suscripción (RFC 8291). Devuelve el cuerpo listo para enviar. */
export async function encryptPayload(sub, payload, saltIn) {
  const uaPublic = b64u.decode(sub.keys.p256dh);
  const authSecret = b64u.decode(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = saltIn || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const data = typeof payload === 'string' ? enc.encode(payload) : payload;
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(data, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]);   // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/** Envía una notificación. Devuelve { ok, status, gone } (gone = la suscripción ya no existe) */
export async function sendPush(sub, payload, vapid, { ttl = 24 * 3600, urgency = 'normal', topic } = {}) {
  const body = await encryptPayload(sub, payload);
  const headers = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
    Authorization: await vapidAuthorization(sub.endpoint, vapid.privateJwk, vapid.publicKey, vapid.subject),
  };
  if (topic) headers.Topic = topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  const text = r.ok ? '' : await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410, text: text.slice(0, 300) };
}
