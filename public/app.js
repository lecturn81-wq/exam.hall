"use strict";
const app = document.getElementById("app");
const $ = id => document.getElementById(id);
const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = t => new Date(t).toLocaleTimeString();
const TN = { mc: "Multiple Choice", tf: "True / False", drag: "Drag to Order", wr: "Written Answer" };
let un = [];
let aiOn = null;
const clean = () => { un.forEach(f => { try { f() } catch (_) {} }); un = []; app.onclick = app.oninput = app.onchange = null; };
const poll = (fn, ms) => { fn(); const id = setInterval(fn, ms); un.push(() => clearInterval(id)); };
function toast(m) { const t = $("toast"); t.textContent = m; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", 4000); }
async function api(m, u, b) {
  const r = await fetch(u, { method: m, headers: m === "GET" ? {} : { "Content-Type": "application/json" }, body: m === "GET" ? undefined : JSON.stringify(b || {}), credentials: "same-origin" });
  let j = {}; try { j = await r.json() } catch (_) {}
  if (!r.ok) throw { code: r.status, message: j.error || "Request failed" };
  return j;
}
const err = x => toast(x && x.message || "Something went wrong");
/* browser backup: a copy of tests + results is kept in this browser and can be restored to the server */
const LS = { get: k => { try { return localStorage.getItem(k) } catch (_) { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch (_) {} }, del: k => { try { localStorage.removeItem(k) } catch (_) {} } };
let lastBk = 0;
const localBk = () => { try { return JSON.parse(LS.get("eh_bk")) } catch (_) { return null } };
async function backup(afterDelete) {
  if (!afterDelete && Date.now() - lastBk < 15000) return; lastBk = Date.now();
  try { const d = await api("GET", "/api/backup"); if (Object.keys(d.tests).length) LS.set("eh_bk", JSON.stringify({ t: Date.now(), d })); else if (afterDelete) LS.del("eh_bk"); } catch (_) {}
}
async function restoreData(d) { const r = await api("POST", "/api/restore", d); toast(`Restored ${r.tests} test(s) and ${r.subs} submission(s).`); dash(); }
async function dlBackup() { const d = await api("GET", "/api/backup"); download(`examhall-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d), "application/json"); }
function banner() { const b = localBk(), n = b && b.d && Object.keys(b.d.tests || {}).length; return n ? `<div class=card style="border-color:var(--w)"><b>⚠ The server has no tests, but this browser has a saved backup</b><p class=m>${n} test(s) and ${(b.d.subs || []).length} submission(s), saved ${new Date(b.t).toLocaleString()}.</p><button data-a=rest>Restore from this browser</button></div>` : ""; }
const tools = () => `<div class=card><b>Backup &amp; restore</b><p class=m>Tests and results are copied into this browser automatically while this dashboard is open. Download a file copy for extra safety.</p><div class=row><button class=g data-a=dl>Download backup file</button><label class=m>Restore from file: <input type=file id=rf accept=".json,application/json" style="width:auto"></label></div></div>`;
function ask(m) {
  return new Promise(r => {
    const o = document.createElement("div"); o.className = "ov";
    o.innerHTML = `<div class=card style="max-width:380px;margin:0"><p>${e(m)}</p><div class=row style="justify-content:flex-end"><button class=g data-v=0>Cancel</button><button data-v=1>Confirm</button></div></div>`;
    o.onclick = ev => { const b = ev.target.closest("button"); if (!b) return; o.remove(); r(b.dataset.v === "1"); };
    document.body.appendChild(o);
  });
}
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

/* scoring helpers (display only; server is authoritative for tables) */
function auto(q, a) {
  if (q.t === "wr") return null; if (a === undefined || a === null) return 0;
  if (q.t === "drag") return Array.isArray(a) && a.length === q.items.length && a.every((v, k) => v === k) ? q.pts : 0;
  return a === q.ans ? q.pts : 0;
}
const mark = (t, s, i) => { const m = (s.marks || {})["q" + i]; return m !== undefined && m !== null && m !== "" ? Number(m) : (auto(t.qs[i], (s.answers || {})["q" + i]) || 0); };
const total = t => t.qs.reduce((a, q) => a + q.pts, 0);
const score = (t, s) => t.qs.reduce((a, _, i) => a + mark(t, s, i), 0);
function aText(q, a) {
  if (a === undefined || a === null || a === "") return "(no answer)";
  if (q.t === "mc") return q.opts[a] ?? "(no answer)"; if (q.t === "tf") return a ? "True" : "False";
  if (q.t === "drag") return Array.isArray(a) ? a.map(k => q.items[k]).join(" → ") : "(no answer)"; return a;
}
const cText = q => q.t === "mc" ? q.opts[q.ans] : q.t === "tf" ? (q.ans ? "True" : "False") : q.t === "drag" ? q.items.join(" → ") : "Marked manually";

/* ---------- HOME ---------- */
function home() {
  clean();
  app.innerHTML = `<div style="text-align:center;margin:28px 0 8px"><h1 style="font-size:34px">📝 ExamHall</h1><p class=m>Secure online tests with live monitoring</p></div>
<div class=grid><div class=card><h2>Student</h2><p class=m>Enter your name and the code your teacher gave you.</p>
<input id=sn placeholder="Full name" maxlength=60 autocomplete=off><input id=sc placeholder="Test code" maxlength=6 autocapitalize=characters autocomplete=off style="text-transform:uppercase;letter-spacing:4px"><button id=jn style="width:100%">Join test</button></div>
<div class=card><h2>Teacher</h2><p class=m>Sign in to manage tests.</p>
<input id=tu placeholder="Username" autocomplete=username><input id=tp type=password placeholder="Password" autocomplete=current-password><button id=tl class=g style="width:100%">Sign in</button></div></div>`;
  $("jn").onclick = join; $("tl").onclick = login;
  $("tp").onkeydown = ev => { if (ev.key === "Enter") login() }; $("sc").onkeydown = ev => { if (ev.key === "Enter") join() };
}
async function login() { try { await api("POST", "/api/login", { user: $("tu").value.trim(), pass: $("tp").value }); dash(); } catch (x) { $("tp").value = ""; err(x); } }
async function logout() { try { await api("POST", "/api/logout") } catch (_) {} home(); }

/* ---------- TEACHER: dashboard ---------- */
function dash() {
  clean();
  app.innerHTML = `<div class="row sp"><h1>Teacher dashboard</h1><div class=row><button id=nt>+ New test</button><button class=g id=lo>Sign out</button></div></div><div id=tl2><p class=m>Loading…</p></div>`;
  $("nt").onclick = () => editor(null); $("lo").onclick = logout;
  app.onchange = async ev => { if (ev.target.id !== "rf" || !ev.target.files[0]) return; try { await restoreData(JSON.parse(await ev.target.files[0].text())); } catch (x) { err(x && x.code ? x : { message: "That file isn't a valid ExamHall backup." }); } };
  let L = [];
  poll(async () => {
    try { L = await api("GET", "/api/tests"); } catch (x) { if (x.code === 401) return home(); return; }
    backup();
    $("tl2").innerHTML = (L.length ? L.map(t => `<div class=card><div class="row sp"><div><h3>${e(t.title)}</h3><span class=m>${t.qs.length} questions · ${total(t)} marks · ${t.students} student(s)</span></div>
<div class=row><span class=code>${t.code}</span><span class="tag ${t.open ? "ok" : "bad"}">${t.open ? "OPEN" : "CLOSED"}</span></div></div>
<div class=row style="margin-top:10px"><button data-a=mon data-id=${t.code}>Monitor &amp; mark</button><button class="${t.open ? "r" : "k"}" data-a=tog data-id=${t.code}>${t.open ? "Close test" : "Open test"}</button><button class=g data-a=ed data-id=${t.code}>Edit</button><button class=g data-a=del data-id=${t.code}>Delete</button></div></div>`).join("") : banner() + `<div class=card><p class=m>No tests yet. Create your first one.</p></div>`) + tools();
  }, 5000);
  $("tl2").onclick = async ev => {
    const b = ev.target.closest("button[data-a]"); if (!b) return; const t = L.find(x => x.code === b.dataset.id), a = b.dataset.a;
    try {
      if (a === "rest") return await restoreData(localBk().d);
      if (a === "dl") return await dlBackup();
      if (a === "tog") { if (t.open && !await ask("Close the test? Students still working will be submitted automatically.")) return; await api("POST", `/api/tests/${t.code}/toggle`); dash(); }
      else if (a === "ed") editor(t); else if (a === "mon") monitor(t.code);
      else if (a === "del" && await ask("Delete this test and all its submissions?")) { await api("DELETE", "/api/tests/" + t.code); await backup(true); dash(); }
    } catch (x) { err(x) }
  };
}

/* ---------- TEACHER: editor ---------- */
function editor(t) {
  clean();
  const D = t ? { title: t.title, qs: t.qs.map(q => ({ t: q.t, q: q.q, pts: q.pts, o: (q.opts || []).join("\n"), a: q.t === "mc" ? q.ans + 1 : q.t === "tf" ? String(q.ans) : "", i: (q.items || []).join("\n") })) } 
: { title: "", qs: [] };
  const G = { topic: "", level: "", mc: 3, tf: 2, drag: 1, wr: 1 };
  const aiCard = () => aiOn ? `<div class=card><b>✨ Generate with AI</b><p class=m>Describe the test and the AI writes the questions and picks the answers. Always check them before saving.</p>
<input data-g=topic placeholder="Topic (e.g. Causes of World War 1)" maxlength=500 value="${e(G.topic)}"><input data-g=level placeholder="Level (e.g. Grade 9)" maxlength=100 value="${e(G.level)}">
<div class=row>${["mc", "tf", "drag", "wr"].map(k => `<div style="flex:1;min-width:110px"><label class=m>${TN[k]}</label><input type=number min=0 max=15 data-g=${k} value="${G[k]}"></div>`).join("")}</div>
<button id=gen>Generate questions</button></div>` : aiOn === false ? `<div class=card><span class=m>✨ AI question generation is off. Add a GEMINI_API_KEY in your server's environment settings to turn it on.</span></div>` : "";
  const draw = () => {
    app.innerHTML = `<div class="row sp"><h1>${t ? "Edit" : "New"} test</h1><button class=g id=bk>Cancel</button></div>
<div class=card><label class=m>Test title</label><input id=ti value="${e(D.title)}" maxlength=100></div>
${D.qs.map((q, i) => `<div class=card><div class="row sp"><b>Q${i + 1} · ${TN[q.t]}</b><button class=g data-x=${i}>Remove</button></div>
<label class=m>Question</label><textarea rows=2 data-q=${i} data-f=q>${e(q.q)}</textarea>
${q.t === "mc" ? `<label class=m>Options (one per line)</label><textarea rows=4 data-q=${i} data-f=o>${e(q.o)}</textarea><label class=m>Correct option number</label><input type=number min=1 data-q=${i} data-f=a value="${e(q.a)}">` : ""}
${q.t === "tf" ? `<label class=m>Correct answer</label><select data-q=${i} data-f=a><option value=true ${q.a === "true" ? "selected" : ""}>True</option><option value=false ${q.a === "false" ? "selected" : ""}>False</option></select>` : ""}
${q.t === "drag" ? `<label class=m>Items in the CORRECT order (one per line; shuffled for each student)</label><textarea rows=4 data-q=${i} data-f=i>${e(q.i)}</textarea>` : ""}
<label class=m>Marks</label><input type=number min=0 step=0.5 data-q=${i} data-f=pts value="${q.pts}"></div>`).join("")}
${aiCard()}<div class=card><div class=m>Add question</div><div class=row style="margin-top:8px">${Object.keys(TN).map(k => `<button class=g data-add=${k}>+ ${TN[k]}</button>`).join("")}</div></div>
<button id=sv style="width:100%;padding:13px">Save test</button>`;
    $("bk").onclick = dash; $("ti").oninput = () => D.title = $("ti").value;
    app.onclick = ev => { const b = ev.target.closest("button"); if (!b) return; if (b.dataset.add) { D.qs.push({ t: b.dataset.add, q: "", pts: 1, o: "", a: b.dataset.add === "tf" ? "true" : "", i: "" }); draw(); } else if (b.dataset.x !== undefined) { D.qs.splice(+b.dataset.x, 1); draw(); } else if (b.id === "gen") gen(); };
    app.oninput = app.onchange = ev => { const d = ev.target.dataset; if (d.g) G[d.g] = ev.target.value; if (d.q !== undefined) D.qs[d.q][d.f] = d.f === "pts" ? Number(ev.target.value) : ev.target.value; };
    $("sv").onclick = save;
  };
  async function save() {
    const L = s => s.split("\n").map(x => x.trim()).filter(Boolean);
    if (!D.title.trim()) return toast("Add a title."); if (!D.qs.length) return toast("Add at least one question.");
    const qs = D.qs.map(q => { const o = { t: q.t, q: q.q.trim(), pts: q.pts }; if (q.t === "mc") { o.opts = L(q.o); o.ans = Number(q.a) - 1; } if (q.t === "tf") o.ans = q.a === "true"; if (q.t === "drag") o.items = L(q.i); return o; });
    try { if (t) await api("PUT", "/api/tests/" + t.code, { title: D.title.trim(), qs }); else await api("POST", "/api/tests", { title: D.title.trim(), qs }); toast("Test saved."); dash(); } catch (x) { err(x) }
  }
  async function gen() {
    if (!G.topic.trim()) return toast("Enter a topic first.");
    const btn = $("gen"); btn.disabled = true; btn.textContent = "Generating… (up to a minute)";
    try {
      const r = await api("POST", "/api/generate", { topic: G.topic, level: G.level, counts: { mc: +G.mc, tf: +G.tf, drag: +G.drag, wr: +G.wr } });
      r.qs.forEach(q => D.qs.push({ t: q.t, q: q.q, pts: q.pts, o: (q.opts || []).join("\n"), a: q.t === "mc" ? q.ans + 1 : q.t === "tf" ? String(q.ans) : "", i: (q.items || []).join("\n") }));
      if (!D.title.trim()) D.title = G.topic.trim();
      toast(`Added ${r.qs.length} questions. Check them before saving!`);
    } catch (x) { err(x) }
    draw();
  }
  draw();
  api("GET", "/api/me").then(r => { aiOn = !!r.ai; draw(); }).catch(() => {});
}

/* ---------- TEACHER: live monitor ---------- */
function monitor(code) {
  clean(); let data = null;
  app.innerHTML = `<div id=mh></div><div id=mt class=card><p class=m>Loading…</p></div>`;
  const draw = () => {
    const { test, subs } = data, nf = subs.reduce((a, s) => a + s.flags, 0);
    $("mh").innerHTML = `<div class="row sp"><button class=g id=b1>← Back</button><div class=row><span class=code>${code}</span><span class="tag ${test.open ? "ok" : "bad"}">${test.open ? "OPEN" : "CLOSED"}</span><button class="${test.open ? "r" : "k"}" id=tg>${test.open ? "Close test" : "Open test"}</button><button class=g id=csv>Gradebook CSV</button></div></div><h2>${e(test.title)}</h2><p class=m>${subs.length} student(s) · ${subs.filter(s => s.status === "done").length} submitted · ${nf} total flags · updates live</p>`;
    $("b1").onclick = dash;
    $("tg").onclick = async () => { try { if (test.open && !await ask("Close the test? Students still working will be submitted automatically.")) return; await api("POST", `/api/tests/${code}/toggle`); tick(); } catch (x) { err(x) } };
    $("csv").onclick = () => download(`${test.title}-grades.csv`, "Name,Status,Score,Total,Flags\n" + subs.map(s => `"${s.name.replace(/"/g, '""')}",${s.status === "done" ? "submitted" : "in progress"},${s.score},${s.total},${s.flags}`).join("\n"), "text/csv");
    $("mt").innerHTML = subs.length ? `<div class=tw><table><tr><th>Student</th><th>Status</th><th>Progress</th><th>Score</th><th>Flags</th><th>Last seen</th></tr>${subs.map(s => { const p = Math.round(s.answered / test.qs.length * 100);
      return `<tr class=cl data-s="${s.id}"><td><b>${e(s.name)}</b></td><td><span class="tag ${s.status === "done" ? "ok" : "w"}">${s.status === "done" ? (s.reviewed ? "MARKED" : "SUBMITTED") : "IN PROGRESS"}</span></td><td><div class=bar><i style="width:${p}%"></i></div><span class=m>${s.answered}/${test.qs.length}</span></td><td>${s.score} / ${s.total}</td><td>${s.flags ? `<span class="tag bad">⚠ ${s.flags}</span>` : `<span class=m>0</span>`}</td><td class=m>${s.updated ? fmt(s.updated) : "-"}</td></tr>`; }).join("")}</table></div><p class=m>Click a student to review and mark. Written answers count 0 until marked.</p>` : `<p class=m>Waiting for students. Share the code <b>${code}</b> and open the test.</p>`;
    $("mt").onclick = ev => { const r = ev.target.closest("tr[data-s]"); if (r) review(test, r.dataset.s, code); };
  };
  const tick = async () => { try { data = await api("GET", "/api/tests/" + code); draw(); backup(); } catch (x) { if (x.code === 401) home(); } };
  poll(tick, 3000);
}

/* ---------- TEACHER: review & mark ---------- */
async function review(test, id, code) {
  clean(); let s;
  try { s = await api("GET", "/api/subs/" + id); } catch (x) { err(x); return monitor(code); }
  app.innerHTML = `<div class="row sp"><button class=g id=b2>← Back</button><div class=row><button class=g id=ex>Export for student</button><button id=sm>Save marks</button></div></div>
<h2>${e(s.name)} <span class=m>· ${e(test.title)}</span></h2>
<div class=card><div class="row sp"><b>Total: <span id=tot>${score(test, s)}</span> / ${total(test)}</b><span class="tag ${s.status === "done" ? "ok" : "w"}">${s.status === "done" ? "SUBMITTED " + fmt(s.submitted) : "IN PROGRESS (not final)"}</span></div>
<p class=m style="margin:8px 0 0">${(s.flags || []).length ? `<b class=bad>⚠ ${s.flags.length} flag(s):</b> ` + s.flags.map(f => e(f.k) + " at " + fmt(f.t)).join("; ") : "No flags recorded."}</p></div>
${test.qs.map((q, i) => { const a = (s.answers || {})["q" + i], m = mark(test, s, i); return `<div class=card><div class=qh><b>Q${i + 1} · ${TN[q.t]}</b><span class=m>${q.pts} pts</span></div><p class=qt>${e(q.q)}</p>
<p><b>Student:</b> <span style="white-space:pre-wrap">${e(aText(q, a))}</span></p><p class=m><b>Expected:</b> ${e(cText(q))}</p>
<div class=row><label class=m>Mark</label><input type=number min=0 max=${q.pts} step=0.5 data-m=${i} value="${m}" style="width:90px"><span class=m>/ ${q.pts}</span>
<button class=g data-full=${i}>✓ Full</button><button class=g data-zero=${i}>✗ Zero</button></div>
<input data-fb=${i} placeholder="Feedback to student (optional)" value="${e((s.fb || {})["q" + i] || "")}"></div>`; }).join("")}`;
  const read = () => { const marks = {}, fb = {};
    app.querySelectorAll("[data-m]").forEach(x => { marks["q" + x.dataset.m] = Math.max(0, Math.min(test.qs[x.dataset.m].pts, Number(x.value) || 0)); });
    app.querySelectorAll("[data-fb]").forEach(x => { if (x.value.trim()) fb["q" + x.dataset.fb] = x.value.trim(); }); return { marks, fb }; };
  const upd = () => { $("tot").textContent = Object.values(read().marks).reduce((a, b) => a + b, 0); };
  app.oninput = upd;
  app.onclick = ev => { const b = ev.target.closest("button[data-full],button[data-zero]"); if (!b) return; const i = b.dataset.full ?? b.dataset.zero; app.querySelector(`[data-m="${i}"]`).value = b.dataset.full !== undefined ? test.qs[i].pts : 0; upd(); };
  $("b2").onclick = () => monitor(code);
  $("sm").onclick = async () => { const r = read(); try { await api("POST", `/api/subs/${id}/marks`, r); Object.assign(s, { marks: r.marks, fb: r.fb }); toast("Marks saved."); } catch (x) { err(x) } };
  $("ex").onclick = () => {
    const r = read(); Object.assign(s, r);
    const body = test.qs.map((q, i) => `<div style="border:1px solid #ccc;border-radius:8px;padding:12px;margin:12px 0"><b>Q${i + 1}</b> <span style="float:right">${mark(test, s, i)} / ${q.pts}</span><p>${e(q.q)}</p><p><b>Your answer:</b> ${e(aText(q, (s.answers || {})["q" + i]))}</p><p style="color:#555"><b>Expected:</b> ${e(cText(q))}</p>${(s.fb || {})["q" + i] ? `<p style="background:#fff7d6;padding:8px;border-radius:6px"><b>Teacher feedback:</b> ${e(s.fb["q" + i])}</p>` : ""}</div>`).join("");
    download((test.title + "-" + s.name).replace(/[^\w-]+/g, "_") + ".html", `<!doctype html><meta charset=utf-8><title>${e(test.title)} - ${e(s.name)}</title><body style="font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px"><h1>${e(test.title)}</h1><h3>${e(s.name)} — ${score(test, s)} / ${total(test)}</h3>${body}`, "text/html");
  };
}

/* ---------- STUDENT ---------- */
function saveSess(v) { try { v ? sessionStorage.setItem("eh_s", v) : sessionStorage.removeItem("eh_s"); } catch (_) {} }
async function join() {
  const name = $("sn").value.trim(), code = $("sc").value.trim().toUpperCase();
  if (!name || !code) return toast("Enter your name and the test code.");
  try { const r = await api("POST", "/api/join", { name, code }); saveSess(r.token); intro(r.token, r.test, r.answers, name); } catch (x) { err(x) }
}
async function resume(token) {
  try { const r = await api("POST", "/api/state", { token }); if (r.status === "done") { saveSess(null); return home(); } intro(token, r.test, r.answers, "Welcome back"); } catch (_) { saveSess(null); home(); }
}
function intro(token, t, answers, who) {
  clean();
  app.innerHTML = `<div class=card><h2>${e(t.title)}</h2><p class=m>${e(who)} · ${t.qs.length} questions · ${t.qs.reduce((a, q) => a + q.pts, 0)} marks</p>
<ul><li>The test opens in full screen.</li><li>Switching tabs/windows or leaving full screen is <b>recorded and shown to your teacher</b>.</li><li>Copy and paste are disabled. Answers save automatically.</li></ul><button id=go style="width:100%">${Object.keys(answers).length ? "Continue test" : "Start test"}</button></div>`;
  $("go").onclick = () => { try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch (_) {} run(token, t, answers); };
}
function run(token, t, answers) {
  clean();
  const S = { answers: answers || {} }; let live = true, last = 0, timer, busy = false;
  const answered = () => t.qs.filter((q, i) => { const a = S.answers["q" + i]; return q.t === "wr" ? !!(a && a.trim()) : a !== undefined && a !== null; }).length;
  const ord = i => S.answers["q" + i] || t.qs[i].items.map(x => x.i);
  const dragH = i => ord(i).map((k, p) => `<div class=dr draggable=true data-qi=${i} data-p=${p}><span>${e(t.qs[i].items.find(x => x.i === k).x)}</span><button class=g data-mv=-1 data-qi=${i} data-p=${p}>▲</button><button class=g data-mv=1 data-qi=${i} data-p=${p}>▼</button></div>`).join("");
  const push = async () => {
    if (!live) return;
    try { const r = await api("POST", "/api/save", { token, answers: S.answers }); if (r.status === "done" && live) finish(true); }
    catch (x) { if (x.code === 401 && live) { stop(); saveSess(null); toast("Session expired."); home(); } }
  };
  const save = () => { clearTimeout(timer); timer = setTimeout(push, 600); };
  const flag = k => { if (!live) return; const n = Date.now(); if (n - last < 1500) return; last = n; api("POST", "/api/flag", { token, k }).catch(() => {}); const w = $("warn"); w.style.display = "block"; setTimeout(() => w.style.display = "none", 6000); };
  app.innerHTML = `<div class="card row sp ns" style="position:sticky;top:6px;z-index:5"><b>${e(t.title)}</b><span class=m id=pg></span></div><div class=ns id=qs>${t.qs.map((q, i) => { const a = S.answers["q" + i];
    const b = q.t === "mc" ? q.opts.map((o, j) => `<label class=o><input type=radio name=q${i} data-i=${i} data-v=${j} ${a === j ? "checked" : ""}>${e(o)}</label>`).join("") :
      q.t === "tf" ? [true, false].map(v => `<label class=o><input type=radio name=q${i} data-i=${i} data-v=${v} ${a === v ? "checked" : ""}>${v ? "True" : "False"}</label>`).join("") :
      q.t === "drag" ? `<p class=m>Drag items (or use the arrows) into the correct order.</p><div id=d${i}>${dragH(i)}</div>` :
      `<textarea class=sel data-i=${i} data-w=1 rows=7 placeholder="Type your answer…">${e(a || "")}</textarea>`;
    return `<section class=card><div class=qh><b>Q${i + 1}</b><span class=m>${q.pts} pt${q.pts == 1 ? "" : "s"}</span></div><p class=qt>${e(q.q)}</p>${b}</section>`; }).join("")}</div><button id=sb class=k style="width:100%;padding:13px">Submit test</button>`;
  const bar = () => { $("pg").textContent = answered() + " / " + t.qs.length + " answered"; }; bar();
  const setA = (i, v) => { S.answers["q" + i] = v; bar(); save(); };
  const mv = (i, f, to) => { const a = [...ord(i)]; if (to < 0 || to >= a.length) return; const [x] = a.splice(f, 1); a.splice(to, 0, x); setA(i, a); $("d" + i).innerHTML = dragH(i); };
  const q$ = $("qs");
  q$.onchange = ev => { const d = ev.target.dataset; if (d.v !== undefined) setA(+d.i, t.qs[d.i].t === "tf" ? d.v === "true" : Number(d.v)); };
  q$.oninput = ev => { const d = ev.target.dataset; if (d.w) setA(+d.i, ev.target.value); };
  q$.onclick = ev => { const b = ev.target.closest("button[data-mv]"); if (b) mv(+b.dataset.qi, +b.dataset.p, +b.dataset.p + Number(b.dataset.mv)); };
  let from = null;
  q$.ondragstart = ev => { const r = ev.target.closest(".dr"); if (r) { from = r.dataset; try { ev.dataTransfer.setData("text/plain", "x") } catch (_) {} } };
  q$.ondragover = ev => { if (ev.target.closest(".dr")) ev.preventDefault(); };
  q$.ondrop = ev => { const r = ev.target.closest(".dr"); if (r && from && from.qi === r.dataset.qi) { ev.preventDefault(); mv(+from.qi, +from.p, +r.dataset.p); } from = null; };
  const blockH = ev => { if (live) ev.preventDefault(); };
  const evs = ["copy", "cut", "paste", "contextmenu"]; evs.forEach(n => document.addEventListener(n, blockH));
  const vis = () => { if (document.hidden) flag("Left the test tab"); }, blur = () => { if (!document.hidden) flag("Window lost focus"); }, fs = () => { if (!document.fullscreenElement) flag("Exited full screen"); };
  document.addEventListener("visibilitychange", vis); window.addEventListener("blur", blur); document.addEventListener("fullscreenchange", fs);
  const hb = setInterval(push, 5000);
  const stop = () => { live = false; clearInterval(hb); clearTimeout(timer); document.removeEventListener("visibilitychange", vis); window.removeEventListener("blur", blur); document.removeEventListener("fullscreenchange", fs); evs.forEach(n => document.removeEventListener(n, blockH)); try { document.fullscreenElement && document.exitFullscreen(); } catch (_) {} $("warn").style.display = "none"; };
  const finish = auto => { stop(); saveSess(null); app.innerHTML = `<div class=card style="text-align:center;margin-top:40px"><h2>✅ Test submitted</h2><p class=m>${auto ? "Your teacher closed the test, so it was submitted automatically." : "Your answers were sent to your teacher."}<br>You can close this page.</p><button class=g id=hm>Back to start</button></div>`; $("hm").onclick = home; };
  $("sb").onclick = async () => {
    if (busy) return; const n = t.qs.length - answered();
    if (!await ask(n ? `${n} question(s) unanswered. Submit anyway?` : "Submit your test now?")) return;
    busy = true; clearTimeout(timer);
    try { await api("POST", "/api/submit", { token, answers: S.answers }); finish(false); } catch (x) { busy = false; err(x); }
  };
  un.push(() => { if (live) stop(); });
}

/* ---------- boot ---------- */
(async () => {
  home();
  try { if ((await api("GET", "/api/me")).teacher) return dash(); } catch (_) {}
  let tok = null; try { tok = sessionStorage.getItem("eh_s"); } catch (_) {}
  if (tok) resume(tok);
})();
