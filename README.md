# ExamHall — secure online tests

Zero-dependency Node.js app (needs Node 18+). No `npm install` required.

## Run locally
    node server.js        # then open http://localhost:3000

## Deploy (pick one)
**Render.com** (easiest)
1. Put this folder in a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: *(leave empty)*  ·  Start command: `node server.js`
4. IMPORTANT, data persistence: Render's free tier wipes files on every restart/redeploy.
   Add a Disk (paid) mounted at `/var/data` and set env var `DATA_FILE=/var/data/db.json`.

**Railway / Fly.io** — same idea: start command `node server.js`, attach a volume, set `DATA_FILE` to a path on it.

## Custom domain / Wix
Add a subdomain (e.g. `tests.yourdomain.com`) as a custom domain in your host, then in Wix → Domains → DNS,
add the CNAME record your host shows you. Your Wix site can link to it with a normal button.
Always use the https:// address (secure cookies).

## Security notes
- Teacher login is checked ONLY on the server against a salted scrypt hash. No password exists in the code or in anything served to browsers.
- 5 wrong logins from one IP = 10-minute lockout. Sessions are signed, HttpOnly, SameSite=Strict cookies (8h).
- Students never receive correct answers; marking happens on the server; students only get an unguessable token for their own attempt.
- To change the teacher login without editing code, set env vars `TEACHER_USER` and `TEACHER_PASS`. Set `SESSION_SECRET` to a long random string too.
- Tab/window/full-screen leaving is detected and logged, but no browser-based proctoring can stop a second device.

## Data
Everything is stored in one JSON file (`data/db.json` by default). Back it up to keep results. Suited to classroom scale.

## AI question generator (optional)
Set ONE of these environment variables on your host, then redeploy:
- `GEMINI_API_KEY` — free key from Google AI Studio (aistudio.google.com). Optional `GEMINI_MODEL` (default `gemini-flash-latest`).
- `ANTHROPIC_API_KEY` — paid Claude key. Optional `CLAUDE_MODEL` (default `claude-haiku-5-5`). Takes priority if both are set.
The key never leaves the server. Teachers can generate up to 20 times per hour. Always check AI questions before saving.

## Browser backup
While the teacher dashboard or a monitor page is open, a copy of all tests + results is saved in that browser. If the server restarts and loses data, the dashboard shows "Restore from this browser". You can also download/restore a backup file. Backups never contain student tokens.
