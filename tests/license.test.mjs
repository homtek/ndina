import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONFIG } from '../app/js/config.js';
import { signCode, verifyCode } from '../app/js/core/license.js';

const priv = JSON.parse(fs.readFileSync(new URL('../owner/private-key.json', import.meta.url), 'utf8'));

test('valid code verifies, tampered or expired codes do not', async () => {
  const code = await signCode(priv, { r: 'leader', g: 'GEREZANI', t: 'TAARIFA', e: '2027-01-31' });
  assert.equal((await verifyCode(code, CONFIG.publicKey, '2026-10-14')).ok, true);
  assert.equal((await verifyCode(code, CONFIG.publicKey, '2027-02-01')).reason, 'expired');
  const [a, b, c] = code.split('.');
  const forged = [a, Buffer.from(JSON.stringify({ r: 'leader', g: 'X', e: '2099-01-01' })).toString('base64url'), c].join('.');
  assert.equal((await verifyCode(forged, CONFIG.publicKey, '2026-10-14')).reason, 'signature');
  assert.equal((await verifyCode('hello', CONFIG.publicKey, '2026-10-14')).reason, 'format');
});
