(() => {
"use strict";

const DB = window.BANCO;
const CASES = DB.cases;
const ALLQ = DB.qs.filter(q => !q.dupOf);           // questões repetidas já foram agrupadas
const BYID = Object.fromEntries(DB.qs.map(q => [q.id, q]));
const caseTitle = n => (CASES.find(c => c.n === n) || {}).title || "";
const SRC_LABEL = { banca: "Banca", ia: "Autoral (IA)" };

/* ---------- persistência local ---------- */
const KEY = "bqcir.v1";
const S = load();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  return Object.assign({ ans: {}, cut: {}, hl: {}, sims: [], cur: null, study: { c: 1, src: "banca", i: 0 }, theme: null }, s || {});
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmtTime(ms) { const s = Math.floor(ms / 1000), h = s / 3600 | 0, m = (s % 3600) / 60 | 0, ss = s % 60; return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0"); }
function qsOf(c, src) { return ALLQ.filter(q => (c == null || q.c === c) && (src === "all" || q.src === src)); }

/* ---------- renderização de blocos ---------- */
function figure(src, cap) {
  return `<figure><img src="${esc(src)}" alt="${esc(cap || "Figura")}">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>`;
}
function mdBlocks(blocks) {
  return blocks.map(b => b.t === "img" ? figure(b.src, b.cap) : `<p>${esc(b.x)}</p>`).join("");
}
function htmlBlocks(blocks) {
  let out = "", inList = false;
  for (const b of blocks) {
    if (b.t === "li") { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${b.h}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    if (b.t === "img") out += figure(b.src, "");
    else if (b.t === "table") out += b.h;
    else out += `<p>${b.h}</p>`;
  }
  return out + (inList ? "</ul>" : "");
}
const isWarn = x => /^(diverg|atenção|aten[cç]ão|observação|cuidado)/i.test(x);

function renderStem(q) {
  return q.stemH ? htmlBlocks(q.stemH) : mdBlocks(q.stem);
}

function renderExpl(q) {
  const T = { correta: `Por que a alternativa ${q.ans} está correta`, demais: "Por que as demais estão erradas", gravar: "Para gravar", fonte: "Fonte", nota: "Observação" };
  let h = "";
  if (q.origAns) h += `<div class="sec warn"><h4>Divergência de gabarito</h4><p>No compilado original o gabarito registrado é <b>${esc(q.origAns)}</b>; nos volumes comentados, <b>${esc(q.ans)}</b>. Confirme com o tutor.</p></div>`;
  if (q.dupNote) h += `<div class="sec warn"><h4>Questão repetida no banco</h4>${q.dupNote.map(d => `<p>O mesmo enunciado aparece como questão <b>${esc(BYID[d.id].lbl)}</b> (gabarito ${esc(d.ans)}). Ela foi agrupada aqui para não aparecer duas vezes.</p>`).join("")}</div>`;
  for (const s of q.expl) {
    const warnParas = s.b.filter(b => b.t === "p" && isWarn(b.x));
    const rest = s.b.filter(b => !warnParas.includes(b));
    if (rest.length) h += `<div class="sec ${s.k}"><h4>${T[s.k] || ""}</h4>${mdBlocks(rest)}</div>`;
    if (warnParas.length) h += `<div class="sec warn"><h4>Atenção</h4>${mdBlocks(warnParas)}</div>`;
  }
  if (q.orig && q.orig.length) {
    const open = q.extra || !q.expl.length ? " open" : "";
    h += `<details class="sec orig"${open}><summary>Comentário original do compilado <span class="muted small">· ${esc(q.origFile)}</span></summary><div class="body">${htmlBlocks(q.orig)}</div></details>`;
  }
  if (!h) h = `<div class="sec"><p class="muted">Sem comentário disponível para esta questão.</p></div>`;
  return `<div class="expl">${h}</div>`;
}

function badges(q) {
  let b = `<span class="badge ${q.src}">${SRC_LABEL[q.src]}</span>`;
  if (q.extra) b += `<span class="badge extra" title="Questão presente apenas no compilado original (.docx), sem comentário dos volumes">Só no compilado</span>`;
  return b;
}

/* ---------- componente de questão ----------
   opts.reveal: mostrar gabarito após responder (estudo / simulado com correção imediata)
   opts.chosen / opts.onChoose: estado de resposta controlado pelo chamador */
function questionCard(q, opts) {
  const el = document.createElement("div");
  el.className = "card q";
  el.dataset.qid = q.id;
  const cut = new Set(S.cut[q.id] || []);
  let pick = opts.chosen || null;
  let answered = !!opts.answered;

  el.innerHTML = `
    <div class="q-head">
      <span class="lbl">Questão ${esc(q.lbl)}</span>${badges(q)}
      <span class="muted small">Caso ${q.c} · ${esc(caseTitle(q.c))}</span>
      <span class="spacer"></span>
      <span class="tools">Grifar:
        <button class="sw y" data-tool="y" title="Selecione o texto e clique para grifar"></button>
        <button class="sw g" data-tool="g" title="Verde"></button>
        <button class="sw p" data-tool="p" title="Rosa"></button>
        <button class="btn ghost sm" data-tool="clear" title="Remover todos os grifos desta questão">limpar</button>
      </span>
    </div>
    <div class="stem hl-zone" data-z="stem">${renderStem(q)}</div>
    <div class="alts">${q.alts.map(a => `
      <div class="alt" data-l="${a.l}">
        <span class="let">${a.l}</span>
        <div class="txt hl-zone" data-z="${a.l}">${esc(a.x)}</div>
        <button class="cut" title="Excluir / restaurar alternativa" aria-label="Excluir alternativa ${a.l}">✂</button>
      </div>`).join("")}
    </div>
    <div class="q-actions"></div>
    <div class="expl-slot"></div>`;

  // grifos salvos
  const saved = S.hl[q.id];
  if (saved) for (const z of $$(".hl-zone", el)) if (saved[z.dataset.z] != null) z.innerHTML = saved[z.dataset.z];

  function paint() {
    el.classList.toggle("locked", answered && opts.reveal);
    for (const a of $$(".alt", el)) {
      const l = a.dataset.l;
      a.classList.toggle("cutoff", cut.has(l));
      a.classList.toggle("sel", pick === l && !(answered && opts.reveal));
      a.classList.toggle("right", answered && opts.reveal && l === q.ans);
      a.classList.toggle("wrong", answered && opts.reveal && l === pick && pick !== q.ans);
    }
    const act = $(".q-actions", el);
    const extra = typeof opts.extraActions === "function" ? opts.extraActions(answered) : (opts.extraActions || "");
    if (answered && opts.reveal) {
      const ok = pick === q.ans;
      act.innerHTML = `<span class="verdict ${ok ? "ok" : "bad"}">${ok ? "✓ Você acertou" : `✗ Você marcou ${pick} · gabarito ${q.ans}`}</span><span class="spacer"></span>${extra}`;
      $(".expl-slot", el).innerHTML = renderExpl(q);
    } else {
      act.innerHTML = opts.reveal
        ? `<button class="btn primary" data-act="answer" ${pick ? "" : "disabled"}>Responder</button><span class="kbd">Teclas: A–E marcam · Enter responde · ← → navegam</span><span class="spacer"></span>${extra}`
        : `<span class="muted small">${pick ? `Marcada: <b>${pick}</b>` : "Nenhuma alternativa marcada"}</span><span class="spacer"></span>${extra}`;
      $(".expl-slot", el).innerHTML = "";
    }
  }

  function choose(l) {
    if (answered && opts.reveal) return;
    if (cut.has(l)) return;
    pick = pick === l && !opts.reveal ? null : l;
    if (opts.onChoose) opts.onChoose(pick);
    paint();
  }
  function answer() {
    if (!pick || (answered && opts.reveal)) return;
    answered = true;
    if (opts.onAnswer) opts.onAnswer(pick);
    paint();
  }
  function toggleCut(l) {
    if (answered && opts.reveal) return;
    cut.has(l) ? cut.delete(l) : cut.add(l);
    if (cut.has(l) && pick === l) { pick = null; if (opts.onChoose) opts.onChoose(null); }
    S.cut[q.id] = [...cut]; if (!S.cut[q.id].length) delete S.cut[q.id];
    save(); paint();
  }

  el.addEventListener("click", e => {
    const t = e.target;
    const tool = t.closest("[data-tool]");
    if (tool) {
      if (tool.dataset.tool === "clear") { delete S.hl[q.id]; save(); for (const z of $$(".hl-zone", el)) z.innerHTML = z.dataset.z === "stem" ? renderStem(q) : esc(q.alts.find(a => a.l === z.dataset.z).x); }
      else applyHighlight(tool.dataset.tool);
      return;
    }
    if (t.closest("[data-act=answer]")) return answer();
    const nav = t.closest("[data-nav]");
    if (nav) return opts.onNav && opts.onNav(+nav.dataset.nav);
    if (t.closest("[data-redo]")) return opts.onRedo && opts.onRedo();
    if (t.closest("[data-finish]")) return opts.onFinish && opts.onFinish();
    if (t.closest("img") && t.closest("figure")) return openLightbox(t.src);
    const cutB = t.closest(".cut");
    const alt = t.closest(".alt");
    if (cutB && alt) return toggleCut(alt.dataset.l);
    if (alt) {
      if (!window.getSelection().isCollapsed) return; // usuário está selecionando texto para grifar
      choose(alt.dataset.l);
    }
  });
  el.addEventListener("contextmenu", e => {
    const alt = e.target.closest(".alt");
    if (alt && window.getSelection().isCollapsed) { e.preventDefault(); toggleCut(alt.dataset.l); }
  });
  el._key = k => {
    const up = k.toUpperCase();
    if (q.alts.some(a => a.l === up)) { choose(up); return true; }
    if (k === "Enter" && opts.reveal) { answer(); return true; }
    return false;
  };
  paint();
  return el;
}

/* ---------- marca-texto ---------- */
function zoneOf(node) { const e = node && (node.nodeType === 1 ? node : node.parentElement); return e && e.closest(".hl-zone"); }
function applyHighlight(color) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const card = zoneOf(range.startContainer)?.closest(".q") || zoneOf(range.endContainer)?.closest(".q");
  if (!card) return;
  // coleta nós de texto da seleção dentro das zonas grifáveis
  const nodes = [];
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, { acceptNode: n => zoneOf(n) && range.intersectsNode(n) && n.nodeValue.length ? 1 : 2 });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (let n of nodes) {
    let s = 0, e = n.nodeValue.length;
    if (n === range.startContainer) s = range.startOffset;
    if (n === range.endContainer) e = range.endOffset;
    if (s >= e) continue;
    if (color === "x") {
      const m = n.parentElement.closest("mark.hl");
      if (m) { m.replaceWith(...m.childNodes); }
      continue;
    }
    if (e < n.nodeValue.length) n.splitText(e);
    if (s > 0) n = n.splitText(s);
    const old = n.parentElement.closest("mark.hl");
    if (old && old.childNodes.length === 1) { old.className = "hl " + color; continue; }
    const m = document.createElement("mark");
    m.className = "hl " + color;
    n.replaceWith(m); m.appendChild(n);
  }
  for (const z of $$(".hl-zone", card)) z.normalize();
  sel.removeAllRanges();
  const qid = card.dataset.qid;
  const rec = {};
  for (const z of $$(".hl-zone", card)) if (z.querySelector("mark.hl")) rec[z.dataset.z] = z.innerHTML;
  if (Object.keys(rec).length) S.hl[qid] = rec; else delete S.hl[qid];
  save();
  hidePop();
}
const pop = $("#hlPop");
function hidePop() { pop.hidden = true; }
function maybeShowPop() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !zoneOf(sel.anchorNode) && !zoneOf(sel.focusNode)) return hidePop();
  const r = sel.getRangeAt(0).getBoundingClientRect();
  pop.hidden = false;
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + window.scrollX + "px";
  pop.style.top = (r.top + window.scrollY - pop.offsetHeight - 8 < window.scrollY + 60 ? r.bottom + window.scrollY + 8 : r.top + window.scrollY - pop.offsetHeight - 8) + "px";
}
document.addEventListener("mouseup", e => { if (!pop.contains(e.target)) setTimeout(maybeShowPop, 0); });
document.addEventListener("touchend", e => { if (!pop.contains(e.target)) setTimeout(maybeShowPop, 300); });
pop.addEventListener("mousedown", e => e.preventDefault());
pop.addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b) applyHighlight(b.dataset.c); });

/* ---------- confirmação na página (o visualizador bloqueia confirm()) ---------- */
function askInline(msg, yesLabel, onYes) {
  $("#askBar")?.remove();
  const bar = document.createElement("div");
  bar.id = "askBar"; bar.className = "ask-bar";
  bar.innerHTML = `<span>${esc(msg)}</span><span class="spacer"></span><button class="btn ghost sm" data-no>Cancelar</button><button class="btn primary sm" data-yes>${esc(yesLabel)}</button>`;
  bar.addEventListener("click", e => {
    if (e.target.closest("[data-yes]")) { bar.remove(); onYes(); }
    else if (e.target.closest("[data-no]")) bar.remove();
  });
  document.body.appendChild(bar);
}

/* ---------- lightbox ---------- */
const lb = $("#lightbox");
function openLightbox(src) { $("img", lb).src = src; lb.hidden = false; }
lb.addEventListener("click", () => lb.hidden = true);

/* ---------- estatísticas ---------- */
function statsFor(list) {
  let done = 0, ok = 0;
  for (const q of list) { const a = S.ans[q.id]; if (a) { done++; if (a.ok) ok++; } }
  return { total: list.length, done, ok };
}
function recordAnswer(q, pick) {
  S.ans[q.id] = { sel: pick, ok: pick === q.ans, t: Date.now() };
  save();
}

/* ---------- roteamento ---------- */
const app = $("#app");
let view = "home";
let keyHandler = null;
function go(v) {
  view = v;
  for (const b of $$("#tabs button")) b.classList.toggle("on", b.dataset.view === v);
  keyHandler = null; hidePop();
  app.innerHTML = "";
  ({ home: Home, study: Study, sim: Sim })[v]();
  window.scrollTo(0, 0);
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.view); });
document.addEventListener("keydown", e => {
  if (e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!lb.hidden && e.key === "Escape") { lb.hidden = true; return; }
  if (keyHandler && keyHandler(e)) e.preventDefault();
});

/* ---------- tema ---------- */
function applyTheme() { if (S.theme) document.documentElement.dataset.theme = S.theme; else delete document.documentElement.dataset.theme; }
$("#themeBtn").addEventListener("click", () => {
  const dark = S.theme ? S.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  S.theme = dark ? "light" : "dark"; save(); applyTheme();
});
applyTheme();

/* ---------- INÍCIO ---------- */
function Home() {
  const b = statsFor(qsOf(null, "banca")), ia = statsFor(qsOf(null, "ia")), all = statsFor(ALLQ);
  const rows = CASES.map(c => {
    const sb = statsFor(qsOf(c.n, "banca")), si = statsFor(qsOf(c.n, "ia"));
    const d = sb.done + si.done, o = sb.ok + si.ok;
    return `<tr><td><b>${c.n}</b></td><td><a href="#" data-case="${c.n}">${esc(c.title)}</a></td>
      <td class="num">${sb.total}</td><td class="num">${si.total}</td>
      <td class="num">${d}/${sb.total + si.total}</td><td><div class="bar"><i style="width:${pct(d, sb.total + si.total)}%"></i></div></td>
      <td class="num">${d ? pct(o, d) + "%" : "—"}</td></tr>`;
  }).join("");
  app.innerHTML = `
    <h1>Banco de Questões de Cirurgia Geral</h1>
    <p class="muted">${ALLQ.length} questões em 15 casos: ${b.total} da banca (provas anteriores) e ${ia.total} autorais escritas por IA no estilo da banca. Questões repetidas foram agrupadas.</p>
    <div class="grid cols-3" style="margin:20px 0">
      <div class="card stat"><b>${all.done}<span class="muted" style="font-size:16px"> / ${all.total}</span></b><span>questões respondidas</span></div>
      <div class="card stat"><b>${all.done ? pct(all.ok, all.done) + "%" : "—"}</b><span>de acerto geral</span></div>
      <div class="card stat"><b>${S.sims.length}</b><span>simulados concluídos</span></div>
    </div>
    <div class="row" style="margin-bottom:20px">
      <button class="btn primary" data-go="study">Estudar por caso</button>
      <button class="btn" data-go="sim">Criar simulado</button>
    </div>
    <div class="card">
      <h2>Progresso por caso</h2>
      <div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>Caso</th><th>Tema</th><th class="num">Banca</th><th class="num">IA</th><th class="num">Feitas</th><th></th><th class="num">Acerto</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="row" style="margin-top:14px"><span class="muted small">Seu progresso, grifos e alternativas excluídas ficam salvos neste navegador.</span><span class="spacer"></span><button class="btn ghost sm" id="reset">Apagar meu progresso</button></div>
    </div>`;
  app.addEventListener("click", homeClick);
  function homeClick(e) {
    const g = e.target.closest("[data-go]"); if (g) { app.removeEventListener("click", homeClick); return go(g.dataset.go); }
    const c = e.target.closest("[data-case]");
    if (c) { e.preventDefault(); S.study.c = +c.dataset.case; S.study.i = 0; save(); app.removeEventListener("click", homeClick); return go("study"); }
    if (e.target.id === "reset") askInline("Apagar respostas, grifos, exclusões e histórico de simulados?", "Apagar tudo", () => {
      Object.assign(S, { ans: {}, cut: {}, hl: {}, sims: [], cur: null }); delete S.paused; save(); app.removeEventListener("click", homeClick); go("home");
    });
  }
}

/* ---------- ESTUDO ---------- */
function Study() {
  const st = S.study;
  const list = () => qsOf(st.c, st.src);
  app.innerHTML = `<div class="study">
      <aside class="card side" id="side"></aside>
      <section>
        <select class="mobile-case" id="mcase">${CASES.map(c => `<option value="${c.n}">Caso ${c.n} · ${esc(c.title)}</option>`).join("")}</select>
        <div class="card" id="caseHead" style="margin-bottom:16px"></div>
        <div id="qslot"></div>
      </section>
    </div>`;

  function side() {
    $("#side").innerHTML = CASES.map(c => {
      const s = statsFor(qsOf(c.n, st.src));
      return `<button class="case-btn ${c.n === st.c ? "on" : ""}" data-c="${c.n}"><span class="n">${c.n}</span><span class="t">${esc(c.title)}<small>${s.done}/${s.total} feitas${s.done ? ` · ${pct(s.ok, s.done)}% acerto` : ""}</small></span></button>`;
    }).join("");
    $("#mcase").value = st.c;
  }
  function head() {
    const c = CASES.find(x => x.n === st.c), L = list(), s = statsFor(L);
    const intro = st.src === "ia" ? c.introIA : c.intro;
    $("#caseHead").innerHTML = `
      <div class="row"><h2 style="margin:0">Caso ${c.n} · ${esc(c.title)}</h2><span class="spacer"></span>
        <div class="seg" id="srcSeg">${[["banca", "Banca"], ["ia", "Autorais (IA)"], ["all", "Todas"]].map(([k, t]) => `<button data-src="${k}" class="${st.src === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
      <p class="muted small" style="margin:8px 0 12px">${s.total} questões · ${s.done} feitas · ${s.done ? pct(s.ok, s.done) + "% de acerto" : "nenhuma respondida ainda"}</p>
      ${intro && intro.length ? `<details class="intro"><summary>Visão geral do caso</summary>${intro.map(p => `<p>${esc(p)}</p>`).join("")}</details>` : ""}
      <div class="qgrid" style="margin-top:12px">${L.map((q, i) => {
        const a = S.ans[q.id];
        return `<button data-i="${i}" class="${i === st.i ? "cur" : ""} ${a ? (a.ok ? "ok" : "bad") : ""} ${q.src === "ia" ? "ia" : ""}" title="${esc(SRC_LABEL[q.src])} ${esc(q.lbl)}">${esc(q.lbl.split(".")[1])}</button>`;
      }).join("")}</div>`;
  }
  function showQ() {
    const L = list();
    if (!L.length) { $("#qslot").innerHTML = `<div class="card empty">Nenhuma questão neste filtro.</div>`; return; }
    st.i = Math.max(0, Math.min(st.i, L.length - 1)); save();
    const q = L[st.i], prev = S.ans[q.id];
    const nav = `<button class="btn sm" data-nav="-1" ${st.i ? "" : "disabled"}>← Anterior</button><button class="btn sm" data-nav="1" ${st.i < L.length - 1 ? "" : "disabled"}>Próxima →</button>`;
    const card = questionCard(q, {
      reveal: true, chosen: prev?.sel, answered: !!prev,
      extraActions: answered => (answered ? `<button class="btn ghost sm" data-redo>Refazer</button>` : "") + nav,
      onAnswer: p => { recordAnswer(q, p); head(); side(); },
      onNav: move,
      onRedo: () => { delete S.ans[q.id]; save(); head(); side(); showQ(); }
    });
    $("#qslot").innerHTML = ""; $("#qslot").appendChild(card);
    keyHandler = e => {
      if (e.key === "ArrowRight") { move(1); return true; }
      if (e.key === "ArrowLeft") { move(-1); return true; }
      return card._key(e.key);
    };
  }
  function move(d) { const L = list(); const n = st.i + d; if (n < 0 || n >= L.length) return; st.i = n; save(); head(); showQ(); window.scrollTo({ top: $("#qslot").offsetTop - 70, behavior: "smooth" }); }
  function setCase(n) { st.c = n; st.i = 0; save(); side(); head(); showQ(); }

  $("#side").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (b) setCase(+b.dataset.c); });
  $("#mcase").addEventListener("change", e => setCase(+e.target.value));
  $("#caseHead").addEventListener("click", e => {
    const s = e.target.closest("[data-src]"); if (s) { st.src = s.dataset.src; st.i = 0; save(); side(); head(); showQ(); return; }
    const g = e.target.closest("[data-i]"); if (g) { st.i = +g.dataset.i; save(); head(); showQ(); }
  });
  side(); head(); showQ();
}

/* ---------- SIMULADOS ---------- */
const simCfg = { src: "banca", cases: CASES.map(c => c.n), n: 20, fresh: true, wrongOnly: false, balance: true, mode: "end" };
function Sim() {
  if (S.cur && !S.cur.done) return SimRun();
  SimSetup();
}
function poolFor(cfg) {
  let p = ALLQ.filter(q => cfg.cases.includes(q.c) && (cfg.src === "all" || q.src === cfg.src));
  if (cfg.wrongOnly) p = p.filter(q => S.ans[q.id] && !S.ans[q.id].ok);
  return p;
}
function seenInSims() { const s = new Set(); for (const h of S.sims) for (const id of h.qids) s.add(id); return s; }
function buildSim(cfg) {
  const pool = poolFor(cfg);
  const seen = seenInSims();
  const isNew = q => !S.ans[q.id] && !seen.has(q.id);
  // nunca repete dentro do simulado: amostragem sem reposição
  let ordered;
  if (cfg.balance) {
    // distribui entre os casos selecionados, intercalando listas embaralhadas de cada caso
    const byCase = {};
    for (const q of shuffle(pool)) (byCase[q.c] ||= []).push(q);
    for (const k in byCase) if (cfg.fresh) byCase[k].sort((a, b) => isNew(b) - isNew(a));
    ordered = [];
    const keys = shuffle(Object.keys(byCase));
    let added = true;
    while (added) { added = false; for (const k of keys) { const q = byCase[k].shift(); if (q) { ordered.push(q); added = true; } } }
    if (cfg.fresh) { const fresh = ordered.filter(isNew), old = ordered.filter(q => !isNew(q)); ordered = fresh.concat(old); }
  } else {
    ordered = shuffle(pool);
    if (cfg.fresh) ordered.sort((a, b) => isNew(b) - isNew(a));
  }
  const chosen = shuffle(ordered.slice(0, Math.min(cfg.n, ordered.length)));
  chosen.sort((a, b) => a.c - b.c || 0);
  return { id: Date.now(), cfg: { ...cfg }, qids: chosen.map(q => q.id), picks: {}, revealed: {}, i: 0, start: Date.now(), elapsed: 0, done: false };
}

function SimSetup() {
  const cfg = simCfg;
  app.innerHTML = `
    <h1>Criar simulado</h1>
    <p class="muted">Escolha os casos, o tipo de questão e quantas questões quer. Nenhuma questão se repete dentro do mesmo simulado.</p>
    <div class="grid" style="grid-template-columns:minmax(0,1fr)">
      <div class="card">
        <div class="field"><span class="lab">Tipo de questão</span>
          <div class="seg" id="cSrc">${[["banca", "Banca (provas anteriores)"], ["ia", "Autorais (IA)"], ["all", "Ambas"]].map(([k, t]) => `<button data-v="${k}">${t}</button>`).join("")}</div></div>
        <div class="field"><div class="row"><span class="lab">Casos</span><span class="spacer"></span>
          <button class="btn sm" data-q="all">Todos</button><button class="btn sm" data-q="p1">P1 · Casos 1–8</button><button class="btn sm" data-q="p2">Casos 9–15</button><button class="btn ghost sm" data-q="none">Limpar</button></div>
          <div class="cases-pick" id="cCases"></div></div>
        <div class="field"><label for="cN">Número de questões</label>
          <div class="row"><input type="number" min="1" class="numin" id="cN"><input type="range" min="1" id="cR"><span class="muted small" id="cAvail"></span></div></div>
        <div class="field"><span class="lab">Correção</span>
          <div class="seg" id="cMode"><button data-v="end">Ao final do simulado</button><button data-v="each">A cada questão</button></div></div>
        <div class="field"><span class="lab">Opções</span>
          <label class="chk"><input type="checkbox" id="cBal"> Equilibrar a quantidade entre os casos escolhidos</label>
          <label class="chk"><input type="checkbox" id="cFresh"> Priorizar questões que ainda não fiz (nem no estudo nem em outros simulados)</label>
          <label class="chk"><input type="checkbox" id="cWrong"> Somente questões que errei</label></div>
        <div class="row"><button class="btn primary" id="cGo">Iniciar simulado</button><span class="muted small" id="cInfo"></span></div>
      </div>
      <div class="card" id="hist"></div>
    </div>`;
  const sync = () => {
    for (const b of $$("#cSrc button")) b.classList.toggle("on", b.dataset.v === cfg.src);
    for (const b of $$("#cMode button")) b.classList.toggle("on", b.dataset.v === cfg.mode);
    $("#cCases").innerHTML = CASES.map(c => {
      const n = poolFor({ ...cfg, cases: [c.n] }).length, on = cfg.cases.includes(c.n);
      return `<label class="pick ${on ? "on" : ""}"><input type="checkbox" data-c="${c.n}" ${on ? "checked" : ""}><span><b>Caso ${c.n}</b> · ${esc(c.title)}<small>${n} questões disponíveis</small></span></label>`;
    }).join("");
    const avail = poolFor(cfg).length;
    const n = Math.max(avail ? 1 : 0, Math.min(cfg.n, avail));
    $("#cN").max = $("#cR").max = Math.max(1, avail);
    $("#cN").value = $("#cR").value = n;
    $("#cAvail").textContent = `de ${avail} disponíveis`;
    $("#cBal").checked = cfg.balance; $("#cFresh").checked = cfg.fresh; $("#cWrong").checked = cfg.wrongOnly;
    const seen = seenInSims(), pool = poolFor(cfg);
    const fresh = pool.filter(q => !S.ans[q.id] && !seen.has(q.id)).length;
    $("#cInfo").textContent = avail ? `${fresh} das ${avail} ainda inéditas para você` : "Nenhuma questão com esses filtros";
    $("#cGo").disabled = !avail;
  };
  $("#cSrc").onclick = e => { const b = e.target.closest("button"); if (b) { cfg.src = b.dataset.v; sync(); } };
  $("#cMode").onclick = e => { const b = e.target.closest("button"); if (b) { cfg.mode = b.dataset.v; sync(); } };
  $("#cCases").onchange = e => { const c = +e.target.dataset.c; cfg.cases = e.target.checked ? [...new Set([...cfg.cases, c])].sort((a, b) => a - b) : cfg.cases.filter(x => x !== c); sync(); };
  app.querySelector(".field .row").onclick = e => {
    const q = e.target.closest("[data-q]")?.dataset.q; if (!q) return;
    cfg.cases = q === "all" ? CASES.map(c => c.n) : q === "p1" ? [1, 2, 3, 4, 5, 6, 7, 8] : q === "p2" ? [9, 10, 11, 12, 13, 14, 15] : [];
    sync();
  };
  $("#cN").oninput = e => { cfg.n = Math.max(1, +e.target.value || 1); $("#cR").value = Math.min(cfg.n, +$("#cR").max); };
  $("#cN").onchange = () => sync();
  $("#cR").oninput = e => { cfg.n = +e.target.value; $("#cN").value = cfg.n; };
  $("#cBal").onchange = e => cfg.balance = e.target.checked;
  $("#cFresh").onchange = e => { cfg.fresh = e.target.checked; sync(); };
  $("#cWrong").onchange = e => { cfg.wrongOnly = e.target.checked; sync(); };
  $("#cGo").onclick = () => { cfg.n = Math.min(+$("#cN").value, poolFor(cfg).length); S.cur = buildSim(cfg); save(); SimRun(); };
  sync();
  history();
  if (S.paused) pausedNotice();
}

function history() {
  const h = $("#hist");
  if (!S.sims.length) { h.innerHTML = `<h2>Histórico</h2><p class="muted">Os simulados que você concluir aparecem aqui.</p>`; return; }
  h.innerHTML = `<h2>Histórico de simulados</h2><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Data</th><th>Tipo</th><th>Casos</th><th class="num">Questões</th><th class="num">Acerto</th><th class="num">Tempo</th><th></th></tr></thead><tbody>
    ${S.sims.slice().reverse().map(s => `<tr><td>${new Date(s.id).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td><td>${{ banca: "Banca", ia: "IA", all: "Ambas" }[s.cfg.src]}</td>
      <td class="small">${s.cfg.cases.length === 15 ? "Todos" : s.cfg.cases.join(", ")}</td><td class="num">${s.qids.length}</td>
      <td class="num"><b>${pct(s.score, s.qids.length)}%</b> <span class="muted">(${s.score})</span></td><td class="num">${fmtTime(s.elapsed)}</td>
      <td><button class="btn sm" data-review="${s.id}">Revisar</button></td></tr>`).join("")}
    </tbody></table></div>`;
  h.onclick = e => { const b = e.target.closest("[data-review]"); if (b) { const s = S.sims.find(x => x.id === +b.dataset.review); if (s) SimResult(s); } };
}

let timerId = null;
function SimRun() {
  const sim = S.cur;
  const qs = sim.qids.map(id => BYID[id]);
  const each = sim.cfg.mode === "each";
  let tick = Date.now();
  app.innerHTML = `
    <div class="sim-bar"><div class="row">
      <h2 style="margin:0">Simulado · ${qs.length} questões</h2><span class="spacer"></span>
      <span class="timer" id="tm"></span>
      <button class="btn sm" id="sQuit">Sair (salva)</button>
      <button class="btn primary sm" id="sEnd">Finalizar</button></div>
      <div class="qgrid" id="sGrid" style="margin-top:10px"></div></div>
    <div id="sSlot"></div>`;
  clearInterval(timerId);
  const upd = () => { const now = Date.now(); sim.elapsed += now - tick; tick = now; $("#tm") ? $("#tm").textContent = "⏱ " + fmtTime(sim.elapsed) : clearInterval(timerId); save(); };
  timerId = setInterval(upd, 1000); upd();

  function grid() {
    $("#sGrid").innerHTML = qs.map((q, i) => {
      const p = sim.picks[q.id], rev = each && sim.revealed[q.id];
      const cls = rev ? (p === q.ans ? "ok" : "bad") : p ? "done" : "";
      return `<button data-i="${i}" class="${i === sim.i ? "cur" : ""} ${cls}" title="Caso ${q.c} · ${esc(q.lbl)}">${i + 1}</button>`;
    }).join("");
  }
  function show() {
    const q = qs[sim.i];
    const nav = `<button class="btn sm" data-nav="-1" ${sim.i ? "" : "disabled"}>← Anterior</button>` +
      (sim.i < qs.length - 1 ? `<button class="btn sm" data-nav="1">Próxima →</button>` : `<button class="btn primary sm" data-finish>Finalizar</button>`);
    const card = questionCard(q, {
      reveal: each, chosen: sim.picks[q.id], answered: each && !!sim.revealed[q.id], extraActions: nav,
      onChoose: p => { if (p) sim.picks[q.id] = p; else delete sim.picks[q.id]; save(); grid(); },
      onAnswer: p => { sim.picks[q.id] = p; sim.revealed[q.id] = true; recordAnswer(q, p); save(); grid(); },
      onNav: move, onFinish: finish
    });
    $(".q-head .lbl", card).textContent = `Questão ${sim.i + 1} de ${qs.length}`;
    $("#sSlot").innerHTML = ""; $("#sSlot").appendChild(card);
    keyHandler = e => {
      if (e.key === "ArrowRight") { move(1); return true; }
      if (e.key === "ArrowLeft") { move(-1); return true; }
      return card._key(e.key);
    };
  }
  function move(d) { const n = sim.i + d; if (n < 0 || n >= qs.length) return; sim.i = n; save(); grid(); show(); window.scrollTo({ top: 0 }); }
  function finish(force) {
    const blank = qs.filter(q => !sim.picks[q.id]).length;
    if (blank && force !== true) return askInline(`${blank} questão(ões) sem resposta. Finalizar mesmo assim?`, "Finalizar", () => finish(true));
    upd(); clearInterval(timerId);
    sim.done = true;
    sim.score = qs.filter(q => sim.picks[q.id] === q.ans).length;
    if (!each) for (const q of qs) if (sim.picks[q.id]) recordAnswer(q, sim.picks[q.id]);
    S.sims.push({ id: sim.id, cfg: sim.cfg, qids: sim.qids, picks: sim.picks, score: sim.score, elapsed: sim.elapsed });
    S.cur = null; save();
    SimResult(S.sims[S.sims.length - 1]);
  }
  $("#sGrid").onclick = e => { const b = e.target.closest("[data-i]"); if (b) { sim.i = +b.dataset.i; save(); grid(); show(); } };
  $("#sEnd").onclick = finish;
  $("#sQuit").onclick = () => { upd(); clearInterval(timerId); S.paused = sim; S.cur = null; save(); SimSetup(); };
  grid(); show();
}
function pausedNotice() {
  // simulado interrompido: fica guardado para retomar
  const sim = S.paused;
  const h = $("#hist");
  h.insertAdjacentHTML("afterbegin", `<div class="sec warn" style="margin-bottom:14px"><div class="row"><span>Você tem um simulado em andamento (${Object.keys(sim.picks).length}/${sim.qids.length} respondidas).</span><span class="spacer"></span><button class="btn sm primary" id="resume">Retomar</button><button class="btn sm ghost" id="discard">Descartar</button></div></div>`);
  $("#resume").onclick = () => { S.cur = S.paused; delete S.paused; save(); SimRun(); };
  $("#discard").onclick = () => { delete S.paused; save(); SimSetup(); };
}

function SimResult(s) {
  clearInterval(timerId);
  const qs = s.qids.map(id => BYID[id]);
  const byCase = {};
  for (const q of qs) { const r = byCase[q.c] ||= { n: 0, ok: 0 }; r.n++; if (s.picks[q.id] === q.ans) r.ok++; }
  const wrong = qs.filter(q => s.picks[q.id] !== q.ans);
  app.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="row"><div><div class="score-big">${pct(s.score, qs.length)}%</div><div class="muted">${s.score} de ${qs.length} corretas · ${fmtTime(s.elapsed)}</div></div><span class="spacer"></span>
        <button class="btn" id="rBack">Novo simulado</button>
        ${wrong.length ? `<button class="btn primary" id="rRedo">Refazer as ${wrong.length} erradas</button>` : ""}</div>
      <div style="overflow-x:auto;margin-top:16px"><table class="tbl"><thead><tr><th>Caso</th><th>Tema</th><th class="num">Acertos</th><th></th></tr></thead><tbody>
      ${Object.keys(byCase).sort((a, b) => a - b).map(c => `<tr><td><b>${c}</b></td><td>${esc(caseTitle(+c))}</td><td class="num">${byCase[c].ok}/${byCase[c].n}</td><td><div class="bar"><i style="width:${pct(byCase[c].ok, byCase[c].n)}%"></i></div></td></tr>`).join("")}
      </tbody></table></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h3>Revisão</h3><p class="muted small">Clique em um número para ver a questão com gabarito e comentários.</p>
      <div class="qgrid" id="rGrid">${qs.map((q, i) => `<button data-i="${i}" class="${s.picks[q.id] === q.ans ? "ok" : "bad"}">${i + 1}</button>`).join("")}</div></div>
    <div id="rSlot"></div>`;
  let cur = -1;
  function show(i) {
    cur = i;
    const q = qs[i];
    $$("#rGrid button").forEach((b, k) => b.classList.toggle("cur", k === i));
    const card = questionCard(q, { reveal: true, chosen: s.picks[q.id] || "—", answered: true,
      extraActions: `<button class="btn sm" data-nav="-1" ${i ? "" : "disabled"}>← Anterior</button><button class="btn sm" data-nav="1" ${i < qs.length - 1 ? "" : "disabled"}>Próxima →</button>`,
      onNav: d => { show(i + d); window.scrollTo({ top: $("#rSlot").offsetTop - 70 }); } });
    $(".q-head .lbl", card).textContent = `Questão ${i + 1} · ${q.lbl}`;
    if (!s.picks[q.id]) $(".verdict", card).textContent = `Em branco · gabarito ${q.ans}`;
    $("#rSlot").innerHTML = ""; $("#rSlot").appendChild(card);
    keyHandler = e => {
      if (e.key === "ArrowRight" && cur < qs.length - 1) { show(cur + 1); return true; }
      if (e.key === "ArrowLeft" && cur > 0) { show(cur - 1); return true; }
      return false;
    };
  }
  $("#rGrid").onclick = e => { const b = e.target.closest("[data-i]"); if (b) show(+b.dataset.i); };
  $("#rBack").onclick = SimSetup;
  const rr = $("#rRedo");
  if (rr) rr.onclick = () => {
    S.cur = { id: Date.now(), cfg: { ...s.cfg, n: wrong.length, mode: s.cfg.mode }, qids: shuffle(wrong.map(q => q.id)), picks: {}, revealed: {}, i: 0, start: Date.now(), elapsed: 0, done: false };
    save(); SimRun();
  };
  window.scrollTo(0, 0);
}

go(S.cur && !S.cur.done ? "sim" : "home");
})();
