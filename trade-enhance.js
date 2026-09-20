// AW Extension — Trade page enhancer.
// On /Game/Trade:
//   1. Prices table: extra "Coût PP" + "Temps farm" columns, et le temps de financement
//      d'un Trade Agreement ajouté dans la case "Trade Revenue". PP/h is fetched
//      silently from /Game/Planets (sum row of the tfoot, last cell) and
//      cached 5 min in chrome.storage. No user input.
//   2. Inventory table: extra rows under "Supply Unit" — a PP ⇄ Astro Dollars
//      converter pre-filled with the owned PP (summed from /Game/Planets) and
//      A$ balances, equivalent PP from owned SU, destroyers achievable.
// All values re-render on DOM mutations and on a 1.5s safety poll.
(function () {
  "use strict";

  const DESTROYER_COST_PP = 30;
  // Prix d'un Trade Agreement, règle du jeu : 20 000 $ par accord, gratuit quand le
  // partenaire est Trader (même valeur que le plan de TA côté backend).
  const TA_COST_USD = 20000;
  const ROW_ID_TA = "aw-trade-ta-row";
  const ROW_ID_RATES = "aw-trade-rates-row";
  const ROW_ID_CONV = "aw-trade-conv-row";
  const ROW_ID_PP_EQ = "aw-trade-pp-eq-row";
  const ROW_ID_DEST = "aw-trade-dest-row";
  const HEADER_CLASS = "aw-trade-extra-header";
  const CELL_CLASS = "aw-trade-extra-cell";
  const TOGGLE_ID = "aw-trade-usesu-toggle";
  const USESU_ROW_ATTR = "data-aw-usesu-row";
  const STORAGE_KEY_PPH = "aw_user_pph";
  const STORAGE_KEY_PP = "aw_user_pp";
  const STORAGE_KEY_PPH_TS = "aw_user_pph_ts";
  const STORAGE_KEY_HIDE_USESU = "aw_trade_hide_usesu";
  const STORAGE_KEY_TIER = "aw_trade_tier";
  const STORAGE_KEY_HIST = "aw_trade_hist";   // { nom: { p: [prix…], ts } }
  // v2 : la clé v1 a pu enregistrer des quantités corrompues (cf.
  // cellTextNoInjected) et donc un PRU inventé. On repart d'une base propre
  // plutôt que de tenter de réparer des données fausses.
  const STORAGE_KEY_COST = "aw_trade_cost2";  // { nom: { qty, pru, kn } }
  const POLL_MS = 1500;
  const PPH_CACHE_MS = 5 * 60 * 1000; // 5 min
  // Le jeu ne recote qu'à chaque update (≈ 1×/jour) : inutile de rappeler
  // /Game/Trade/PriceHistory plus souvent. 1 h reste large sous cette cadence
  // tout en gardant la charge sur le jeu au plancher.
  const HIST_TTL_MS = 60 * 60 * 1000;
  const HIST_GAP_MS = 400;  // une requête à la fois, espacées

  // Palette des contrôles injectés : dérivée de l'accent du joueur (--aw-turquoise,
  // réglable dans les Réglages), jamais d'une teinte figée — sinon la barre de
  // tiers reste bleue pendant que le reste du jeu est vert, rose, etc.
  const ACC = "var(--aw-turquoise, #2ad2d8)";
  const TH = {
    accent: ACC,
    txt: "var(--aw-text, #d9ffff)",
    line: "color-mix(in srgb, " + ACC + " 30%, transparent)",
    lineSoft: "color-mix(in srgb, " + ACC + " 16%, transparent)",
    onBg: "color-mix(in srgb, " + ACC + " 18%, #0d1319)",
    onLine: "color-mix(in srgb, " + ACC + " 65%, transparent)",
  };

  let userPPH = 0;
  let userPP = 0;   // stock total de Production Points (somme des planètes)
  let pphTs = 0;
  let pphFetching = false;
  let useSUHidden = true; // default: hide them — they clutter the table
  let tierSel = "1";      // tier d'artefacts affiché (1|2|3) — un seul à la fois

  function isTradePage() { return /\/Game\/Trade(\/|$|\?)/i.test(location.pathname); }

  // ── Number / format helpers ───────────────────────────────────────────

  function parseMoney(txt) {
    if (!txt) return NaN;
    const m = String(txt).match(/[\$€]?\s*([0-9][\d\s.,]*)/);
    if (!m) return NaN;
    let s = m[1].replace(/\s/g, "");
    const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      const dec = lastComma > lastDot ? "," : ".";
      const thou = dec === "," ? "." : ",";
      s = s.split(thou).join("").replace(dec, ".");
    } else if (lastComma >= 0) {
      const tail = s.slice(lastComma + 1);
      s = (tail.length <= 2) ? s.replace(",", ".") : s.replace(/,/g, "");
    }
    const v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }

  // Parse "+11,5" / "19,1" / "1.234,5" / "1234.5" → number
  function parseDecimal(txt) {
    if (txt == null) return NaN;
    const s = String(txt).replace(/[++−\s]/g, "").trim();
    if (!s) return NaN;
    return parseMoney(s);
  }

  function fmtMoney(v) { return isFinite(v) ? "$" + v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }
  function fmtPP(v) { return isFinite(v) ? v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " PP" : "—"; }
  function fmtDuration(hours) {
    if (!isFinite(hours) || hours < 0) return "—";
    if (hours < 1) return Math.max(1, Math.round(hours * 60)) + " min";
    const totalMin = Math.round(hours * 60);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    let s = "";
    if (d > 0) s += d + "j ";
    if (h > 0 || d > 0) s += h + "h ";
    s += m + "min";
    return s.trim();
  }

  // ── PP/h: fetch from /Game/Planets, cache 5 min ───────────────────────

  // Une seule lecture de /Game/Planets donne les DEUX chiffres : le PP/h (ligne
  // « Sum » du tfoot, dernière cellule) et le STOCK total de PP (avant-dernière
  // colonne de chaque planète). Le stock n'est PAS dans l'inventaire de la page
  // Trade : cette table ne liste que les biens échangeables (A$, Supply Units,
  // artefacts), pas les Production Points.
  function parsePlanetsHTML(html) {
    const out = { pph: NaN, pp: NaN };
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const tables = doc.querySelectorAll("table.sortable, table");
      for (const tbl of tables) {
        // Must look like the Planets overview table (rows with data-planet-id)
        if (!tbl.querySelector("tr[data-planet-id]")) continue;

        // Stock : on additionne les planètes plutôt que de lire la ligne « Sum »,
        // qui abrège (« 91,2K ») et perd la précision.
        let total = 0, n = 0;
        tbl.querySelectorAll("tr[data-planet-id]").forEach(r => {
          const cells = r.querySelectorAll("td");
          if (cells.length < 3) return;
          const v = parseQty(cells[cells.length - 2].textContent); // dernière = +/h
          if (isFinite(v)) { total += v; n++; }
        });
        if (n > 0) out.pp = total;

        const tfoot = tbl.querySelector("tfoot");
        if (tfoot) {
          const rows = tfoot.querySelectorAll("tr");
          for (const row of rows) {
            const first = (row.querySelector("td") || {}).textContent || "";
            if (!/sum/i.test(first.trim())) continue;
            const cells = row.querySelectorAll("td");
            if (cells.length < 2) continue;
            // Last cell = "+/h" sum for Production = PP/h
            const v = parseDecimal(cells[cells.length - 1].textContent);
            if (isFinite(v) && v > 0) { out.pph = v; break; }
          }
        }
        if (isFinite(out.pph) || isFinite(out.pp)) break;
      }
    } catch (_) {}
    return out;
  }

  async function fetchPPHFromPlanets() {
    if (pphFetching) return;
    pphFetching = true;
    try {
      const res = await fetch("/Game/Planets", { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
      if (!res.ok) return;
      const html = await res.text();
      const r = parsePlanetsHTML(html);
      let got = false;
      if (isFinite(r.pph) && r.pph > 0) { userPPH = r.pph; got = true; }
      if (isFinite(r.pp) && r.pp >= 0) { userPP = r.pp; got = true; }
      if (got) {
        pphTs = Date.now();
        if (typeof chrome !== "undefined" && chrome.storage) {
          try {
            chrome.storage.local.set({
              [STORAGE_KEY_PPH]: userPPH, [STORAGE_KEY_PP]: userPP, [STORAGE_KEY_PPH_TS]: pphTs,
            });
          } catch (_) {}
        }
        schedule();
      }
    } catch (_) {} finally {
      pphFetching = false;
    }
  }

  function ensureFreshPPH() {
    const stale = !pphTs || (Date.now() - pphTs) > PPH_CACHE_MS;
    if (stale) fetchPPHFromPlanets();
  }

  // Load cached PP/h + toggle state at boot, then start the freshness check
  if (typeof chrome !== "undefined" && chrome.storage) {
    try {
      chrome.storage.local.get([STORAGE_KEY_PPH, STORAGE_KEY_PP, STORAGE_KEY_PPH_TS, STORAGE_KEY_HIDE_USESU, STORAGE_KEY_TIER, STORAGE_KEY_HIST, STORAGE_KEY_COST], (r) => {
        const h = r && r[STORAGE_KEY_HIST];
        if (h && typeof h === "object") Object.keys(h).forEach(k => { histCache[k] = h[k]; });
        const c = r && r[STORAGE_KEY_COST];
        if (c && typeof c === "object") costMap = c;
        try { chrome.storage.local.remove("aw_trade_cost"); } catch (_) {}  // clé v1 corrompue
        const v = parseFloat(r && r[STORAGE_KEY_PPH]);
        const p = parseFloat(r && r[STORAGE_KEY_PP]);
        const t = parseFloat(r && r[STORAGE_KEY_PPH_TS]);
        if (isFinite(v) && v > 0) userPPH = v;
        if (isFinite(p) && p >= 0) userPP = p;
        if (isFinite(t) && t > 0) pphTs = t;
        if (r && typeof r[STORAGE_KEY_HIDE_USESU] === "boolean") useSUHidden = r[STORAGE_KEY_HIDE_USESU];
        if (r && /^[123]$/.test(String(r[STORAGE_KEY_TIER]))) tierSel = String(r[STORAGE_KEY_TIER]);
        // Seule la page Trade affiche PP/h : ailleurs, pas de lecture de /Game/Planets
        // (tick() la relance dès qu'on arrive sur Trade).
        if (isTradePage()) ensureFreshPPH();
        schedule();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[STORAGE_KEY_HIDE_USESU]) {
          useSUHidden = !!changes[STORAGE_KEY_HIDE_USESU].newValue;
          schedule();
        }
      });
    } catch (_) {}
  } else if (isTradePage()) {
    ensureFreshPPH();
  }

  // ── Historique des prix : /Game/Trade/PriceHistory/<nom> ──────────────
  // Chaque page renvoie ~28 relevés en clair (« 24215.2354 »), le DERNIER étant
  // le cours courant — vérifié contre le tableau des prix (24300.1594 ↔
  // $24 300,16). On ne demande que les lignes VISIBLES (le filtre de tier en
  // masque les 2/3) plus les artefacts détenus, une requête à la fois, et on
  // garde le résultat 1 h : le jeu ne recote qu'à l'update.

  const histCache = Object.create(null);   // nom → { p: [...], ts }
  const histQueue = [];
  const histAsked = new Set();             // évite d'empiler deux fois le même
  let histBusy = false;

  function histFresh(name) {
    const e = histCache[name];
    return e && e.p && e.p.length && (Date.now() - e.ts) < HIST_TTL_MS ? e : null;
  }

  function persistHist() {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    try { chrome.storage.local.set({ [STORAGE_KEY_HIST]: histCache }); } catch (_) {}
  }

  async function histDrain() {
    if (histBusy) return;
    histBusy = true;
    try {
      while (histQueue.length) {
        const name = histQueue.shift();
        histAsked.delete(name);
        if (histFresh(name)) continue;
        try {
          const res = await fetch("/Game/Trade/PriceHistory/" + encodeURIComponent(name),
            { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
          if (res.ok) {
            const html = await res.text();
            // Les cours sont les seuls nombres à 4 décimales de la page.
            const p = (html.match(/\d+\.\d{4}/g) || []).map(parseFloat).filter(isFinite);
            if (p.length >= 5) {
              histCache[name] = { p, ts: Date.now() };
              persistHist();
              schedule();
            }
          }
        } catch (_) {}
        await new Promise(r => setTimeout(r, HIST_GAP_MS));
      }
    } finally { histBusy = false; }
  }

  function requestHist(name) {
    if (!name || histFresh(name) || histAsked.has(name)) return;
    histAsked.add(name);
    histQueue.push(name);
    histDrain();
  }

  // Position du cours dans sa propre fourchette : 0 % = au plus bas observé
  // (moment d'acheter), 100 % = au plus haut (moment de vendre).
  function histStats(name) {
    const e = histFresh(name);
    if (!e) return null;
    const p = e.p;
    const min = Math.min.apply(null, p), max = Math.max.apply(null, p);
    const cur = p[p.length - 1], first = p[0];
    const span = max - min;
    return {
      p, min, max, cur, first,
      pos: span > 0 ? (cur - min) / span : 0.5,
      drift: first > 0 ? (cur - first) / first : NaN,
    };
  }

  function sparklineSVG(p, w, h) {
    const min = Math.min.apply(null, p), max = Math.max.apply(null, p);
    const span = (max - min) || 1;
    const n = p.length;
    const x = (i) => (n > 1 ? (i / (n - 1)) * (w - 3) + 1.5 : w / 2);
    const y = (v) => h - 1.5 - ((v - min) / span) * (h - 3);
    const pts = p.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    const up = p[n - 1] >= p[0];
    const col = up ? "#5fd38d" : "#e8695f";
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" ' +
      'style="vertical-align:middle;overflow:visible;">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + col + '" ' +
      'stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + y(p[n - 1]).toFixed(1) + '" r="1.8" fill="' + col + '"/>' +
      '</svg>';
  }

  // Vert = bas de fourchette (acheter), rouge = haut (vendre), gris entre les deux.
  function posBadge(pos) {
    const pct = Math.round(pos * 100);
    let col = "#8a9ba8", label = pct + "%";
    if (pos <= 0.25) { col = "#5fd38d"; label = pct + "% bas"; }
    else if (pos >= 0.75) { col = "#e8695f"; label = pct + "% haut"; }
    return '<span style="color:' + col + ';font-size:0.85em;white-space:nowrap;">' + label + '</span>';
  }

  // ── DOM scrape helpers (Trade page) ───────────────────────────────────

  // Concatenate cell text from original cells only — ignore our injected
  // <td>/<tr> so the greedy "$..." regex below doesn't swallow the PP
  // numbers we already wrote (which would loop and grow them each tick).
  function nonInjectedText(row) {
    if (!row) return "";
    let s = "";
    row.querySelectorAll("td, th").forEach(c => {
      if (c.getAttribute && c.getAttribute("data-aw-injected") === "1") return;
      // …et à l'intérieur des cellules d'origine, ignorer aussi nos ajouts :
      // on écrit désormais DANS la cellule de variation.
      s += " " + cellTextNoInjected(c);
    });
    return s.replace(/\s+/g, " ").trim();
  }

  // Même piège que nonInjectedText, mais à l'échelle d'UNE cellule : on écrit la
  // valeur/plus-value DANS la cellule « qty », donc relire son textContent
  // brut ferait ravaler nos propres chiffres et la quantité enflerait à chaque
  // tick (observé : 1 → 3,2e56).
  function cellTextNoInjected(cell) {
    if (!cell) return "";
    let s = "";
    cell.childNodes.forEach(n => {
      if (n.nodeType === 1 && n.getAttribute && n.getAttribute("data-aw-injected") === "1") return;
      s += n.textContent || "";
    });
    return s;
  }

  function findRowsByExactLabel(label) {
    const lc = label.trim().toLowerCase();
    const rows = [];
    document.querySelectorAll("tr").forEach(r => {
      const cells = r.querySelectorAll("td, th");
      if (!cells.length) return;
      const first = (cells[0].textContent || "").trim().toLowerCase();
      if (first === lc) rows.push(r);
    });
    if (rows.length) return rows;
    document.querySelectorAll("tr").forEach(r => {
      const t = (r.textContent || "").trim();
      if (t.toLowerCase().startsWith(lc)) rows.push(r);
    });
    return rows;
  }

  function scrapePPRate() {
    const rows = findRowsByExactLabel("Production Point");
    for (const r of rows) {
      const m = nonInjectedText(r).match(/\$\s*([0-9][\d\s.,]*)/);
      if (m) {
        const v = parseMoney(m[0]);
        if (isFinite(v) && v > 0) return v;
      }
    }
    return NaN;
  }

  function scrapeSURate() {
    const rows = findRowsByExactLabel("Supply Unit");
    for (const r of rows) {
      const t = nonInjectedText(r);
      if (/\b\d+\s*\/\s*\d+\b/.test(t) && !/\$\s*\d{2,}/.test(t)) continue;
      const m = t.match(/\$\s*([0-9][\d\s.,]*)/);
      if (m) {
        const v = parseMoney(m[0]);
        if (isFinite(v) && v > 1) return v;
      }
    }
    return NaN;
  }

  function scrapeInventorySU() {
    const rows = findRowsByExactLabel("Supply Unit");
    for (const r of rows) {
      const t = nonInjectedText(r);
      const m = t.match(/\b(\d+)\s*\/\s*(\d+)\b/);
      if (m && !/\$\s*\d{2,}/.test(t)) {
        return { row: r, owned: parseInt(m[1], 10), max: parseInt(m[2], 10) };
      }
    }
    return null;
  }

  // ── Inventory augmentation ─────────────────────────────────────────────

  function buildRowLikeHost(hostRow, id, label, valueHtml) {
    const tr = document.createElement("tr");
    tr.id = id;
    tr.setAttribute("data-aw-injected", "1");
    if (hostRow.className) tr.className = hostRow.className;
    const cellCount = Math.max(2, hostRow.querySelectorAll("td, th").length);
    const labelCell = document.createElement("td");
    labelCell.textContent = label;
    tr.appendChild(labelCell);
    const valueCell = document.createElement("td");
    valueCell.innerHTML = valueHtml;
    tr.appendChild(valueCell);
    for (let i = 2; i < cellCount; i++) {
      const td = document.createElement("td");
      td.innerHTML = "&nbsp;";
      tr.appendChild(td);
    }
    return tr;
  }

  function upsertRowAfter(hostRow, id, label, valueHtml) {
    let row = document.getElementById(id);
    if (row && row.parentElement === hostRow.parentElement) {
      const cells = row.querySelectorAll("td");
      if (cells[0]) cells[0].textContent = label;
      if (cells[1]) cells[1].innerHTML = valueHtml;
      return row;
    }
    if (row) row.remove();
    row = buildRowLikeHost(hostRow, id, label, valueHtml);
    let anchor = hostRow;
    while (anchor.nextElementSibling && anchor.nextElementSibling.getAttribute &&
           anchor.nextElementSibling.getAttribute("data-aw-injected") === "1") {
      anchor = anchor.nextElementSibling;
    }
    hostRow.parentElement.insertBefore(row, anchor.nextSibling);
    return row;
  }

  // ── Convertisseur PP ⇄ Astro Dollars ──────────────────────────────────
  // Deux champs liés par le cours du PP scrapé sur la page. On n'écrit JAMAIS
  // dans le champ qui a le focus (sinon le poll 1,5 s écraserait la saisie),
  // et la ligne n'est construite qu'une fois — les ticks ne font que
  // recalculer le côté passif.

  let convRate = NaN;       // $ par 1 PP
  let convLast = "pp";      // sens du calcul en mode manuel : "pp" | "usd"
  let convOwnedPP = NaN;    // PP possédés, lus dans l'inventaire
  let convOwnedUSD = NaN;   // Astro Dollars possédés, idem
  // "auto-pp"  : le champ PP suit le stock de PP (défaut)
  // "auto-usd" : le champ $ suit le solde d'Astro Dollars
  // "manual"   : l'utilisateur a saisi une valeur, on ne touche plus à rien
  let convMode = "auto-pp";

  function fmtNum(v, dec) {
    return isFinite(v)
      ? v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: dec })
      : "";
  }

  // Quantité possédée : les séparateurs de milliers du jeu sont ambigus avec un
  // point décimal (« 1.234 »). Pour une QUANTITÉ on tranche — un séparateur
  // suivi d'exactement 3 chiffres est un séparateur de milliers. parseMoney ne
  // convient pas ici : il lirait « 1.234 » comme 1,234.
  function parseQty(txt) {
    if (txt == null) return NaN;
    let s = String(txt).split("/")[0]                 // « 12 / 50 » → possédés
      .replace(/[^0-9.,\s]/g, "").replace(/\s/g, "");
    if (!s) return NaN;
    s = s.replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }

  // Solde d'Astro Dollars : ligne « Astro Dollar » de la table d'INVENTAIRE.
  // Le même libellé existe aussi dans la table des PRIX (où il vaut un cours,
  // pas un solde) — d'où le scope sur la seule table passée en argument.
  function scrapeOwnedUSD(table) {
    if (!table) return NaN;
    const rows = table.querySelectorAll("tr");
    for (const r of rows) {
      if (r.getAttribute("data-aw-injected") === "1") continue;
      const cells = r.querySelectorAll("td, th");
      if (!cells.length) continue;
      const label = (cells[0].textContent || "")
        .replace(/\s*[+-]?\d+\s*%/g, "").replace(/\s+/g, " ").trim();
      // La section « Orders » suit l'inventaire dans la même table et rejoue les
      // mêmes libellés (un ordre en cours). On s'arrête avant, sinon on lirait
      // une quantité d'ordre à la place du solde (cf. fleet-forecast.js).
      if (/^Orders?\b/i.test(label)) break;
      if (cells.length < 2) continue;
      if (!/^Astro\s*Dollars?\b/i.test(label)) continue;
      const v = parseQty(cellTextNoInjected(cells[1]));
      if (isFinite(v) && v >= 0) return v;
    }
    return NaN;
  }

  function converterHTML() {
    const inputCss =
      "width:96px;padding:3px 6px;font-size:0.95em;font-family:inherit;text-align:right;" +
      "background:#0d1319;color:" + TH.txt + ";border:1px solid " + TH.line + ";" +
      "border-radius:4px;outline:none;";
    const unitCss = "opacity:0.7;font-size:0.9em;";
    const btnCss =
      "padding:3px 7px;font-size:0.9em;font-family:inherit;cursor:pointer;line-height:1;" +
      "background:#121a20;color:" + TH.accent + ";border:1px solid " + TH.line + ";" +
      "border-radius:4px;";
    const resetBtn = (side) =>
      '<button data-aw-conv-reset="' + side + '" type="button" style="' + btnCss + '">⟲</button>';
    return (
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<input data-aw-conv-pp type="text" inputmode="decimal" placeholder="0" style="' + inputCss + '">' +
        '<span style="' + unitCss + '">PP</span>' + resetBtn("pp") +
        '<span style="color:' + TH.accent + ';margin:0 2px;">⇄</span>' +
        '<span style="' + unitCss + '">$</span>' +
        '<input data-aw-conv-usd type="text" inputmode="decimal" placeholder="0" style="' + inputCss + '">' +
        resetBtn("usd") +
        '<span data-aw-conv-hint style="opacity:0.55;font-size:0.85em;white-space:nowrap;"></span>' +
      '</div>' +
      '<div data-aw-conv-own style="opacity:0.55;font-size:0.85em;margin-top:3px;"></div>'
    );
  }

  function setIfNotFocused(el, value) {
    if (el && document.activeElement !== el) el.value = value;
  }

  function recomputeConverter(row) {
    const ppEl = row.querySelector("[data-aw-conv-pp]");
    const usdEl = row.querySelector("[data-aw-conv-usd]");
    const hintEl = row.querySelector("[data-aw-conv-hint]");
    const ownEl = row.querySelector("[data-aw-conv-own]");
    if (!ppEl || !usdEl) return;

    // Tant que l'utilisateur n'a rien saisi, le champ actif suit le solde réel
    // (il continue donc de bouger avec la production / les ventes). Dès qu'il
    // tape quelque chose on passe en "manual" — les ⟲ resynchronisent.
    if (convMode === "auto-pp" && isFinite(convOwnedPP)) {
      convLast = "pp";
      setIfNotFocused(ppEl, fmtNum(convOwnedPP, 0));
    } else if (convMode === "auto-usd" && isFinite(convOwnedUSD)) {
      convLast = "usd";
      setIfNotFocused(usdEl, fmtNum(convOwnedUSD, 2));
    }

    // Les ⟲ ne s'affichent que si le solde correspondant est lisible, et celui
    // du mode actif est mis en évidence.
    [["pp", convOwnedPP, fmtNum(convOwnedPP, 0) + " PP", "auto-pp"],
     ["usd", convOwnedUSD, fmtMoney(convOwnedUSD), "auto-usd"]].forEach(([side, val, txt, mode]) => {
      const b = row.querySelector('[data-aw-conv-reset="' + side + '"]');
      if (!b) return;
      const has = isFinite(val);
      b.style.display = has ? "" : "none";
      b.title = has ? "Reprendre mon solde (" + txt + ")" : "";
      const on = has && convMode === mode;
      b.style.background = on ? TH.onBg : "#121a20";
      b.style.borderColor = on ? TH.onLine : TH.line;
      // état lisible par les skins HUD / Verre (game-skins.css), qui repeignent le bouton
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    if (ownEl) {
      const parts = [];
      if (isFinite(convOwnedPP)) parts.push(fmtNum(convOwnedPP, 0) + " PP");
      if (isFinite(convOwnedUSD)) parts.push(fmtMoney(convOwnedUSD));
      ownEl.textContent = parts.length ? "Possédés : " + parts.join(" · ") : "";
    }

    if (!isFinite(convRate) || convRate <= 0) {
      if (hintEl) hintEl.textContent = "cours indisponible";
      return;
    }

    let pp;
    if (convLast === "usd") {
      const usd = parseMoney(usdEl.value);
      pp = isFinite(usd) ? usd / convRate : NaN;
      setIfNotFocused(ppEl, isFinite(pp) ? fmtNum(pp, 2) : "");
    } else {
      pp = parseMoney(ppEl.value);
      setIfNotFocused(usdEl, isFinite(pp) ? fmtNum(pp * convRate, 2) : "");
    }

    if (hintEl) {
      const hours = (isFinite(pp) && pp > 0 && userPPH > 0) ? pp / userPPH : NaN;
      hintEl.textContent = isFinite(hours)
        ? "≈ " + fmtDuration(hours) + " de prod"
        : "1 PP = " + fmtMoney(convRate);
    }
  }

  function wireConverter(row) {
    const ppEl = row.querySelector("[data-aw-conv-pp]");
    const usdEl = row.querySelector("[data-aw-conv-usd]");
    if (!ppEl || !usdEl) return;
    ppEl.addEventListener("input", () => { convMode = "manual"; convLast = "pp"; recomputeConverter(row); });
    usdEl.addEventListener("input", () => { convMode = "manual"; convLast = "usd"; recomputeConverter(row); });
    row.querySelectorAll("[data-aw-conv-reset]").forEach(btn => {
      const side = btn.getAttribute("data-aw-conv-reset");
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        convMode = side === "usd" ? "auto-usd" : "auto-pp";
        convLast = side;
        // Un champ qui a le focus est ignoré par setIfNotFocused : on le relâche.
        if (document.activeElement === ppEl || document.activeElement === usdEl) {
          document.activeElement.blur();
        }
        recomputeConverter(row);
      });
      btn.addEventListener("mousedown", e => e.stopPropagation());
    });
    // Le tableau du jeu trie au clic sur la ligne : on isole les champs.
    [ppEl, usdEl].forEach(el => {
      el.addEventListener("click", e => e.stopPropagation());
      el.addEventListener("mousedown", e => e.stopPropagation());
    });
  }

  function ensureConverterRow(hostRow, ppRate) {
    convRate = ppRate;
    convOwnedPP = userPP > 0 ? userPP : NaN;          // vient de /Game/Planets
    convOwnedUSD = scrapeOwnedUSD(hostRow.closest("table"));
    let row = document.getElementById(ROW_ID_CONV);
    if (!row || row.parentElement !== hostRow.parentElement) {
      if (row) row.remove();
      row = buildRowLikeHost(hostRow, ROW_ID_CONV, "PP ⇄ $", converterHTML());
      // Se place après les lignes déjà injectées : appelé juste après « Cours »,
      // il atterrit donc directement sous celle-ci.
      let anchor = hostRow;
      while (anchor.nextElementSibling && anchor.nextElementSibling.getAttribute &&
             anchor.nextElementSibling.getAttribute("data-aw-injected") === "1") {
        anchor = anchor.nextElementSibling;
      }
      hostRow.parentElement.insertBefore(row, anchor.nextSibling);
      wireConverter(row);
    }
    recomputeConverter(row);
    return row;
  }

  // ── Valeur et plus-value de l'inventaire ──────────────────────────────
  // Le prix d'achat n'est stocké NULLE PART : ni dans le jeu, ni côté backend
  // Holocron (aucune table d'historique de transaction). On l'OBSERVE donc :
  // à chaque hausse de la quantité détenue, on intègre le cours du moment dans
  // une moyenne pondérée. La toute première observation ne fixe rien — on ne
  // sait pas si l'item vient d'être acheté ou traîne depuis des semaines.

  // { qty: détenu, pru: coût moyen, kn: NOMBRE D'UNITÉS que ce coût couvre }.
  // `kn` est indispensable : si on détient 2 unités et qu'on n'a vu l'achat que
  // d'une seule, le PRU ne vaut que pour celle-là. Le confondre avec `qty`
  // faisait dériver la moyenne à chaque achat suivant.
  let costMap = Object.create(null);

  function persistCost() {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    try { chrome.storage.local.set({ [STORAGE_KEY_COST]: costMap }); } catch (_) {}
  }

  function learnCost(name, qty, price) {
    const e = costMap[name];
    if (!e) { costMap[name] = { qty, pru: null, kn: 0 }; return true; }
    if (typeof e.kn !== "number") e.kn = (isFinite(e.pru) && e.pru > 0) ? e.qty : 0;
    let changed = false;
    if (qty > e.qty && isFinite(price) && price > 0) {
      const d = qty - e.qty;
      const base = (isFinite(e.pru) && e.pru > 0) ? e.pru : 0;
      e.pru = (base * e.kn + price * d) / (e.kn + d);
      e.kn += d;
      changed = true;
    }
    if (qty !== e.qty) {
      e.qty = qty;
      if (e.kn > qty) e.kn = qty;   // des unités au coût connu ont été vendues
      changed = true;
    }
    return changed;
  }

  function buildPriceMap() {
    const map = Object.create(null);
    const table = findPricesTable();
    if (!table) return map;
    table.querySelectorAll("tr").forEach(row => {
      if (row.getAttribute("data-aw-injected") === "1") return;
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;
      if (/Use\s+Supply\s+Unit/i.test(nonInjectedText(row))) return;
      const name = itemName(cells[0].textContent);
      if (!name || (name in map)) return;
      const v = parseMoney(cellTextNoInjected(cells[1]));
      if (isFinite(v) && v > 0) map[name] = v;
    });
    return map;
  }

  function renderInventoryValues(invTable) {
    if (!invTable) return;
    const prices = buildPriceMap();
    let dirty = false;
    const rows = invTable.querySelectorAll("tr");
    for (const r of rows) {
      if (r.getAttribute("data-aw-injected") === "1") continue;
      const cells = r.querySelectorAll("td, th");
      if (!cells.length) continue;
      const name = itemName(cells[0].textContent);
      if (/^Orders?\b/i.test(name)) break;              // cf. scrapeOwnedUSD
      if (cells.length < 2 || /^Astro\s*Dollars?\b/i.test(name)) continue;
      const price = prices[name];
      const qty = parseQty(cellTextNoInjected(cells[1]));
      // Garde-fou : une quantité aberrante signe une relecture de nos propres
      // chiffres — on refuse d'apprendre un PRU dessus.
      if (!isFinite(price) || !isFinite(qty) || qty <= 0 || qty > 1e7) continue;

      if (learnCost(name, qty, price)) dirty = true;

      let span = cells[1].querySelector("[data-aw-val]");
      if (!span) {
        span = document.createElement("span");
        span.setAttribute("data-aw-val", "1");
        span.setAttribute("data-aw-injected", "1");
        span.style.cssText = "margin-left:8px;font-size:0.85em;white-space:nowrap;";
        cells[1].appendChild(span);
      }

      let html = '<span style="opacity:0.75;">' + fmtMoney(qty * price) + '</span>';
      const e = costMap[name];
      if (e && isFinite(e.pru) && e.pru > 0 && e.kn > 0) {
        // Plus-value calculée sur les SEULES unités dont on a observé l'achat.
        const pv = (price - e.pru) * e.kn;
        const pct = ((price - e.pru) / e.pru) * 100;
        const col = pv >= 0 ? "#5fd38d" : "#e8695f";
        html += ' · <span style="color:' + col + ';">' + (pv >= 0 ? "+" : "−") +
          fmtMoney(Math.abs(pv)) + " (" + (pct >= 0 ? "+" : "−") + Math.abs(pct).toFixed(1) + "%)</span>" +
          ' <span style="opacity:0.45;">PRU ' + fmtMoney(e.pru) +
          (e.kn < qty ? " sur " + e.kn + "/" + qty : "") + "</span>";
      }
      const st = histStats(name);
      if (st) html += " " + posBadge(st.pos);
      else requestHist(name);
      span.innerHTML = html;
    }
    if (dirty) persistCost();
  }

  function renderInventoryAddon(ppRate, suRate) {
    const inv = scrapeInventorySU();
    if (!inv) return;
    const ppFromSU = (isFinite(suRate) && isFinite(ppRate) && ppRate > 0 && inv.owned > 0)
      ? (inv.owned * suRate) / ppRate : NaN;
    const destAchievable = isFinite(ppFromSU) ? Math.floor(ppFromSU / DESTROYER_COST_PP) : NaN;

    ensureConverterRow(inv.row, ppRate);
    renderInventoryValues(inv.row.closest("table"));

    upsertRowAfter(inv.row, ROW_ID_PP_EQ, "≈ en PP",
      isFinite(ppFromSU)
        ? fmtPP(ppFromSU) + ' <span style="opacity:0.6;">(' + fmtMoney(inv.owned * suRate) + ')</span>'
        : "—");

    upsertRowAfter(inv.row, ROW_ID_DEST, "Destroyers faisables",
      isFinite(destAchievable)
        ? '<strong>' + destAchievable.toLocaleString("fr-FR") + '</strong> destroyer(s) ' +
          '<span style="opacity:0.6;">(' + DESTROYER_COST_PP + ' PP/unité)</span>'
        : "—");
  }

  // ── Prices augmentation ───────────────────────────────────────────────

  function useSULabel() {
    return useSUHidden ? "👁 Afficher Use Supply Unit" : "🚫 Masquer Use Supply Unit";
  }

  // Le "titre à fond bleu" du jeu = div.head (fond rgb(35,30,100)).
  // Il est dans un conteneur frère du tableau, pas dans une carte Bootstrap :
  // on remonte depuis le tableau et on prend la .head du plus petit sous-arbre
  // englobant (gère .head dans le même conteneur OU un conteneur frère).
  function findCardHeader(table) {
    let node = table;
    for (let i = 0; i < 6 && node; i++) {
      const head = node.querySelector && node.querySelector(".head");
      if (head) return head;
      node = node.parentElement;
    }
    // Repli: en-têtes Bootstrap classiques, sinon avant le tableau.
    const card = table.closest(".card, .panel");
    return card ? card.querySelector(".card-header, .panel-heading") : null;
  }

  // Place le bouton dans le titre bleu si on le trouve, sinon repli sur
  // l'ancien emplacement (juste avant le tableau).
  function placeUseSUToggle(btn, table) {
    const header = findCardHeader(table);
    if (header) {
      if (btn.parentElement !== header) {
        // Coin GAUCHE du titre bleu, centré verticalement (cf. capture : rectangle jaune).
        // Le titre "Trade & Artefacts" est centré via text-align ; on positionne le
        // bouton en absolu pour ne pas décaler ce texte.
        if (getComputedStyle(header).position === "static") {
          header.style.position = "relative";
        }
        btn.style.cssText = "position:absolute;left:8px;top:50%;transform:translateY(-50%);margin:0;font-size:0.85em;z-index:2;";
        header.appendChild(btn);
      }
    } else if (btn.parentElement !== table.parentElement) {
      btn.style.cssText = "margin:4px 8px 8px 0;font-size:0.85em;";
      table.parentElement.insertBefore(btn, table);
    }
  }

  function ensureUseSUToggle(table) {
    let btn = document.getElementById(TOGGLE_ID);
    if (btn) {
      btn.textContent = useSULabel();
      placeUseSUToggle(btn, table); // ré-ancre dans le titre si la carte a été re-rendue
      return btn;
    }
    btn = document.createElement("button");
    btn.id = TOGGLE_ID;
    btn.setAttribute("data-aw-injected", "1");
    btn.type = "button";
    // btn-outline-light : reste lisible sur le fond bleu du titre
    btn.className = "btn btn-sm btn-outline-light";
    btn.textContent = useSULabel();
    btn.addEventListener("click", () => {
      useSUHidden = !useSUHidden;
      if (typeof chrome !== "undefined" && chrome.storage) {
        try { chrome.storage.local.set({ [STORAGE_KEY_HIDE_USESU]: useSUHidden }); } catch (_) {}
      }
      btn.textContent = useSULabel();
      schedule();
    });
    placeUseSUToggle(btn, table);
    return btn;
  }


  function findPricesTable() {
    const ppRows = findRowsByExactLabel("Production Point");
    for (const r of ppRows) {
      const t = r.textContent || "";
      if (!/\$\s*\d/.test(t)) continue;
      const tbl = r.closest("table");
      if (tbl) return tbl;
    }
    return null;
  }

  function ensurePricesHeaders(table) {
    const thead = table.querySelector("thead") || table;
    let headerRow = thead.querySelector("tr") || table.querySelector("tr");
    if (!headerRow) return null;
    if (headerRow.querySelector("." + HEADER_CLASS)) return headerRow;
    const existing = headerRow.querySelectorAll("th, td");
    const tag = (existing[0] && existing[0].tagName) || "TH";
    const mk = (label) => {
      const cell = document.createElement(tag);
      cell.className = HEADER_CLASS;
      cell.setAttribute("data-aw-injected", "1");
      cell.textContent = label;
      cell.style.whiteSpace = "nowrap";
      return cell;
    };
    // PAS de colonne « Tendance » : le tableau n'a plus de largeur disponible
    // (avec une 3e colonne ajoutée il débordait sous le panneau Inventory).
    // La tendance est rendue DANS la cellule de variation — voir ensureTrend().
    headerRow.appendChild(mk("Coût PP"));
    headerRow.appendChild(mk("Temps farm"));
    return headerRow;
  }

  // Nom d'item sans les badges de bonus : « Charcoal Diamond 3 +30% » →
  // « Charcoal Diamond 3 », qui est la clé attendue par /PriceHistory.
  function itemName(label) {
    return String(label || "").replace(/\s*[+-]?\d+\s*%/g, "").replace(/\s+/g, " ").trim();
  }

  // La tendance se greffe SOUS le badge de variation (3e cellule), qui traite
  // déjà du mouvement du prix — plutôt que dans une colonne à elle, faute de
  // largeur : le tableau débordait alors sous le panneau Inventory.
  function ensureTrend(row, cells, name) {
    const host = cells[2] || cells[1];
    if (!host) return;
    let box = host.querySelector("[data-aw-trend]");
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-aw-trend", "1");
      box.setAttribute("data-aw-injected", "1");
      box.style.cssText = "margin-top:3px;line-height:1;white-space:nowrap;";
      host.appendChild(box);
    }
    const st = histStats(name);
    if (!st) {
      if (box.textContent !== "…") box.textContent = "…";
      requestHist(name);
      return;
    }
    box.innerHTML = sparklineSVG(st.p, 40, 12) +
      '<span style="margin-left:3px;">' + posBadge(st.pos) + "</span>";
    box.title = name + " — bas " + fmtMoney(st.min) + " · haut " + fmtMoney(st.max) +
      " · actuel " + fmtMoney(st.cur) + " (" +
      (st.drift >= 0 ? "+" : "") + (st.drift * 100).toFixed(1) + "% sur " + st.p.length + " relevés)";
  }

  function ensurePricesCells(table, ppRate, suRate) {
    const tbody = table.querySelector("tbody") || table;
    tbody.querySelectorAll("tr").forEach(row => {
      if (row.getAttribute("data-aw-injected") === "1") return;
      if (row.querySelectorAll("th").length && !row.querySelector("td")) return;
      const cells = row.querySelectorAll("td");
      if (!cells.length) return;
      const txt = nonInjectedText(row);
      const priceMatch = txt.match(/\$\s*([0-9][\d\s.,]*)/);
      if (!priceMatch) return;
      const price = parseMoney(priceMatch[0]);
      if (!isFinite(price) || price <= 0) return;

      const firstLabel = (cells[0].textContent || "").trim();
      const isPPRow = /^Production Point$/i.test(firstLabel);
      const isUseSURow = /Use\s+Supply\s+Unit/i.test(txt);

      if (isUseSURow) {
        row.setAttribute(USESU_ROW_ATTR, "1");
        row.style.display = useSUHidden ? "none" : "";
      }

      let costCell = row.querySelector("td." + CELL_CLASS + "[data-aw-col='cost']");
      let timeCell = row.querySelector("td." + CELL_CLASS + "[data-aw-col='time']");
      if (!costCell) {
        costCell = document.createElement("td");
        costCell.className = CELL_CLASS;
        costCell.setAttribute("data-aw-col", "cost");
        costCell.setAttribute("data-aw-injected", "1");
        costCell.style.whiteSpace = "nowrap";
        row.appendChild(costCell);
      }
      if (!timeCell) {
        timeCell = document.createElement("td");
        timeCell.className = CELL_CLASS;
        timeCell.setAttribute("data-aw-col", "time");
        timeCell.setAttribute("data-aw-injected", "1");
        timeCell.style.whiteSpace = "nowrap";
        row.appendChild(timeCell);
      }
      // Tendance : uniquement pour les lignes VISIBLES (le filtre de tier en
      // masque les 2/3) et jamais pour « Use Supply Unit », qui est une action
      // et non un item coté.
      if (!isUseSURow && row.style.display !== "none") {
        ensureTrend(row, cells, itemName(firstLabel));
      }

      // Cost in PP: 1 for PP row, (price+SU_cost)/PP_rate for Use SU rows, price/PP_rate otherwise
      let ppCost;
      if (isPPRow) {
        ppCost = 1;
      } else if (isUseSURow) {
        const suInPP = (isFinite(suRate) && isFinite(ppRate) && ppRate > 0) ? (suRate / ppRate) : NaN;
        const cashInPP = (isFinite(ppRate) && ppRate > 0) ? (price / ppRate) : NaN;
        ppCost = (isFinite(suInPP) && isFinite(cashInPP)) ? (suInPP + cashInPP) : NaN;
      } else {
        ppCost = (isFinite(ppRate) && ppRate > 0) ? (price / ppRate) : NaN;
      }
      const hours = isFinite(ppCost) && userPPH > 0 ? ppCost / userPPH : NaN;

      if (isFinite(ppCost) && isUseSURow) {
        costCell.innerHTML = fmtPP(ppCost) +
          ' <span style="opacity:0.55;font-size:0.85em;">(+1 SU)</span>';
      } else {
        costCell.textContent = isFinite(ppCost) ? fmtPP(ppCost) : "—";
      }
      timeCell.textContent = isFinite(hours) ? fmtDuration(hours) : "—";
    });
  }

  // Sépare visuellement les artefacts par tier (« Basalt Monolith 1 » → tier 1…).
  // Le tier = chiffre final du nom d'item, AVANT les badges de bonus (+10%…) qui
  // partagent la même cellule — d'où l'ancrage sur « espace-chiffre » suivi de
  // +/fin, jamais sur le dernier chiffre du texte (piège : « +10% »).
  function tierOfRow(row) {
    const cell = row.querySelector("td");
    if (!cell) return null;
    const m = (cell.textContent || "").trim().match(/\s([123])\s*(?:\+|$)/);
    return m ? m[1] : null;
  }

  // Barre de filtre « Tier 1 | Tier 2 | Tier 3 » : un SEUL palier d'artefacts
  // affiché à la fois (PP / Supply Unit toujours visibles). Choix persisté.
  function ensureTierFilter(table) {
    const tbody = table.querySelector("tbody") || table;
    // Barre AU-DESSUS de la table, détachée (marge entre elle et le tableau).
    let bar = table.parentNode ? table.parentNode.querySelector("[data-aw-tierbar]") : null;
    if (!bar) {
      if (!table.parentNode) return;
      bar = document.createElement("div");
      bar.setAttribute("data-aw-injected", "1");
      bar.setAttribute("data-aw-tierbar", "1");
      bar.style.cssText =
        "display:flex;gap:6px;justify-content:center;margin:6px 0 10px;padding:6px;" +
        "background:#0d1319;border-radius:6px;" +
        "border:1px solid " + TH.lineSoft + ";";
      ["1", "2", "3"].forEach((t) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("data-aw-tierbtn", t);
        b.textContent = "Tier " + t + " · +" + t + "0%";
        // Même gabarit que les onglets du jeu : police du jeu, capitales, pilule
        // sombre ; l'actif est repeint dans le bloc d'état plus bas.
        b.style.cssText =
          "flex:1;max-width:190px;padding:7px 14px;font-size:13px;font-weight:700;letter-spacing:.8px;cursor:pointer;" +
          "font-family:inherit;border-radius:6px;text-transform:uppercase;" +
          "background:#121a20;transition:background .15s,border-color .15s;" +
          "border:1px solid " + TH.line + ";color:" + TH.txt + ";";
        b.addEventListener("click", () => {
          tierSel = t;
          if (typeof chrome !== "undefined" && chrome.storage) {
            try { chrome.storage.local.set({ [STORAGE_KEY_TIER]: t }); } catch (_) {}
          }
          schedule();
        });
        bar.appendChild(b);
      });
      table.parentNode.insertBefore(bar, table);
    }
    bar.querySelectorAll("[data-aw-tierbtn]").forEach((b) => {
      const on = b.getAttribute("data-aw-tierbtn") === tierSel;
      b.style.background = on ? TH.onBg : "#121a20";
      b.style.borderColor = on ? TH.onLine : TH.line;
      b.style.color = on ? TH.accent : TH.txt;
      b.setAttribute("aria-pressed", on ? "true" : "false");   // cf. skins HUD / Verre
    });
    tbody.querySelectorAll("tr").forEach((row) => {
      if (row.getAttribute("data-aw-injected") === "1") return;
      const t = tierOfRow(row);
      if (!t) return; // PP / Supply Unit / lignes sans tier : intouchées
      if (t !== tierSel) row.style.display = "none";
      else if (row.getAttribute(USESU_ROW_ATTR) === "1") row.style.display = useSUHidden ? "none" : "";
      else row.style.display = "";
    });
  }

  /* Coût d'un Trade Agreement DANS la case « Trade Revenue » : le temps qu'il faut pour
     le financer au cours du jour. Le reste (prix, PP, cours) est en infobulle. */
  function ensureTARow(ppRate) {
    const hote = findRowsByExactLabel("Trade Revenue")[0];
    if (!hote) return;
    const cells = hote.querySelectorAll("td, th");
    const cible = cells[1] || cells[0];
    if (!cible) return;

    const ppCost = (isFinite(ppRate) && ppRate > 0) ? (TA_COST_USD / ppRate) : NaN;
    const hours = (isFinite(ppCost) && userPPH > 0) ? (ppCost / userPPH) : NaN;
    if (!isFinite(hours)) return;

    // On calque la pilule du jeu (le badge « +0% ») : mêmes classes, donc même apparence
    // quel que soit le skin, et les deux badges s'alignent sur la même ligne.
    const modele = cible.querySelector("[class]:not([data-aw-injected])");
    let tag = cible.querySelector("[data-aw-ta]");
    if (!tag) {
      tag = document.createElement("span");
      tag.setAttribute("data-aw-ta", "1");
      tag.setAttribute("data-aw-injected", "1");
      cible.appendChild(tag);
    }
    tag.className = modele ? modele.className : "";
    tag.style.cssText = "margin-left:8px;vertical-align:middle;white-space:nowrap;color:#fbbf24;" +
      (modele ? "" : "display:inline-block;padding:2px 8px;border-radius:999px;font-size:.85em;" +
                     "background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);");
    if (cible.style) { cible.style.whiteSpace = "nowrap"; }
    const texte = "🤝 " + fmtDuration(hours);
    if (tag.textContent !== texte) tag.textContent = texte;
    tag.title = "Un Trade Agreement coûte " + fmtMoney(TA_COST_USD) + " ≈ " + fmtPP(ppCost) +
      " au cours de " + fmtMoney(ppRate) + "/PP — soit " + fmtDuration(hours) +
      " de production (gratuit avec un Trader, 5 accords max).";
  }

  function renderPricesAddon(ppRate, suRate) {
    const table = findPricesTable();
    if (!table) return;
    ensureUseSUToggle(table);
    ensurePricesHeaders(table);
    // Le filtre de tier AVANT les cellules : c'est lui qui fixe la visibilité,
    // et la colonne Tendance ne demande son historique que pour les lignes
    // visibles. Dans l'autre ordre, le premier tick voit les 21 artefacts
    // « visibles » et déclenche 23 requêtes au lieu de 9.
    ensureTierFilter(table);
    ensurePricesCells(table, ppRate, suRate);
    ensureTARow(ppRate);               // sous « Trade Revenue », pas dans la liste des prix
  }

  // ── Orchestration ──────────────────────────────────────────────────────

  function tick() {
    if (!isTradePage()) return;
    ensureFreshPPH();
    const ppRate = scrapePPRate();
    const suRate = scrapeSURate();
    renderInventoryAddon(ppRate, suRate);
    renderPricesAddon(ppRate, suRate);
  }

  let _scheduled = false;
  function schedule() {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => { _scheduled = false; try { tick(); } catch (e) { console.log("[TRADE]", e); } });
  }

  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        const tgt = m.target;
        if (!tgt) continue;
        if (tgt.id && tgt.id.startsWith("aw-trade-")) continue;
        if (tgt.closest && tgt.closest("[data-aw-injected='1']")) continue;
        schedule();
        return;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function stopObserver() { if (observer) { observer.disconnect(); observer = null; } }

  function removeInjected() {
    [ROW_ID_RATES, ROW_ID_CONV, ROW_ID_PP_EQ, ROW_ID_DEST, ROW_ID_TA, TOGGLE_ID].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    document.querySelectorAll("." + HEADER_CLASS + ", ." + CELL_CLASS).forEach(el => el.remove());
    document.querySelectorAll("[data-aw-val], [data-aw-trend]").forEach(el => el.remove());
    // Restore Use SU rows visibility when leaving the page
    document.querySelectorAll("[" + USESU_ROW_ATTR + "]").forEach(r => {
      r.style.display = "";
      r.removeAttribute(USESU_ROW_ATTR);
    });
    // Legacy banner from earlier dev versions
    const old = document.getElementById("aw-trade-pph-banner");
    if (old) old.remove();
  }

  function boot() {
    if (!isTradePage()) { stopObserver(); removeInjected(); return; }
    schedule();
    startObserver();
    setInterval(schedule, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      stopObserver();
      removeInjected();
      boot();
    }
  }, 750);
})();
