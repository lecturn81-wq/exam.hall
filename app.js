"use strict";
const app = document.getElementById("app");
const $ = id => document.getElementById(id);
const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = t => new Date(t).toLocaleTimeString();
const fdt = t => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const TN = { mc: "Multiple Choice", tf: "True / False", drag: "Drag to Order", wr: "Written Answer", bk: "Question Bank", ti: "Title / Text" };
const AIK = ["mc", "tf", "drag", "wr", "bk"];            // types the AI can write
const nums = qs => { let n = 0; return qs.map(q => q.t === "ti" ? null : ++n); };   // question numbers skip titles
const nreal = qs => qs.filter(q => q.t !== "ti").length;
const fillS = (s, w) => /_{3,}/.test(s) ? s.replace(/_{3,}/, "[" + w + "]") : s + " [" + w + "]";
const toLocalInput = ms => { if (!ms) return ""; const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const fromLocalInput = v => { const n = v ? new Date(v).getTime() : NaN; return isNaN(n) ? null : n; };
const dur = ms => { const s = Math.round(ms / 1000); return s >= 60 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : s + "s"; };
const fl = f => e(f.k) + (f.x ? " (" + e(f.x) + ")" : "");
let un = [];
let aiOn = null;
const clean = () => { un.forEach(f => { try { f() } catch (_) {} }); un = []; app.onclick = app.oninput = app.onchange = null; };
const poll = (fn, ms) => { fn(); const id = setInterval(fn, ms); un.push(() => clearInterval(id)); };
function toast(m) { const t = $("toast"); t.textContent = m; t.style.display = "block"; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = "none", 4000); }
async function api(m, u, b) {
  const r = await fetch(u, { method: m, headers: m === "GET" ? {} : { "Content-Type": "application/json" }, body: m === "GET" ? undefined : JSON.stringify(b || {}), credentials: "same-origin" });
  let j = {}; try { j = await r.json() } catch (_) {}
  if (!r.ok) throw { code: r.status, message: j.error || "Request failed", opensAt: j.opensAt };
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
/* dialog for releasing results; resolves {ans} or null */
function releaseDlg(unmarked, inprog) {
  return new Promise(r => {
    const o = document.createElement("div"); o.className = "ov";
    o.innerHTML = `<div class=card style="max-width:420px;margin:0"><b>Release results to students?</b>
<p class=m>Students will see their score and your feedback by joining the start page with their <b>name and the test code</b>.${unmarked ? `<br><br><b class=bad>${unmarked} submission(s) still need marking</b> (written answers). Those students will see "not marked yet" until you save marks.` : ""}${inprog ? `<br><br>${inprog} student(s) haven't submitted yet; they'll see results once they have.` : ""}</p>
<label class=row style="gap:8px;cursor:pointer"><input type=checkbox id=ra checked style="width:auto;margin:0"> <span>Also show the correct answers</span></label>
<div class=row style="justify-content:flex-end;margin-top:12px"><button class=g data-v=0>Cancel</button><button data-v=1>Release</button></div></div>`;
    o.onclick = ev => { const b = ev.target.closest("button"); if (!b) return; const ans = o.querySelector("#ra").checked; o.remove(); r(b.dataset.v === "1" ? { ans } : null); };
    document.body.appendChild(o);
  });
}
function saveBlob(name, blob) { const a = document.createElement("a"); const u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000); }
function download(name, text, type) { saveBlob(name, new Blob([text], { type })); }
const fname = (...p) => p.join("-").replace(/[^\w-]+/g, "_");
function pdf(doc, name) { try { saveBlob(name + ".pdf", ExamPDF.build(doc)); } catch (x) { console.error(x); toast("Couldn't create the PDF in this browser."); } }

/* scoring helpers (display only; server is authoritative for tables) */
function auto(q, a) {
  if (q.t === "ti") return 0; if (q.t === "wr") return null; if (a === undefined || a === null) return 0;
  if (q.t === "bk") { if (!Array.isArray(a)) return 0; const c = q.sents.filter((x, j) => a[j] === x.a).length; return Math.round(q.pts * c / q.sents.length * 100) / 100; }
  if (q.t === "drag") return Array.isArray(a) && a.length === q.items.length && a.every((v, k) => v === k) ? q.pts : 0;
  return a === q.ans ? q.pts : 0;
}
const mark = (t, s, i) => { const m = (s.marks || {})["q" + i]; return m !== undefined && m !== null && m !== "" ? Number(m) : (auto(t.qs[i], (s.answers || {})["q" + i]) || 0); };
const total = t => t.qs.reduce((a, q) => a + q.pts, 0);
const score = (t, s) => Math.round(t.qs.reduce((a, _, i) => a + mark(t, s, i), 0) * 100) / 100;
const isAns = (q, a) => q.t === "ti" ? false : q.t === "wr" ? !!(a && a.trim()) : q.t === "bk" ? Array.isArray(a) && a.length > 0 && a.every(x => x !== null && x !== undefined) : a !== undefined && a !== null;
function aText(q, a) {
  if (q.t === "bk") { const ar = Array.isArray(a) ? a : []; return q.sents.map((x, j) => { const v = ar[j]; return (v == null ? "– " : v === x.a ? "✓ " : "✗ ") + (j + 1) + ". " + fillS(x.s, v == null ? "…" : q.bank[v]); }).join("\n"); }
  if (a === undefined || a === null || a === "") return "(no answer)";
  if (q.t === "mc") return q.opts[a] ?? "(no answer)"; if (q.t === "tf") return a ? "True" : "False";
  if (q.t === "drag") return Array.isArray(a) ? a.map(k => q.items[k]).join(" → ") : "(no answer)"; return a;
}
const cText = q => q.t === "mc" ? q.opts[q.ans] : q.t === "tf" ? (q.ans ? "True" : "False") : q.t === "drag" ? q.items.join(" → ") : q.t === "bk" ? q.sents.map((x, j) => (j + 1) + ". " + fillS(x.s, q.bank[x.a])).join("\n") : "Marked manually";

/* ---------- HOME ---------- */
function home() {
  clean();
  app.innerHTML = `<div style="text-align:center;margin:28px 0 8px"><h1 style="font-size:34px">📝 ExamHall</h1><p class=m>Secure online tests with live monitoring</p></div>
<div class=grid><div class=card><h2>Student</h2><p class=m>Enter your name and the code your teacher gave you. Already finished? Enter the same name and code to see your results once your teacher has released them.</p>
<input id=sn placeholder="Full name" maxlength=60 autocomplete=off><input id=sc placeholder="Test code" maxlength=6 autocapitalize=characters autocomplete=off style="text-transform:uppercase;letter-spacing:4px"><button id=jn style="width:100%">Join test / see results</button></div>
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
  const meta = t => [`${nreal(t.qs)} questions`, `${total(t)} marks`, `${t.students} student(s)`, t.limit ? `⏱ ${t.limit} min` : "", t.opensAt && !t.schedOpened ? `opens ${fdt(t.opensAt)}` : "", t.closesAt && !t.schedClosed ? `closes ${fdt(t.closesAt)}` : ""].filter(Boolean).join(" · ");
  const tag = t => t.open ? ["ok", "OPEN"] : t.opensAt && !t.schedOpened ? ["w", "SCHEDULED"] : ["bad", "CLOSED"];
  poll(async () => {
    try { L = await api("GET", "/api/tests"); } catch (x) { if (x.code === 401) return home(); return; }
    backup();
    $("tl2").innerHTML = (L.length ? L.map(t => { const g = tag(t); return `<div class=card><div class="row sp"><div><h3>${e(t.title)}</h3><span class=m>${meta(t)}</span></div>
<div class=row><span class=code>${t.code}</span><span class="tag ${g[0]}">${g[1]}</span>${t.released ? `<span class="tag ok">RESULTS RELEASED</span>` : ""}</div></div>
<div class=row style="margin-top:10px"><button data-a=mon data-id=${t.code}>Monitor &amp; mark</button><button class="${t.open ? "r" : "k"}" data-a=tog data-id=${t.code}>${t.open ? "Close test" : "Open test"}</button><button class=g data-a=ed data-id=${t.code}>Edit</button><button class=g data-a=del data-id=${t.code}>Delete</button></div></div>`; }).join("") : banner() + `<div class=card><p class=m>No tests yet. Create your first one.</p></div>`) + tools();
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
  const toD = q => ({ t: q.t, q: q.q, pts: q.pts, o: (q.opts || []).join("\n"), a: q.t === "mc" ? q.ans + 1 : q.t === "tf" ? String(q.ans) : "", i: (q.items || []).join("\n"), bank: (q.bank || []).join("\n"), sents: (q.sents || []).map(x => ({ s: x.s, a: x.a })) });
  const blank = k => ({ t: k, q: k === "bk" ? "Fill in each blank using a word from the table." : "", pts: k === "ti" ? 0 : k === "bk" ? 3 : 1, o: "", a: k === "tf" ? "true" : "", i: "", bank: "", sents: k === "bk" ? [{ s: "", a: 0 }, { s: "", a: 0 }, { s: "", a: 0 }] : [] });
  const D = t ? { title: t.title, limit: String(t.limit || 0), oa: toLocalInput(t.opensAt), ca: toLocalInput(t.closesAt), qs: t.qs.map(toD) }
    : { title: "", limit: "0", oa: "", ca: "", qs: [] };
  const G = { topic: "", level: "", mc: 3, tf: 2, drag: 1, wr: 1, bk: 1 };
  const bankL = q => q.bank.split("\n").map(x => x.trim()).filter(Boolean);
  const selOpts = (q, cur) => bankL(q).map((w, k) => `<option value=${k} ${k === cur ? "selected" : ""}>${e(w)}</option>`).join("") || "<option value=0>(add words to the bank first)</option>";
  const refreshSel = i => {
    D.qs[i].sents.forEach((x, j) => { const sel = app.querySelector(`select[data-q="${i}"][data-sj="${j}"]`); if (sel) sel.innerHTML = selOpts(D.qs[i], x.a); });
    const c = $("bc" + i); if (c) c.textContent = bankL(D.qs[i]).length + " / 20";
  };
  const aiCard = () => aiOn ? `<div class=card><b>✨ Generate with AI</b><p class=m>Describe the test and the AI writes the questions and picks the answers. Always check them before saving.</p>
<label class=m>What should the AI write? Describe the topic, style, difficulty, what to include or avoid…</label><textarea data-g=topic rows=7 maxlength=4000 placeholder="e.g. Grade 9 history test on the causes of World War 1. Focus on alliances, militarism and the assassination of Franz Ferdinand. Make the multiple choice tricky but fair, and ask the written questions to be analytical.">${e(G.topic)}</textarea><input data-g=level placeholder="Level (e.g. Grade 9)" maxlength=100 value="${e(G.level)}">
<div class=row>${AIK.map(k => `<div style="flex:1;min-width:110px"><label class=m>${TN[k]}</label><input type=number min=0 max=50 data-g=${k} value="${G[k]}"></div>`).join("")}</div><p class=m>Up to 50 of each type and 60 questions total per click. Big requests can take 1–2 minutes.</p>
<button id=gen>Generate questions</button></div>` : aiOn === false ? `<div class=card><span class=m>✨ AI question generation is off. Add a GEMINI_API_KEY in your server's environment settings to turn it on.</span></div>` : "";
  const draw = () => {
    const N = nums(D.qs);
    app.innerHTML = `<div class="row sp"><h1>${t ? "Edit" : "New"} test</h1><button class=g id=bk>Cancel</button></div>
<div class=card><label class=m>Test title</label><input id=ti value="${e(D.title)}" maxlength=100></div>
<div class=card><b>Time &amp; schedule</b><div class=grid style="margin-top:6px"><div><label class=m>Time limit in minutes (0 = no limit)</label><input type=number min=0 max=600 step=1 data-s=limit value="${e(D.limit)}"></div>
<div><label class=m>Opens automatically at (optional)</label><input type=datetime-local data-s=oa value="${e(D.oa)}"></div><div><label class=m>Closes automatically at (optional)</label><input type=datetime-local data-s=ca value="${e(D.ca)}"></div></div>
<p class=m>Times use this browser's time zone. Each student's timer starts when they press "Start test" and the test auto-submits at zero. At the close time the test closes for everyone, whatever time they have left. The Open/Close buttons still work any time.</p></div>
${D.qs.map((q, i) => `<div class=card><div class="row sp"><b>${q.t === "ti" ? "Title / Text" : "Q" + N[i] + " · " + TN[q.t]}</b><div class=row><button class=g data-mu=${i} ${i ? "" : "disabled"}>↑</button><button class=g data-md=${i} ${i < D.qs.length - 1 ? "" : "disabled"}>↓</button><button class=g data-x=${i}>Remove</button></div></div>
<label class=m>${q.t === "ti" ? "Text shown to students (a heading, instructions, a reading passage…)" : q.t === "bk" ? "Instructions" : "Question"}</label><textarea rows=${q.t === "ti" ? 3 : 2} data-q=${i} data-f=q>${e(q.q)}</textarea>
${q.t === "mc" ? `<label class=m>Options (one per line)</label><textarea rows=4 data-q=${i} data-f=o>${e(q.o)}</textarea><label class=m>Correct option number</label><input type=number min=1 data-q=${i} data-f=a value="${e(q.a)}">` : ""}
${q.t === "tf" ? `<label class=m>Correct answer</label><select data-q=${i} data-f=a><option value=true ${q.a === "true" ? "selected" : ""}>True</option><option value=false ${q.a === "false" ? "selected" : ""}>False</option></select>` : ""}
${q.t === "drag" ? `<label class=m>Items in the CORRECT order (one per line; shuffled for each student)</label><textarea rows=4 data-q=${i} data-f=i>${e(q.i)}</textarea>` : ""}
${q.t === "bk" ? `<label class=m>Word bank: the possible answers, one per line (max 20). Students see these in a table above the sentences. <b id=bc${i}>${bankL(q).length} / 20</b></label><textarea rows=5 data-q=${i} data-f=bank placeholder="mitochondria&#10;nucleus&#10;ribosome">${e(q.bank)}</textarea>
<label class=m>Sentences: write <b>___</b> where the blank goes, then pick the correct word from the bank</label>
${q.sents.map((x, j) => `<div class=row><span class=m>${j + 1}.</span><input style="flex:3;min-width:200px" data-q=${i} data-sj=${j} data-sf=s placeholder="e.g. The ___ is the powerhouse of the cell." value="${e(x.s)}"><select style="flex:2;min-width:140px" data-q=${i} data-sj=${j} data-sf=a>${selOpts(q, x.a)}</select><button class=g data-rs=${i} data-j=${j}>✕</button></div>`).join("")}
<button class=g data-as=${i}>+ Add sentence</button>` : ""}
${q.t === "ti" ? "" : `<label class=m style="display:block;margin-top:8px">${q.t === "bk" ? "Total marks (shared equally between the blanks)" : "Marks"}</label><input type=number min=0 step=0.5 data-q=${i} data-f=pts value="${q.pts}">`}</div>`).join("")}
${aiCard()}<div class=card><div class=m>Add question</div><div class=row style="margin-top:8px">${Object.keys(TN).map(k => `<button class=g data-add=${k}>+ ${TN[k]}</button>`).join("")}</div></div>
<button id=sv style="width:100%;padding:13px">Save test</button>`;
    $("bk").onclick = dash; $("ti").oninput = () => D.title = $("ti").value;
    app.onclick = ev => {
      const b = ev.target.closest("button"); if (!b) return; const d = b.dataset;
      if (d.add) { D.qs.push(blank(d.add)); draw(); }
      else if (d.x !== undefined) { D.qs.splice(+d.x, 1); draw(); }
      else if (d.mu !== undefined) { const i = +d.mu; if (i > 0) [D.qs[i - 1], D.qs[i]] = [D.qs[i], D.qs[i - 1]]; draw(); }
      else if (d.md !== undefined) { const i = +d.md; if (i < D.qs.length - 1) [D.qs[i + 1], D.qs[i]] = [D.qs[i], D.qs[i + 1]]; draw(); }
      else if (d.as !== undefined) { D.qs[+d.as].sents.push({ s: "", a: 0 }); draw(); }
      else if (d.rs !== undefined) { D.qs[+d.rs].sents.splice(+d.j, 1); draw(); }
      else if (b.id === "gen") gen();
    };
    app.oninput = app.onchange = ev => {
      const d = ev.target.dataset;
      if (d.g) G[d.g] = ev.target.value;
      if (d.s) D[d.s] = ev.target.value;
      if (d.sj !== undefined) { const sn = D.qs[d.q].sents[d.sj]; if (d.sf === "a") sn.a = Number(ev.target.value); else sn.s = ev.target.value; return; }
      if (d.q !== undefined && d.f) { D.qs[d.q][d.f] = d.f === "pts" ? Number(ev.target.value) : ev.target.value; if (d.f === "bank") refreshSel(+d.q); }
    };
    $("sv").onclick = save;
  };
  async function save() {
    const L = s => s.split("\n").map(x => x.trim()).filter(Boolean);
    if (!D.title.trim()) return toast("Add a title."); if (!D.qs.length) return toast("Add at least one question.");
    const qs = D.qs.map(q => {
      const o = { t: q.t, q: q.q.trim(), pts: q.t === "ti" ? 0 : q.pts };
      if (q.t === "mc") { o.opts = L(q.o); o.ans = Number(q.a) - 1; } if (q.t === "tf") o.ans = q.a === "true"; if (q.t === "drag") o.items = L(q.i);
      if (q.t === "bk") { o.bank = L(q.bank); o.sents = q.sents.filter(x => x.s.trim()).map(x => ({ s: x.s.trim(), a: Number(x.a) })); }
      return o;
    });
    const body = { title: D.title.trim(), qs, limit: Number(D.limit) || 0, opensAt: fromLocalInput(D.oa), closesAt: fromLocalInput(D.ca) };
    try { if (t) await api("PUT", "/api/tests/" + t.code, body); else await api("POST", "/api/tests", body); toast("Test saved."); dash(); } catch (x) { err(x) }
  }
  async function gen() {
    if (!G.topic.trim()) return toast("Enter a topic first.");
    const btn = $("gen"); btn.disabled = true; btn.textContent = "Generating… (can take 1–2 minutes)";
    try {
      const counts = {}; AIK.forEach(k => counts[k] = +G[k]);
      const r = await api("POST", "/api/generate", { topic: G.topic, level: G.level, counts });
      r.qs.forEach(q => D.qs.push(toD(q)));
      if (!D.title.trim()) D.title = G.topic.trim().split("\n")[0].slice(0, 60);
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
    const { test, subs } = data, nf = subs.reduce((a, s) => a + s.flags, 0), nq = nreal(test.qs), wr = test.qs.some(q => q.t === "wr");
    const g = test.open ? ["ok", "OPEN"] : test.opensAt && !test.schedOpened ? ["w", "SCHEDULED"] : ["bad", "CLOSED"];
    const sch = [test.limit ? `⏱ ${test.limit} min limit` : "", test.opensAt && !test.schedOpened ? `opens ${fdt(test.opensAt)}` : "", test.closesAt && !test.schedClosed ? `closes ${fdt(test.closesAt)}` : ""].filter(Boolean).join(" · ");
    $("mh").innerHTML = `<div class="row sp"><button class=g id=b1>← Back</button><div class=row><span class=code>${code}</span><span class="tag ${g[0]}">${g[1]}</span><button class="${test.open ? "r" : "k"}" id=tg>${test.open ? "Close test" : "Open test"}</button><button class="${test.released ? "g" : "k"}" id=rl>${test.released ? "Unrelease results" : "Release results"}</button><button class=g id=csv>Gradebook CSV</button></div></div><h2>${e(test.title)} ${test.released ? `<span class="tag ok">RESULTS RELEASED</span>` : ""}</h2><p class=m>${subs.length} student(s) · ${subs.filter(s => s.status === "done").length} submitted · ${nf} total flags · updates live${sch ? "<br>" + sch : ""}</p>`;
    $("b1").onclick = dash;
    $("tg").onclick = async () => { try { if (test.open && !await ask("Close the test? Students still working will be submitted automatically.")) return; await api("POST", `/api/tests/${code}/toggle`); tick(); } catch (x) { err(x) } };
    $("rl").onclick = async () => {
      try {
        if (test.released) { if (!await ask("Hide the results from students again?")) return; await api("POST", `/api/tests/${code}/release`, { on: false }); toast("Results hidden."); }
        else { const o = await releaseDlg(wr ? subs.filter(s => s.status === "done" && !s.reviewed).length : 0, subs.filter(s => s.status !== "done").length); if (!o) return; await api("POST", `/api/tests/${code}/release`, { on: true, ans: o.ans }); toast("Results released. Students see them by joining with their name and the test code."); }
        tick();
      } catch (x) { err(x) }
    };
    $("csv").onclick = () => download(`${test.title}-grades.csv`, "Name,Status,Score,Total,Flags\n" + subs.map(s => `"${s.name.replace(/"/g, '""')}",${s.status === "done" ? "submitted" : "in progress"},${s.score},${s.total},${s.flags}`).join("\n"), "text/csv");
    $("mt").innerHTML = subs.length ? `<div class=tw><table><tr><th>Student</th><th>Status</th><th>Progress</th><th>Score</th><th>Flags</th><th>Last seen</th></tr>${subs.map(s => { const p = nq ? Math.round(s.answered / nq * 100) : 0;
      return `<tr class=cl data-s="${s.id}"><td><b>${e(s.name)}</b></td><td><span class="tag ${s.status === "done" ? "ok" : "w"}">${s.status === "done" ? (s.reviewed ? "MARKED" : "SUBMITTED") : "IN PROGRESS"}</span></td><td><div class=bar><i style="width:${p}%"></i></div><span class=m>${s.answered}/${nq}</span></td><td>${s.score} / ${s.total}</td><td>${s.flags ? `<span class="tag bad">⚠ ${s.flags}</span>` : `<span class=m>0</span>`}</td><td class=m>${s.updated ? fmt(s.updated) : "-"}</td></tr>`; }).join("")}</table></div><p class=m>Click a student to review and mark. Written answers count 0 until marked. Flags are hints for you, not proof of cheating.</p>` : `<p class=m>Waiting for students. Share the code <b>${code}</b> and open the test.</p>`;
    $("mt").onclick = ev => { const r = ev.target.closest("tr[data-s]"); if (r) review(test, r.dataset.s, code); };
  };
  const tick = async () => { try { data = await api("GET", "/api/tests/" + code); draw(); backup(); } catch (x) { if (x.code === 401) home(); } };
  poll(tick, 3000);
}

/* ---------- TEACHER: review & mark ---------- */
async function review(test, id, code) {
  clean(); let s;
  try { s = await api("GET", "/api/subs/" + id); } catch (x) { err(x); return monitor(code); }
  const N = nums(test.qs), fcount = {}; (s.flags || []).forEach(f => fcount[f.k] = (fcount[f.k] || 0) + 1);
  app.innerHTML = `<div class="row sp"><button class=g id=b2>← Back</button><div class=row><button class=g id=ex>Export for student (PDF)</button><button id=sm>Save marks</button></div></div>
<h2>${e(s.name)} <span class=m>· ${e(test.title)}</span></h2>
<div class=card><div class="row sp"><b>Total: <span id=tot>${score(test, s)}</span> / ${total(test)}</b><span class="tag ${s.status === "done" ? "ok" : "w"}">${s.status === "done" ? "SUBMITTED " + fmt(s.submitted) : "IN PROGRESS (not final)"}</span></div>
<p class=m style="margin:8px 0 0">${(s.flags || []).length ? `<b class=bad>⚠ ${s.flags.length} flag(s):</b> ` + Object.entries(fcount).map(([k, n]) => e(k) + " ×" + n).join(", ") + `. These are hints, not proof.` : "No flags recorded."}</p>
${(s.flags || []).length ? `<details style="margin-top:8px"><summary class=m style="cursor:pointer">Show timeline</summary><div class="fl m">${s.flags.map(f => `<div>${fmt(f.t)} — ${fl(f)}</div>`).join("")}</div></details>` : ""}</div>
${test.qs.map((q, i) => {
    if (q.t === "ti") return `<h3 style="margin:18px 4px 4px;white-space:pre-wrap">${e(q.q)}</h3>`;
    const a = (s.answers || {})["q" + i], m = mark(test, s, i);
    return `<div class=card><div class=qh><b>Q${N[i]} · ${TN[q.t]}</b><span class=m>${q.pts} pts</span></div><p class=qt>${e(q.q)}</p>${q.t === "bk" ? `<p class=m><b>Word bank:</b> ${q.bank.map(e).join(" · ")}</p>` : ""}
<p><b>Student:</b> <span style="white-space:pre-wrap">${e(aText(q, a))}</span></p><p class=m><b>Expected:</b> <span style="white-space:pre-wrap">${e(cText(q))}</span></p>
<div class=row><label class=m>Mark</label><input type=number min=0 max=${q.pts} step=0.5 data-m=${i} value="${m}" style="width:90px"><span class=m>/ ${q.pts}</span>
<button class=g data-full=${i}>✓ Full</button><button class=g data-zero=${i}>✗ Zero</button></div>
<input data-fb=${i} placeholder="Feedback to student (optional)" value="${e((s.fb || {})["q" + i] || "")}"></div>`; }).join("")}`;
  const read = () => { const marks = {}, fb = {};
    app.querySelectorAll("[data-m]").forEach(x => { marks["q" + x.dataset.m] = Math.max(0, Math.min(test.qs[x.dataset.m].pts, Number(x.value) || 0)); });
    app.querySelectorAll("[data-fb]").forEach(x => { if (x.value.trim()) fb["q" + x.dataset.fb] = x.value.trim(); }); return { marks, fb }; };
  const upd = () => { $("tot").textContent = Math.round(Object.values(read().marks).reduce((a, b) => a + b, 0) * 100) / 100; };
  app.oninput = upd;
  app.onclick = ev => { const b = ev.target.closest("button[data-full],button[data-zero]"); if (!b) return; const i = b.dataset.full ?? b.dataset.zero; app.querySelector(`[data-m="${i}"]`).value = b.dataset.full !== undefined ? test.qs[i].pts : 0; upd(); };
  $("b2").onclick = () => monitor(code);
  $("sm").onclick = async () => { const r = read(); try { await api("POST", `/api/subs/${id}/marks`, r); Object.assign(s, { marks: r.marks, fb: r.fb }); toast("Marks saved."); } catch (x) { err(x) } };
  $("ex").onclick = () => {
    const r = read(); Object.assign(s, r);
    const items = test.qs.map((q, i) => q.t === "ti" ? { k: "title", q: q.q } : { k: "q", n: N[i], q: q.q, pts: q.pts, got: mark(test, s, i), extra: q.t === "bk" ? q.bank.join("  ·  ") : "", yours: aText(q, (s.answers || {})["q" + i]), expected: cText(q), fb: (s.fb || {})["q" + i] || "" });
    pdf({ title: test.title, name: s.name, score: score(test, s), total: total(test), items }, fname(test.title, s.name));
  };
}

/* ---------- STUDENT ---------- */
function saveSess(v) { try { v ? sessionStorage.setItem("eh_s", v) : sessionStorage.removeItem("eh_s"); } catch (_) {} }
async function join() {
  const name = $("sn").value.trim(), code = $("sc").value.trim().toUpperCase();
  if (!name || !code) return toast("Enter your name and the test code.");
  try {
    const r = await api("POST", "/api/join", { name, code });
    if (r.result) return showResult(r.result);
    saveSess(r.token); intro(r.token, r.test, r.answers, name);
  } catch (x) { if (x.opensAt) toast(`This test opens ${fdt(x.opensAt)}. Come back then.`); else err(x); }
}
async function resume(token) {
  try { const r = await api("POST", "/api/state", { token }); if (r.status === "done") { saveSess(null); return home(); } intro(token, r.test, r.answers, "Welcome back"); } catch (_) { saveSess(null); home(); }
}
/* released results (student view) */
function showResult(r) {
  clean(); saveSess(null); const N = nums(r.qs);
  app.innerHTML = `<div class="row sp"><button class=g id=hm>← Back</button><button id=pf>Download PDF</button></div>
<div class=card><h2>${e(r.title)}</h2><p class=m>${e(r.name)} · test code ${e(r.code)}</p><div class=code style="font-size:36px;letter-spacing:2px">${r.score} / ${r.total}</div></div>
${r.qs.map((q, i) => q.t === "ti" ? `<h3 style="margin:18px 4px 4px;white-space:pre-wrap">${e(q.q)}</h3>` :
    `<div class=card><div class=qh><b>Q${N[i]}</b><span class=m>${q.mark} / ${q.pts}</span></div><p class=qt>${e(q.q)}</p>${q.bank ? `<p class=m><b>Word bank:</b> ${q.bank.map(e).join(" · ")}</p>` : ""}
<p><b>Your answer:</b> <span style="white-space:pre-wrap">${e(q.yours)}</span></p>${q.expected != null ? `<p class=m><b>Expected:</b> <span style="white-space:pre-wrap">${e(q.expected)}</span></p>` : ""}${q.fb ? `<p class=fb><b>Teacher feedback:</b> ${e(q.fb)}</p>` : ""}</div>`).join("")}`;
  $("hm").onclick = home;
  $("pf").onclick = () => pdf({ title: r.title, name: r.name, score: r.score, total: r.total, sub: "Test code " + r.code,
    items: r.qs.map((q, i) => q.t === "ti" ? { k: "title", q: q.q } : { k: "q", n: N[i], q: q.q, pts: q.pts, got: q.mark, extra: q.bank ? q.bank.join("  ·  ") : "", yours: q.yours, expected: q.expected ?? null, fb: q.fb }) }, fname(r.title, r.name));
}
function intro(token, t, answers, who) {
  clean();
  app.innerHTML = `<div class=card><h2>${e(t.title)}</h2><p class=m>${e(who)} · ${nreal(t.qs)} questions · ${t.qs.reduce((a, q) => a + q.pts, 0)} marks${t.limit ? ` · ⏱ ${t.limit} minutes` : ""}</p>
<ul>${t.limit ? `<li><b>Time limit: ${t.limit} minutes.</b> The timer starts when you press the button and the test submits itself at zero.</li>` : ""}${t.deadline && !t.limit ? `<li>This test closes automatically; a countdown is shown at the top.</li>` : ""}<li>The test opens in full screen.</li><li>Switching tabs/windows, leaving full screen, resizing the window, pasting, and long pauses are <b>recorded and shown to your teacher</b>.</li><li>Copy and paste are disabled. Answers save automatically.</li></ul><button id=go style="width:100%">${Object.keys(answers).length ? "Continue test" : "Start test"}</button></div>`;
  $("go").onclick = async () => {
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch (_) {}
    try {
      const r = await api("POST", "/api/begin", { token });
      if (r.status === "done") { saveSess(null); toast("This test has already ended."); return home(); }
      t.deadline = r.deadline; t.now = r.now;
    } catch (x) { return err(x); }
    run(token, t, answers);
  };
}
function run(token, t, answers) {
  clean();
  const S = { answers: answers || {} }; let live = true, timer, busy = false, expiring = false, dl = t.deadline ?? null, skew = (t.now || Date.now()) - Date.now();
  const NQ = nreal(t.qs), N = nums(t.qs), IDLE = 180000;
  const answered = () => t.qs.filter((q, i) => isAns(q, S.answers["q" + i])).length;
  const ord = i => S.answers["q" + i] || t.qs[i].items.map(x => x.i);
  const dragH = i => ord(i).map((k, p) => `<div class=dr draggable=true data-qi=${i} data-p=${p}><span>${e(t.qs[i].items.find(x => x.i === k).x)}</span><button class=g data-mv=-1 data-qi=${i} data-p=${p}>▲</button><button class=g data-mv=1 data-qi=${i} data-p=${p}>▼</button></div>`).join("");
  const bkH = (q, i) => {
    const a = S.answers["q" + i] || [];
    const opts = v => `<option value="">— choose —</option>` + q.bank.map((w, k) => `<option value=${k} ${v === k ? "selected" : ""}>${e(w)}</option>`).join("");
    let tb = ""; for (let k = 0; k < q.bank.length; k += 4) tb += "<tr>" + [0, 1, 2, 3].map(c => q.bank[k + c] === undefined ? "<td class=em></td>" : `<td>${e(q.bank[k + c])}</td>`).join("") + "</tr>";
    return `<div class=tw><table class=bt>${tb}</table></div>` + q.sents.map((s, j) => {
      const m = /_{3,}/.exec(s), pre = m ? s.slice(0, m.index) : s, post = m ? s.slice(m.index + m[0].length) : "";
      return `<div class=bs><span class=m>${j + 1}.</span> <span>${e(pre)}</span><select data-bk=${i} data-j=${j}>${opts(a[j])}</select><span>${e(post)}</span></div>`;
    }).join("");
  };
  const push = async () => {
    if (!live) return;
    try {
      const r = await api("POST", "/api/save", { token, answers: S.answers });
      if (r.status === "done" && live) return finish(expiring ? "time" : "auto");
      if (r.deadline !== undefined) { dl = r.deadline; skew = r.now - Date.now(); }
    } catch (x) { if (x.code === 401 && live) { stop(); saveSess(null); toast("Session expired."); home(); } }
  };
  const save = () => { clearTimeout(timer); timer = setTimeout(push, 600); };
  /* ---- logging (hints for the teacher) ---- */
  const fstate = {};
  const flag = (k, x, warn) => {
    if (!live) return; const n = Date.now(); if (fstate[k] && n - fstate[k] < 300) return; fstate[k] = n;
    api("POST", "/api/flag", { token, k, x }).catch(() => {});
    if (warn) { const w = $("warn"); w.style.display = "block"; clearTimeout(flag.h); flag.h = setTimeout(() => w.style.display = "none", 6000); }
  };
  let awayAt = 0, awayK = null, lastAct = Date.now(), lastFs = 0, size = [innerWidth, innerHeight], rz, rzN = 0;
  const leave = k => { if (!awayAt) { awayAt = Date.now(); awayK = k; } flag(k, undefined, true); };
  const back = () => { if (awayAt) { const d = Date.now() - awayAt; if (live && d >= 500) api("POST", "/api/flag", { token, k: awayK, x: "away " + dur(d), upd: true }).catch(() => {}); awayAt = 0; } lastAct = Date.now(); };
  app.innerHTML = `<div class="card row sp ns" style="position:sticky;top:6px;z-index:5"><b>${e(t.title)}</b><div class=row><span class=m id=pg></span><span id=tm class=tm></span></div></div><div class=ns id=qs>${t.qs.map((q, i) => { const a = S.answers["q" + i];
    if (q.t === "ti") return `<section class="card ti"><p class=qt>${e(q.q)}</p></section>`;
    const b = q.t === "mc" ? q.opts.map((o, j) => `<label class=o><input type=radio name=q${i} data-i=${i} data-v=${j} ${a === j ? "checked" : ""}>${e(o)}</label>`).join("") :
      q.t === "tf" ? [true, false].map(v => `<label class=o><input type=radio name=q${i} data-i=${i} data-v=${v} ${a === v ? "checked" : ""}>${v ? "True" : "False"}</label>`).join("") :
      q.t === "drag" ? `<p class=m>Drag items (or use the arrows) into the correct order.</p><div id=d${i}>${dragH(i)}</div>` :
      q.t === "bk" ? bkH(q, i) :
      `<textarea class=sel data-i=${i} data-w=1 rows=7 placeholder="Type your answer…">${e(a || "")}</textarea>`;
    return `<section class=card><div class=qh><b>Q${N[i]}</b><span class=m>${q.pts} pt${q.pts == 1 ? "" : "s"}</span></div><p class=qt>${e(q.q)}</p>${b}</section>`; }).join("")}</div><button id=sb class=k style="width:100%;padding:13px">Submit test</button>`;
  const bar = () => { $("pg").textContent = answered() + " / " + NQ + " answered"; }; bar();
  const setA = (i, v) => { S.answers["q" + i] = v; bar(); save(); };
  const mv = (i, f, to) => { const a = [...ord(i)]; if (to < 0 || to >= a.length) return; const [x] = a.splice(f, 1); a.splice(to, 0, x); setA(i, a); $("d" + i).innerHTML = dragH(i); };
  const lens = {}; t.qs.forEach((q, i) => { if (q.t === "wr") lens[i] = (S.answers["q" + i] || "").length; });
  const q$ = $("qs");
  q$.onchange = ev => {
    const d = ev.target.dataset;
    if (d.bk !== undefined) { const i = +d.bk, arr = Array.isArray(S.answers["q" + i]) ? [...S.answers["q" + i]] : t.qs[i].sents.map(() => null); arr[+d.j] = ev.target.value === "" ? null : Number(ev.target.value); setA(i, arr); }
    else if (d.v !== undefined) setA(+d.i, t.qs[d.i].t === "tf" ? d.v === "true" : Number(d.v));
  };
  q$.oninput = ev => {
    const d = ev.target.dataset; if (!d.w) return;
    const v = ev.target.value, add = v.length - (lens[d.i] ?? 0); lens[d.i] = v.length;
    if (add > 40) flag("Large text insertion", add + " characters at once");
    setA(+d.i, v);
  };
  q$.onclick = ev => { const b = ev.target.closest("button[data-mv]"); if (b) mv(+b.dataset.qi, +b.dataset.p, +b.dataset.p + Number(b.dataset.mv)); };
  let from = null;
  q$.ondragstart = ev => { const r = ev.target.closest(".dr"); if (r) { from = r.dataset; try { ev.dataTransfer.setData("text/plain", "x") } catch (_) {} } };
  q$.ondragover = ev => { if (ev.target.closest(".dr")) ev.preventDefault(); };
  q$.ondrop = ev => {
    if (ev.target.closest("textarea")) { ev.preventDefault(); flag("Paste attempt", "text dropped in"); return; }
    const r = ev.target.closest(".dr"); if (r && from && from.qi === r.dataset.qi) { ev.preventDefault(); mv(+from.qi, +from.p, +r.dataset.p); } from = null;
  };
  /* copy / paste */
  const onPaste = ev => { if (!live) return; ev.preventDefault(); let n = 0; try { n = (ev.clipboardData.getData("text") || "").length; } catch (_) {} flag("Paste attempt", n ? n + " characters" : undefined); toast("Pasting is disabled. This attempt was recorded."); };
  const onCopy = ev => { if (!live) return; ev.preventDefault(); flag("Copy or cut attempt"); };
  const onCtx = ev => { if (live) ev.preventDefault(); };
  document.addEventListener("paste", onPaste); document.addEventListener("copy", onCopy); document.addEventListener("cut", onCopy); document.addEventListener("contextmenu", onCtx);
  /* leaving the page: every loss of focus is logged (even ~1 second), with how long the student was away */
  const vis = () => { document.hidden ? leave("Left the test tab") : back(); };
  const blur = () => setTimeout(() => { if (live && !document.hidden && !document.hasFocus()) leave("Window lost focus"); }, 150);
  const foc = () => back();
  const fs = () => { lastFs = Date.now(); if (!document.fullscreenElement) flag("Exited full screen", undefined, true); };
  /* long pauses (no keyboard/mouse/touch activity) */
  const act = () => { const n = Date.now(); if (live && !awayAt && n - lastAct >= IDLE) flag("Long pause", "no activity for " + dur(n - lastAct)); lastAct = n; };
  const actEv = ["keydown", "pointerdown", "pointermove", "touchstart", "scroll", "wheel"];
  /* window resizes */
  const rsz = () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const w = innerWidth, h = innerHeight;
      if (!live || Date.now() - lastFs < 2000) { size = [w, h]; return; }   // full-screen changes are not suspicious
      const dw = Math.abs(w - size[0]), dh = Math.abs(h - size[1]), coarse = matchMedia("(pointer:coarse)").matches; // phones: on-screen keyboard changes height
      if (dw < 40 && (coarse || dh < 40)) return;
      if (rzN++ < 30) flag("Window resized", `${size[0]}×${size[1]} → ${w}×${h}`);
      size = [w, h];
    }, 700);
  };
  document.addEventListener("visibilitychange", vis); window.addEventListener("blur", blur); window.addEventListener("focus", foc); document.addEventListener("fullscreenchange", fs);
  actEv.forEach(n => window.addEventListener(n, act, { passive: true, capture: true })); window.addEventListener("resize", rsz);
  /* countdown */
  const clock = ms => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const warned = {};
  const tick = () => {
    const el = $("tm"); if (!el) return;
    if (dl === null) { el.textContent = ""; el.className = "tm"; return; }
    const rem = dl - (Date.now() + skew);
    el.textContent = "⏱ " + clock(Math.max(0, rem)); el.className = "tm tag " + (rem < 60000 ? "bad" : rem < 300000 ? "w" : "");
    if (rem <= 300000 && rem > 60000 && !warned.a) { warned.a = 1; toast("5 minutes left."); }
    if (rem <= 60000 && rem > 0 && !warned.b) { warned.b = 1; toast("1 minute left!"); }
    if (rem <= 0 && live && !expiring) expire();
  };
  const expire = () => {
    expiring = true; busy = true; clearTimeout(timer);
    app.querySelectorAll("#qs input,#qs textarea,#qs select,#qs button,#sb").forEach(x => x.disabled = true);
    toast("Time's up. Submitting your test…");
    const go = async () => {
      if (!live) return;
      try { await api("POST", "/api/submit", { token, answers: S.answers }); finish("time"); }
      catch (x) { if (x.code === 401) { stop(); saveSess(null); home(); return; } setTimeout(go, 2500); }
    };
    go();
  };
  const hb = setInterval(push, 5000), tm = setInterval(tick, 500); tick();
  const stop = () => {
    live = false; clearInterval(hb); clearInterval(tm); clearTimeout(timer); clearTimeout(rz);
    document.removeEventListener("visibilitychange", vis); window.removeEventListener("blur", blur); window.removeEventListener("focus", foc); document.removeEventListener("fullscreenchange", fs);
    document.removeEventListener("paste", onPaste); document.removeEventListener("copy", onCopy); document.removeEventListener("cut", onCopy); document.removeEventListener("contextmenu", onCtx);
    actEv.forEach(n => window.removeEventListener(n, act, { capture: true })); window.removeEventListener("resize", rsz);
    try { document.fullscreenElement && document.exitFullscreen(); } catch (_) {} $("warn").style.display = "none";
  };
  const finish = why => {
    stop(); saveSess(null);
    const msg = why === "time" ? "⏰ Time's up. Your test was submitted automatically." : why === "auto" ? "Your teacher closed the test (or it reached its closing time), so it was submitted automatically." : "Your answers were sent to your teacher.";
    app.innerHTML = `<div class=card style="text-align:center;margin-top:40px"><h2>✅ Test submitted</h2><p class=m>${msg}<br>If your teacher releases results, you can see them from the start page with your name and the test code.<br>You can close this page.</p><button class=g id=hm>Back to start</button></div>`; $("hm").onclick = home;
  };
  $("sb").onclick = async () => {
    if (busy) return; const n = NQ - answered();
    if (!await ask(n ? `${n} question(s) unanswered. Submit anyway?` : "Submit your test now?")) return;
    busy = true; clearTimeout(timer);
    try { await api("POST", "/api/submit", { token, answers: S.answers }); finish("manual"); } catch (x) { busy = false; err(x); }
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
