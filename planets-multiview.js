// AW Extension - Vue multi-planètes
// Sur /Game/Planets : cases à cocher par ligne + bouton « Vue multi » intégré
// dans la sous-nav du jeu (Planets | Overview | Buildings | Spend all).
// Ouvre un overlay plein écran avec les fiches /Game/Planets/Planet/<id>
// affichées côte à côte dans des iframes same-origin (X-Frame-Options:
// SAMEORIGIN → OK). La nav principale du jeu est masquée DANS chaque iframe
// (CSS injecté via contentDocument, possible car même origine) ; la sous-nav
// Planets (Overview/Buildings/…) reste utilisable dans chaque vignette.
// Sélection persistée en localStorage.

(function () {
  "use strict";

  if (window.__awMultiViewLoaded) return;
  window.__awMultiViewLoaded = true;

  var LS_SEL = "aw_multiview_selection";
  var LS_COLS = "aw_multiview_cols";

  function isListPage() {
    return /\/Game\/Planets\/?$/i.test(location.pathname || "");
  }
  if (!isListPage()) return;

  // ── Sélection ──────────────────────────────────────────────────────────
  function loadSel() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_SEL) || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch (e) { return []; }
  }
  function saveSel() { try { localStorage.setItem(LS_SEL, JSON.stringify(selection)); } catch (e) {} }
  var selection = loadSel();

  function planetRows() {
    return Array.prototype.slice.call(document.querySelectorAll("tr[data-planet-id]"));
  }
  function planetName(row) {
    var cells = row.querySelectorAll("td");
    var link = cells[1] && cells[1].querySelector("a[href*='Planet']");
    var txt = link ? link.textContent : (cells[1] ? cells[1].textContent : "");
    return (txt || "").trim().replace(/\s+/g, " ") || ("Planète " + row.getAttribute("data-planet-id"));
  }
  function knownPlanets() {
    return planetRows().map(function (r) {
      return { id: String(r.getAttribute("data-planet-id")), name: planetName(r) };
    });
  }
  function isSelected(id) { return selection.indexOf(String(id)) !== -1; }
  function setSelected(id, on) {
    id = String(id);
    var i = selection.indexOf(id);
    if (on && i === -1) selection.push(id);
    if (!on && i !== -1) selection.splice(i, 1);
    saveSel();
    syncCheckboxes();
    updateBar();
    if (overlay && !overlay.hidden) syncTiles();
  }

  // ── Checkboxes dans le tableau ─────────────────────────────────────────
  // Injectées DANS la cellule Nom existante (pas de <td> ajouté : ne décale
  // aucune colonne pour les autres scripts / scrapers).
  function addCheckboxes() {
    planetRows().forEach(function (row) {
      var id = String(row.getAttribute("data-planet-id"));
      var cell = row.querySelectorAll("td")[1];
      if (!cell || cell.querySelector("[data-aw-mv-check]")) return;
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-aw-mv-check", id);
      cb.setAttribute("data-aw-injected", "1");
      cb.title = "Vue multi : afficher cette planète";
      cb.checked = isSelected(id);
      cb.style.cssText = "margin-right:6px;vertical-align:middle;cursor:pointer;accent-color:var(--aw-turquoise,#40e0d0);";
      cell.insertBefore(cb, cell.firstChild);
    });
  }
  // Délégation (même raison que le bouton nav : survit au clonage du reskin).
  document.addEventListener("click", function (ev) {
    if (ev.target && ev.target.matches && ev.target.matches("[data-aw-mv-check]")) ev.stopPropagation();
  }, true);
  document.addEventListener("change", function (ev) {
    var cb = ev.target;
    if (cb && cb.matches && cb.matches("[data-aw-mv-check]")) {
      setSelected(cb.getAttribute("data-aw-mv-check"), cb.checked);
    }
  });
  function syncCheckboxes() {
    document.querySelectorAll("[data-aw-mv-check]").forEach(function (cb) {
      var want = isSelected(cb.getAttribute("data-aw-mv-check"));
      if (cb.checked !== want) cb.checked = want;
    });
  }

  // ── Bouton dans la sous-nav du jeu ─────────────────────────────────────
  // Ajouté comme <td><a> à la suite de Planets | Overview | Buildings |
  // Spend all → hérite du style du jeu (et du reskin) sans CSS dédié.
  // (Les tables .navigation ne sont scrapées par aucun script : un td de
  // plus ici ne décale rien.)
  // ⚠ Le reskin (cockpit) CLONE cette table (elle devient .navigation.sub-nav)
  // → tout listener posé sur le nœud est perdu et une référence gardée pointe
  // sur l'ancien DOM détaché. D'où : délégation de clic sur document + le
  // texte est retrouvé par querySelector à chaque mise à jour.
  function addNavButton() {
    if (document.querySelector("[data-aw-mv-navbtn]")) { updateBar(); return; }
    var navs = document.querySelectorAll("table.table.navigation");
    var target = null;
    navs.forEach(function (t) {
      if (t.querySelector("a[href='/Game/Planets/Buildings']")) target = t;
    });
    var row = target && target.querySelector("tr");
    if (!row) return;
    var td = document.createElement("td");
    td.setAttribute("data-aw-mv-navbtn", "1");
    td.setAttribute("data-aw-injected", "1");
    var a = document.createElement("a");
    a.href = "#";
    td.appendChild(a);
    row.appendChild(td);
    updateBar();
  }
  document.addEventListener("click", function (ev) {
    var td = ev.target && ev.target.closest && ev.target.closest("[data-aw-mv-navbtn]");
    if (!td) return;
    ev.preventDefault();
    openOverlay();
  });
  function mkBtn(label, onclick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "background:rgba(64,224,208,0.12);border:1px solid rgba(64,224,208,0.5);" +
      "color:#d9ffff;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;line-height:1.4;";
    b.addEventListener("click", onclick);
    return b;
  }
  function updateBar() {
    document.querySelectorAll("[data-aw-mv-navbtn] a").forEach(function (a) {
      var txt = "🪐 Vue multi" + (selection.length ? " (" + selection.length + ")" : "");
      if (a.textContent !== txt) a.textContent = txt;
    });
  }

  // ── Overlay ────────────────────────────────────────────────────────────
  var overlay = null, grid = null, chipsBox = null;
  function cols() {
    var c = parseInt(localStorage.getItem(LS_COLS) || "2", 10);
    return (c >= 1 && c <= 4) ? c : 2;
  }
  function setCols(c) {
    try { localStorage.setItem(LS_COLS, String(c)); } catch (e) {}
    if (grid) grid.style.gridTemplateColumns = "repeat(" + c + ",1fr)";
    if (overlay) overlay.querySelectorAll("[data-aw-mv-col]").forEach(function (b) {
      b.style.background = (parseInt(b.getAttribute("data-aw-mv-col"), 10) === c)
        ? "rgba(64,224,208,0.35)" : "rgba(64,224,208,0.12)";
    });
  }

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "aw-mv-overlay";
    overlay.setAttribute("data-aw-injected", "1");
    overlay.hidden = true;
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:999990;background:rgba(6,8,18,0.97);" +
      "display:flex;flex-direction:column;font-size:13px;color:#d9ffff;";

    var head = document.createElement("div");
    head.style.cssText =
      "flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;" +
      "padding:8px 12px;border-bottom:1px solid rgba(64,224,208,0.4);background:rgba(10,14,28,0.9);";
    var title = document.createElement("span");
    title.textContent = "🪐 Vue multi-planètes";
    title.style.cssText = "font-weight:700;font-size:14px;color:var(--aw-turquoise,#40e0d0);";
    head.appendChild(title);

    // Chips de sélection (une par planète connue)
    chipsBox = document.createElement("div");
    chipsBox.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;flex:1 1 auto;";
    head.appendChild(chipsBox);

    var allBtn = mkBtn("Tout", function () {
      selection = knownPlanets().map(function (p) { return p.id; });
      saveSel(); syncCheckboxes(); updateBar(); syncTiles();
    });
    var noneBtn = mkBtn("Aucun", function () {
      selection = []; saveSel(); syncCheckboxes(); updateBar(); syncTiles();
    });
    head.appendChild(allBtn);
    head.appendChild(noneBtn);

    // Colonnes 1-4
    var colBox = document.createElement("span");
    colBox.style.cssText = "display:flex;gap:4px;align-items:center;";
    var colLbl = document.createElement("span");
    colLbl.textContent = "Colonnes :";
    colLbl.style.opacity = "0.7";
    colBox.appendChild(colLbl);
    [1, 2, 3, 4].forEach(function (c) {
      var b = mkBtn(String(c), function () { setCols(c); });
      b.setAttribute("data-aw-mv-col", String(c));
      colBox.appendChild(b);
    });
    head.appendChild(colBox);

    var reloadBtn = mkBtn("⟳ Tout recharger", function () {
      overlay.querySelectorAll("iframe[data-aw-mv-frame]").forEach(function (f) {
        try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; }
      });
    });
    head.appendChild(reloadBtn);

    var closeBtn = mkBtn("✕ Fermer", closeOverlay);
    closeBtn.style.fontWeight = "700";
    head.appendChild(closeBtn);

    grid = document.createElement("div");
    grid.style.cssText =
      "flex:1 1 auto;overflow:auto;display:grid;gap:8px;padding:8px;" +
      "grid-template-columns:repeat(" + cols() + ",1fr);grid-auto-rows:minmax(430px,1fr);align-items:stretch;";
    overlay.appendChild(head);
    overlay.appendChild(grid);
    document.body.appendChild(overlay);

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && overlay && !overlay.hidden) closeOverlay();
    });
    setCols(cols());
  }

  // Le rail du cockpit (#awc-rail, fixed à droite, z-index 999991) passe
  // au-dessus de l'overlay (999990) : on arrête l'overlay au bord du rail
  // pour que ni les contrôles d'en-tête ni les boutons des vignettes de
  // droite ne soient masqués — et le rail reste cliquable.
  function railOffset() {
    var rail = document.getElementById("awc-rail");
    return (rail && document.documentElement.classList.contains("awc-on"))
      ? rail.offsetWidth : 0;
  }

  function openOverlay() {
    buildOverlay();
    overlay.style.right = railOffset() + "px";
    overlay.hidden = false;
    document.documentElement.style.overflow = "hidden";
    syncTiles();
  }
  function closeOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
    document.documentElement.style.overflow = "";
  }

  // Chips (état sélection) — reconstruites à chaque sync, c'est peu coûteux.
  function syncChips() {
    if (!chipsBox) return;
    chipsBox.textContent = "";
    knownPlanets().forEach(function (p) {
      var on = isSelected(p.id);
      var chip = mkBtn(p.name, function () { setSelected(p.id, !on); });
      chip.style.background = on ? "rgba(64,224,208,0.35)" : "rgba(64,224,208,0.08)";
      chip.style.borderColor = on ? "var(--aw-turquoise,#40e0d0)" : "rgba(64,224,208,0.3)";
      chip.title = on ? "Retirer de la vue" : "Ajouter à la vue";
      chipsBox.appendChild(chip);
    });
  }

  // ── Vignettes (iframes) ────────────────────────────────────────────────
  function tileFor(id) {
    return overlay ? overlay.querySelector("[data-aw-mv-tile='" + id + "']") : null;
  }

  function syncTiles() {
    syncChips();
    // Retirer les vignettes désélectionnées
    overlay.querySelectorAll("[data-aw-mv-tile]").forEach(function (t) {
      if (!isSelected(t.getAttribute("data-aw-mv-tile"))) t.remove();
    });
    // Ajouter les manquantes, dans l'ordre de sélection
    selection.forEach(function (id) {
      if (!tileFor(id)) grid.appendChild(buildTile(id));
    });
    // Vue vide : inviter à cliquer les chips ci-dessus
    var ph = overlay.querySelector("[data-aw-mv-empty]");
    if (!selection.length && !ph) {
      ph = document.createElement("div");
      ph.setAttribute("data-aw-mv-empty", "1");
      ph.textContent = "Aucune planète sélectionnée — clique sur les noms en haut (ou les cases du tableau) pour les ajouter.";
      ph.style.cssText = "grid-column:1/-1;align-self:center;text-align:center;opacity:0.7;font-size:14px;";
      grid.appendChild(ph);
    } else if (selection.length && ph) {
      ph.remove();
    }
  }

  function buildTile(id) {
    var names = {};
    knownPlanets().forEach(function (p) { names[p.id] = p.name; });

    var tile = document.createElement("div");
    tile.setAttribute("data-aw-mv-tile", id);
    tile.style.cssText =
      "display:flex;flex-direction:column;min-height:0;border:1px solid rgba(64,224,208,0.35);" +
      "border-radius:8px;overflow:hidden;background:#0a0a1a;";

    var h = document.createElement("div");
    h.style.cssText =
      "flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:4px 8px;" +
      "background:rgba(64,224,208,0.12);border-bottom:1px solid rgba(64,224,208,0.25);";
    var name = document.createElement("span");
    name.textContent = names[id] || ("Planète " + id);
    name.style.cssText = "font-weight:700;flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    h.appendChild(name);

    var open = mkBtn("↗", function () { window.open("/Game/Planets/Planet/" + id, "_blank"); });
    open.title = "Ouvrir dans un onglet";
    var rel = mkBtn("⟳", function () {
      try { frame.contentWindow.location.reload(); } catch (e) { frame.src = frame.src; }
    });
    rel.title = "Recharger";
    var rm = mkBtn("✕", function () { setSelected(id, false); });
    rm.title = "Retirer de la vue";
    [open, rel, rm].forEach(function (b) { b.style.padding = "1px 7px"; h.appendChild(b); });

    var frame = document.createElement("iframe");
    frame.setAttribute("data-aw-mv-frame", id);
    frame.src = "/Game/Planets/Planet/" + id;
    frame.style.cssText = "flex:1 1 auto;width:100%;border:0;background:#0a0a1a;min-height:0;";
    frame.addEventListener("load", function () {
      styleFrameDoc(frame);
      // Titre réel de la page ("Astro Wars - Genam #8" → "Genam #8")
      try {
        var t = frame.contentDocument && frame.contentDocument.title;
        if (t) name.textContent = t.replace(/^Astro\s*Wars\s*-\s*/i, "");
      } catch (e) {}
    });

    tile.appendChild(h);
    tile.appendChild(frame);
    return tile;
  }

  // CSS injecté dans le document de l'iframe (same-origin) : masque la nav
  // principale (1re .row du container) + le footer, compacte les marges.
  // Réappliqué à chaque load (navigation interne dans la vignette incluse).
  function styleFrameDoc(frame) {
    try {
      var d = frame.contentDocument;
      if (!d || !d.head || d.getElementById("aw-mv-embed-css")) return;
      var st = d.createElement("style");
      st.id = "aw-mv-embed-css";
      st.textContent =
        "main .container > .row:first-child{display:none!important}" +
        "footer{display:none!important}" +
        "main{padding:4px 0!important}" +
        ".container{max-width:100%!important;padding:0 8px!important}" +
        "body{overflow-x:hidden}";
      d.head.appendChild(st);
    } catch (e) {}
  }

  // ── Init + observer (le tableau peut re-render) ────────────────────────
  function run() {
    addCheckboxes();
    addNavButton();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
  var mutTimer = null;
  new MutationObserver(function () {
    if (mutTimer) return;
    mutTimer = setTimeout(function () {
      mutTimer = null;
      addCheckboxes();
      addNavButton();
      syncCheckboxes(); // le clonage du reskin peut perdre l'état coché
    }, 400);
  }).observe(document.body, { childList: true, subtree: true });

  window.AWMultiView = { open: openOverlay, close: closeOverlay };
})();
