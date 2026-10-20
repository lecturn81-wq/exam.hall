# ExamHall v3.0

Zero-dependency Node.js app (Node 18+). Start with `node server.js`, then open http://localhost:3000.

## Version 3.0 additions
- Title/text questions and Question Bank fill-in questions (up to 20 choices).
- Per-test countdown timer and scheduled open/close fields.
- More monitoring signals: focus loss, paste attempts, long inactivity, and window resize. Signals are clues, not proof of cheating.
- Teacher release/unrelease control for student results.
- Student export opens a print-ready report; choose **Save as PDF** in the browser print dialog to create the PDF.
- AI generation supports Title and Question Bank counts when an AI provider is configured.

## Teacher login and deployment
Set `TEACHER_USER`, `TEACHER_PASS`, and a long random `SESSION_SECRET` in your environment. If omitted, the built-in demo credentials remain active; set your own credentials before deploying publicly.

Deploy on Render/Railway/Fly with start command `node server.js`. Set `DATA_FILE` to a persistent-volume path (for example `/var/data/db.json`) so data survives redeploys.

## Optional AI
Set `GEMINI_API_KEY` (Google AI Studio) or `ANTHROPIC_API_KEY` (Claude). Keys stay on the server. Review generated questions before publishing.

## Notes
Browser monitoring is not proof of misconduct and cannot detect a second device. Scheduled open/close are enforced when a student joins; the teacher should keep the server running. Time limits are client countdowns and should be paired with server-side monitoring; do not treat browser-based controls as tamper-proof proctoring. Keep backups of `data/db.json`.
