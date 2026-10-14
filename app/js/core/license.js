// Offline leader codes: ECDSA P-256 signature checked with the public key in config.js.
// Code format:  NDN1.<payload>.<signature>   (both base64url)
const enc = new TextEncoder();
const b64uToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const bytesToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function signCode(privateJwk, payload) {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const body = bytesToB64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(body));
  return `NDN1.${body}.${bytesToB64u(sig)}`;
}

// returns { ok:true, payload } or { ok:false, reason:'format'|'signature'|'expired'|'unsupported' }
export async function verifyCode(code, publicJwk, todayIso) {
  try {
    const parts = String(code || '').trim().replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== 'NDN1') return { ok: false, reason: 'format' };
    if (!globalThis.crypto?.subtle) return { ok: false, reason: 'unsupported' };
    const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBytes(parts[2]), enc.encode(parts[1]));
    if (!valid) return { ok: false, reason: 'signature' };
    const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])));
    if (payload.r !== 'leader') return { ok: false, reason: 'format' };
    if (payload.e && todayIso > payload.e) return { ok: false, reason: 'expired', payload };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'format' };
  }
}
