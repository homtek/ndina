// Run ONCE:  node owner/gen-keys.mjs
// Creates owner/private-key.json (KEEP SECRET, never upload it) and writes the public key into app/js/config.js
import fs from 'node:fs';
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await crypto.subtle.exportKey('jwk', privateKey);
const pub = await crypto.subtle.exportKey('jwk', publicKey);
const dir = new URL('.', import.meta.url);
if (fs.existsSync(new URL('private-key.json', dir))) { console.error('owner/private-key.json already exists. Delete it first if you really want new keys (old codes will stop working).'); process.exit(1); }
fs.writeFileSync(new URL('private-key.json', dir), JSON.stringify(priv, null, 2));
const cfgUrl = new URL('../app/js/config.js', dir);
let cfg = fs.readFileSync(cfgUrl, 'utf8');
cfg = cfg.replace(/publicKey:\s*\{[^}]*\}/s, `publicKey: ${JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y })}`);
fs.writeFileSync(cfgUrl, cfg);
console.log('Done. Private key saved to owner/private-key.json. Public key written to app/js/config.js');
