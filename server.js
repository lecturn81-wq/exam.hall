"use strict";
// ExamHall server — zero dependencies. Run: node server.js
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, "data", "db.json");
const PUB = path.join(__dirname, "public");
const GRACE = 30000; // ms after a deadline/close during which a student's last autosave/submit is still accepted

/* Teacher credential = salted scrypt hash (no plaintext stored anywhere).
   To change it, set TEACHER_USER and TEACHER_PASS environment variables. */
const scrypt = (s, salt) => crypto.scryptSync(s, Buffer.from(salt, "hex"), 32).toString("hex");
let SALT = "12d3a66c164be9fa13c5ba6e35c5cdfb", HASH = "4d385b2daeb9655ff22bc42bb8c8fdb369178b9f23a8feef5de0f4251fec2927";
if (process.env.TEACHER_USER && process.env.TEACHER_PASS) {
  SALT = crypto.randomBytes(16).toString("hex");
  HASH = scrypt(process.env.TEACHER_USER + ":" + process.env.TEACHER_PASS, SALT);
}

/* ---------- storage (JSON file, atomic writes) ---------- */
let db = { tests: {}, subs: {}, secret: crypto.randomBytes(32).toString("hex") };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA, "utf8"))); } catch (_) {}
fs.mkdirSync(path.dirname(DATA), { recursive: true });
let st;
function flush() { const tmp = DATA + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DATA); }
const persist = () => { clearTimeout(st); st = setTimeout(flush, 250); };
process.on("SIGTERM", () => { flush(); process.exit(0); });
process.on("SIGINT", () => { flush(); process.exit(0); });
flush();
const SECRET = process.env.SESSION_SECRET || db.secret;

/* ---------- auth ---------- */
const sign = x => crypto.createHmac("sha256", SECRET).update(x).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkSession = () => { const exp = Date.now() + 8 * 3600e3; return exp + "." + sign("t" + exp); };
function isTeacher(req) {
  const m = /(?:^|; )eh=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return false;
  const [exp, sg] = m[1].split("."); return +exp > Date.now() && !!sg && safeEq(sg, sign("t" + exp));
}
const ipOf = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const fails = new Map();
const looks = new Map();
function lookupOk(ip) { // limits how fast one IP can view released results (name + code lookups)
  const n = Date.now(); let f = looks.get(ip); if (!f || f.until < n) f = { n: 0, until: n + 600e3 };
  f.n++; looks.set(ip, f);
  if (looks.size > 5000) for (const [k, v] of looks) if (v.until < n) looks.delete(k);
  return f.n <= 120;
}
const delay = ms => new Promise(r => setTimeout(r, ms));

/* ---------- helpers ---------- */
const HDR = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function send(res, code, body, extra = {}) {
  const isObj = body && typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(code, { ...HDR, "Content-Type": isObj ? "application/json" : (extra.type || "text/plain"), "Cache-Control": "no-store", ...extra.h });
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, code, error, more) => send(res, code, { error, ...more });
function readBody(req, max = 1e6) {
  return new Promise((ok, no) => {
    let s = "", n = 0;
    req.on("data", c => { n += c.length; if (n > max) { no("Too large"); req.destroy(); } else s += c; });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (_) { no("Bad JSON"); } });
  });
}
const newCode = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c; do { c = Array.from({ length: 6 }, () => a[crypto.randomInt(a.length)]).join(""); } while (db.tests[c]); return c; };
const subsOf = code => Object.values(db.subs).filter(s => s.code === code);
const byToken = t => typeof t === "string" && t.length > 20 ? Object.values(db.subs).find(s => s.token === t) : null;

/* question types: mc, tf, drag, wr (written), bk (question bank / fill the blanks), ti (title / plain text, no marks) */
const TYPES = ["mc", "tf", "drag", "wr", "bk", "ti"];
function cleanQs(qs) {
  if (!Array.isArray(qs) || !qs.length || qs.length > 100) throw "Add between 1 and 100 items.";
  const L = (a, n = 500) => (Array.isArray(a) ? a : []).map(x => String(x).trim().slice(0, n)).filter(Boolean);
  let real = 0;
  const out = qs.map((q, i) => {
    const n = "Item " + (i + 1) + ": ";
    const o = { t: q.t, q: String(q.q || "").trim().slice(0, 3000), pts: Number(q.pts) };
    if (!TYPES.includes(o.t)) throw n + "invalid type";
    if (!o.q) throw n + (o.t === "ti" ? "the title text is empty" : "question text is empty");
    if (o.t === "ti") { o.pts = 0; return o; }
    real++;
    if (!(o.pts >= 0 && o.pts <= 1000)) throw n + "invalid marks";
    if (o.t === "mc") { o.opts = L(q.opts); o.ans = Number(q.ans); if (o.opts.length < 2 || o.opts.length > 12) throw n + "needs 2-12 options"; if (!Number.isInteger(o.ans) || o.ans < 0 || o.ans >= o.opts.length) throw n + "correct option out of range"; }
    if (o.t === "tf") o.ans = q.ans === true;
    if (o.t === "drag") { o.items = L(q.items); if (o.items.length < 2 || o.items.length > 12) throw n + "needs 2-12 items"; }
    if (o.t === "bk") {
      o.bank = L(q.bank, 100); if (o.bank.length < 2 || o.bank.length > 20) throw n + "the word bank needs 2-20 words";
      o.sents = (Array.isArray(q.sents) ? q.sents : []).map(x => ({ s: String((x && x.s) || "").trim().slice(0, 500), a: Number(x && x.a) })).filter(x => x.s);
      if (o.sents.length < 1 || o.sents.length > 30) throw n + "needs 1-30 sentences";
      if (o.sents.some(x => !Number.isInteger(x.a) || x.a < 0 || x.a >= o.bank.length)) throw n + "every sentence needs a correct word from the bank";
    }
    return o;
  });
  if (!real) throw "Add at least one real question (a test can't be only titles).";
  return out;
}
/* time limit + schedule. strict=true validates teacher input; strict=false is lenient (used for restoring backups) */
function sched(b, old, strict = true) {
  const lim = b.limit === "" || b.limit == null ? 0 : Number(b.limit);
  if (strict && (!Number.isFinite(lim) || lim < 0 || lim > 600)) throw "Time limit must be between 0 and 600 minutes (0 = no limit).";
  const ts = v => { const n = Number(v); return v && Number.isFinite(n) && n > 1e12 && n < 4e12 ? Math.round(n) : null; };
  const o = ts(b.opensAt), c = ts(b.closesAt);
  if (strict) {
    if (b.opensAt && !o || b.closesAt && !c) throw "Invalid open/close time.";
    if (o && c && c <= o) throw "The close time must be after the open time.";
    if (c && c <= Date.now() && !(old && old.closesAt === c)) throw "The close time must be in the future.";
  }
  return { limit: Number.isFinite(lim) ? Math.max(0, Math.min(600, Math.round(lim * 100) / 100)) : 0, opensAt: o, closesAt: c };
}
function auto(q, a) {
  if (q.t === "ti") return 0; if (q.t === "wr") return null; if (a === undefined || a === null) return 0;
  if (q.t === "bk") { if (!Array.isArray(a)) return 0; const c = q.sents.filter((x, j) => a[j] === x.a).length; return Math.round(q.pts * c / q.sents.length * 100) / 100; }
  if (q.t === "drag") return Array.isArray(a) && a.length === q.items.length && a.every((v, k) => v === k) ? q.pts : 0;
  return a === q.ans ? q.pts : 0;
}
function mark(t, s, i) { const m = (s.marks || {})["q" + i]; return m !== undefined && m !== null ? Number(m) : (auto(t.qs[i], (s.answers || {})["q" + i]) || 0); }
const total = t => t.qs.reduce((a, q) => a + q.pts, 0);
function isAns(q, a) {
  if (q.t === "ti") return false; if (q.t === "wr") return !!(a && a.trim());
  if (q.t === "bk") return Array.isArray(a) && a.length > 0 && a.every(x => x !== null && x !== undefined);
  return a !== undefined && a !== null;
}
const answered = (t, s) => t.qs.filter((q, i) => isAns(q, (s.answers || {})["q" + i])).length;
const hasWr = t => t.qs.some(q => q.t === "wr");
const ready = (t, s) => s.status === "done" && (!!s.reviewed || !hasWr(t)); // fully marked (or auto-markable)
const resultsReady = (t, s) => !!t.released && ready(t, s);
const summary = (t, s) => ({ id: s.id, name: s.name, status: s.status, reviewed: !!s.reviewed, ready: ready(t, s), answered: answered(t, s), score: Math.round(t.qs.reduce((a, _, i) => a + mark(t, s, i), 0) * 100) / 100, total: total(t), flags: (s.flags || []).length, updated: s.updated, submitted: s.submitted });

/* text versions of answers (used for released results) */
const fillS = (s, w) => /_{3,}/.test(s) ? s.replace(/_{3,}/, "[" + w + "]") : s + " [" + w + "]";
function aTxt(q, a) {
  if (q.t === "bk") { const ar = Array.isArray(a) ? a : []; return q.sents.map((x, j) => { const v = ar[j]; return (v == null ? "– " : v === x.a ? "✓ " : "✗ ") + (j + 1) + ". " + fillS(x.s, v == null ? "…" : q.bank[v]); }).join("\n"); }
  if (a === undefined || a === null || a === "") return "(no answer)";
  if (q.t === "mc") return q.opts[a] ?? "(no answer)"; if (q.t === "tf") return a ? "True" : "False";
  if (q.t === "drag") return Array.isArray(a) ? a.map(k => q.items[k]).join(" → ") : "(no answer)"; return String(a);
}
const cTxt = q => q.t === "mc" ? q.opts[q.ans] : q.t === "tf" ? (q.ans ? "True" : "False") : q.t === "drag" ? q.items.join(" → ") : q.t === "bk" ? q.sents.map((x, j) => (j + 1) + ". " + fillS(x.s, q.bank[x.a])).join("\n") : null;
function resultOf(t, s) {
  return {
    title: t.title, name: s.name, code: t.code, score: Math.round(t.qs.reduce((a, _, i) => a + mark(t, s, i), 0) * 100) / 100, total: total(t),
    qs: t.qs.map((q, i) => {
      if (q.t === "ti") return { t: "ti", q: q.q };
      const o = { t: q.t, q: q.q, pts: q.pts, mark: mark(t, s, i), yours: aTxt(q, (s.answers || {})["q" + i]), fb: (s.fb || {})["q" + i] || "" };
      if (q.t === "bk") o.bank = q.bank;
      if (t.releaseAns) o.expected = cTxt(q);
      return o;
    })
  };
}

/* ---------- timer & schedule ---------- */
function deadline(t, s) { // when this student's attempt ends (ms) or null
  let d = null;
  if (t.limit && s.begun) d = s.begun + t.limit * 60000;
  if (t.closesAt && !t.schedClosed) d = d === null ? t.closesAt : Math.min(d, t.closesAt);
  return d;
}
function finish(s, auto) { if (s.status !== "done") { s.status = "done"; s.submitted = Date.now(); s.updated = s.submitted; if (auto) s.auto = true; } }
/* if the student's time is up, finish them (accepting a last save if it arrives within the grace period). returns true if finished */
function settle(t, s, answers) {
  if (s.status === "done") return true;
  const d = deadline(t, s); if (d === null || Date.now() < d) return false;
  if (answers !== undefined && Date.now() <= d + GRACE) s.answers = cleanAnswers(t, answers);
  finish(s, true); return true;
}
function sweep() {
  const now = Date.now(); let ch = false;
  for (const t of Object.values(db.tests)) {
    if (t.opensAt && now >= t.opensAt && !t.schedOpened) { t.schedOpened = true; t.open = true; ch = true; }
    if (t.closesAt && now >= t.closesAt && !t.schedClosed) { t.schedClosed = true; t.open = false; subsOf(t.code).forEach(s => finish(s, true)); ch = true; }
  }
  for (const s of Object.values(db.subs)) if (s.status === "in") { const t = db.tests[s.code]; if (t && settle(t, s)) ch = true; }
  if (ch) persist();
}
setInterval(sweep, 5000).unref(); sweep();

function pub(t, s) {
  return {
    code: t.code, title: t.title, open: t.open, limit: t.limit || 0, deadline: deadline(t, s), now: Date.now(),
    qs: t.qs.map((q, i) => {
      const o = { t: q.t, q: q.q, pts: q.pts }; if (q.t === "mc") o.opts = q.opts;
      if (q.t === "drag") o.items = s.shuf["q" + i].map(k => ({ i: k, x: q.items[k] }));
      if (q.t === "bk") { o.bank = q.bank; o.sents = q.sents.map(x => x.s); }
      return o;
    })
  };
}
function cleanAnswers(t, a) {
  const out = {}; if (!a || typeof a !== "object") return out;
  t.qs.forEach((q, i) => {
    const v = a["q" + i]; if (v === undefined || v === null) return;
    if (q.t === "mc" && Number.isInteger(v) && v >= 0 && v < q.opts.length) out["q" + i] = v;
    else if (q.t === "tf" && typeof v === "boolean") out["q" + i] = v;
    else if (q.t === "wr" && typeof v === "string") out["q" + i] = v.slice(0, 20000);
    else if (q.t === "drag" && Array.isArray(v) && v.length === q.items.length && [...v].sort((x, y) => x - y).every((x, k) => x === k)) out["q" + i] = v;
    else if (q.t === "bk" && Array.isArray(v) && v.length === q.sents.length && v.every(x => x === null || (Number.isInteger(x) && x >= 0 && x < q.bank.length))) out["q" + i] = v;
  });
  return out;
}
const shuffle = n => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const FLAGS = ["Left the test tab", "Window lost focus", "Exited full screen", "Reloaded or rejoined the page", "Paste attempt", "Copy or cut attempt", "Large text insertion", "Long pause", "Window resized"];

/* ---------- backup restore (teacher only; everything re-validated) ---------- */
function restore(b) {
  let nt = 0, ns = 0; b = b && typeof b === "object" ? b : {};
  for (const t of (b.tests && typeof b.tests === "object" ? Object.values(b.tests) : [])) {
    try {
      if (!t || !/^[A-Z0-9]{6}$/.test(t.code) || db.tests[t.code]) continue;
      const title = String(t.title || "").trim().slice(0, 100); if (!title) continue;
      db.tests[t.code] = { code: t.code, title, qs: cleanQs(t.qs), open: t.open === true, created: Number(t.created) || Date.now(), ...sched(t, null, false),
        schedOpened: !!t.schedOpened, schedClosed: !!t.schedClosed, released: !!t.released, releaseAns: t.releaseAns !== false }; nt++;
    } catch (_) {}
  }
  for (const s of (Array.isArray(b.subs) ? b.subs : [])) {
    try {
      const t = s && db.tests[s.code]; if (!t || !/^[a-f0-9]{16}$/.test(s.id) || db.subs[s.id]) continue;
      const name = String(s.name || "").trim().slice(0, 60) || "Student";
      if (subsOf(s.code).some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
      const shuf = {};
      t.qs.forEach((q, i) => { if (q.t === "drag") { const p = s.shuf && s.shuf["q" + i]; shuf["q" + i] = Array.isArray(p) && p.length === q.items.length && [...p].sort((x, y) => x - y).every((x, k) => x === k) ? p : shuffle(q.items.length); } });
      const marks = {}, fb = {};
      t.qs.forEach((q, i) => {
        const v = s.marks && s.marks["q" + i]; if (typeof v === "number" && isFinite(v)) marks["q" + i] = Math.max(0, Math.min(q.pts, v));
        const f = s.fb && s.fb["q" + i]; if (typeof f === "string" && f.trim()) fb["q" + i] = f.trim().slice(0, 1000);
      });
      const done = s.status === "done";
      db.subs[s.id] = { id: s.id, code: s.code, name, token: crypto.randomBytes(24).toString("hex"), answers: cleanAnswers(t, s.answers),
        flags: (Array.isArray(s.flags) ? s.flags : []).filter(f => f && typeof f.k === "string" && Number.isFinite(f.t)).slice(0, 500).map(f => (typeof f.x === "string" ? { k: f.k.slice(0, 80), t: f.t, x: f.x.slice(0, 80) } : { k: f.k.slice(0, 80), t: f.t })),
        status: done ? "done" : "in", started: Number(s.started) || Date.now(), begun: Number(s.begun) || undefined, updated: Number(s.updated) || Date.now(), submitted: done ? (Number(s.submitted) || Date.now()) : undefined,
        marks, fb, reviewed: !!s.reviewed, shuf }; ns++;
    } catch (_) {}
  }
  persist(); return { tests: nt, subs: ns };
}

/* ---------- AI question generator (Claude or Gemini; key stays on the server) ---------- */
const provider = () => process.env.ANTHROPIC_API_KEY ? "claude" : process.env.GEMINI_API_KEY ? "gemini" : null;
const aiHits = [];
async function generate(b) {
  const p = provider(); if (!p) throw { code: 503, msg: "AI isn't set up on this server yet. Add a GEMINI_API_KEY in your host's environment settings." };
  const now = Date.now(); while (aiHits.length && now - aiHits[0] > 3600e3) aiHits.shift();
  if (aiHits.length >= 20) throw { code: 429, msg: "AI limit reached (20 generations per hour). Try again later." };
  const topic = String(b.topic || "").trim().slice(0, 4000), level = String(b.level || "").trim().slice(0, 100) || "general";
  if (!topic) throw { code: 400, msg: "Enter a topic." };
  const c = {}; let n = 0;
  for (const k of ["mc", "tf", "drag", "wr", "bk"]) { c[k] = Math.max(0, Math.min(50, Math.floor(Number(b.counts && b.counts[k]) || 0))); n += c[k]; }
  if (!n || n > 60) throw { code: 400, msg: "Ask for between 1 and 60 questions in total (up to 50 of each type)." };
  const prompt = `You write exam questions for teachers. The teacher's instructions about the subject and style are between the markers. Follow them for CONTENT only; the output format rules below always take priority.
---BEGIN TEACHER INSTRUCTIONS---
${topic}
---END TEACHER INSTRUCTIONS---
Level: ${level}.
Create exactly: ${c.mc} multiple choice (t:"mc"), ${c.tf} true/false (t:"tf"), ${c.drag} drag-to-order (t:"drag"), ${c.wr} written-answer (t:"wr"), ${c.bk} question-bank fill-in-the-blanks (t:"bk") questions.
Reply with ONLY JSON, no markdown: {"questions":[{"t":"mc","q":"...","pts":1,"opts":["A","B","C","D"],"ans":0},{"t":"tf","q":"...","pts":1,"ans":true},{"t":"drag","q":"Put these in order...","pts":3,"items":["first","second","third"]},{"t":"wr","q":"...","pts":4},{"t":"bk","q":"Fill in each blank using a word from the table.","pts":5,"bank":["word1","word2","word3","word4","word5","word6","word7"],"sents":[{"s":"A sentence with exactly one ___ blank.","a":2}]}]}
Rules: mc has exactly 4 options and "ans" is the 0-based index of the single correct option; tf "ans" is true or false; drag has 3-6 items listed in the CORRECT order and the order must be objectively determinable (chronology, steps of a process, size...); wr has no answer field; bk has a "bank" of 6-12 short words or phrases (a few may be wrong distractors that fit no sentence) and 4-10 "sents", each sentence containing exactly one blank written as ___ , with "a" = the 0-based index in "bank" of the one word that correctly fills it; every blank must have exactly one unambiguous correct word from the bank, and "pts" for a bk question equals the number of sentences. Be factually accurate and unambiguous.`;
  aiHits.push(now);
  let text;
  try {
    if (p === "gemini") {
      const models = [...new Set([process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-flash-lite-latest"])];
      let last = 0, detail = "";
      outer: for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await fetch(`${process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(80000),
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 16000 } }) });
          if (r.ok) { const j = await r.json(); text = ((j.candidates || [])[0]?.content?.parts || []).map(x => x.text || "").join(""); break outer; }
          last = r.status; try { detail = String((await r.json()).error?.message || "").slice(0, 200); } catch (_) {}
          if ([400, 401, 403].includes(r.status)) throw { code: 502, msg: `Google rejected the request (${r.status}). Check that GEMINI_API_KEY is correct and saved.${detail ? " Google says: " + detail : ""}` };
          if (r.status === 404) break;
          await delay(1500);
        }
      }
      if (text === undefined) throw { code: 502, msg: last === 429 ? "The AI's free limit was hit. Wait a minute and try again."
        : last === 404 ? "That AI model name wasn't found. Remove GEMINI_MODEL or set it to a current model."
        : "Google's AI is overloaded right now (error " + last + "). Wait a minute and try again." };
    } else {
      const r = await fetch(`${process.env.ANTHROPIC_BASE || "https://api.anthropic.com"}/v1/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(90000),
        body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-haiku-5-5", max_tokens: 12000, messages: [{ role: "user", content: prompt }] }) });
      if (r.status === 429) throw { code: 429, msg: "AI rate limit hit. Wait a minute and try again." };
      if (!r.ok) throw { code: 502, msg: [401, 403].includes(r.status) ? "Anthropic rejected the key (" + r.status + "). Check ANTHROPIC_API_KEY." : "The AI service is busy or returned an error (" + r.status + "). Try again in a minute." };
      const j = await r.json(); text = (j.content || []).map(x => x.text || "").join("");
    }
  } catch (e) { if (e && e.code) throw e; throw { code: 502, msg: "Couldn't reach the AI service. Try again." }; }
  let arr; try { arr = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()).questions; } catch (_) { throw { code: 502, msg: "The AI gave an unreadable answer. Try again." }; }
  const out = [];
  for (const q of (Array.isArray(arr) ? arr : []).slice(0, 80)) { try { if (q && q.t === "ti") continue; out.push(cleanQs([{ ...q, pts: Number(q.pts) >= 0 ? q.pts : 1 }])[0]); } catch (_) {} }
  if (!out.length) throw { code: 502, msg: "The AI's questions were invalid. Try again." };
  return out;
}

/* ---------- routes ---------- */
function doneReply(req, res, t, s) {
  if (resultsReady(t, s)) {
    if (!lookupOk(ipOf(req))) return fail(res, 429, "Too many attempts. Try again in a few minutes.");
    return send(res, 200, { result: resultOf(t, s) });
  }
  return fail(res, 409, t.released ? "Your test hasn't been marked yet. Check back soon." : "This name has already submitted this test. Your results haven't been released yet.");
}
async function api(req, res, url) {
  sweep();
  const m = req.method, p = url.pathname;
  if (m !== "GET" && !/^application\/json/.test(req.headers["content-type"] || "")) return fail(res, 415, "JSON required");
  const big = p === "/api/restore"; if (big && !isTeacher(req)) return fail(res, 401, "Not signed in.");
  const body = m === "GET" ? {} : await readBody(req, big ? 8e6 : 1e6).catch(e => { throw e; });

  if (p === "/api/login" && m === "POST") {
    const ip = ipOf(req), f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return fail(res, 429, "Too many attempts. Try again in a few minutes.");
    const { user, pass } = body;
    const ok = typeof user === "string" && typeof pass === "string" && user.length < 100 && pass.length < 200 && safeEq(scrypt(user + ":" + pass, SALT), HASH);
    if (!ok) { f.n++; if (f.n >= 5) { f.until = Date.now() + 10 * 60e3; f.n = 0; } fails.set(ip, f); await delay(500); return fail(res, 401, "Invalid username or password."); }
    fails.delete(ip);
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return send(res, 200, { ok: true }, { h: { "Set-Cookie": `eh=${mkSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` } });
  }
  if (p === "/api/logout" && m === "POST") return send(res, 200, { ok: true }, { h: { "Set-Cookie": "eh=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" } });
  if (p === "/api/me") { const te = isTeacher(req); return send(res, 200, { teacher: te, ai: te && !!provider() }); }

  /* ----- student ----- */
  if (p === "/api/join" && m === "POST") {
    const code = String(body.code || "").trim().toUpperCase(), name = String(body.name || "").trim().slice(0, 60);
    const t = db.tests[code]; if (!name || !code) return fail(res, 400, "Enter your name and the test code.");
    if (!t) return fail(res, 404, "No test found with that code.");
    let s = subsOf(code).find(x => x.name.toLowerCase() === name.toLowerCase());
    if (s) {
      if (settle(t, s)) persist();
      if (s.status === "done") return doneReply(req, res, t, s);
      s.token = crypto.randomBytes(24).toString("hex"); s.flags.push({ k: FLAGS[3], t: Date.now() });
    } else {
      if (!t.open) {
        if (t.opensAt && !t.schedOpened) return fail(res, 403, "This test hasn't opened yet.", { opensAt: t.opensAt });
        return fail(res, 403, t.schedClosed ? "This test has closed." : "This test is not open yet. Ask your teacher.");
      }
      const id = crypto.randomBytes(8).toString("hex"), shuf = {};
      t.qs.forEach((q, i) => { if (q.t === "drag") shuf["q" + i] = shuffle(q.items.length); });
      s = db.subs[id] = { id, code, name, token: crypto.randomBytes(24).toString("hex"), answers: {}, flags: [], status: "in", started: Date.now(), updated: Date.now(), shuf };
    }
    persist(); return send(res, 200, { token: s.token, test: pub(t, s), answers: s.answers });
  }
  if (p === "/api/state" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (!t) return fail(res, 404, "Test no longer exists.");
    settle(t, s);
    if (s.status === "in") s.flags.push({ k: FLAGS[3], t: Date.now() });
    persist(); return send(res, 200, { status: s.status, test: pub(t, s), answers: s.answers });
  }
  if (p === "/api/begin" && m === "POST") { // the timer starts here, when the student presses "Start test"
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (!t) return fail(res, 404, "Test no longer exists.");
    if (settle(t, s)) { persist(); return send(res, 200, { status: "done" }); }
    if (!s.begun) { s.begun = Date.now(); persist(); }
    return send(res, 200, { status: "in", deadline: deadline(t, s), now: Date.now() });
  }
  if (p === "/api/save" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (!t) return fail(res, 404, "Test no longer exists.");
    if (s.status === "done") { if (s.auto && Date.now() - s.submitted <= GRACE) { s.answers = cleanAnswers(t, body.answers); persist(); } return send(res, 200, { status: "done" }); }
    if (settle(t, s, body.answers)) { persist(); return send(res, 200, { status: "done" }); }
    if (!t.open) { s.answers = { ...s.answers, ...cleanAnswers(t, body.answers) }; finish(s, true); persist(); return send(res, 200, { status: "done" }); }
    s.answers = cleanAnswers(t, body.answers); s.updated = Date.now(); persist();
    return send(res, 200, { status: "in", deadline: deadline(t, s), now: Date.now() });
  }
  if (p === "/api/flag" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    if (s.status === "in" && FLAGS.includes(body.k)) {
      const x = typeof body.x === "string" && body.x ? body.x.slice(0, 80) : undefined;
      if (body.upd) { const l = [...s.flags].reverse().find(f => f.k === body.k); if (l && x) l.x = x; } // adds "away 12s" to the last matching flag
      else if (s.flags.length < 500) s.flags.push(x ? { k: body.k, t: Date.now(), x } : { k: body.k, t: Date.now() });
      s.updated = Date.now(); persist();
    }
    return send(res, 200, { ok: true });
  }
  if (p === "/api/submit" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (!t) return fail(res, 404, "Test no longer exists.");
    if (s.status === "done") { if (s.auto && Date.now() - s.submitted <= GRACE) { s.answers = cleanAnswers(t, body.answers); s.auto = false; persist(); } return send(res, 200, { status: "done" }); }
    if (!settle(t, s, body.answers)) { s.answers = cleanAnswers(t, body.answers); finish(s); }
    persist(); return send(res, 200, { status: "done" });
  }

  /* ----- teacher (cookie required) ----- */
  if (!/^\/api\/(tests|subs|generate|backup|restore)/.test(p)) return fail(res, 404, "Not found");
  if (!isTeacher(req)) return fail(res, 401, "Not signed in.");
  let r;
  if (p === "/api/backup" && m === "GET") return send(res, 200, { v: 3, tests: db.tests, subs: Object.values(db.subs).map(({ token, ...x }) => x) });
  if (p === "/api/restore" && m === "POST") return send(res, 200, restore(body));
  if (p === "/api/generate" && m === "POST") {
    try { return send(res, 200, { qs: await generate(body) }); }
    catch (x) { return fail(res, x && x.code || 500, x && x.msg || "AI generation failed."); }
  }
  if (p === "/api/tests" && m === "GET") return send(res, 200, Object.values(db.tests).sort((a, b) => b.created - a.created).map(t => ({ ...t, students: subsOf(t.code).length })));
  if (p === "/api/tests" && m === "POST") {
    const title = String(body.title || "").trim().slice(0, 100); if (!title) return fail(res, 400, "Add a title.");
    let qs, sc; try { qs = cleanQs(body.qs); sc = sched(body, null); } catch (x) { return fail(res, 400, String(x)); }
    const code = newCode(); db.tests[code] = { code, title, qs, open: false, created: Date.now(), ...sc, schedOpened: false, schedClosed: false, released: false, releaseAns: true }; persist(); sweep(); return send(res, 200, { code });
  }
  if ((r = /^\/api\/tests\/([A-Z0-9]{6})(\/toggle|\/release)?$/.exec(p))) {
    const t = db.tests[r[1]]; if (!t) return fail(res, 404, "Test not found.");
    if (m === "GET" && !r[2]) return send(res, 200, { test: t, subs: subsOf(t.code).map(s => summary(t, s)).sort((a, b) => a.name.localeCompare(b.name)) });
    if (m === "POST" && r[2] === "/toggle") { t.open = !t.open; if (!t.open) subsOf(t.code).forEach(s => finish(s, true)); persist(); return send(res, 200, { open: t.open }); }
    if (m === "POST" && r[2] === "/release") { t.released = !!body.on; if (body.ans !== undefined) t.releaseAns = body.ans !== false; persist(); return send(res, 200, { released: t.released }); }
    if (m === "PUT" && !r[2]) {
      const title = String(body.title || "").trim().slice(0, 100); if (!title) return fail(res, 400, "Add a title.");
      let qs, sc; try { qs = cleanQs(body.qs); sc = sched(body, t); } catch (x) { return fail(res, 400, String(x)); }
      if (subsOf(t.code).length && JSON.stringify(qs.map(q => q.t)) !== JSON.stringify(t.qs.map(q => q.t))) return fail(res, 409, "Students already joined: you can edit wording and answers, but not add, remove, move or change question types.");
      if (sc.opensAt !== t.opensAt) t.schedOpened = false;
      if (sc.closesAt !== t.closesAt) t.schedClosed = false;
      t.title = title; t.qs = qs; Object.assign(t, sc); persist(); sweep(); return send(res, 200, { ok: true });
    }
    if (m === "DELETE" && !r[2]) { subsOf(t.code).forEach(s => delete db.subs[s.id]); delete db.tests[t.code]; persist(); return send(res, 200, { ok: true }); }
  }
  if ((r = /^\/api\/subs\/([a-f0-9]{16})(\/marks)?$/.exec(p))) {
    const s = db.subs[r[1]]; if (!s) return fail(res, 404, "Submission not found.");
    if (m === "GET" && !r[2]) { const { token, shuf, ...rest } = s; return send(res, 200, rest); }
    if (m === "POST" && r[2]) {
      const t = db.tests[s.code], marks = {}, fb = {};
      t.qs.forEach((q, i) => {
        if (q.t === "ti") return;
        const v = body.marks && body.marks["q" + i]; if (v !== undefined && v !== null && v !== "") marks["q" + i] = Math.max(0, Math.min(q.pts, Number(v) || 0));
        const f = body.fb && body.fb["q" + i]; if (typeof f === "string" && f.trim()) fb["q" + i] = f.trim().slice(0, 1000);
      });
      s.marks = marks; s.fb = fb; s.reviewed = true; persist(); return send(res, 200, { ok: true });
    }
  }
  return fail(res, 404, "Not found");
}

const STATIC = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/pdf.js": ["pdf.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"] };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.headers["x-forwarded-proto"] === "https") HDR["Strict-Transport-Security"] = "max-age=31536000";
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const f = STATIC[url.pathname]; if (!f || req.method !== "GET") return send(res, 404, "Not found");
    send(res, 200, fs.readFileSync(path.join(PUB, f[0])), { type: f[1] });
  } catch (e) { if (!res.headersSent) fail(res, typeof e === "string" ? 400 : 500, typeof e === "string" ? e : "Server error"); }
}).listen(PORT, () => console.log("ExamHall running on http://localhost:" + PORT));
