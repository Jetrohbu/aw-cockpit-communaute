// AW Extension - Planets page enhancement
// Ajoute le temps jusqu au prochain niveau de pop EN-DESSOUS de la valeur "+/h"
// dans le tableau /Game/Planets. Pas de nouvelle colonne.

(function() {
  "use strict";

  if (window.__awNextPopColumnLoaded) return;
  window.__awNextPopColumnLoaded = true;

  function fmtHours(h) {
    if (!isFinite(h) || h <= 0) return "-";
    var totalMin = Math.round(h * 60);
    if (totalMin < 60) return totalMin + "m";
    var hh = Math.floor(totalMin / 60);
    var mm = totalMin % 60;
    if (hh < 24) return mm ? (hh + "h" + (mm < 10 ? "0" + mm : mm)) : (hh + "h");
    var d = Math.floor(hh / 24);
    return d + "j" + ((hh % 24) < 10 ? "0" + (hh % 24) : (hh % 24)) + "h";
  }

  function parseRate(txt) {
    if (!txt) return null;
    var m = txt.replace(/\s+/g, "").match(/^([+-]?)(\d+(?:[.,]\d+)?)$/);
    if (!m) return null;
    var sign = m[1] === "-" ? -1 : 1;
    return sign * parseFloat(m[2].replace(",", "."));
  }

  function parseProgress(txt) {
    if (!txt) return null;
    var m = txt.replace(/\s+/g, "").match(/^(\d+)\/(\d+)$/);
    if (!m) return null;
    var cur = parseInt(m[1], 10);
    var max = parseInt(m[2], 10);
    if (max <= 0) return null;
    return { cur: cur, max: max, remaining: Math.max(0, max - cur) };
  }

  function findPopColumns(row) {
    // Retourne { progCell, rateCell, prog, rate } pour la PREMIERE paire X/Y + rate (= pop).
    var cells = row.querySelectorAll("td");
    var progIdx = -1, prog = null;
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || "").trim();
      if (progIdx === -1) {
        // Note: les progress bars peuvent contenir le texte ailleurs que dans textContent direct.
        // On regarde aussi le sous-text d'un span (cas <span>X/Y</span> dans une cellule).
        var p = parseProgress(txt);
        if (!p) {
          // Essai sur le texte de tous les descendants
          var subs = cells[i].querySelectorAll("*");
          for (var s = 0; s < subs.length; s++) {
            p = parseProgress((subs[s].textContent || "").trim());
            if (p) break;
          }
        }
        if (p) { progIdx = i; prog = p; continue; }
      } else {
        var r = parseRate(txt);
        if (r !== null) {
          return { progCell: cells[progIdx], rateCell: cells[i], prog: prog, rate: r };
        }
      }
    }
    return null;
  }

  function addTimeLine(rateCell, hours, title) {
    // Append un petit "Xj YYh" sous la valeur existante dans rateCell, sans la modifier.
    if (!rateCell || rateCell.querySelector("[data-aw-time-line]")) return;
    var span = document.createElement("div");
    span.setAttribute("data-aw-time-line", "1");
    span.setAttribute("data-aw-injected", "1");
    span.textContent = fmtHours(hours);
    span.style.display = "block";
    span.style.fontSize = "0.78em";
    span.style.fontWeight = "normal";
    span.style.opacity = "0.85";
    span.style.color = "#ffffff";
    span.style.marginTop = "1px";
    span.style.whiteSpace = "nowrap";
    span.style.textAlign = "center";
    if (title) span.title = title;
    rateCell.appendChild(span);
  }

  function processTable(table) {
    if (table.dataset.awNextPopProcessed === "1") return;
    var rows = table.querySelectorAll("tbody tr[data-planet-id], tr[data-planet-id]");
    if (!rows.length) return;
    table.dataset.awNextPopProcessed = "1";

    rows.forEach(function(row) {
      var info = findPopColumns(row);
      if (!info || info.rate <= 0 || !info.prog) return;
      var hours = info.prog.remaining / info.rate;
      var title = "Reste " + info.prog.remaining + " pts / " + info.rate.toFixed(2) + " pts/h";
      // Skin actif : le temps rejoint la ligne de la jauge, après le « X/Y » du
      // jeu. Sinon (skin off), ancien comportement — superposé dans la barre.
      var row = info.progCell.querySelector(".progress-bar-timed");
      if (gaugeMode() && appendRowTime(row, hours, title)) return;
      var bar = info.progCell.querySelector(".progress-bar") || info.progCell;
      injectBarTime(bar, hours, title, null, -3);
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // PAGE DÉTAIL d'une planète : /Game/Planets/Planet/<id>
  // Affiche le temps restant DANS chaque barre de progression.
  //  - Bâtiments (tr[data-points]) : payés en Production Points
  //      → temps = restant / (PP/h de la planète)
  //  - Ressource type Population (barre X/Y + taux +/h dans sa ligne)
  //      → temps = (max - cur) / taux propre
  // ───────────────────────────────────────────────────────────────────────

  function parseFraction(txt) {
    if (!txt) return null;
    var m = txt.replace(/ /g, " ").match(/(\d[\d\s.,]*)\s*\/\s*(\d[\d\s.,]*)/);
    if (!m) return null;
    var cur = parseInt(m[1].replace(/\D/g, ""), 10);
    var max = parseInt(m[2].replace(/\D/g, ""), 10);
    if (!isFinite(max) || max <= 0) return null;
    return { cur: cur, max: max, remaining: Math.max(0, max - cur) };
  }

  function parseRateLoose(txt) {
    if (!txt) return null;
    var s = txt.replace(/\s+/g, "");
    var m = s.match(/([+-]?\d+(?:[.,]\d+)?)\/?h/i) || s.match(/\+(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    return parseFloat(m[1].replace(",", "."));
  }

  // Taux STRICT "+N/h" (exige le /h). Évite de confondre un "+1" de lvl/qty
  // (lignes Auto Produce) ou un "1h34" de durée avec un vrai taux horaire.
  function parseRatePerHour(txt) {
    if (!txt) return null;
    var m = txt.replace(/\s+/g, "").match(/([+-]?\d+(?:[.,]\d+)?)\/h/i);
    return m ? parseFloat(m[1].replace(",", ".")) : null;
  }

  // Taux de Production Points de la planète (ligne "Production Points", +X/h).
  function findPPRate() {
    var trs = document.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      if (!/Production\s*Points/i.test(trs[i].textContent || "")) continue;
      var tds = trs[i].querySelectorAll("td");
      for (var j = tds.length - 1; j >= 0; j--) {
        var r = parseRateLoose(tds[j].textContent || "");
        if (r && r > 0) return r;
      }
    }
    return null;
  }

  // Skin actif → les barres du jeu sont des jauges de 5 px (gauges.js +
  // cockpit.css) : plus rien ne tient DEDANS, le temps restant se pose à côté.
  function gaugeMode() {
    var c = document.documentElement.classList;
    return c.contains("awc-gameskin") && c.contains("awc-gauge-on");
  }

  // Cas .progress-bar-timed : le temps devient un élément de la ligne flex,
  // après le « 116/3 783 » du jeu.
  function appendRowTime(row, hours, title) {
    if (!row) return false;
    var span = row.querySelector("[data-aw-bartime]");
    if (!span) {
      span = document.createElement("span");
      span.setAttribute("data-aw-bartime", "1");
      span.setAttribute("data-aw-injected", "1");
      row.appendChild(span);
    }
    var txt = fmtHours(hours);
    if (span.textContent !== txt) span.textContent = txt;
    if (title) span.title = title;
    return true;
  }

  // Cas .progress-bar nue (fiche planète, Science) : le temps se pose APRÈS le
  // rail, dans la même cellule.
  function appendNextToBar(bar, hours, title) {
    if (!bar || !bar.parentNode) return false;
    var span = bar.parentNode.querySelector("[data-aw-gtime]");
    if (!span) {
      span = document.createElement("span");
      span.setAttribute("data-aw-gtime", "1");
      span.setAttribute("data-aw-injected", "1");
      bar.parentNode.insertBefore(span, bar.nextSibling);
    }
    var txt = fmtHours(hours);
    if (span.textContent !== txt) span.textContent = txt;
    if (title) span.title = title;
    return true;
  }

  function injectBarTime(bar, hours, title, align, dy) {
    if (!bar) return;
    var span = bar.querySelector("[data-aw-bartime]");
    if (!span) {
      span = document.createElement("span");
      span.setAttribute("data-aw-bartime", "1");
      span.setAttribute("data-aw-injected", "1");
      var place = (align === "left")
        // Gauche : coexiste avec le "X/Y" affiché à droite dans la barre.
        ? "left:4px;transform:translateY(-50%);"
        // Centré : barres vides (bâtiments de la page détail).
        : "left:50%;transform:translate(-50%,-50%);";
      // dy : décalage vertical en px (négatif = remonte). Défaut : centré (50%).
      var top = dy ? ("calc(50% " + (dy < 0 ? "- " + (-dy) : "+ " + dy) + "px)") : "50%";
      // Chiffres blancs, sans fond (ombre légère pour rester lisibles sur la barre).
      span.style.cssText =
        "position:absolute;top:" + top + ";" + place +
        "font-size:0.78em;font-weight:700;color:#fff;" +
        "text-shadow:0 1px 2px rgba(0,0,0,0.9),0 0 2px rgba(0,0,0,0.9);" +
        "pointer-events:none;white-space:nowrap;z-index:10;";
      if (getComputedStyle(bar).position === "static") bar.style.position = "relative";
      bar.appendChild(span);
    }
    var txt = fmtHours(hours);
    if (span.textContent !== txt) span.textContent = txt;
    if (title) span.title = title;
  }

  function processPlanetDetail() {
    var ppRate = findPPRate();
    // .progress-bar-timed inclus : sur la fiche planète, la Population utilise
    // cette forme-là (rail + texte), les bâtiments la forme nue.
    document.querySelectorAll(".progress-bar, .progress-bar-timed").forEach(function(bar) {
      var tr = bar.closest("tr");
      if (!tr) return;
      // Lignes "Auto Produce" : le jeu affiche déjà son propre compte à rebours
      // (HH:MM:SS) dans la colonne Remain -> ne rien injecter (sinon temps faux
      // calculé sur le "+1" lvl/qty, et doublon avec Remain).
      if (tr.hasAttribute("data-auto-produce")) return;
      var remaining = null, rate = null, basis = "";
      if (tr.hasAttribute("data-points")) {
        // Bâtiment : restant via le titre "Progress: X / Y" (sinon data-points).
        var f = parseFraction(bar.getAttribute("title") || bar.textContent || "");
        remaining = f ? f.remaining
                      : parseInt((tr.getAttribute("data-points") || "").replace(/\D/g, ""), 10);
        rate = ppRate; basis = "PP";
      } else {
        // Ressource (Population…) : barre X/Y + taux propre dans la ligne.
        var g = parseFraction(bar.getAttribute("title") || bar.textContent || "");
        if (!g) return;
        remaining = g.remaining;
        var tds = tr.querySelectorAll("td");
        for (var k = tds.length - 1; k >= 0; k--) {
          var rr = parseRatePerHour(tds[k].textContent || "");
          if (rr && rr > 0) { rate = rr; break; }
        }
        basis = "auto";
      }
      if (!isFinite(remaining) || remaining <= 0 || !rate || rate <= 0) return;
      var hrs = remaining / rate;
      var tip = "Reste " + remaining + " · " + rate + " " + basis + "/h";
      if (gaugeMode()) {
        // Jauge de 5 px : le temps se pose à côté, jamais dedans.
        if (bar.classList.contains("progress-bar-timed")) { appendRowTime(bar, hrs, tip); return; }
        if (appendNextToBar(bar, hrs, tip)) return;
      }
      injectBarTime(bar, hrs, tip, basis === "auto" ? "left" : null);
    });
  }

  /* ── Buildings (/Game/Planets/Buildings) : niveaux EN COURS ─────────────────────────────
     Le jeu marque td.building-lvl-started (PP déjà investis), mais un niveau entamé que le stock
     de PP suffit à terminer reçoit building-lvl-up (« payable »), comme un niveau pas commencé.
     Pour ces cellules seulement (niveau ≥ 1), on lit la fiche de la planète (barre
     « Progress: 58 / 128 ») : 1 requête par planète concernée, 12 max par affichage, gardée
     10 min et relue si les niveaux de la ligne changent. Un échec est gardé aussi : jamais de
     rafale de requêtes au gré du MutationObserver. */
  var BLD_TTL = 10 * 60 * 1000, BLD_MAX = 12, bldBusy = false, bldFetched = 0;
  function isBuildingsPage(p) { return /\/Game\/Planets\/Buildings$/i.test(p); }
  function bldGet(id, sig) {
    try {
      var c = JSON.parse(sessionStorage.getItem("aw_bld_prog_" + id) || "null");
      return c && c.sig === sig && Date.now() - c.t < BLD_TTL ? c.prog : null;
    } catch (e) { return null; }
  }
  function bldSet(id, sig, prog) {
    try { sessionStorage.setItem("aw_bld_prog_" + id, JSON.stringify({ t: Date.now(), sig: sig, prog: prog })); } catch (e) {}
  }
  async function bldFetch(id) {
    var prog = {};
    try {
      var r = await fetch("/Game/Planets/Planet/" + id, { credentials: "same-origin" });
      if (!r.ok) return prog;
      var doc = new DOMParser().parseFromString(await r.text(), "text/html");
      doc.querySelectorAll(".progress-bar[title]").forEach(function (bar) {
        var m = /Progress:\s*([\d\s  ]+)\/\s*([\d\s  ]+)/.exec(bar.getAttribute("title") || "");
        var tr = bar.closest("tr");
        if (!m || !tr || !tr.cells.length) return;
        var name = (tr.cells[0].textContent || "").trim().split(/\s+/)[0];
        if (name && !prog[name]) prog[name] = { cur: parseInt(m[1].replace(/\D/g, ""), 10) || 0, max: parseInt(m[2].replace(/\D/g, ""), 10) || 0 };
      });
    } catch (e) { /* réseau : la cellule reste neutre */ }
    return prog;
  }
  function bldPaint(td, p) {
    var on = !!(p && p.cur > 0);
    td.classList.toggle("aw-lvl-encours", on);
    if (on) td.title = "En cours : " + p.cur + " / " + p.max + " PP";
  }
  async function processBuildings() {
    var table = Array.from(document.querySelectorAll("table")).filter(function (t) {
      return t.tHead && t.tBodies.length && /cybernet/i.test(t.tHead.textContent || "");
    })[0];
    if (!table) return;
    var col = {};
    Array.from(table.tHead.rows[0].cells).forEach(function (th, i) {
      var t = (th.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (/farm/.test(t)) col.Farm = i;
      else if (/factory/.test(t)) col.Factory = i;
      else if (/cybernet/.test(t)) col.Cybernet = i;
      else if (/\blab\b/.test(t)) col.Lab = i;
      else if (/^sb$|starbase/.test(t)) col.Starbase = i;
    });
    var names = Object.keys(col), todo = [];
    Array.from(table.tBodies[0].rows).forEach(function (tr) {
      var a = tr.querySelector('a[href*="/Game/Planets/Planet/"]');
      var id = a && ((a.getAttribute("href") || "").match(/Planet\/(\d+)/) || [])[1];
      if (!id) return;
      var cand = names.map(function (n) { return [n, tr.cells[col[n]]]; }).filter(function (c) {
        return c[1] && c[1].classList.contains("building-lvl-up") && parseInt(c[1].textContent, 10) >= 1;
      });
      if (!cand.length) return;
      var sig = names.map(function (n) { var td = tr.cells[col[n]]; return td ? td.textContent.trim() : ""; }).join("|");
      var prog = bldGet(id, sig);
      if (prog) cand.forEach(function (c) { bldPaint(c[1], prog[c[0]]); });
      else todo.push({ id: id, sig: sig, cand: cand });
    });
    if (!todo.length || bldBusy || bldFetched >= BLD_MAX) return;
    bldBusy = true;
    try {
      for (var i = 0; i < todo.length && bldFetched < BLD_MAX; i++) {
        if (bldFetched) await new Promise(function (r) { setTimeout(r, 250); });
        bldFetched++;
        var job = todo[i], prog = await bldFetch(job.id);
        bldSet(job.id, job.sig, prog);
        job.cand.forEach(function (c) { if (c[1].isConnected) bldPaint(c[1], prog[c[0]]); });
      }
    } finally { bldBusy = false; }
  }

  function isListPage(p) {
    return /\/Game\/Planets$/i.test(p) || (/\/Planets$/i.test(p) && !/\/Buildings\b/i.test(p));
  }
  function isDetailPage(p) {
    return /\/Planets\/Planet\/\d+/i.test(p);
  }

  function run() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    if (isDetailPage(path)) { processPlanetDetail(); return; }
    if (isBuildingsPage(path)) { processBuildings(); return; }
    if (isListPage(path)) document.querySelectorAll("table").forEach(processTable);
  }

  // N'agir que sur la liste des planètes OU la page détail d'une planète.
  // (l'ancien garde renvoyait tôt sur /Planets/Planet/<id> -> le temps dans les
  //  barres des bâtiments ne s'affichait jamais.)
  var path = (location.pathname || "").replace(/\/+$/, "");
  if (!isListPage(path) && !isDetailPage(path) && !isBuildingsPage(path)) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  var mutTimer = null;
  var obs = new MutationObserver(function() {
    if (mutTimer) return;
    mutTimer = setTimeout(function() { mutTimer = null; run(); }, 300);
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Rejeu forcé : le changement de style de jauge dans les Réglages déplace le
  // temps restant (dans la barre ↔ à côté), or processTable marque la table
  // comme déjà traitée. On lève le drapeau et on repasse.
  function rerun() {
    document.querySelectorAll("[data-aw-next-pop-processed], table").forEach(function(t) {
      if (t.dataset) delete t.dataset.awNextPopProcessed;
    });
    document.querySelectorAll("[data-aw-bartime],[data-aw-gtime]").forEach(function(e) { e.remove(); });
    run();
  }
  window.AWPlanetsEnhance = { rerun: rerun };
})();
