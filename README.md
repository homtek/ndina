# Ndina

Offline-first web app (PWA) for daily revenue reports. No server, no login, no running cost.
Members read GePG screenshots on their own phone; leaders compile and check the group's reports.

```
app/      the website. This is the ONLY folder you upload.
owner/    YOUR private tools and key. NEVER upload this.
tests/    automated checks (npm test)
```

## Put it online (free, 10 minutes)
1. Cloudflare Pages (or Netlify / GitHub Pages) → create a project → upload the **app** folder only.
2. Open the link on a phone using Chrome → menu → **Add to Home screen**.
3. Open it once with data on and wait ~1 minute. The reading engine (about 11 MB) downloads once, then Ndina works with no data.

It must be served over https (all the hosts above do this). Opening index.html directly from a file will not work.

## Leader codes
A leader sees the Leader area only after entering a code that you sign.
- Easiest: open `owner/code-maker.html`, choose `owner/private-key.json`, fill group, title and expiry date, press Make code, send the code by WhatsApp.
- Or: `node owner/make-code.mjs --group GEREZANI --title "TAARIFA YA SIKU YA GEREZANI" --until 2027-01-31`

Keep `owner/private-key.json` safe and backed up. If you lose it you cannot make new codes; if someone else gets it they can. To start over: delete it and run `node owner/gen-keys.mjs` (every old code stops working, and you must redeploy `app`).
Codes cannot be cancelled remotely (there is no server), so use expiry dates. The check is a gate for trusted colleagues, not strong security.

## Updating the app
Change files in `app/`, bump `VERSION` in `app/sw.js`, upload again. Phones update next time they open it online.

## Using it
Member: Ripoti yangu → Chagua screenshot (many at once) → check → Tuma WhatsApp.
Leader: Kiongozi → Wanachama (paste an old compiled report to get names) → Pokea (paste group chat) → Makosa → Ripoti kuu.
The app checks: duplicates across members, same control number with different amounts, count/total mistakes, wrong date, yesterday's lines, bad control numbers.

## Know the limits
- Data lives only on each phone. Tell everyone to use Zaidi → Pakua nakala regularly.
- Sending to WhatsApp opens WhatsApp with the text ready; the person picks the group and taps send (WhatsApp does not allow apps to post into groups by themselves).
- Reading depends on GePG keeping the same Payment Details layout. If it changes, edit `app/js/core/gepg.js`.
- Tested: your two screenshots, your 13.10.2026 report, and the full flow in headless Chrome. Not yet tested on real cheap Android phones. Try with 3–4 members first.
