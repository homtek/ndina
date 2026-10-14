// node owner/make-code.mjs --group "GEREZANI" --title "TAARIFA YA SIKU YA GEREZANI" --until 2027-01-31
import fs from 'node:fs';
import { signCode } from '../app/js/core/license.js';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const priv = JSON.parse(fs.readFileSync(new URL('private-key.json', import.meta.url), 'utf8'));
const payload = { r: 'leader', g: arg('group', ''), t: arg('title', ''), e: arg('until', ''), i: Date.now().toString(36) };
if (!payload.g || !payload.e) { console.error('Usage: node owner/make-code.mjs --group NAME --title "REPORT TITLE" --until YYYY-MM-DD'); process.exit(1); }
console.log(await signCode(priv, payload));
