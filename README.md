# ExamHall v3.0 — secure online tests

Zero-dependency Node.js app (needs Node 18+). No `npm install` required.

    examhall/
      server.js        the server (API, marking, timers, schedule, AI)
      package.json
      public/          index.html · app.js · pdf.js · style.css  (served to browsers)

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

## What's new in 3.0
**Question types**
- **Title / Text** — just writes something to the student (a heading, instructions, a reading passage). No marks, not numbered.
- **Question Bank** — the teacher adds up to 20 possible answers (shown to students as a table at the top), then writes
  sentences with `___` where the blank goes and picks the correct word for each. Students choose the word for every blank from a dropdown.
  Marks are split equally between the blanks and marked automatically. (If a sentence has no `___`, the blank is added at the end.)
- Questions can be moved up/down in the editor (until students have joined).

**Time limit** — set minutes per test. Each student's timer starts when they press *Start test*, is kept on the server
(refreshing or rejoining doesn't reset it), is shown as a countdown, and the test auto-submits at zero. A final autosave/submit that arrives
up to 30 s after time is up is still accepted.

**Scheduled open/close** — set "opens at" and "closes at". The test opens and closes itself; at the close time everyone still working is
submitted automatically (and their countdown never runs past the close time). The Open/Close buttons still work at any time.
Times use the teacher's browser time zone.

**Release results** — in *Monitor & mark* click **Release results** (optionally including the correct answers). Students then go to the start page,
enter the **same name and test code**, and see their score, answers and your feedback, with a **Download PDF** button. Students whose written
answers aren't marked yet see "not marked yet" until you save their marks. *Unrelease* hides results again. Tests with no written questions are
auto-marked, so they're viewable immediately after release.
Note: name + code is the "key" to a result, so anyone who knows a classmate's exact name and the code could look it up. Don't release results if that matters for your class,
or ask students to use a unique name. (Lookups are rate-limited per IP.)

**Stricter cheating signals** (all shown to the teacher as flags with times; they are *hints, not proof*):
- window/tab/focus loss — even a ~1 second loss is logged, and the time the student was away is added ("away 4s")
- pasted text — paste is still blocked, but every attempt is logged with how many characters. Copy/cut attempts and text dropped into an answer are logged too
- large text insertions (40+ characters appearing at once)
- long pauses (3+ minutes with no keyboard/mouse/touch activity, logged when the student returns)
- window resizes (ignores full-screen changes, and phone keyboards)
- leaving full screen, and reloading/rejoining the page (as before)

**PDF export** — "Export for student" now downloads a **PDF** with the same look as before (title, name and score, a box per question with marks,
the student's answer, the expected answer and highlighted teacher feedback). It is generated in the browser with no libraries.
Each page is embedded as an image, so every language and symbol renders correctly (the text is not selectable/searchable).

**AI generator** — can now also write **Question Bank** questions (word bank + sentences + correct words). Set the counts per type as before.

## Security notes
- Teacher login is checked ONLY on the server against a salted scrypt hash. No password exists in the code or in anything served to browsers.
- 5 wrong logins from one IP = 10-minute lockout. Sessions are signed, HttpOnly, SameSite=Strict cookies (8h).
- Students never receive correct answers while taking the test; marking happens on the server; students only get an unguessable token for their own attempt.
  Correct answers are only sent after you release results with "show correct answers" ticked.
- To change the teacher login without editing code, set env vars `TEACHER_USER` and `TEACHER_PASS`. Set `SESSION_SECRET` to a long random string too.
- Tab/window/full-screen leaving is detected and logged, but no browser-based proctoring can stop a second device.

## Data
Everything is stored in one JSON file (`data/db.json` by default). Back it up to keep results. Suited to classroom scale.
Old (v1/v2) data files and backups load fine in v3.

## AI question generator (optional)
Set ONE of these environment variables on your host, then redeploy:
- `GEMINI_API_KEY` — free key from Google AI Studio (aistudio.google.com). Optional `GEMINI_MODEL` (default `gemini-flash-latest`).
- `ANTHROPIC_API_KEY` — paid Claude key. Optional `CLAUDE_MODEL` (default `claude-haiku-5-5`). Takes priority if both are set.
The key never leaves the server. Teachers can generate up to 20 times per hour. Always check AI questions before saving.

## Browser backup
While the teacher dashboard or a monitor page is open, a copy of all tests + results is saved in that browser. If the server restarts and loses data, the dashboard shows "Restore from this browser". You can also download/restore a backup file. Backups never contain student tokens.
