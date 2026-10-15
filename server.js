"use strict";
// ExamHall server — zero dependencies. Run: node server.js
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, "data", "db.json");
const PUB = path.join(__dirname, "public");

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
const fail = (res, code, error) => send(res, code, { error });
function readBody(req) {
  return new Promise((ok, no) => {
    let s = "", n = 0;
    req.on("data", c => { n += c.length; if (n > 1e6) { no("Too large"); req.destroy(); } else s += c; });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (_) { no("Bad JSON"); } });
  });
}
const newCode = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c; do { c = Array.from({ length: 6 }, () => a[crypto.randomInt(a.length)]).join(""); } while (db.tests[c]); return c; };
const subsOf = code => Object.values(db.subs).filter(s => s.code === code);
const byToken = t => typeof t === "string" && t.length > 20 ? Object.values(db.subs).find(s => s.token === t) : null;

function cleanQs(qs) {
  if (!Array.isArray(qs) || !qs.length || qs.length > 100) throw "Add between 1 and 100 questions.";
  const L = a => (Array.isArray(a) ? a : []).map(x => String(x).trim().slice(0, 500)).filter(Boolean);
  return qs.map((q, i) => {
    const n = "Q" + (i + 1) + ": ";
    const o = { t: q.t, q: String(q.q || "").trim().slice(0, 3000), pts: Number(q.pts) };
    if (!["mc", "tf", "drag", "wr"].includes(o.t)) throw n + "invalid type";
    if (!o.q) throw n + "question text is empty";
    if (!(o.pts >= 0 && o.pts <= 1000)) throw n + "invalid marks";
    if (o.t === "mc") { o.opts = L(q.opts); o.ans = Number(q.ans); if (o.opts.length < 2 || o.opts.length > 12) throw n + "needs 2-12 options"; if (!Number.isInteger(o.ans) || o.ans < 0 || o.ans >= o.opts.length) throw n + "correct option out of range"; }
    if (o.t === "tf") o.ans = q.ans === true;
    if (o.t === "drag") { o.items = L(q.items); if (o.items.length < 2 || o.items.length > 12) throw n + "needs 2-12 items"; }
    return o;
  });
}
function auto(q, a) {
  if (q.t === "wr") return null; if (a === undefined || a === null) return 0;
  if (q.t === "drag") return Array.isArray(a) && a.length === q.items.length && a.every((v, k) => v === k) ? q.pts : 0;
  return a === q.ans ? q.pts : 0;
}
function mark(t, s, i) { const m = (s.marks || {})["q" + i]; return m !== undefined && m !== null ? Number(m) : (auto(t.qs[i], (s.answers || {})["q" + i]) || 0); }
const total = t => t.qs.reduce((a, q) => a + q.pts, 0);
function answered(t, s) {
  return t.qs.filter((q, i) => { const a = (s.answers || {})["q" + i]; return q.t === "wr" ? !!(a && a.trim()) : a !== undefined && a !== null; }).length;
}
const summary = (t, s) => ({ id: s.id, name: s.name, status: s.status, reviewed: !!s.reviewed, answered: answered(t, s), score: t.qs.reduce((a, _, i) => a + mark(t, s, i), 0), total: total(t), flags: (s.flags || []).length, updated: s.updated, submitted: s.submitted });
function pub(t, s) {
  return { code: t.code, title: t.title, open: t.open, qs: t.qs.map((q, i) => { const o = { t: q.t, q: q.q, pts: q.pts }; if (q.t === "mc") o.opts = q.opts; if (q.t === "drag") o.items = s.shuf["q" + i].map(k => ({ i: k, x: q.items[k] })); return o; }) };
}
function cleanAnswers(t, a) {
  const out = {}; if (!a || typeof a !== "object") return out;
  t.qs.forEach((q, i) => {
    const v = a["q" + i]; if (v === undefined || v === null) return;
    if (q.t === "mc" && Number.isInteger(v) && v >= 0 && v < q.opts.length) out["q" + i] = v;
    else if (q.t === "tf" && typeof v === "boolean") out["q" + i] = v;
    else if (q.t === "wr" && typeof v === "string") out["q" + i] = v.slice(0, 20000);
    else if (q.t === "drag" && Array.isArray(v) && v.length === q.items.length && [...v].sort((x, y) => x - y).every((x, k) => x === k)) out["q" + i] = v;
  });
  return out;
}
function finish(s) { if (s.status !== "done") { s.status = "done"; s.submitted = Date.now(); s.updated = s.submitted; } }
const shuffle = n => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const FLAGS = ["Left the test tab", "Window lost focus", "Exited full screen", "Reloaded or rejoined the page"];

/* ---------- routes ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m !== "GET" && !/^application\/json/.test(req.headers["content-type"] || "")) return fail(res, 415, "JSON required");
  const body = m === "GET" ? {} : await readBody(req).catch(e => { throw e; });

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
  if (p === "/api/me") return send(res, 200, { teacher: isTeacher(req) });

  /* ----- student ----- */
  if (p === "/api/join" && m === "POST") {
    const code = String(body.code || "").trim().toUpperCase(), name = String(body.name || "").trim().slice(0, 60);
    const t = db.tests[code]; if (!name || !code) return fail(res, 400, "Enter your name and the test code.");
    if (!t) return fail(res, 404, "No test found with that code.");
    let s = subsOf(code).find(x => x.name.toLowerCase() === name.toLowerCase());
    if (s) {
      if (s.status === "done") return fail(res, 409, "This name has already submitted this test.");
      s.token = crypto.randomBytes(24).toString("hex"); s.flags.push({ k: FLAGS[3], t: Date.now() });
    } else {
      if (!t.open) return fail(res, 403, "This test is not open yet. Ask your teacher.");
      const id = crypto.randomBytes(8).toString("hex"), shuf = {};
      t.qs.forEach((q, i) => { if (q.t === "drag") shuf["q" + i] = shuffle(q.items.length); });
      s = db.subs[id] = { id, code, name, token: crypto.randomBytes(24).toString("hex"), answers: {}, flags: [], status: "in", started: Date.now(), updated: Date.now(), shuf };
    }
    persist(); return send(res, 200, { token: s.token, test: pub(t, s), answers: s.answers });
  }
  if (p === "/api/state" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (!t) return fail(res, 404, "Test no longer exists.");
    if (s.status === "in") { s.flags.push({ k: FLAGS[3], t: Date.now() }); persist(); }
    return send(res, 200, { status: s.status, test: pub(t, s), answers: s.answers });
  }
  if (p === "/api/save" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (!t) return fail(res, 404, "Test no longer exists.");
    if (s.status === "done") return send(res, 200, { status: "done" });
    if (!t.open) { s.answers = { ...s.answers, ...cleanAnswers(t, body.answers) }; finish(s); persist(); return send(res, 200, { status: "done" }); }
    s.answers = cleanAnswers(t, body.answers); s.updated = Date.now(); persist();
    return send(res, 200, { status: "in" });
  }
  if (p === "/api/flag" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    if (s.status === "in" && FLAGS.includes(body.k) && s.flags.length < 500) { s.flags.push({ k: body.k, t: Date.now() }); s.updated = Date.now(); persist(); }
    return send(res, 200, { ok: true });
  }
  if (p === "/api/submit" && m === "POST") {
    const s = byToken(body.token); if (!s) return fail(res, 401, "Session expired.");
    const t = db.tests[s.code]; if (s.status === "in") s.answers = cleanAnswers(t, body.answers);
    finish(s); persist(); return send(res, 200, { status: "done" });
  }

  /* ----- teacher (cookie required) ----- */
  if (!p.startsWith("/api/tests") && !p.startsWith("/api/subs")) return fail(res, 404, "Not found");
  if (!isTeacher(req)) return fail(res, 401, "Not signed in.");
  let r;
  if (p === "/api/tests" && m === "GET") return send(res, 200, Object.values(db.tests).sort((a, b) => b.created - a.created).map(t => ({ ...t, students: subsOf(t.code).length })));
  if (p === "/api/tests" && m === "POST") {
    const title = String(body.title || "").trim().slice(0, 100); if (!title) return fail(res, 400, "Add a title.");
    let qs; try { qs = cleanQs(body.qs); } catch (x) { return fail(res, 400, String(x)); }
    const code = newCode(); db.tests[code] = { code, title, qs, open: false, created: Date.now() }; persist(); return send(res, 200, { code });
  }
  if ((r = /^\/api\/tests\/([A-Z0-9]{6})(\/toggle)?$/.exec(p))) {
    const t = db.tests[r[1]]; if (!t) return fail(res, 404, "Test not found.");
    if (m === "GET" && !r[2]) return send(res, 200, { test: t, subs: subsOf(t.code).map(s => summary(t, s)).sort((a, b) => a.name.localeCompare(b.name)) });
    if (m === "POST" && r[2]) { t.open = !t.open; if (!t.open) subsOf(t.code).forEach(finish); persist(); return send(res, 200, { open: t.open }); }
    if (m === "PUT" && !r[2]) {
      const title = String(body.title || "").trim().slice(0, 100); if (!title) return fail(res, 400, "Add a title.");
      let qs; try { qs = cleanQs(body.qs); } catch (x) { return fail(res, 400, String(x)); }
      if (subsOf(t.code).length && JSON.stringify(qs.map(q => q.t)) !== JSON.stringify(t.qs.map(q => q.t))) return fail(res, 409, "Students already joined: you can edit wording and answers, but not add, remove or change question types.");
      t.title = title; t.qs = qs; persist(); return send(res, 200, { ok: true });
    }
    if (m === "DELETE" && !r[2]) { subsOf(t.code).forEach(s => delete db.subs[s.id]); delete db.tests[t.code]; persist(); return send(res, 200, { ok: true }); }
  }
  if ((r = /^\/api\/subs\/([a-f0-9]{16})(\/marks)?$/.exec(p))) {
    const s = db.subs[r[1]]; if (!s) return fail(res, 404, "Submission not found.");
    if (m === "GET" && !r[2]) { const { token, shuf, ...rest } = s; return send(res, 200, rest); }
    if (m === "POST" && r[2]) {
      const t = db.tests[s.code], marks = {}, fb = {};
      t.qs.forEach((q, i) => {
        const v = body.marks && body.marks["q" + i]; if (v !== undefined && v !== null && v !== "") marks["q" + i] = Math.max(0, Math.min(q.pts, Number(v) || 0));
        const f = body.fb && body.fb["q" + i]; if (typeof f === "string" && f.trim()) fb["q" + i] = f.trim().slice(0, 1000);
      });
      s.marks = marks; s.fb = fb; s.reviewed = true; persist(); return send(res, 200, { ok: true });
    }
  }
  return fail(res, 404, "Not found");
}

const STATIC = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"] };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.headers["x-forwarded-proto"] === "https") HDR["Strict-Transport-Security"] = "max-age=31536000";
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const f = STATIC[url.pathname]; if (!f || req.method !== "GET") return send(res, 404, "Not found");
    send(res, 200, fs.readFileSync(path.join(PUB, f[0])), { type: f[1] });
  } catch (e) { if (!res.headersSent) fail(res, typeof e === "string" ? 400 : 500, typeof e === "string" ? e : "Server error"); }
}).listen(PORT, () => console.log("ExamHall running on http://localhost:" + PORT));
