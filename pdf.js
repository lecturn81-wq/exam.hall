"use strict";
/* ExamHall PDF export — no libraries.
   The report is laid out on A4 canvas pages (so any language, ✓ ✗ → and emoji render correctly) and each page is
   embedded in a PDF file as a JPEG. Usage: ExamPDF.build({title,name,sub,score,total,items}) -> Blob
   items: {k:"title",q} or {k:"q",n,q,pts,got,extra,yours,expected,fb} */
const ExamPDF = (() => {
  const PW = 794, PH = 1123, M = 48, S = 2;               // A4 at 96 dpi, margin, render scale (2 = crisp)
  const FONT = '"Helvetica Neue",Helvetica,Arial,"Segoe UI",system-ui,sans-serif';
  const font = (px, bold) => (bold ? "bold " : "") + px + "px " + FONT;

  function wrap(ctx, text, maxW, firstW) {
    const lines = []; let width = firstW;
    for (const para of String(text).split("\n")) {
      let cur = "";
      for (const word of para.split(" ")) {
        const test = cur ? cur + " " + word : word;
        if (ctx.measureText(test).width <= width) { cur = test; continue; }
        if (cur) { lines.push(cur); width = maxW; cur = ""; }
        let w = word;
        while (ctx.measureText(w).width > width) {           // a single very long word: break it by characters
          let k = 1; while (k < w.length && ctx.measureText(w.slice(0, k + 1)).width <= width) k++;
          lines.push(w.slice(0, k)); width = maxW; w = w.slice(k);
        }
        cur = w;
      }
      lines.push(cur); width = maxW;
    }
    return lines;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function layout(doc) {
    const pages = []; let cv, ctx, y;
    const newPage = () => {
      cv = document.createElement("canvas"); cv.width = PW * S; cv.height = PH * S; ctx = cv.getContext("2d");
      ctx.scale(S, S); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH); ctx.textBaseline = "top"; ctx.textAlign = "left";
      pages.push(cv); y = M;
    };
    /* free text (headings, titles) */
    const text = (str, px, o = {}) => {
      const lh = Math.round(px * 1.45), x = o.x ?? M, w = o.w ?? PW - 2 * M;
      ctx.font = font(px, o.bold);
      for (const ln of wrap(ctx, str, w, w)) {
        if (y + lh > PH - M) { newPage(); ctx.font = font(px, o.bold); }
        ctx.fillStyle = o.color || "#111"; ctx.fillText(ln, x, y); y += lh;
      }
      y += o.gap || 0;
    };
    /* a bordered box made of rows; splits across pages line by line */
    const box = rows => {
      const X = M, W = PW - 2 * M, PAD = 12, IN = W - 2 * PAD;
      let top = y; y += PAD;
      const close = () => { ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 1; rr(ctx, X + .5, top + .5, W - 1, y + PAD - top - 1, 8); ctx.stroke(); };
      const brk = () => { close(); newPage(); top = y; y += PAD; };
      for (const r of rows) {
        if (r.sp) { if (y + r.sp > PH - M - PAD) brk(); if (r.bg) { ctx.fillStyle = r.bg; ctx.fillRect(X + PAD, y, IN, r.sp); } y += r.sp; continue; }
        const px = r.px || 15, lh = Math.round(px * 1.45), ind = r.bg ? 8 : 0, w = IN - 2 * ind, x0 = X + PAD + ind;
        if (r.head !== undefined) {
          if (y + lh > PH - M - PAD) brk();
          ctx.font = font(px, true); ctx.fillStyle = "#111"; ctx.fillText(r.head, x0, y);
          if (r.right) { ctx.font = font(px, false); ctx.textAlign = "right"; ctx.fillText(r.right, X + W - PAD, y); ctx.textAlign = "left"; }
          y += lh; continue;
        }
        let labW = 0;
        if (r.label) { ctx.font = font(px, true); labW = ctx.measureText(r.label + " ").width; }
        ctx.font = font(px, r.bold);
        let firstW = w - labW, lines;
        if (r.label && firstW < 90) { lines = [""].concat(wrap(ctx, r.body, w, w)); firstW = w; } // label gets its own line
        else lines = wrap(ctx, r.body, w, r.label ? firstW : w);
        lines.forEach((ln, k) => {
          if (y + lh > PH - M - PAD) { brk(); }
          if (r.bg) { ctx.fillStyle = r.bg; ctx.fillRect(X + PAD, y, IN, lh); }
          ctx.fillStyle = r.color || "#111";
          if (k === 0 && r.label) { ctx.font = font(px, true); ctx.fillText(r.label, x0, y); ctx.font = font(px, r.bold); ctx.fillText(ln, x0 + labW, y); }
          else { ctx.font = font(px, r.bold); ctx.fillText(ln, x0, y); }
          y += lh;
        });
      }
      close(); y += PAD + 12;
    };

    newPage();
    text(doc.title, 26, { bold: true, gap: 4 });
    text(doc.name + " — " + doc.score + " / " + doc.total, 18, { bold: true, gap: 2 });
    if (doc.sub) text(doc.sub, 12, { color: "#667085", gap: 2 });
    y += 10;
    for (const it of doc.items) {
      if (it.k === "title") { y += 4; text(it.q, 19, { bold: true, gap: 8 }); continue; }
      const rows = [{ head: "Q" + it.n, right: it.got + " / " + it.pts }, { sp: 6 }, { body: it.q }, { sp: 6 }];
      if (it.extra) rows.push({ label: "Word bank:", body: it.extra, color: "#555" }, { sp: 6 });
      rows.push({ label: "Your answer:", body: it.yours });
      if (it.expected != null) rows.push({ sp: 6 }, { label: "Expected:", body: it.expected, color: "#555" });
      if (it.fb) rows.push({ sp: 8 }, { sp: 6, bg: "#fff7d6" }, { label: "Teacher feedback:", body: it.fb, bg: "#fff7d6", color: "#111" }, { sp: 6, bg: "#fff7d6" });
      box(rows);
    }
    pages.forEach((c, i) => { // footer
      const g = c.getContext("2d"); g.font = font(11); g.fillStyle = "#999"; g.textBaseline = "top"; g.textAlign = "right";
      g.fillText((i + 1) + " / " + pages.length, PW - M, PH - 34);
    });
    return pages;
  }

  function toBytes(dataUrl) {
    const bin = atob(dataUrl.split(",")[1]), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  /* wraps JPEG pages into a valid PDF 1.4 file */
  function assemble(jpgs, W, H) {
    const enc = new TextEncoder(), chunks = [], offs = []; let off = 0;
    const push = b => { if (typeof b === "string") b = enc.encode(b); chunks.push(b); off += b.length; };
    const obj = (n, body) => { offs[n] = off; push(n + " 0 obj\n" + body + "\nendobj\n"); };
    const N = jpgs.length, total = 2 + 3 * N;
    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])); // %PDF-1.4 + binary marker
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [" + jpgs.map((_, i) => (3 + 3 * i) + " 0 R").join(" ") + "] /Count " + N + " >>");
    jpgs.forEach((jpg, i) => {
      const pg = 3 + 3 * i, ct = pg + 1, im = pg + 2, cs = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
      obj(pg, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 " + im + " 0 R >> >> /Contents " + ct + " 0 R >>");
      obj(ct, "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
      offs[im] = off;
      push(im + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + W + " /Height " + H + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n");
      push(jpg); push("\nendstream\nendobj\n");
    });
    const xo = off;
    let x = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for (let n = 1; n <= total; n++) x += String(offs[n]).padStart(10, "0") + " 00000 n \n";
    push(x + "trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xo + "\n%%EOF\n");
    return new Blob(chunks, { type: "application/pdf" });
  }

  return { build: doc => { const pages = layout(doc); return assemble(pages.map(c => toBytes(c.toDataURL("image/jpeg", 0.92))), PW * S, PH * S); }, _layout: layout, _assemble: assemble };
})();
if (typeof module !== "undefined") module.exports = ExamPDF;
