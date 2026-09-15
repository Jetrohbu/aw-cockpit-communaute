/* ════════════════════════════════════════════════════════════════════════
   AW3D — VUE 3D DE LA CARTE DU JEU  (/Game/Map)
   ────────────────────────────────────────────────────────────────────────
   La 3D prend la place de la carte DANS son bloc d'origine (#container) : la
   navigation, la barre d'outils et les compteurs du jeu restent autour.
     · un système = soleil plasma + halo à la couleur de son alliance +
       anneau de possession à crans, ses 12 planètes en orbite
     · survol  → fiche complète (états, population, starbases, sièges, colons)
     · clic    → sa page dans le jeu
     · calques : 2D/3D, repère, noms, starbases, vision, flottes ;
                 filtres et recherche

   Three.js vient de l'extension (vendor/three.module.min.js) : la CSP du jeu
   interdit tout script externe. Dans l'app Android, le bundle IIFE injecté
   avant nous a déjà posé window.THREE — un seul source pour les deux
   plateformes, aucune branche de plus.

   ── ORDRE DE CHARGEMENT ─────────────────────────────────────────────────
   Ce fichier porte le SOCLE (window.AW3D) et le PIPELINE DE DONNÉES : il doit
   donc être chargé AVANT aw-carte-2d.js, qui les consomme et se retire en
   silence s'il ne les trouve pas. Il est un IIFE autonome : la concaténation
   « aw-carte-3d.js + aw-carte-2d.js » dans cet ordre produit un bundle valide,
   c'est la forme sous laquelle le mod Android l'injecte par ses assets.

   ── CE QUE CE FICHIER PUBLIE ────────────────────────────────────────────
     NS.active                        on est bien sur /Game/Map
     NS.MOBILE / NS.COARSE            profil de l'appareil
     NS.FREE_HEX / NS.SOLO_HEX / NS.UNKN_HEX
     NS.starIdx(l) / NS.starColor(l) / NS.tagColor(t) / NS.readableTag(css)
     NS.esc(s) / NS.onTap(el, fn) / NS.mapBox() / NS.nativeMap()
     NS.loaded                        journal de chargement (bundle Android)
     NS.data.snapshot(opts)           LE pipeline, partagé avec les calques 2D
     NS.data.pretes                   promesse : mémoire des couleurs revenue
   Le fichier ne dessine RIEN sur la carte 2D du jeu : les deux calques
   « Territoires AW » et « Portée AW » vivent dans aw-carte-2d.js. On se
   contente de le monter (NS.map2d.mount) au démarrage, parce que c'est ici
   qu'on observe déjà l'apparition de #mapToolbar.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* Un seul global, créé de façon idempotente : l'ordre de chargement ne peut
     pas casser sur un namespace manquant. */
  var NS = (window.AW3D = window.AW3D || {});
  /* Double chargement (manifeste + bundle du mod concaténé) : déjà vu, et il
     doublait les boutons dans la barre d'outils. */
  if (window.__awMap3dLoaded) return;
  window.__awMap3dLoaded = true;
  NS.loaded = NS.loaded || [];

  NS.active = /\/Game\/Map(\/|$|\?)/i.test(location.pathname) &&
              !/\/Game\/Map\/SolarSystem\//i.test(location.pathname);

  var THREE = null, ui = null, panelEl = null, app = null;

  /* ══════════════════════════════════════════════════════════════════════
     1 · SOCLE — profil de l'appareil, couleurs, petits outils communs
     ══════════════════════════════════════════════════════════════════════ */

  /* Profil mobile. Sur téléphone la carte devenait illisible : la taille des
     points d'étoile est multipliée par le devicePixelRatio (2 sur un S24)
     alors que la surface d'écran fond, donc 300 000 étoiles + 46 par système
     recouvraient les systèmes eux-mêmes. Et un doigt vise moins bien qu'une
     souris. On règle densité, taille d'icône et tolérances en conséquence. */
  var COARSE = false;
  try { COARSE = matchMedia("(pointer:coarse)").matches; } catch (e) {}
  var MOBILE = COARSE || Math.min(innerWidth, innerHeight) < 700;
  /* Taille de l'astre. 0,55 était calé sur les GIF 64 px du jeu, qui
     pixelisaient dès qu'on les agrandissait ; le style plasma est rendu par un
     shader et supporte bien mieux. Les systèmes sont l'information de cette
     carte, ils doivent se voir. */
  var ICON_K = MOBILE ? 0.92 : 0.78;

  var FREE_HEX = "#5c6478", SOLO_HEX = "#9aa7bd", UNKN_HEX = "#3f4658";

  /* La vraie carte code le NIVEAU DE POPULATION du système dans l'icône :
     star0 … star8 (relevé sur /Game/Map — 170:star8 pour un système de niveau
     8, 172:star0 pour un niveau 0). On reprend l'échelle et les teintes du pack
     d'icônes de l'extension, et l'anneau reste à la couleur de l'alliance. */
  var STAR_COLORS = ["#cacace", "#b9b9c0", "#4e95a2", "#a1d631", "#d6c631",
                     "#d6a231", "#d65731", "#d631c6", "#7331d6"];
  function starIdx(lvl) { return Math.max(0, Math.min(8, lvl | 0)); }
  function starColor(lvl) { return STAR_COLORS[starIdx(lvl)]; }

  /* Repli EXACT du jeu pour une alliance sans couleur déclarée : même hachage
     (h*31 + code, modulo 360) et même hsl(h,65%,45%) — relevé sur le fill des
     <text> de la carte 2D, ex. LOW → hsl(332,65%,45%). On était à 52 % de
     luminosité, donc systématiquement plus clair que le jeu. */
  /* ⚠ RENVOIE DU HEX, jamais "hsl(h,65%,45%)". La chaîne hsl contient des
     VIRGULES, et la clé de la texture des tags est une liste "TAG:couleur"
     jointe par des virgules : allianceTexMulti la redécoupait au mauvais
     endroit et écrivait « TUGA · 65 · 45% » à l'écran. Même teinte, même
     luminosité que le repli du jeu, mais sans séparateur dans la valeur. */
  function tagColor(tag) {
    var h = 0;
    for (var i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
    return hslHex(h / 360, 0.65, 0.45);
  }
  function hslHex(h, s2, l) {
    function hue(p2, q2, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p2 + (q2 - p2) * 6 * t;
      if (t < 1/2) return q2;
      if (t < 2/3) return p2 + (q2 - p2) * (2/3 - t) * 6;
      return p2;
    }
    var q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2, pp = 2 * l - q;
    var out = s2 === 0 ? [l, l, l] : [hue(pp, q, h + 1/3), hue(pp, q, h), hue(pp, q, h - 1/3)];
    return "#" + out.map(function (v) {
      return ("0" + Math.round(v * 255).toString(16)).slice(-2);
    }).join("");
  }
  /* Le tag d'alliance est écrit en tout petit sur un fond noir constellé.
     Les couleurs sombres du jeu — l'indigo de FARt (#4B0082), le bordeaux de
     NSA (#800000), le hsl(…,45%) des alliances sans couleur déclarée comme
     TUGA, FREE ou LOCO — y sont illisibles.
     On garde donc la TEINTE et la SATURATION exactes du jeu, et on ne remonte
     que la luminosité, et UNIQUEMENT pour le texte : les anneaux de possession
     et les halos, eux, gardent la couleur brute — ce sont de larges aplats,
     ils n'ont pas ce problème. */
  var _cssCv = null;
  function readableTag(css, lVise) {
    if (!_cssCv) { _cssCv = document.createElement("canvas"); _cssCv.width = _cssCv.height = 1; }
    var x = _cssCv.getContext("2d", { willReadFrequently: true });
    x.clearRect(0, 0, 1, 1);
    x.fillStyle = "#000000";
    try { x.fillStyle = css; } catch (e) {}
    x.fillRect(0, 0, 1, 1);
    var d = x.getImageData(0, 0, 1, 1).data;
    var r = d[0]/255, g = d[1]/255, b = d[2]/255;
    var mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2, h = 0, sat = 0;
    if (mx !== mn) {
      var dd = mx - mn;
      sat = l > 0.5 ? dd/(2-mx-mn) : dd/(mx+mn);
      h = mx === r ? (g-b)/dd + (g<b ? 6:0) : mx === g ? (b-r)/dd + 2 : (r-g)/dd + 4;
      h /= 6;
    }
    /* lVise : luminosité voulue (0,62 par défaut ; la fiche au survol demande 0,74 — ses
       lignes sont en petit corps sur fond sombre, le bleu pur de HNU y restait illisible) */
    var L = lVise || 0.62;
    if (l >= L - 0.02) return css;             /* déjà assez clair : on n'y touche pas */
    return hslHex(h, sat, L);                  /* hex, jamais hsl : cf. tagColor */
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  function mapBox() {
    return document.getElementById("container") || document.querySelector(".map-container");
  }
  function nativeMap() {
    return document.getElementById("mapBackground");
  }

  /* ── Appui : click NE SUFFIT PAS dans l'app Android ────────────────────
     ⚠ Un script tiers de la page appelle preventDefault() sur touchstart.
     Android ne synthétise alors AUCUN événement click, et tout bouton câblé
     sur "click" reste définitivement inerte au doigt. Constaté en direct sur
     l'appareil (devtools) : pointerdown, touchstart, pointerup et touchend
     arrivent bien sur le bouton, click jamais, et le touchstart ressort
     defaultPrevented en fin de bouillonnement.
     On câble donc aussi pointerup, avec un garde anti-doublon pour la souris
     qui, elle, reçoit normalement son click. TOUT bouton de ce projet passe
     par ici — un seul câblé en "click" et il est mort sur mobile. */
  function onTap(el, fn) {
    if (!el) return;
    var t0 = 0, x0 = 0, y0 = 0, done = 0;
    el.addEventListener("pointerdown", function (e) {
      t0 = Date.now(); x0 = e.clientX; y0 = e.clientY;
    });
    el.addEventListener("pointerup", function (e) {
      if (e.pointerType === "mouse") return;      /* la souris a son click */
      if (Date.now() - t0 > 700) return;          /* appui long : pas un tap */
      if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12) return;
      done = Date.now();
      fn(e);
    });
    el.addEventListener("click", function (e) {
      if (Date.now() - done < 700) return;        /* déjà traité au doigt */
      fn(e);
    });
  }

  NS.COARSE = COARSE; NS.MOBILE = MOBILE;
  NS.FREE_HEX = FREE_HEX; NS.SOLO_HEX = SOLO_HEX; NS.UNKN_HEX = UNKN_HEX;
  NS.starIdx = starIdx; NS.starColor = starColor;
  NS.tagColor = tagColor; NS.hslHex = hslHex; NS.readableTag = readableTag;
  /* Le jeu sert les proprietaires sous la forme « Nom [TAG] » (ownerName de
     la page, owner des scans mobiles). On stocke le nom NU partout : le tag a
     sa propre propriete, et la fiche l'ajoute UNE fois — sinon elle affichait
     « Hyoga [ZOD] [ZOD] » (PC et mobile), et Ctrl+clic visait un profil
     « Hyoga [ZOD] » qui n'existe pas. */
  function bareOwner(n) { return String(n || "").replace(/\s*\[[^\]]*\]\s*$/, "").trim(); }
  NS.esc = esc; NS.onTap = onTap; NS.mapBox = mapBox; NS.nativeMap = nativeMap;
  NS.bareOwner = bareOwner;

  /* ══════════════════════════════════════════════════════════════════════
     2 · PIPELINE DE DONNÉES  (NS.data)
     ──────────────────────────────────────────────────────────────────────
     CE PIPELINE NE SE RÉÉCRIT PAS, IL SE RECOPIE. Chacune de ses fonctions
     encode une leçon payée cher — la forme des scans, ce qu'est une position
     valide, pourquoi on ne recalcule PAS le niveau de population. Il n'existe
     qu'à un seul exemplaire, partagé avec les calques 2D : deux copies, c'est
     la garantie qu'elles divergeront.
     ══════════════════════════════════════════════════════════════════════ */

  /* Repli si content.js n'a pas encore posé window.AW_MAP_DATA : on relit le
     `const mapData = {…}` que la page embarque dans son script module. */
  function parseInlineMapData() {
    var scripts = [].slice.call(document.querySelectorAll("script"));
    var src = null;
    for (var i = 0; i < scripts.length; i++) {
      var c = scripts[i].textContent || "";
      if (/(?:var|const|let)\s+mapData\s*=/.test(c)) { src = c; break; }
    }
    if (!src) return null;
    var m = src.match(/(?:var|const|let)\s+mapData\s*=\s*/);
    var start = src.indexOf("{", m.index + m[0].length - 1);
    if (start < 0) return null;
    var depth = 0, inStr = false, quote = "", esc2 = false, end = -1;
    for (var j = start; j < src.length; j++) {
      var ch = src[j];
      if (inStr) {
        if (esc2) esc2 = false;
        else if (ch === "\\") esc2 = true;
        else if (ch === quote) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (!depth) { end = j + 1; break; } }
    }
    if (end < 0) return null;
    try { return JSON.parse(src.substring(start, end)); }
    catch (e) { console.warn("[AW3D] mapData illisible:", e); return null; }
  }

  /* Les scans de l'extension (aw_solar_data) couvrent toute la carte, pas
     seulement le rectangle que la page vient de servir. On complète donc
     mapData avec les systèmes déjà scannés — c'est le même fonds que la barre
     « SOLAR n/m » de map-integrate.
     INVARIANT : storageGet NE REJETTE JAMAIS. Hors extension, en navigation
     privée, ou si chrome.storage disparaît en cours de route, elle rend {} —
     tout le pipeline en aval compte là-dessus et ne teste rien. */
  function storageGet(keys) {
    return new Promise(function (res) {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) return res({});
        chrome.storage.local.get(keys, function (r) { res(r || {}); });
      } catch (e) { res({}); }
    });
  }

  /* ── MÉMOIRE DES COULEURS D'ALLIANCE ──────────────────────────────────
     La couleur d'une alliance n'est déclarée que dans les secteurs SERVIS par
     la page, et la page ne sert qu'un rectangle autour de la vue. Selon l'endroit
     où l'on se trouve, la même alliance arrivait donc soit avec sa vraie couleur,
     soit sans couleur du tout — auquel cas on retombait sur le hachage, une
     autre teinte. D'un chargement à l'autre, les couleurs changeaient sans
     raison visible.
     On retient donc toute couleur officielle déjà rencontrée, et on la
     réutilise quand le secteur qui la déclare n'est pas servi. Une couleur
     officielle écrase toujours une couleur de hachage. */
  /* COL_MEM = couleurs OFFICIELLES du jeu déjà rencontrées (aw3d_game_colors).
     USER_COL = couleurs choisies par le joueur dans « Couleur par alliance »
     (aw_alliance_colors) : prioritaires, et la 3D ne les écrit plus JAMAIS —
     elle y rangeait les couleurs du jeu, ce qui écrasait les choix du joueur. */
  var COL_MEM = {}, COL_SALE = false, USER_COL = {}, USER_SALE = false, MIGRATION = false, USER_LU = false;
  /* `pretes` résout quand la mémoire est revenue du stockage. Sans elle, le
     premier readMapData() partait sur un COL_MEM vide et refabriquait des
     couleurs de hachage pour les alliances dont le secteur n'est pas servi :
     le piège n° 6 revenait une fois sur deux, au chargement le plus rapide. */
  var pretes = new Promise(function (res) {
    try {
      if (!window.chrome || !chrome.storage || !chrome.storage.local) return res();
      chrome.storage.local.get(["aw3d_game_colors", "aw_alliance_colors", "aw3d_colors_split"], function (r) {
        COL_MEM = (r && r.aw3d_game_colors) || {};
        USER_COL = (r && r.aw_alliance_colors) || {};
        USER_LU = true;
        if (!(r && r.aw3d_colors_split)) {
          /* première fois : aw_alliance_colors mélange choix du joueur et couleurs
             du jeu rangées par l'ancienne 3D. On les garde comme mémoire du jeu, et
             colorPour retire des choix celles que le jeu sert à l'identique. */
          Object.keys(USER_COL).forEach(function (t) { if (!COL_MEM[t]) COL_MEM[t] = USER_COL[t]; });
          MIGRATION = true;
        }
        res();
      });
    } catch (e) { res(); }
  });
  function memColor(tag, hex) {
    if (!tag || !hex || hex.charAt(0) !== "#") return;
    if (COL_MEM[tag] === hex) return;
    COL_MEM[tag] = hex; COL_SALE = true;
  }
  /* ordre : couleur choisie par le joueur → couleur servie par le jeu →
     couleur du jeu mémorisée → hachage du jeu */
  /* le menu « Couleur par alliance » range les tags en MAJUSCULES sans ponctuation
     (« FARt » servi par le jeu y devient « FART ») : recherche sans casse */
  function normTag(t) { return String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function userKey(tag, map) {
    if (!tag || !map) return null;
    if (map[tag]) return tag;
    var n = normTag(tag);
    if (map[n]) return n;
    for (var k in map) { if (map[k] && normTag(k) === n) return k; }
    return null;
  }
  function userColor(tag, map) {
    map = map || USER_COL;
    var k = userKey(tag, map), v = k ? map[k] : null;
    return (v && String(v).charAt(0) === "#") ? v : null;
  }
  function colorPour(tag, servie) {
    var officielle = (servie && servie.charAt(0) === "#") ? servie : null;
    if (officielle) {
      memColor(tag, officielle);
      /* un « choix » identique à la couleur servie n'en est pas un : l'ancienne 3D
         rangeait les couleurs du jeu dans les choix, pour chaque alliance croisée.
         On le retire à chaque passage — la 3D suivra le jeu si l'alliance change
         de couleur, et le menu n'affiche plus ↺ pour rien. */
      var k = userKey(tag, USER_COL);
      if (k && String(USER_COL[k]).toLowerCase() === officielle.toLowerCase()) {
        delete USER_COL[k]; USER_SALE = true;
      }
    }
    return userColor(tag) || officielle || COL_MEM[tag] || tagColor(tag);
  }
  function rangerCouleurs() {
    var o = {};
    if (COL_SALE) { COL_SALE = false; o.aw3d_game_colors = COL_MEM; }
    if (USER_SALE) { USER_SALE = false; o.aw_alliance_colors = USER_COL; }
    if (MIGRATION) { MIGRATION = false; o.aw3d_colors_split = true; }
    if (Object.keys(o).length) { try { chrome.storage.local.set(o); } catch (e) {} }
  }
  /* un choix fait dans « Couleur par alliance » s'applique à la prochaine ouverture de la 3D */
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === "local" && ch.aw_alliance_colors) { USER_COL = ch.aw_alliance_colors.newValue || {}; USER_LU = true; }
    });
  } catch (e) {}

  function mergeScans(data, store) {
    var solar = store.aw_solar_data || [];
    var known = store.aw_map_data || [];
    var extra = store.aw_alliance_colors || {};
    /* Niveaux OFFICIELS relevés lors des visites précédentes de /Game/Map
       (open() les archive). Seule source valable pour un système que la page
       ne sert pas aujourd'hui. */
    var lvls = store.aw_system_levels || {};
    /* couleurs choisies par le joueur : elles passent devant tout (y compris la couleur servie).
       USER_COL une fois la mémoire revenue (colorPour y a retiré les faux choix),
       sinon ce que le stockage donnait à l'ouverture. */
    var choix = USER_LU ? USER_COL : extra;
    Object.keys(data.colors).forEach(function (t) {
      var u = userColor(t, choix);
      if (u) data.colors[t] = u;
    });
    Object.keys(choix).forEach(function (t) {
      var u = userColor(t, choix);
      if (u && !userKey(t, data.colors)) data.colors[t] = u;
    });

    var have = {};
    data.systems.forEach(function (s) { have[String(s.id)] = s; });

    /* lignes de scan groupées par système */
    var bySys = {};
    solar.forEach(function (row) {
      var id = String(row.systemId || "");
      if (!id || have[id]) return;              /* le live fait foi */
      (bySys[id] || (bySys[id] = [])).push(row);
    });

    /* position : la ligne de scan, sinon l'index carte. L'index est bâti sur
       le SEUL systemId : le repli sur le nom du système indexait la position
       sous une clé que personne ne relit jamais (tout le reste lit par id). */
    var pos = {};
    known.forEach(function (m) {
      var id = String(m.systemId || "");
      if (id) pos[id] = {x: +m.x, y: +m.y, name: m.system || ""};
    });

    var num = function (v) { var n = parseInt(String(v).replace(/[^\d-]/g, ""), 10); return isNaN(n) ? 0 : n; };

    Object.keys(bySys).forEach(function (id) {
      var rows = bySys[id];
      var r0 = rows[0];
      /* 0/0 est une VRAIE position (le centre, ex. Rana) : on ne jette que
         si la coordonnée est absente du scan ET de l'index carte */
      var hasPos = /-?\d/.test(String(r0.x)) && /-?\d/.test(String(r0.y));
      var x = num(r0.x), y = num(r0.y);
      if (!hasPos && pos[id] && isFinite(pos[id].x) && isFinite(pos[id].y)) {
        x = pos[id].x; y = pos[id].y; hasPos = true;
      }
      if (!hasPos) return;                      /* sans position, on ne peut rien poser */

      var planets = [], seenIdx = {};
      rows.forEach(function (row) {
        var idx = num(row.planetIndex);
        if (!idx || seenIdx[idx]) return;
        seenIdx[idx] = 1;
        var owner = bareOwner(row.owner);
        var tag = (row.alliance || "").trim();
        /* les scans gardent les libellés du jeu : « Free Planet » = libre, « Unknown » = hors
           vision. Pris pour des noms, ils faisaient des planètes « solo » (fiche, anneau, colons). */
        var libre = !owner || /^free planet$/i.test(owner), inconnue = /^unknown$/i.test(owner);
        planets.push({
          id: null, idx: idx, name: (row.system || "") + " #" + idx,
          state: libre ? "free" : inconnue ? "unknown" : (tag ? "held" : "solo"),
          tag: libre || inconnue ? "" : tag,
          owner: libre ? "Planète libre" : inconnue ? "Inconnu" : owner, ownerId: null,
          pop: num(row.population), sb: num(row.starbase), siege: false
        });
      });
      for (var k = 1; k <= 12; k++) {
        if (seenIdx[k]) continue;
        planets.push({id:null, idx:k, name:"", state:"unknown", tag:"", owner:"Inconnu",
                      ownerId:null, pop:0, sb:0, siege:false});
      }
      planets.sort(function (a, b) { return a.idx - b.idx; });

      var counts = {}, pop = 0, sbMax = 0, owners = {}, knownPl = 0;
      planets.forEach(function (pl) {
        counts[pl.tag || pl.state] = (counts[pl.tag || pl.state] || 0) + 1;
        pop += pl.pop; sbMax = Math.max(sbMax, pl.sb);
        if (pl.state !== "unknown") knownPl++;
        if (pl.state === "held" || pl.state === "solo") owners[pl.owner] = 1;
      });
      var dom = null, best = 0;
      Object.keys(counts).forEach(function (t) {
        if (t && t !== "free" && t !== "unknown" && t !== "solo" && counts[t] > best) { best = counts[t]; dom = t; }
      });
      /* ⚠ tagColor et NON un gris fixe. Une alliance dont le secteur servi ne
         déclare pas la couleur retombait sur #94a3b8 : sur la carte complète,
         où la plupart des systèmes viennent des scans, TOUS prenaient le même
         gris. Les zones n'y voyaient donc qu'une seule alliance et traçaient un
         unique contour gris autour de l'ensemble — les deux symptômes constatés
         n'avaient qu'une seule cause. */
      var hex = dom ? (data.colors[dom] || (data.colors[dom] = colorPour(dom, null)))
        : counts.solo ? SOLO_HEX : counts.unknown && !counts.free ? UNKN_HEX : FREE_HEX;

      data.systems.push({
        id: id, name: r0.system || (pos[id] && pos[id].name) || ("Système " + id),
        cx: x, cy: y,
        sector: Math.floor(x / data.sectorSize) + "/" + Math.floor(y / data.sectorSize),
        tag: dom || "", hex: hex, planets: planets,
        /* ⚠ NE PAS inventer le niveau du système à partir des scans. La
           moyenne des populations de planètes connues (ce qui était fait ici)
           n'est PAS la même grandeur que le populationLevel du jeu : elle
           montait à 3, 4, 6 pendant que TOUS les systèmes servis par la page
           étaient à 0 ou 1, et ces systèmes-là s'allumaient en vert ou en
           violet sur la carte 3D alors qu'ils sont gris dans le vrai jeu.
           On prend le niveau officiel s'il a été relevé lors d'une visite
           précédente, sinon 0 — gris, comme un système dont on ne sait rien.
           La moyenne reste disponible sous scanAvg pour la fiche. */
        pop: pop, popLevel: Math.max(0, Math.min(8, +lvls[id] || 0)),
        scanAvg: Math.max(0, Math.min(8, Math.round(pop / Math.max(1, knownPl)))),
        sbMax: sbMax,
        owners: Object.keys(owners), inVision: false, fromScan: true,
        isMine: false, hasAlly: !!(data.myTag && counts[data.myTag]),
        hasEnemy: Object.keys(counts).some(function (t) {
          return t && t !== "free" && t !== "unknown" && t !== data.myTag;
        })
      });
    });

    /* Les systèmes connus mais jamais scannés (aw_map_data) : on les pose
       quand même, en « non scanné » — c'est la carte du jeu, pas seulement
       ce qu'on a fouillé. */
    var placed = {};
    data.systems.forEach(function (s) { placed[String(s.id)] = 1; placed[s.cx + "," + s.cy] = 1; });
    known.forEach(function (m) {
      var id = String(m.systemId || "");
      var x = num(m.x), y = num(m.y);
      if ((!x && !y) || placed[id] || placed[x + "," + y]) return;
      placed[id] = 1; placed[x + "," + y] = 1;
      var planets = [];
      for (var k = 1; k <= 12; k++) {
        planets.push({id:null, idx:k, name:"", state:"unknown", tag:"", owner:"Inconnu",
                      ownerId:null, pop:0, sb:0, siege:false});
      }
      data.systems.push({
        id: id || (x + "/" + y), name: m.system || ("Système " + (id || x + "/" + y)),
        cx: x, cy: y,
        sector: Math.floor(x / data.sectorSize) + "/" + Math.floor(y / data.sectorSize),
        tag: "", hex: UNKN_HEX, planets: planets,
        pop: 0, popLevel: 0, sbMax: 0, owners: [], inVision: false, fromScan: true,
        isMine: false, hasAlly: false, hasEnemy: false
      });
    });

    return data;
  }

  /* Le calque flottes de l'extension garde en cache ce qu'il a vu en orbite
     de chaque système (aw_map_fleets_cache) : c'est ce que montre l'info-bulle
     de la carte du jeu, on le reprend dans la fiche. */
  function mergeOrbits(data, store) {
    var c = store.aw_map_fleets_cache;
    if (!c || !c.systems) return data;
    data.orbitsAt = {};
    Object.keys(c.systems).forEach(function (id) {
      var f = (c.systems[id] || {}).fleets || [];
      if (f.length) data.orbitsAt[String(id)] = f;
    });
    return data;
  }

  function readMapData() {
    var md = window.AW_MAP_DATA;
    if (!md || !md.sectors) md = parseInlineMapData();
    if (!md || !md.sectors) return null;

    var colors = {}, systems = [], seen = {};
    (md.sectors || []).forEach(function (sec) {
      (sec.alliances || []).forEach(function (a) {
        /* ⚠ La couleur du jeu, TELLE QUELLE. boost() éclaircissait toute
           couleur de luminance < 0,34 : le bleu pur de HNU (#0000FF), l'indigo
           de FARt (#4B0082) et le rouge de RAID (#FF0000) ressortaient délavés
           et ne correspondaient plus à la carte 2D. Le jeu, lui, peint ses
           <text> avec le hex brut. Sans couleur déclarée, on retombe sur le
           même hachage que lui (tagColor). C'est pour ça que boost() n'existe
           plus : plus aucun appelant, et la moindre reprise le ferait revenir.
           Premier non-nul gagnant : une alliance peut apparaître dans
           plusieurs secteurs, dont certains sans couleur. */
        if (a && a.tag && !colors[a.tag]) colors[a.tag] = colorPour(a.tag, a.color);
      });
    });

    (md.sectors || []).forEach(function (sec) {
      (sec.solarSystems || []).forEach(function (s) {
        if (!s || seen[s.id]) return;
        seen[s.id] = 1;
        /* un tag vu ici mais dont aucun secteur servi ne déclare la couleur
           récupère celle qu'on a mémorisée lors d'une visite précédente */
        (s.systemOwnerships || []).forEach(function (o5) {
          if (o5 && o5.allianceTag && !colors[o5.allianceTag])
            colors[o5.allianceTag] = colorPour(o5.allianceTag, null);
        });

        var planets = (s.planets || []).map(function (p) {
          var state = p.isUnknownOwner ? "unknown"
            : (!p.ownerId && (p.ownerName === "Free Planet" || !p.ownerName)) ? "free"
            : p.allianceTag ? "held" : "solo";
          return {
            id: p.id, idx: p.index, name: p.name,
            state: state,
            tag: p.allianceTag || "",
            owner: bareOwner(p.ownerName) || (state === "free" ? "Planète libre" : "Inconnu"),
            ownerId: p.ownerId || null,
            pop: p.populationLevel || 0,
            sb: p.starbaseLevel || 0,
            siege: !!p.hasSiege
          };
        }).sort(function (a, b) { return a.idx - b.idx; });

        /* tag dominant : l'alliance qui tient le plus de planètes,
           exactement comme systemOwnerships */
        var counts = {}, pop = 0, sbMax = 0, owners = {};
        planets.forEach(function (p) {
          counts[p.tag || p.state] = (counts[p.tag || p.state] || 0) + 1;
          pop += p.pop; sbMax = Math.max(sbMax, p.sb);
          if (p.state === "held" || p.state === "solo") owners[p.owner] = (owners[p.owner] || 0) + 1;
        });
        var dom = null, best = 0;
        Object.keys(counts).forEach(function (k) {
          if (k && k !== "free" && k !== "unknown" && k !== "solo" && counts[k] > best) { best = counts[k]; dom = k; }
        });
        var hex = dom ? (colors[dom] || tagColor(dom))
          : counts.solo ? SOLO_HEX
          : counts.unknown && !counts.free ? UNKN_HEX : FREE_HEX;

        /* toutes les alliances présentes (étiquette au-dessus de l'anneau) :
           systemOwnerships d'abord — souvent renseigné quand planets ne l'est
           pas (simple vision), c'est déjà lui qui colore le donut */
        var atags = {}, aord = [];
        (s.systemOwnerships || []).forEach(function (o) {
          if (!o.allianceTag) return;
          if (!(o.allianceTag in atags)) aord.push(o.allianceTag);
          atags[o.allianceTag] = (atags[o.allianceTag] || 0) + (o.planetCount || 1);
        });
        if (!aord.length) planets.forEach(function (p) {
          if (!p.tag) return;
          if (!(p.tag in atags)) aord.push(p.tag);
          atags[p.tag] = (atags[p.tag] || 0) + 1;
        });
        aord.sort(function (a, b) { return atags[b] - atags[a]; });
        if (!dom && aord.length) { dom = aord[0]; hex = colors[dom] || tagColor(dom); }

        systems.push({
          id: s.id, name: s.name, cx: s.x, cy: s.y,
          sector: Math.floor(s.x / (md.sectorSize || 10)) + "/" + Math.floor(s.y / (md.sectorSize || 10)),
          tag: dom || "", atags: aord, hex: hex, planets: planets,
          /* la possession telle que le jeu la sert : c'est elle qui colore le
             donut de la carte 2D, souvent renseignée même quand planets ne
             l'est pas (simple vision) */
          owns: s.systemOwnerships || null,
          pop: pop, popLevel: s.populationLevel || 0, sbMax: sbMax,
          owners: Object.keys(owners).sort(function (a, b) { return owners[b] - owners[a]; }),
          inVision: s.isInVision !== false,
          capturedAt: s.capturedAt || null
        });
      });
    });

    var me = md.player || {};
    var myTag = me.allianceTag || null;
    rangerCouleurs();
    systems.forEach(function (s) {
      s.isMine = s.planets.some(function (p) { return p.ownerId && me.id && p.ownerId === me.id; });
      s.hasAlly = !!myTag && s.planets.some(function (p) { return p.tag === myTag; });
      s.hasEnemy = s.planets.some(function (p) {
        return (p.state === "held" && p.tag !== myTag) || (p.state === "solo" && (!me.id || p.ownerId !== me.id));
      });
    });

    return {
      systems: systems,
      colors: colors,
      player: me,
      myTag: myTag,
      origin: md.playerOrigin || {x: 0, y: 0},
      spiral: md.spiralPosition || null,
      vision: md.vision || 15,
      sectorSize: md.sectorSize || 10,
      fleets: md.fleets || [],
      center: md.center || {x: 0, y: 0}
    };
  }

  /* ── INVARIANT DE FORME D'UN SYSTÈME ──────────────────────────────────
     Deux origines, deux formes, et tout le rendu en dépend :
       · système SERVI PAR LA PAGE : porte `atags` (tous les tags présents),
         `owns` (systemOwnerships, renseigné même en simple vision) et
         `capturedAt` ; `planets` peut être VIDE — c'est justement pour ça
         qu'`owns` existe.
       · système VENANT DES SCANS (fromScan:true) : porte TOUJOURS ses 12
         planètes (les manquantes sont remplies en "unknown"), et ni `atags`,
         ni `owns`, ni `capturedAt`.
     Écrire cet invariant ici remplace les six gardes défensives qui étaient
     disséminées dans le rendu, et qui masquaient surtout les vraies erreurs. */

  /* ── snapshot() : le point d'entrée unique ────────────────────────────
     Un mémo court, parce que les DEUX calques 2D redemandent les données à
     chaque détection de changement d'échelle : sans lui, un cran de zoom
     rejouait quatre pipelines complets (readMapData + storageGet + mergeScans,
     deux fois). Les données de la page ne changent pas sans rechargement, le
     mémo ne peut donc pas servir du périmé. */
  var MEMO_MS = 30000;
  var _memo = {};        /* clé → {t, data} */
  var _vol = {};         /* clé → promesse en vol, pour ne pas doubler le travail */

  function snapshot(opts) {
    opts = opts || {};
    var orbits = opts.orbits !== false, alliance = opts.alliance !== false;
    var cle = (orbits ? "o" : "-") + (alliance ? "a" : "-");
    var e = _memo[cle];
    if (e && Date.now() - e.t < MEMO_MS && !opts.force) return Promise.resolve(e.data);
    if (_vol[cle]) return _vol[cle];
    _vol[cle] = construire(orbits, alliance, opts).then(function (d) {
      _vol[cle] = null;
      if (d) _memo[cle] = { t: Date.now(), data: d };
      return d;
    }, function (err) {
      _vol[cle] = null;
      throw err;
    });
    return _vol[cle];
  }

  /* ── Édition communauté : galaxie complète (voir tools/galaxie_complete.py) ── */
  var GALAXY_KEY = "aw3d_galaxy", GALAXY_TTL = 15 * 60 * 1000;
  async function galaxieComplete() {
    var live = (window.AW_MAP_DATA && window.AW_MAP_DATA.sectors) ? window.AW_MAP_DATA : parseInlineMapData();
    if (!live || !live.sectors) return;
    var cache = (await storageGet([GALAXY_KEY]))[GALAXY_KEY];
    var sectors = (cache && cache.ts && Date.now() - cache.ts < GALAXY_TTL && Array.isArray(cache.sectors)) ? cache.sectors : null;
    if (!sectors) {
      var r = await fetch("/api/v1/Map/sectors?x1=-60&y1=-60&x2=60&y2=60",
        { credentials: "same-origin", headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
      if (!r.ok) return;
      var got = await r.json();
      sectors = Array.isArray(got) ? got : ((got && got.sectors) || []);
      if (!sectors.length) return;
      try { var o = {}; o[GALAXY_KEY] = { ts: Date.now(), sectors: sectors }; chrome.storage.local.set(o); } catch (e) {}
    }
    var byId = {};
    sectors.forEach(function (sec) { if (sec && sec.id != null) byId[sec.id] = sec; });
    live.sectors.forEach(function (sec) { if (sec && sec.id != null) byId[sec.id] = sec; });   /* le direct fait foi */
    window.AW_MAP_DATA = Object.assign({}, live, { sectors: Object.keys(byId).map(function (k) { return byId[k]; }) });
  }

  async function construire(orbits, alliance, opts) {
    var dire = opts.onMsg || function () {};
    /* la mémoire des couleurs d'abord : cf. `pretes` et le piège n° 6 */
    /* ⚠ garde-fou de temps : `pretes` ne se résout que dans le rappel de
       chrome.storage.local.get. Si ce rappel ne revient jamais (extension
       rechargée sous les pieds, contexte invalidé), l'ouverture de la vue
       resterait bloquée pour toujours. On attend au plus une seconde, puis on
       continue sans la mémoire des couleurs : la carte est juste moins stable
       en teintes, elle n'est pas morte. */
    await Promise.race([pretes, new Promise(function (r) { setTimeout(r, 1000); })]);
    try { await galaxieComplete(); } catch (e) { console.warn("[AW3D] galaxie complète KO:", e); }
    var data = readMapData();
    if (!data) return null;

    var store = await storageGet(["aw_solar_data", "aw_map_data", "aw_alliance_colors",
                                  "aw_map_fleets_cache", "aw_system_levels"]);

    try { mergeScans(data, store); } catch (e) { console.warn("[AW3D] fusion des scans KO:", e); }
    if (alliance) {
      /* Les vols (ma page Flottes, Holocron, puis un player-detail par vol)
         coutaient jusqu'a une dizaine de requetes AVANT le premier rendu :
         la carte mettait des secondes a s'ouvrir. Ils sont maintenant
         charges apres coup, et la carte les ajoute quand ils arrivent
         (NS.onFleetsLate -> app.refreshFleets). */
      setTimeout(async function () {
        try { await flottesPropres(data); } catch (e) { console.warn("[AW3D] mes flottes KO:", e); }
        try { if (NS.onFleetsLate) NS.onFleetsLate(); } catch (e) {}
      }, 0);
    }
    if (orbits) {
      try { mergeOrbits(data, store); } catch (e) { console.warn("[AW3D] fusion des orbites KO:", e); }
    }
    var nScan = data.systems.filter(function (s2) { return s2.fromScan; }).length;
    console.info("[AW3D] systèmes posés:", data.systems.length,
      "(" + (data.systems.length - nScan) + " servis par la page + " + nScan + " des scans)");

    /* niveaux officiels (populationLevel du jeu) persistés pour que la vue
       système (solar3d) affiche EXACTEMENT la même couleur d'étoile */
    try {
      var lvls = {};
      data.systems.forEach(function (s2) { if (!s2.fromScan) lvls[String(s2.id)] = s2.popLevel || 0; });
      chrome.storage.local.get(["aw_system_levels"], function (r2) {
        var cur = r2.aw_system_levels || {};
        Object.keys(lvls).forEach(function (k2) { cur[k2] = lvls[k2]; });
        chrome.storage.local.set({ aw_system_levels: cur });
      });
    } catch (e) {}
    return data;
  }

  /* Édition communauté : aucun jeton, aucune requête vers un serveur. */
  function authHeaders() { return {}; }
  /* ── MES FLOTTES EN VOL ────────────────────────────────────────────────
     mapData.fleets (la carte du jeu) ne contient PAS les flottes du joueur :
     verifie le 2026-09-09 avec 3 CS en vol vers Al Bali #12 et un
     `"fleets":[]` dans la page. Elles ne sont listees que sur /Game/Fleets :
     destination (lien /Game/Map/SolarSystem/{sys}/{planete}), vaisseaux, CV
     et ETA « 21:36:31 - sept. 09 ». Ni origine ni heure de depart : on prend
     pour origine MON systeme le plus proche de la cible (a defaut l'origine
     du joueur) et on estime le depart a ETA - distance x 1,35 h, le meme
     bareme que buildFleets faute d'horaires. La parabole est donc juste, la
     position de la tete est une estimation. Une requete par ouverture, memo
     60 s. */
  var _ownFleetsMem = { t: 0, list: null };
  var MOIS = { jan: 0, janv: 0, feb: 1, fev: 1, "f\u00e9v": 1, "f\u00e9vr": 1, mar: 2, mars: 2, apr: 3, avr: 3,
               may: 4, mai: 4, jun: 5, juin: 5, jul: 6, juil: 6, aug: 7, "ao\u00fb": 7, "ao\u00fbt": 7,
               sep: 8, sept: 8, oct: 9, nov: 10, dec: 11, "d\u00e9c": 11 };
  function parseEta(txt) {
    var m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(txt || "");
    if (!m) return null;
    var h = +m[1], mi = +m[2], se = +(m[3] || 0);
    if (m[4]) { var pm = /pm/i.test(m[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    var rest = (txt || "").replace(m[0], " ");
    var mo = null, d = null;
    var w = /([A-Za-z\u00e0-\u00ff]{3,5})\.?/.exec(rest);
    if (w) { var k = w[1].toLowerCase(); if (k in MOIS) mo = MOIS[k]; }
    var dn = /\b(\d{1,2})\b/.exec(rest);
    if (dn) d = +dn[1];
    var now = new Date();
    if (mo === null || d === null) {
      /* pas de date lisible : aujourd'hui, ou demain si l'heure est passee */
      var t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi, se);
      if (t.getTime() < now.getTime() - 3600e3) t.setDate(t.getDate() + 1);
      return t;
    }
    var dt = new Date(now.getFullYear(), mo, d, h, mi, se);
    if (dt.getTime() < now.getTime() - 180 * 86400e3) dt.setFullYear(dt.getFullYear() + 1);
    return dt;
  }
  async function flottesPropres(data) {
    if (!data || !data.player) return;
    var list = _ownFleetsMem.list;
    if (!list || Date.now() - _ownFleetsMem.t > 60e3) {
      /* ⚠ XHR et non fetch : dans la WebView du mod Android, fetch() d'une
         PAGE du jeu ne se resout jamais (teste par CDP le 2026-09-09 : fetch
         « TIMEOUT 8 s », XHR 200 en 16 Ko sur la meme URL) — l'intercepteur
         natif du mod ne rend pas la main sur ces requetes. XHR marche partout. */
      var html = await new Promise(function (res, rej) {
        try {
          var x = new XMLHttpRequest();
          x.open("GET", "/Game/Fleets", true);
          x.timeout = 15000;
          x.onload = function () { x.status >= 200 && x.status < 300 ? res(x.responseText) : rej(new Error("HTTP " + x.status)); };
          x.onerror = function () { rej(new Error("reseau")); };
          x.ontimeout = function () { rej(new Error("timeout")); };
          x.send();
        } catch (e) { rej(e); }
      });
      var doc = new DOMParser().parseFromString(html, "text/html");
      list = [];
      var rows = doc.querySelectorAll("tr");
      for (var i = 0; i < rows.length; i++) {
        var tr = rows[i];
        var a = tr.querySelector('a[href*="/Game/Map/SolarSystem/"]');
        if (!a) continue;
        var tds = tr.querySelectorAll("td");
        if (tds.length < 8) continue;
        var last = (tds[tds.length - 1].textContent || "").trim();
        if (!/\d{1,2}:\d{2}/.test(last)) continue;      /* au sol : « Launch Loop BC TT » */
        var hm = /\/Game\/Map\/SolarSystem\/(\d+)(?:\/(\d+))?/.exec(a.getAttribute("href") || "");
        var xy = /\((-?\d+)\s*\/\s*(-?\d+)\)/.exec(a.textContent || "");
        var num = function (n) { return parseInt((tds[n].textContent || "").replace(/[^\d-]/g, ""), 10) || 0; };
        list.push({
          sysId: hm ? +hm[1] : null, planetIdx: hm && hm[2] ? +hm[2] : null,
          tx: xy ? +xy[1] : null, ty: xy ? +xy[2] : null,
          targetName: (tds[1].textContent || "").trim(),
          ships: { TR: num(2), CS: num(3), DS: num(4), CR: num(5), BS: num(6) },
          cv: num(7), eta: parseEta(last)
        });
      }
      _ownFleetsMem = { t: Date.now(), list: list };
    }
    if (!list.length) return;
    var me = data.player, mine = data.systems.filter(function (s2) { return s2.isMine; });
    data.fleets = data.fleets || [];
    var have = {};
    data.fleets.forEach(function (f) { if (f.id != null) have[String(f.id)] = 1; });
    list.forEach(function (o, i) {
      if (o.tx === null || !o.eta) return;
      /* origine : mon systeme le plus proche de la cible (autre que la cible) */
      var from = null, bd = Infinity;
      mine.forEach(function (s2) {
        if (s2.id === o.sysId) return;
        var d = Math.max(Math.abs(s2.cx - o.tx), Math.abs(s2.cy - o.ty));
        if (d < bd) { bd = d; from = s2; }
      });
      if (!from && data.origin && (+data.origin.x || +data.origin.y)) from = { cx: +data.origin.x, cy: +data.origin.y, name: "" };
      if (!from) return;
      var dist = Math.hypot(o.tx - from.cx, o.ty - from.cy);
      /* depart estime : ETA - distance x 1,35 h ; mais si ce calcul tombe dans
         le FUTUR (vaisseaux lents, ex. colons), la flotte vient de partir :
         on la pose a 10 min du depart plutot qu'au point d'origine */
      var arr = o.eta.getTime();
      var durH = o.ttHours != null ? o.ttHours : Math.max(0.5, dist * 1.35);
      var launch = arr - durH * 3600e3;
      /* si le depart calcule est dans le futur, la duree est surestimee :
         on pose la flotte a 10 min du depart plutot que sur l'origine */
      if (launch > Date.now() - 10 * 60e3) launch = Date.now() - 10 * 60e3;
      var id = "own-" + o.sysId + "-" + (o.planetIdx || 0) + "-" + Math.round(arr / 60000);
      if (have[id]) return;
      data.fleets.push({
        id: id, relation: "own",
        ownerName: me.name || "", allianceTag: me.allianceTag || data.myTag || "",
        originName: from.name || "", targetName: o.targetName,
        originPosition: { x: from.cx, y: from.cy }, targetPosition: { x: o.tx, y: o.ty },
        launchTime: new Date(launch).toISOString(), arrivalTime: new Date(arr).toISOString(),
        ships: Object.keys(o.ships).filter(function (k) { return o.ships[k] > 0; })
          .map(function (k) { return { name: k, count: o.ships[k] }; }),
        combatValue: o.cv, estimatedOrigin: true
      });
    });
    console.info("[AW3D] mes flottes en vol (/Game/Fleets):", list.length);
  }
  /* Édition communauté : pas de flottes alliées ni de scans d'alliance (Holocron). */

  NS.data = {
    snapshot: snapshot,
    pretes: pretes,
    readMapData: readMapData,
    mergeScans: mergeScans,
    mergeOrbits: mergeOrbits,
    storageGet: storageGet,
    colorPour: colorPour,
    rangerCouleurs: rangerCouleurs
  };
  NS.loaded.push("data");

  /* Mauvaise page : le socle et le pipeline sont publiés (d'autres scripts de
     l'extension s'en servent), mais on ne monte aucune interface. */
  if (!NS.active) return;

  /* ══════════════════════════════════════════════════════════════════════
     3 · L'INTERFACE — feuille de style, hôte, panneau de réglages
     ──────────────────────────────────────────────────────────────────────
     La 3D prend la place de la carte DANS son bloc d'origine (#container) :
     la navigation, la barre d'outils et les compteurs du jeu restent autour.
     Les réglages vivent HORS du bloc de la carte : une fenêtre flottante
     ancrée au body, déplaçable par son en-tête (position mémorisée),
     rétractable, calquée sur #awm-bar / .map-toolbar du jeu.
     ══════════════════════════════════════════════════════════════════════ */

  var HOST_ID = "aw3d-host", COLLAPSE_KEY = "aw3d_panel_collapsed",
      POS_KEY = "aw3d_panel_pos";

  function css() {
    if (document.getElementById("aw3d-css")) return;
    var st = document.createElement("style");
    st.id = "aw3d-css";
    st.textContent = [
      "#aw3d-host{position:absolute;inset:0;z-index:20;background:#04050c;display:none;overflow:hidden;}",
      "#aw3d-host.on{display:block;}",
      "#aw3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none;}",
      "#aw3d-canvas.dragging{cursor:grabbing;}",
      "#aw3d-host .aw3d-vig{position:absolute;inset:0;pointer-events:none;",
      "  background:radial-gradient(ellipse 90% 75% at 50% 50%,transparent 40%,rgba(4,5,12,.5) 100%);}",

      /* panneau de réglages — fenêtre FLOTTANTE déplaçable (hors du bloc map),
         même coquille que #awm-bar / .map-toolbar du jeu ; on la saisit par
         son en-tête, la position est mémorisée */
      /* width en min() : sur un téléphone 280 px couvriraient presque tout
         l'écran, on laisse toujours une marge pour voir la carte derrière */
      "#aw3d-panel{display:none;position:fixed;top:110px;right:16px;width:min(300px,calc(100vw - 24px));z-index:2147483000;",
      "  --p3-acc:#ffb347;--p3-ink:#1a0d05;background:rgba(22,22,26,.96);border:1px solid rgba(255,255,255,.12);",
      "  border-radius:10px;color:#fff;font-family:inherit;font-size:.8125rem;overflow:hidden;",
      "  box-shadow:0 18px 50px -12px rgba(0,0,0,.85);}",
      "#aw3d-panel.on{display:block;}",
      "#aw3d-panel .aw3d-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:move;user-select:none;",
      "  touch-action:none;border-bottom:1px solid rgba(255,255,255,.08);}",
      "#aw3d-panel.collapsed .aw3d-head{border-bottom:none;}",
      "#aw3d-panel .aw3d-title{font-size:.8rem;font-weight:700;color:#fff;white-space:nowrap;}",
      "#aw3d-panel .aw3d-title i{color:var(--p3-acc);margin-right:3px;}",
      "#aw3d-panel .aw3d-stats{margin-left:auto;display:flex;gap:8px;font-size:.66rem;color:rgba(255,255,255,.45);",
      "  font-variant-numeric:tabular-nums;white-space:nowrap;}",
      "#aw3d-panel .aw3d-stats b{color:rgba(255,255,255,.88);font-weight:600;}",
      "#aw3d-panel .aw3d-caret{color:rgba(255,255,255,.5);font-size:.7rem;}",
      "#aw3d-panel .aw3d-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:12px;",
      "  max-height:min(66vh,560px);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;}",
      "#aw3d-panel.collapsed .aw3d-body{display:none;}",
      "#aw3d-panel .aw3d-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:3px;border-radius:9px;",
      "  background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.08);}",
      "#aw3d-panel .aw3d-tab{cursor:pointer;border:0;border-radius:7px;background:transparent;color:rgba(255,255,255,.6);",
      "  font:inherit;font-size:.75rem;font-weight:700;padding:5px 0;touch-action:manipulation;}",
      "#aw3d-panel .aw3d-tab:hover{color:#fff;}",
      "#aw3d-panel .aw3d-tab[aria-selected=true]{background:rgba(255,255,255,.14);color:#fff;}",
      "#aw3d-panel .aw3d-pane{display:flex;flex-direction:column;gap:13px;}",
      "#aw3d-panel .aw3d-pane[hidden]{display:none;}",
      "#aw3d-panel .aw3d-grp{display:flex;flex-direction:column;gap:7px;}",
      "#aw3d-panel .aw3d-lab{font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.42);font-weight:700;}",
      "#aw3d-panel .aw3d-row{display:flex;flex-wrap:wrap;gap:5px;}",
      ".aw3d-chip{cursor:pointer;font-size:.72rem;padding:4px 10px;border-radius:999px;touch-action:manipulation;font-family:inherit;",
      "  border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.8);background:rgba(255,255,255,.05);}",
      ".aw3d-chip:hover{border-color:rgba(255,255,255,.42);color:#fff;}",
      "#aw3d-save.dirty{border-color:#ffb347;color:#ffb347;}",
      ".aw3d-chip[aria-pressed=true]{background:var(--p3-acc,#ffb347);border-color:var(--p3-acc,#ffb347);color:var(--p3-ink,#1a0d05);font-weight:700;}",
      "#aw3d-panel .aw3d-search{position:relative;}",
      "#aw3d-panel .aw3d-search i{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:.72rem;",
      "  color:rgba(255,255,255,.45);pointer-events:none;}",
      "#aw3d-panel input[type=text]{width:100%;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);border-radius:8px;",
      "  color:#fff;padding:6px 8px 6px 27px;font-size:.76rem;outline:none;font-family:inherit;}",
      "#aw3d-panel input[type=text]:focus{border-color:var(--p3-acc);}",
      "#aw3d-panel .aw3d-filters{display:grid;grid-template-columns:1fr 1fr;gap:5px;}",
      "#aw3d-panel .aw3d-filters label{display:flex;align-items:center;gap:6px;font-size:.72rem;color:rgba(255,255,255,.8);",
      "  cursor:pointer;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);}",
      "#aw3d-panel .aw3d-filters label:has(input:checked){border-color:var(--p3-acc);color:#fff;",
      "  background:color-mix(in srgb,var(--p3-acc) 16%,transparent);}",
      "#aw3d-panel .aw3d-filters input{accent-color:var(--p3-acc);margin:0;}",
      "#aw3d-panel .aw3d-bgs .aw3d-chip{display:inline-flex;align-items:center;gap:6px;}",
      "#aw3d-panel .aw3d-bgs .aw3d-chip::before{content:'';width:12px;height:12px;border-radius:50%;flex:none;",
      "  border:1px solid rgba(255,255,255,.28);background:#223;}",
      "#aw3d-panel [data-bg=spirale]::before{background:radial-gradient(circle at 40% 40%,#ffd9a0,#b0552a 45%,#1a1030 78%);}",
      "#aw3d-panel [data-bg=barree]::before{background:linear-gradient(120deg,#1a1030 30%,#e8a060 50%,#1a1030 70%);}",
      "#aw3d-panel [data-bg=dense]::before{background:radial-gradient(circle,#fff2d0,#d27a3c 55%,#40202a);}",
      "#aw3d-panel [data-bg=nebuleuse]::before{background:radial-gradient(circle at 30% 30%,#c080ff,#4a2a8a 50%,#10102a);}",
      "#aw3d-panel [data-bg=froide]::before{background:radial-gradient(circle,#bfe8ff,#3a6ea8 55%,#0a1428);}",
      "#aw3d-panel [data-bg=sobre]::before{background:radial-gradient(circle,#8a8f9a,#2a2d35 70%);}",
      "#aw3d-panel [data-bg=vide]::before{background:#05060a;}",
      "#aw3d-panel .aw3d-fld{display:grid;grid-template-columns:1fr auto;gap:4px 8px;align-items:center;}",
      "#aw3d-panel .aw3d-fld label{font-size:.75rem;color:rgba(255,255,255,.8);}",
      "#aw3d-panel .aw3d-fld output{font-size:.7rem;font-variant-numeric:tabular-nums;color:#fff;padding:1px 7px;",
      "  border-radius:6px;background:rgba(255,255,255,.08);}",
      "#aw3d-panel input[type=range]{grid-column:1/-1;width:100%;height:16px;margin:0;background:transparent;",
      "  -webkit-appearance:none;appearance:none;accent-color:var(--p3-acc);}",
      "#aw3d-panel input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:rgba(255,255,255,.15);}",
      "#aw3d-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;",
      "  border-radius:50%;background:var(--p3-acc);border:2px solid rgba(0,0,0,.35);",
      "  box-shadow:0 0 0 3px color-mix(in srgb,var(--p3-acc) 25%,transparent);}",
      "#aw3d-panel input[type=range]::-moz-range-track{height:4px;border-radius:4px;background:rgba(255,255,255,.15);}",
      "#aw3d-panel input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--p3-acc);",
      "  border:2px solid rgba(0,0,0,.35);}",
      "#aw3d-panel .aw3d-help{display:flex;flex-direction:column;gap:4px;font-size:.7rem;color:rgba(255,255,255,.6);}",
      "#aw3d-panel .aw3d-help kbd{font-family:inherit;font-size:.66rem;padding:0 5px;border-radius:4px;",
      "  border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;}",
      "#aw3d-panel .aw3d-foot{display:grid;grid-template-columns:1fr auto;gap:6px;padding-top:10px;",
      "  border-top:1px solid rgba(255,255,255,.08);}",
      "#aw3d-panel .aw3d-foot .aw3d-chip{padding:6px 12px;text-align:center;}",
      "#aw3d-panel .aw3d-primary{background:var(--p3-acc);border-color:var(--p3-acc);color:var(--p3-ink);font-weight:700;}",
      "#aw3d-panel .aw3d-primary.dirty{color:var(--p3-ink);border-color:var(--p3-acc);",
      "  box-shadow:0 0 0 3px color-mix(in srgb,var(--p3-acc) 35%,transparent);}",

      /* fiche au survol */
      "#aw3d-tip{position:absolute;z-index:40;width:250px;padding:9px 10px;border-radius:4px;pointer-events:none;",
      "  background:rgba(9,12,24,.96);border:1px solid rgba(158,170,220,.3);color:#e6e9f7;",
      "  font-family:inherit;font-size:.8125rem;line-height:1.4;opacity:0;transform:translateY(4px);",
      "  transition:opacity .13s,transform .13s;box-shadow:0 14px 34px -14px rgba(0,0,0,.85);}",
      "#aw3d-tip.on{opacity:1;transform:none;}",
      "#aw3d-tip .t-n{font-weight:700;font-size:.9rem;}",
      "#aw3d-tip .t-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:4px;}",
      "#aw3d-tip .t-t{font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;",
      "  display:inline-flex;align-items:center;gap:5px;}",
      "#aw3d-tip .t-t i{width:7px;height:7px;border-radius:50%;display:block;}",
      "#aw3d-tip .t-xy{font-size:.68rem;color:rgba(255,255,255,.45);white-space:nowrap;",
      "  font-variant-numeric:tabular-nums;}",
      "#aw3d-tip .t-tab{width:100%;margin-top:7px;border-collapse:collapse;font-size:.72rem;}",
      "#aw3d-tip .t-tab th{text-align:left;font-weight:600;color:rgba(255,255,255,.45);",
      "  text-transform:uppercase;font-size:.62rem;letter-spacing:.04em;padding:1px 6px 2px 0;}",
      "#aw3d-tip .t-tab td{padding:1px 6px 1px 0;border-top:1px solid rgba(255,255,255,.07);",
      "  font-variant-numeric:tabular-nums;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;}",
      "#aw3d-tip .t-o{margin-top:7px;font-size:.72rem;color:rgba(255,255,255,.6);max-height:46px;overflow:hidden;}",
      "#aw3d-tip .t-o b{color:#fff;font-weight:600;}",
      "#aw3d-tip .t-g{margin-top:6px;font-size:.68rem;color:rgba(255,255,255,.5);}",
      "#aw3d-tip .t-g b{color:rgba(255,255,255,.78);font-weight:600;}",
      "#aw3d-tip .t-sg{color:#ff6b6b;font-weight:700;margin-left:4px;}",
      "#aw3d-tip .t-f{display:flex;justify-content:space-between;gap:6px;margin-top:7px;font-size:.66rem;",
      "  letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.45);}",
      "#aw3d-tip .t-f b{color:#ffb347;font-weight:600;}",
      /* fiche du SYSTÈME OUVERT : en grand, à droite, centrée (cf. placeTip) */
      "#aw3d-tip.big{width:460px;padding:18px 20px;border-radius:8px;}",
      "#aw3d-tip.big .t-n{font-size:1.6rem;}",
      "#aw3d-tip.big .t-t{font-size:.95rem;}",
      "#aw3d-tip.big .t-t i{width:11px;height:11px;}",
      "#aw3d-tip.big .t-xy{font-size:1rem;}",
      "#aw3d-tip.big .t-tab{margin-top:12px;font-size:1.12rem;}",
      "#aw3d-tip.big .t-tab th{font-size:.86rem;padding:3px 12px 5px 0;}",
      "#aw3d-tip.big .t-tab td{padding:4px 12px 4px 0;max-width:250px;}",
      "#aw3d-tip.big .t-o{font-size:1.05rem;max-height:110px;margin-top:12px;}",
      "#aw3d-tip.big .t-g{font-size:1rem;margin-top:10px;}",
      "#aw3d-tip.big .t-f{font-size:.92rem;margin-top:12px;}",
      /* hors plein écran (bloc de la carte du jeu) : fiche compacte, ou réduite si le bloc est bas */
      "#aw3d-tip.big.compact{width:360px;padding:12px 14px;}",
      "#aw3d-tip.big.compact .t-n{font-size:1.18rem;}",
      "#aw3d-tip.big.compact .t-t{font-size:.76rem;}",
      "#aw3d-tip.big.compact .t-t i{width:9px;height:9px;}",
      "#aw3d-tip.big.compact .t-xy{font-size:.8rem;}",
      "#aw3d-tip.big.compact .t-tab{margin-top:8px;font-size:.88rem;}",
      "#aw3d-tip.big.compact .t-tab th{font-size:.68rem;padding:1px 8px 3px 0;}",
      "#aw3d-tip.big.compact .t-tab td{padding:2px 8px 2px 0;max-width:170px;}",
      "#aw3d-tip.big.compact .t-o{font-size:.82rem;max-height:60px;margin-top:8px;}",
      "#aw3d-tip.big.compact .t-g{font-size:.78rem;margin-top:6px;}",
      "#aw3d-tip.big.compact .t-f{font-size:.72rem;margin-top:8px;}",
      "#aw3d-tip.big.tiny{width:290px;padding:9px 11px;}",
      "#aw3d-tip.big.tiny .t-n{font-size:1rem;}",
      "#aw3d-tip.big.tiny .t-t{font-size:.68rem;}",
      "#aw3d-tip.big.tiny .t-xy{font-size:.7rem;}",
      "#aw3d-tip.big.tiny .t-tab{margin-top:6px;font-size:.76rem;}",
      "#aw3d-tip.big.tiny .t-tab th{font-size:.62rem;padding:1px 6px 2px 0;}",
      "#aw3d-tip.big.tiny .t-tab td{padding:1px 6px 1px 0;max-width:140px;}",
      "#aw3d-tip.big.tiny .t-o,#aw3d-tip.big.tiny .t-g{font-size:.72rem;margin-top:5px;max-height:46px;}",
      "#aw3d-tip.big.tiny .t-f{font-size:.66rem;margin-top:6px;}",
      "#aw3d-tip.big.sheet{top:auto !important;left:8px !important;right:8px !important;width:auto !important;}",
      "#aw3d-tip.big.sheet.mini .t-tab,#aw3d-tip.big.sheet.mini .t-o{display:none;}",

      /* plein écran : l'hôte, déplacé sous <body>, couvre toute la fenêtre (sous le panneau Réglages 3D) */
      "#aw3d-host.aw3d-full{position:fixed !important;inset:0 !important;z-index:2147482600 !important;border-radius:0 !important;}",
      "html.aw3d-full-on,html.aw3d-full-on body{overflow:hidden !important;}",
      "#aw3d-quickbar{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;z-index:30;",
      "  flex-wrap:wrap;max-width:calc(100% - 16px);}",
      /* touch-action:manipulation supprime l'attente de double-tap (la WebView
         du mod autorise le zoom, Chrome retardait donc chaque tap de 300 ms et
         le geste partait dans le déplacement de la carte) ; et une cible de
         24 px de haut se rate au doigt, d'où le min-height. */
      "#aw3d-quickbar .aw3d-qbtn{cursor:pointer;font-size:.72rem;padding:4px 10px;border-radius:5px;",
      "  border:1px solid rgba(140,160,220,.35);background:rgba(10,14,28,.82);color:#c8d2f0;",
      "  user-select:none;touch-action:manipulation;display:inline-flex;align-items:center;}",
      "#aw3d-quickbar .aw3d-qbtn:hover{border-color:#ffb347;color:#fff;}",
      "#aw3d-quickbar .aw3d-qbtn:active{border-color:#ffb347;background:rgba(40,52,90,.95);}",
      /* ── TACTILE ─────────────────────────────────────────────────────
         Sur telephone les quatre boutons en texte faisaient deux rangees de
         42 px qui mangeaient le quart bas-gauche de la carte, le panneau
         « Reglages 3D » flottait a 110 px du haut en travers de la vue, et la
         fiche d'un systeme se posait sous le doigt qui venait de l'appuyer.
           · barre = UNE rangee d'icones, etalee sur toute la largeur
           · panneau = tiroir ancre en BAS de l'ecran, replie sur son en-tete
           · fiche  = ancree en HAUT de la carte, pleine largeur (cf. placeTip) */
      "@media (pointer:coarse){",
      "  #aw3d-quickbar{left:8px;right:8px;bottom:8px;gap:6px;max-width:none;flex-wrap:nowrap;",
      "    justify-content:space-between;}",
      "  #aw3d-quickbar .aw3d-qbtn{font-size:0;padding:0;flex:1 1 0;min-height:40px;height:40px;",
      "    justify-content:center;background:rgba(10,14,28,.9);}",
      "  #aw3d-quickbar .aw3d-qbtn i{font-size:1.15rem;line-height:1;}",
      "  #aw3d-quickbar .aw3d-qbtn[aria-pressed=\"true\"]{border-color:#ffb347;color:#ffb347;}",
      "  #aw3d-panel{top:auto !important;bottom:0 !important;left:0 !important;right:0 !important;",
      "    width:100vw;max-width:none;border-radius:10px 10px 0 0;border-bottom:none;}",
      "  #aw3d-panel .aw3d-head{cursor:pointer;padding:10px 14px;justify-content:center;gap:10px;}",
      "  #aw3d-panel .aw3d-body{max-height:48vh;padding:10px 12px 14px;}",
      "  #aw3d-panel .aw3d-chip,#aw3d-panel .aw3d-filters label{min-height:38px;}",
      "  #aw3d-panel .aw3d-chip{padding:8px 12px;}",
      "  #aw3d-tip{left:8px !important;right:8px;top:46px !important;width:auto;}",
      /* grande fiche en portrait : bandeau au-dessus de la barre rapide */
      "  #aw3d-tip.big.sheet{top:auto !important;left:8px !important;right:8px !important;width:auto !important;}",
      /* plein écran : la carte descend jusqu'en bas, sous le tiroir replié (≈ 46 px) — la barre rapide
         (Mon système, Centre, Vue dessus, Plein écran) et le menu des flottes remontent au-dessus */
      "  #aw3d-host.aw3d-full #aw3d-quickbar{bottom:calc(56px + env(safe-area-inset-bottom,0px));}",
      "  #aw3d-host.aw3d-full #aw3d-fleetmenu{bottom:calc(104px + env(safe-area-inset-bottom,0px));}",
      "}",
      "#aw3d-fleetmenu{position:absolute;left:8px;bottom:56px;z-index:31;display:flex;flex-direction:column;gap:4px;",
      "  padding:6px;border-radius:6px;border:1px solid rgba(140,160,220,.35);background:rgba(10,14,28,.94);}",
      "#aw3d-fleetmenu[hidden]{display:none;}",
      "#aw3d-fleetmenu .aw3d-fm{cursor:pointer;font-size:.78rem;padding:7px 12px;border-radius:4px;color:#c8d2f0;",
      "  display:flex;align-items:center;gap:8px;user-select:none;touch-action:manipulation;min-height:34px;}",
      "#aw3d-fleetmenu .aw3d-fm b{margin-left:auto;color:#ffb347;font-weight:700;}",
      "#aw3d-fleetmenu .aw3d-fm-eye{margin-left:10px;padding:4px 8px;border-radius:4px;border:1px solid rgba(140,160,220,.3);color:#c8d2f0;}",
      "#aw3d-fleetmenu .aw3d-fm-eye.off{color:rgba(200,210,240,.35);border-style:dashed;}",
      "#aw3d-fleetmenu .aw3d-fm-eye{position:relative;display:inline-flex;align-items:center;}",
      "#aw3d-fleetmenu .aw3d-fm-eye svg{display:block;}",
      "#aw3d-fleetmenu .aw3d-fm-eye.off svg{opacity:.35;}",
      "#aw3d-fleetmenu .aw3d-fm-eye.off::after{content:\"\";position:absolute;left:6px;right:6px;top:50%;height:2px;background:#ff7a7a;transform:rotate(-30deg);}",
      "#aw3d-fleetmenu .aw3d-fm:active,#aw3d-fleetmenu .aw3d-fm:hover{background:rgba(40,52,90,.95);color:#fff;}",
      "@media (pointer:coarse){#aw3d-fleetmenu{bottom:60px;left:8px;right:8px;} #aw3d-fleetmenu .aw3d-fm{font-size:.92rem;min-height:42px;}}",
      "#aw3d-actions{position:absolute;left:8px;top:8px;display:flex;gap:5px;z-index:30;}",
      "#aw3d-actions a{font-size:.72rem;text-decoration:none;padding:4px 8px;border-radius:3px;",
      "  border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.8);background:rgba(10,13,26,.7);}",
      "#aw3d-actions a:hover{color:#fff;border-color:#ffb347;}",
      "#aw3d-actions a[hidden]{display:none;}",
      "#aw3d-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:35;",
      "  color:rgba(255,255,255,.6);font-size:.85rem;text-align:center;padding:30px;}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function buildHost() {
    css();
    var box = mapBox();
    if (!box) return null;
    if (getComputedStyle(box).position === "static") box.style.position = "relative";

    var host = document.createElement("div");
    host.id = HOST_ID;
    host.innerHTML =
      '<canvas id="aw3d-canvas"></canvas>' +
      '<div class="aw3d-vig"></div>' +
      '<div id="aw3d-tip"></div>' +
      '<div id="aw3d-fleetmenu" hidden>' +
        '<div class="aw3d-fm" data-qgo="fleet:own"><i class="bi bi-rocket-takeoff-fill"></i> Ma flotte <b id="aw3d-fm-own">0</b><span class="aw3d-fm-eye" data-fvis="own" title="Masquer / afficher ces paraboles"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/></svg></span></div>' +
        '<div class="aw3d-fm" data-qgo="fleet:ally"><i class="bi bi-shield-fill"></i> Alliées <b id="aw3d-fm-ally">0</b><span class="aw3d-fm-eye" data-fvis="ally" title="Masquer / afficher ces paraboles"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/></svg></span></div>' +
        '<div class="aw3d-fm" data-qgo="fleet:enemy"><i class="bi bi-exclamation-triangle-fill"></i> Ennemies <b id="aw3d-fm-enemy">0</b><span class="aw3d-fm-eye" data-fvis="enemy" title="Masquer / afficher ces paraboles"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/></svg></span></div>' +
      '</div>' +
      '<div id="aw3d-quickbar">' +
        '<span class="aw3d-qbtn" data-qgo="home" title="Centrer sur mon système de départ"><i class="bi bi-house-fill"></i> Mon système</span>' +
        '<span class="aw3d-qbtn" id="aw3d-fleetbtn" title="Flottes en vol : la mienne, alliées, ennemies"><i class="bi bi-rocket-takeoff-fill"></i> Flottes</span>' +
        '<span class="aw3d-qbtn" data-qgo="origin" title="Centre de la galaxie"><i class="bi bi-record-circle"></i> Centre</span>' +
        '<span class="aw3d-qbtn" id="aw3d-flat" title="Basculer la vue de dessus" aria-pressed="false"><i class="bi bi-map"></i> Vue dessus</span>' +
        '<span class="aw3d-qbtn" id="aw3d-fullbtn" title="Carte en plein écran (touche F) — Échap pour revenir" aria-pressed="false"><i class="bi bi-arrows-fullscreen"></i> Plein écran</span>' +
      '</div>' +
      '<div id="aw3d-actions">' +
        '<a href="#" id="aw3d-open" hidden>Ouvrir le système ↗</a>' +
      '</div>';
    box.appendChild(host);

    /* Le panneau de réglages vit HORS du bloc de la carte : une fenêtre
       flottante ancrée au body, déplaçable par son en-tête.
       « Vue 2D » n'y figure PLUS : la puce du panneau et le bouton #aw3d-flat
       de la barre rapide portaient deux aria-pressed indépendants, cliquer
       l'un laissait l'autre en état contraire. Il ne reste que le bouton. */
    panelEl = document.createElement("div");
    panelEl.id = "aw3d-panel";
    panelEl.innerHTML =
        '<div class="aw3d-head" id="aw3d-toggle-panel">' +
          '<span class="aw3d-title"><i class="bi bi-sliders"></i> Réglages 3D</span>' +
          '<span class="aw3d-stats"><span><b id="aw3d-nsys">—</b> syst.</span>' +
            '<span><b id="aw3d-npl">—</b> pl.</span><span><b id="aw3d-nfl">—</b> fl.</span></span>' +
          '<span class="aw3d-caret">▾</span></div>' +
        '<div class="aw3d-body">' +
          '<div class="aw3d-tabs" role="tablist">' +
            '<button type="button" class="aw3d-tab" role="tab" data-tab="vue">Vue</button>' +
            '<button type="button" class="aw3d-tab" role="tab" data-tab="style">Style</button>' +
            '<button type="button" class="aw3d-tab" role="tab" data-tab="galaxie">Galaxie</button>' +
          '</div>' +
          /* ── onglet Vue : ce qu'on montre et où on va ── */
          '<div class="aw3d-pane" data-pane="vue">' +
            '<div class="aw3d-grp"><div class="aw3d-lab">Calques</div><div class="aw3d-row">' +
              '<button class="aw3d-chip" type="button" data-l="grid" aria-pressed="true">Repère</button>' +
              '<button class="aw3d-chip" type="button" data-l="tags" aria-pressed="true">Noms</button>' +
              '<button class="aw3d-chip" type="button" data-l="star" aria-pressed="false">Starbases</button>' +
              '<button class="aw3d-chip" type="button" data-l="fleets" aria-pressed="true">Flottes</button>' +
              '<button class="aw3d-chip" type="button" data-l="fog" aria-pressed="false">Vision</button>' +
            '</div></div>' +
            '<div class="aw3d-grp"><div class="aw3d-lab">Aller à</div><div class="aw3d-row">' +
              '<button class="aw3d-chip" type="button" data-go="origin">Centre</button>' +
              '<button class="aw3d-chip" type="button" data-go="spiral">Spirale</button>' +
              '<button class="aw3d-chip" type="button" data-go="home">Mon système</button>' +
              '<button class="aw3d-chip" type="button" data-go="fleet:own">Ma flotte</button>' +
              '<button class="aw3d-chip" type="button" data-go="fleet:ally">Alliées</button>' +
              '<button class="aw3d-chip" type="button" data-go="fleet:enemy">Ennemies</button>' +
            '</div><div class="aw3d-search"><i class="bi bi-search"></i>' +
              '<input type="text" id="aw3d-search" placeholder="Chercher un système…" autocomplete="off"></div></div>' +
            '<div class="aw3d-grp"><div class="aw3d-lab">Filtres</div><div class="aw3d-filters">' +
              '<label><input type="checkbox" data-f="mine"> Mes systèmes</label>' +
              '<label><input type="checkbox" data-f="ally"> Mon alliance</label>' +
              '<label><input type="checkbox" data-f="enemy"> Avec ennemis</label>' +
              '<label><input type="checkbox" data-f="free"> Sans ennemis</label>' +
            '</div></div>' +
          '</div>' +
          /* ── onglet Style : fond, portée, commandes ── */
          '<div class="aw3d-pane" data-pane="style" hidden>' +
            '<div class="aw3d-grp"><div class="aw3d-lab">Fond de carte</div><div class="aw3d-row aw3d-bgs" id="aw3d-bgs">' +
              ["spirale", "barree", "dense", "nebuleuse", "froide", "sobre", "vide"]
                .map(function (k) {
                  return '<button class="aw3d-chip" type="button" data-bg="' + k + '"></button>';
                }).join("") +
            '</div></div>' +
            '<div class="aw3d-grp"><div class="aw3d-lab">Carte</div>' +
              '<div class="aw3d-fld"><label for="aw3d-range">Portée affichée</label><output id="aw3d-rangeOut">8 cases</output>' +
                '<input type="range" id="aw3d-range" min="2" max="30" step="1" value="8"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-elev">Élévation</label><output id="aw3d-elevOut"></output>' +
                '<input type="range" id="aw3d-elev" min="0" max="0.6" step="0.01"></div></div>' +
            '<div class="aw3d-grp"><div class="aw3d-lab">Commandes</div>' +
              '<div class="aw3d-help"><span><kbd>Glisser</kbd> déplacer</span>' +
              '<span><kbd>Maj</kbd> + <kbd>glisser</kbd> ou clic droit : pivoter</span>' +
              '<span><kbd>Molette</kbd> zoom · <kbd>3</kbd> 2D / 3D</span></div>' +
              '<div class="aw3d-row"><button class="aw3d-chip" type="button" id="aw3d-rotmode" ' +
              'aria-pressed="false">Mode pivot</button></div></div>' +
          '</div>' +
          /* ── onglet Galaxie : le décor ── */
          '<div class="aw3d-pane" data-pane="galaxie" hidden>' +
            '<div class="aw3d-grp">' +
              '<div class="aw3d-fld"><label for="aw3d-count">Étoiles</label><output id="aw3d-countOut"></output>' +
                '<input type="range" id="aw3d-count" min="0" max="500000" step="5000"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-radius">Rayon</label><output id="aw3d-radiusOut"></output>' +
                '<input type="range" id="aw3d-radius" min="3" max="12" step="0.5"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-branches">Bras</label><output id="aw3d-branchesOut"></output>' +
                '<input type="range" id="aw3d-branches" min="2" max="12" step="1"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-spin">Torsion</label><output id="aw3d-spinOut"></output>' +
                '<input type="range" id="aw3d-spin" min="-4" max="4" step="0.05"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-randomness">Dispersion</label><output id="aw3d-randomnessOut"></output>' +
                '<input type="range" id="aw3d-randomness" min="0" max="1" step="0.01"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-rigid">Rotation</label><output id="aw3d-rigidOut"></output>' +
                '<input type="range" id="aw3d-rigid" min="0" max="0.4" step="0.005"></div>' +
              '<div class="aw3d-fld"><label for="aw3d-speed">Cisaillement</label><output id="aw3d-speedOut"></output>' +
                '<input type="range" id="aw3d-speed" min="0" max="1" step="0.01"></div>' +
            '</div>' +
          '</div>' +
          '<div class="aw3d-foot">' +
            '<button class="aw3d-chip aw3d-primary" type="button" id="aw3d-save" title="Mémoriser calques, fond, curseurs et portée">Enregistrer</button>' +
            '<button class="aw3d-chip" type="button" id="aw3d-reset" title="Revenir aux réglages d\'origine">Réinitialiser</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(panelEl);

    /* onglets Vue / Style / Galaxie : le dernier ouvert est retenu */
    (function () {
      var TAB_KEY = "aw3d_panel_tab";
      var tabs = panelEl.querySelectorAll("[data-tab]"), panes = panelEl.querySelectorAll("[data-pane]");
      function show(k) {
        if (!panelEl.querySelector('[data-pane="' + k + '"]')) k = "vue";
        tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === k)); });
        panes.forEach(function (p) { p.hidden = p.dataset.pane !== k; });
        try { localStorage.setItem(TAB_KEY, k); } catch (e) {}
      }
      tabs.forEach(function (t) { onTap(t, function () { show(t.dataset.tab); }); });
      var k0 = "vue";
      try { k0 = localStorage.getItem(TAB_KEY) || "vue"; } catch (e) {}
      show(k0);
    })();

    var panel = panelEl;
    /* Sans préférence enregistrée : déplié sur grand écran, replié sur
       téléphone — déplié il couvrirait la carte qu'on vient d'ouvrir. */
    var collapsed = innerWidth < 700;
    try {
      var pref = localStorage.getItem(COLLAPSE_KEY);
      if (pref !== null) collapsed = pref === "1";
    } catch (e) {}
    panel.classList.toggle("collapsed", collapsed);
    /* onTap et non click : cf. le commentaire sur onTap — au doigt le click
       n'est jamais synthétisé sur cette page, le panneau était donc impossible
       à déplier dans l'app. */
    onTap(panelEl.querySelector("#aw3d-toggle-panel"), function () {
      /* un glisser qui se termine sur l'en-tête ne doit pas replier le panneau */
      if (panelEl.__dragMoved) { panelEl.__dragMoved = false; return; }
      var c = panel.classList.toggle("collapsed");
      panel.querySelector(".aw3d-caret").textContent = c ? "▸" : "▾";
      try { localStorage.setItem(COLLAPSE_KEY, c ? "1" : "0"); } catch (e) {}
    });
    var caret0 = panel.querySelector(".aw3d-caret");
    if (caret0) caret0.textContent = collapsed ? "▸" : "▾";

    /* glisser-déposer par l'en-tête, position mémorisée */
    (function () {
      var head = panelEl.querySelector(".aw3d-head");
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      function place(l, t) {
        /* Au doigt le panneau est un tiroir ancre en bas (CSS pointer:coarse) :
           aucune position libre, ni memorisee ni glissee. */
        if (MOBILE) return;
        /* Sur téléphone, une position mémorisée sur grand écran laisserait le
           panneau à 80 px du bord, quasi hors champ : quand il tient, on le
           ramène entièrement dans la fenêtre. */
        var pw = panelEl.offsetWidth || 280, ph = panelEl.offsetHeight || 120;
        var maxL = pw + 16 <= innerWidth ? innerWidth - pw - 8 : innerWidth - 80;
        var maxT = ph + 16 <= innerHeight ? innerHeight - ph - 8 : innerHeight - 40;
        l = Math.max(0, Math.min(l, maxL));
        t = Math.max(0, Math.min(t, maxT));
        panelEl.style.left = l + "px";
        panelEl.style.top = t + "px";
        panelEl.style.right = "auto";
      }
      try {
        var p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
        if (p && isFinite(p.l) && isFinite(p.t)) place(p.l, p.t);
      } catch (e) {}
      head.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || MOBILE) return;
        dragging = true; panelEl.__dragMoved = false;
        sx = e.clientX; sy = e.clientY;
        var r = panelEl.getBoundingClientRect(); ox = r.left; oy = r.top;
        try { head.setPointerCapture(e.pointerId); } catch (er) {}
      });
      head.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (!panelEl.__dragMoved && Math.abs(dx) + Math.abs(dy) < 5) return;
        panelEl.__dragMoved = true;
        place(ox + dx, oy + dy);
      });
      head.addEventListener("pointerup", function (e) {
        if (!dragging) return;
        dragging = false;
        try { head.releasePointerCapture(e.pointerId); } catch (er) {}
        if (panelEl.__dragMoved) {
          var r = panelEl.getBoundingClientRect();
          try { localStorage.setItem(POS_KEY, JSON.stringify({l: r.left, t: r.top})); } catch (er) {}
        }
      });
    })();

    return host;
  }

  /* ── bouton bascule dans la barre d'outils du jeu ── */
  function addToolbarButton() {
    var bar = document.getElementById("mapToolbar");
    if (bar && !document.getElementById("aw3d-btn")) {
      var grp = document.createElement("div");
      grp.className = "map-toolbar-group";
      grp.innerHTML = '<span class="link" id="aw3d-btn" title="Basculer la carte en 3D (touche 3)" ' +
        'style="color:#ffb347;font-weight:600">' +
        '<i class="bi bi-globe-americas"></i> <span class="d-none d-md-inline">Vue 3D</span></span>';
      var div = document.createElement("div");
      div.className = "map-toolbar-divider";
      bar.insertBefore(div, bar.firstChild);
      bar.insertBefore(grp, bar.firstChild);
      onTap(grp.querySelector("#aw3d-btn"), toggle);
      autoOpen3d();
    }
  }

  function setButtonState(on) {
    var b = document.getElementById("aw3d-btn");
    if (!b) return;
    b.style.color = on ? "#7ef7ff" : "#ffb347";
    var lbl = b.querySelector("span");
    if (lbl) lbl.textContent = on ? "Vue 2D" : "Vue 3D";
    b.title = on ? "Revenir à la carte du jeu (touche 3)" : "Basculer la carte en 3D (touche 3)";
  }

  /* ══════════════════════════════════════════════════════════════════════
     4 · OUVERTURE / FERMETURE
     ══════════════════════════════════════════════════════════════════════ */

  /* vue par défaut de la carte : 3D, sauf si le joueur est repassé en 2D la dernière fois */
  var VIEW_KEY = "aw3d_view", autoOpened = false;
  function rememberView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} }
  function autoOpen3d() {
    if (autoOpened || !NS.active) return;
    autoOpened = true;
    var pref = null;
    try { pref = localStorage.getItem(VIEW_KEY); } catch (e) {}
    if (pref === "2d") return;
    setTimeout(function () { if (!(ui && ui.classList.contains("on"))) open(); }, 250);
    /* ouverture pendant la mise en page ou dans un onglet en arrière-plan : on recale
       taille et caméra une fois la page stable, puis à chaque retour sur l'onglet */
    var recaler = function () { if (ui && ui.classList.contains("on")) dispatchEvent(new Event("resize")); };
    setTimeout(recaler, 2500);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) recaler(); });
  }

  function toggle() {
    if (ui && ui.classList.contains("on")) { rememberView("2d"); close(); } else { rememberView("3d"); open(); }
  }

  async function open() {
    if (!ui) ui = buildHost();
    if (!ui) return;
    ui.classList.add("on");
    try { if (localStorage.getItem(FULL_KEY) === "1") setFull(true, true); } catch (e) {}
    /* Réglages 3D : calques, filtres, fond de carte, curseurs de galaxie.
       Le panneau s'ouvre replié sur les petits écrans (voir COLLAPSE_KEY),
       pour ne pas manger la carte sur un téléphone. */
    if (panelEl) panelEl.classList.add("on");
    var nm = nativeMap();
    if (nm) { nm.dataset.aw3dPrev = nm.style.visibility || ""; nm.style.visibility = "hidden"; }
    setButtonState(true);

    var data = null;
    try {
      data = await snapshot({ onMsg: function (m) { if (m) msg(m); else clearMsg(); } });
    } catch (e) { console.warn("[AW3D] pipeline KO:", e); }

    if (!data || !data.systems.length) {
      msg("Les données de la carte ne sont pas encore chargées.<br>Recharge la page puis rouvre la vue 3D.");
      return;
    }
    if (!THREE) {
      /* Dans l'app Android three est déjà là (bundle IIFE injecté avant nous) ;
         dans l'extension PC on l'importe depuis ses propres fichiers, la CSP du
         jeu interdisant tout CDN. Un seul source pour les deux plateformes. */
      THREE = window.THREE || null;
    }
    if (!THREE) {
      msg("Chargement du moteur 3D…");
      try {
        THREE = await import(chrome.runtime.getURL("vendor/three.module.min.js"));
      } catch (e) {
        console.warn("[AW3D] three.js non chargé:", e);
        msg("Moteur 3D indisponible : " + (e && e.message));
        return;
      }
    }
    clearMsg();
    try {
      if (!app) app = createApp(THREE, document.getElementById("aw3d-canvas"));
      /* wirePanel AVANT setData : les curseurs doivent refléter les paramètres
         du fond de carte restauré, que setData ne touche pas. Ce n'est plus le
         piège d'autrefois (le forçage d'un style d'icône a disparu avec les
         styles eux-mêmes), mais l'ordre reste intentionnel. */
      wirePanel();
      app.setData(data);
      app.start();
      /* les vols arrivent apres coup (cf. construire) : on reconstruit juste
         le calque des flottes, pas la carte */
      NS.onFleetsLate = function () { try { if (app && app.refreshFleets) app.refreshFleets(); } catch (e) {} };
      /* réglages enregistrés (bouton du panneau) : après setData, qui
         recrée la carte, sinon buildMap les écraserait */
      if (NS.applySavedSettings) NS.applySavedSettings();
    } catch (e) {
      document.documentElement.setAttribute("data-aw3d-err", String((e && e.stack) || e).slice(0, 800));
      console.error("[AW3D] ouverture plantée:", e);
      msg("Erreur 3D : " + (e && e.message));
    }
  }

  /* ── PLEIN ÉCRAN (14/09, « la map en plein écran comme le labo ») ─────────
     La 3D quitte le bloc de la carte du jeu et occupe toute la fenêtre, sous le
     panneau Réglages 3D. On DÉPLACE l'hôte sous <body> : un ancêtre du jeu avec
     transform ou overflow le rognerait sinon ; le contexte WebGL survit au
     déplacement du canvas. Bouton, touche F, Échap pour revenir ; le choix est
     retenu (aw3d_full) et réappliqué à la prochaine ouverture de la 3D. */
  var FULL_KEY = "aw3d_full", fullHome = null;
  function isFull() { return !!(ui && ui.classList.contains("aw3d-full")); }
  function setFull(on, keepPref) {
    if (!ui) return;
    on = !!on;
    if (on === isFull()) return;
    if (on) {
      fullHome = { parent: ui.parentNode, next: ui.nextSibling };
      document.body.appendChild(ui);
    } else if (fullHome && fullHome.parent) {
      var nx = fullHome.next && fullHome.next.parentNode === fullHome.parent ? fullHome.next : null;
      fullHome.parent.insertBefore(ui, nx);
    }
    ui.classList.toggle("aw3d-full", on);
    document.documentElement.classList.toggle("aw3d-full-on", on);
    var fb = document.getElementById("aw3d-fullbtn");
    if (fb) {
      fb.setAttribute("aria-pressed", String(on));
      fb.innerHTML = on ? '<i class="bi bi-fullscreen-exit"></i> Quitter le plein écran' : '<i class="bi bi-arrows-fullscreen"></i> Plein écran';
    }
    if (!keepPref) { try { localStorage.setItem(FULL_KEY, on ? "1" : "0"); } catch (e) {} }
    /* taille du canvas, caméra, rectangle de survol : recalés par le resize de l'app */
    setTimeout(function () { dispatchEvent(new Event("resize")); }, 30);
  }

  function close() {
    if (!ui) return;
    if (isFull()) setFull(false, true);   /* on garde la préférence : la 3D rouvrira en plein écran */
    ui.classList.remove("on");
    if (panelEl) panelEl.classList.remove("on");
    var nm = nativeMap();
    if (nm) nm.style.visibility = nm.dataset.aw3dPrev || "";
    setButtonState(false);
    if (app) app.stop();
  }

  function msg(html) {
    var m = document.getElementById("aw3d-msg");
    if (!m) {
      m = document.createElement("div");
      m.id = "aw3d-msg";
      ui.appendChild(m);
    }
    m.innerHTML = html;
  }
  function clearMsg() {
    var m = document.getElementById("aw3d-msg");
    if (m) m.remove();
  }

  /* ══════════════════════════════════════════════════════════════════════
     5 · LE MOTEUR 3D
     ──────────────────────────────────────────────────────────────────────
     Un seul objet, créé à la première ouverture, qui garde tout : renderer,
     scène, caméra, systèmes, flottes, étiquettes. L'interface (§ 3 et § 4) ne
     connaît QUE l'API rendue en bas de cette fonction — jamais un objet three.

     TROIS INVARIANTS qui ne se rediscutent pas :
       · L'HORLOGE N'APPARTIENT QU'À LA BOUCLE. clock.getDelta() n'est appelé
         qu'à un seul endroit ; toute lecture d'horloge ailleurs VOLE le delta
         de l'image (c'est la cicatrice `actPending`).
       · pxCellNow est EN RETARD D'UNE IMAGE, exprès : la boucle le lit avant
         qu'updateMap ne l'écrive. C'est le comportement qui marche, on le
         documente au lieu de le « corriger ».
       · DEUX mises à jour de matrices, à la main, dans cet ordre :
         group.updateMatrixWorld() en tête d'updateMap, puis
         scene.updateMatrixWorld() juste avant le rendu. La scène est en
         matrixWorldAutoUpdate = false : déplacer l'une des deux vide l'écran
         sans la moindre erreur.
     ══════════════════════════════════════════════════════════════════════ */

  function createApp(T, canvas) {
    var params = {
      /* mêmes réglages que la carte tactique de référence : 200 000 étoiles,
         points plus gros → bras spiraux bien visibles */
      /* bras plus fins et marqués, comme le galaxy generator de référence :
         torsion plus forte, dispersion resserrée, power 4 */
      /* Mobile : densité réduite, mais bien moins qu'au premier réglage. Le
         champ mangeait les systèmes surtout parce que uPixelRatio était figé
         à 2 alors que le renderer tourne plus bas — les points étaient dessinés
         deux fois trop gros EN SURFACE. Ce défaut corrigé, on peut rendre les
         étoiles sans réétouffer la carte. */
      count: MOBILE ? 130000 : 300000, size: MOBILE ? 17 : 26,
      radius: 5, branches: 5, spin: 1.6,
      randomness: 0.2, power: 4, inside: "#ff6030", outside: "#1b3984",
      /* cisaillement doux par défaut : les bras spiraux tournoient lentement
         (les systèmes, eux, restent à leurs coordonnées) */
      speed: 0.25, rigid: 0,
      elev: 0.15                   /* relief des systèmes (0 = carte plate) */
    };
    /* Réglages d'usine : copie prise ICI, avant que le fond de carte
       mémorisé ou les réglages enregistrés ne touchent à params. C'est ce
       que « Réinitialiser » restaure. */
    var PARAMS0 = JSON.parse(JSON.stringify(params));

    var scene = new T.Scene();
    /* on pilote nous-mêmes la mise à jour de l'arbre (une seule fois par
       image, avant le rendu) au lieu de laisser renderer.render() la refaire.
       ⚠ Conséquence : tout objet ajouté après coup DOIT avoir
       frustumCulled = false, sinon il est testé avec une matrice périmée, jugé
       hors champ et jamais dessiné — visible vaut true, la géométrie existe,
       et il n'y a rien à l'écran ni dans la console. */
    scene.matrixWorldAutoUpdate = false;
    var camera = new T.PerspectiveCamera(58, 1, 0.1, 400);
    /* antialias : les sphères plasma ont des silhouettes nettes — mais sur
       mobile il double le coût mémoire du tampon, et c'est ce tampon qui fait
       échouer la création du contexte quand le GPU est déjà chargé. */
    var renderer = new T.WebGLRenderer({
      canvas: canvas, antialias: !MOBILE, powerPreference: "high-performance"
    });
    renderer.setClearColor(0x04050c, 1);
    /* posé tout de suite : les matériaux de points lisent getPixelRatio() à la
       construction, qui a lieu avant le premier resize() */
    renderer.setPixelRatio(Math.min(MOBILE ? 1.9 : 2, devicePixelRatio));
    /* Un contexte perdu (app en arrière-plan, pression mémoire) laissait une
       carte morte et muette ; on le dit et on cesse de le solliciter. */
    var ctxLost = false;
    canvas.addEventListener("webglcontextlost", function (e) {
      /* preventDefault est indispensable : sans lui le navigateur ne tentera
         JAMAIS de restaurer le contexte. */
      e.preventDefault();
      ctxLost = true;
      msg("Contexte 3D perdu, restauration en cours…");
    }, false);
    /* Le navigateur rend la main après une réinitialisation du pilote ou une
       mise en veille : on repart d'une page propre plutôt que de rester sur un
       canvas mort. */
    canvas.addEventListener("webglcontextrestored", function () {
      location.reload();
    }, false);
    /* La WebView enchaîne les navigations : un contexte non libéré reste
       vivant et, au bout de quelques pages, le navigateur refuse d'en créer
       un de plus — c'est l'erreur « creating WebGL context ». */
    window.addEventListener("pagehide", function (e) {
      /* ⚠ e.persisted : la page part en cache arrière/avant et peut revenir
         telle quelle. Détruire le contexte ici la faisait revenir avec un
         canvas mort et le message « contexte 3D perdu » — un bug que j'avais
         introduit en voulant justement éviter l'accumulation de contextes.
         On ne libère que sur une vraie sortie. */
      if (e && e.persisted) return;
      try {
        ctxLost = true;
        renderer.dispose();
        var ext = renderer.getContext().getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (e2) {}
    });
    /* le canvas se décale quand la page défile : la position mise en cache
       doit suivre, sinon le pointage vise à côté */
    addEventListener("scroll", function () { syncRect(); }, { passive: true });

    if (T.ColorManagement) T.ColorManagement.enabled = false;

    /* ── 5.1 · nuages de points : le shader commun ─────────────────────── */

    var VERT = [
      "uniform float uSize;","uniform float uTime;","uniform float uSpeed;",
      "uniform float uRigid;","uniform float uPixelRatio;",
      "attribute vec3 aColor;","attribute float aScale;","attribute vec3 aRandom;",
      "varying vec3 vColor;",
      "void main(){",
      "  vec4 mp = modelMatrix * vec4(position, 1.0);",
      "  float d = length(mp.xz);",
      "  float a = atan(mp.x, mp.z) + (1.0/(d+0.35))*uTime*uSpeed + uTime*uRigid;",
      /* a = atan(x, z) ⇒ x = sin(a)·d, z = cos(a)·d — l'ancien cos/sin
         inversé MIROITAIT toutes les positions (x↔z) : amas posés loin de
         leurs systèmes et rotation à contresens */
      "  mp.x = sin(a)*d; mp.z = cos(a)*d;",
      "  mp.xyz += aRandom;",
      "  vec4 mv = viewMatrix * mp;",
      "  gl_Position = projectionMatrix * mv;",
      "  gl_PointSize = uSize * aScale * uPixelRatio * (1.0 / -mv.z);",
      "  vColor = aColor;",
      "}"
    ].join("\n");
    var FRAG = [
      "varying vec3 vColor;",
      /* uFade : estompage du DÉCOR (galaxie, ciel, amas) pendant qu'un système
         est déployé, cf. decorFade() — 1 pour les planètes */
      "uniform float uFade;",
      "void main(){",
      "  float d = distance(gl_PointCoord, vec2(0.5));",
      "  float s = clamp(1.0 - d*2.0, 0.0, 1.0);",
      "  s = pow(s, 4.0);",
      "  if(s < 0.002) discard;",
      /* Étoiles opaques : alpha plein, le dégradé `s` continue de faire le rond
         mais son cœur est franc. En revanche la couleur est BAISSÉE, pas
         montée : le mélange est additif, donc passer l'alpha de 0,72 à 1 rend
         déjà chaque étoile ~40 % plus lumineuse, et des milliers de points qui
         se recouvrent saturent en un tapis uniforme. */
      "  gl_FragColor = vec4(vColor * s * 0.82 * uFade, s);",
      "}"
    ].join("\n");
    var STAR_VERT = VERT.replace("  mp.xyz += aRandom;\n", "").replace("attribute vec3 aRandom;", "");

    /* Tous les nuages de points vivants, pour rafraîchir uPixelRatio au
       redimensionnement. On les RETIRE quand on les détruit : la liste
       grossissait sans fin, et resize() finissait par écrire dans les uniforms
       de matériaux déjà disposés. */
    var ptMats = [];
    function mat(size, still) {
      var m = new T.ShaderMaterial({
        vertexShader: still ? STAR_VERT : VERT, fragmentShader: FRAG,
        uniforms: {
          uSize:{value:size}, uTime:{value:0},
          uSpeed:{value: still ? 0 : params.speed},
          /* la rotation d'ensemble ne passe PLUS par le shader (elle tournait
             à l'envers des systèmes) : c'est galaxy.rotation.y qui suit group */
          uRigid:{value: 0},
          /* doit suivre le ratio RÉEL du renderer (1,4 sur mobile) : à 2 les
             points étaient dessinés deux fois trop gros en surface — d'où un
             ciel saturé d'étoiles, et deux fois plus de fragments à remplir */
          uPixelRatio:{value: renderer.getPixelRatio()},
          uFade:{value: 1}
        },
        transparent:true, depthWrite:false, blending:T.AdditiveBlending
      });
      ptMats.push(m);
      return m;
    }
    function ptDrop(m) {
      var i = ptMats.indexOf(m);
      if (i >= 0) ptMats.splice(i, 1);
    }

    /* ── 5.2 · le décor : ciel de fond et étoiles filantes ─────────────── */

    var skyDome = null;
    (function () {
      var n = 2200, pos = new Float32Array(n*3), col = new Float32Array(n*3), sca = new Float32Array(n);
      var warm = new T.Color("#ffd9b0"), cool = new T.Color("#8fa8ff");
      for (var i = 0; i < n; i++) {
        var u = Math.random()*2-1, a = Math.random()*Math.PI*2, s = Math.sqrt(1-u*u), d = 50 + Math.random()*45;
        pos[i*3] = Math.cos(a)*s*d; pos[i*3+1] = u*d*0.6; pos[i*3+2] = Math.sin(a)*s*d;
        var c = warm.clone().lerp(cool, Math.random()), dim = 0.25 + Math.random()*0.55;
        col[i*3] = c.r*dim; col[i*3+1] = c.g*dim; col[i*3+2] = c.b*dim;
        sca[i] = 0.3 + Math.random()*0.9;
      }
      var g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos,3));
      g.setAttribute("aColor", new T.BufferAttribute(col,3));
      g.setAttribute("aScale", new T.BufferAttribute(sca,1));
      skyDome = new T.Points(g, mat(900, true));
      /* même piège que la galaxie : trié sur son centre (l'origine), donc
         dessiné APRÈS la moitié lointaine de la carte alors que c'est le ciel
         de FOND. -20 et non -10 pour rester derrière la galaxie — ordre
         aujourd'hui obtenu par hasard (ordre de création), ici figé. */
      skyDome.renderOrder = -20;
      scene.add(skyDome);
    })();

    var meteors = [];
    for (var mi = 0; mi < 7; mi++)
      meteors.push({ line: null, t0: -1, dur: 0, p0: null, v: null, nextAt: 1 + mi * 2 + Math.random() * 4 });
    function launchMeteor(m, t) {
      if (!m.line) {
        var mg = new T.BufferGeometry();
        mg.setAttribute("position", new T.BufferAttribute(new Float32Array(6), 3));
        m.line = new T.Line(mg, new T.LineBasicMaterial({
          color: 0xd6e4ff, transparent: true, opacity: 0,
          blending: T.AdditiveBlending, depthWrite: false
        }));
        m.line.frustumCulled = false;
        /* décor de fond au même titre que skyDome : sans ça un trait additif
           à opacité .9 vient rayer les noms de systèmes en passant devant */
        m.line.renderOrder = -20;
        scene.add(m.line);
      }
      var u = 0.15 + Math.random() * 0.65, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      var r = 55 + Math.random() * 30;
      m.p0 = new T.Vector3(Math.cos(a) * s * r, u * r * 0.7, Math.sin(a) * s * r);
      m.v = new T.Vector3()
        .crossVectors(m.p0, new T.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5))
        .normalize().multiplyScalar(28 + Math.random() * 32);
      m.t0 = t; m.dur = 0.9 + Math.random() * 0.9;
    }
    var _mh = new T.Vector3(), _mt = new T.Vector3();
    /* ── DÉCOR ESTOMPÉ pendant qu'un système est déployé ─────────────────
       Poussière de galaxie, nébuleuse, ciel, amas et repère passaient PAR-DESSUS
       les anneaux du système ouvert et en faussaient la lecture. On les fond
       jusqu'à 8 % au rythme du déploiement (et ils reviennent au repli). Le voile
       CSS assombrit déjà tout ce qui est hors des anneaux : dedans, il ne reste
       que le système. Matériaux modifiés seulement quand le facteur bouge. */
    var decorK = 1, decorKSet = -1;
    function fadeMats(root, k) {
      if (!root) return;
      root.traverse(function (o) {
        var m = o.material;
        if (!m || m.uniforms) return;
        if (m.userData.baseOp == null) m.userData.baseOp = m.opacity;
        m.opacity = m.userData.baseOp * k;
      });
    }
    function decorFade(dmax) {
      decorK = 1 - 0.92 * Math.max(0, Math.min(1, dmax));
      if (Math.abs(decorK - decorKSet) < 0.004) return;
      decorKSet = decorK;
      [galaxyMat, clusterMat, skyDome && skyDome.material].forEach(function (m) {
        if (m && m.uniforms && m.uniforms.uFade) m.uniforms.uFade.value = decorK;
      });
      fadeMats(nebula, decorK);
      fadeMats(grid, decorK);
    }

    function updateMeteors(t) {
      for (var i = 0; i < meteors.length; i++) {
        var m = meteors[i];
        if (m.t0 < 0 || t - m.t0 > m.dur) {
          if (m.line) m.line.material.opacity = 0;
          if (t > m.nextAt) {
            launchMeteor(m, t);
            m.nextAt = t + m.dur + 2 + Math.random() * 6;
          }
          continue;
        }
        var ph = (t - m.t0) / m.dur;
        _mh.copy(m.p0).addScaledVector(m.v, ph * m.dur);
        _mt.copy(_mh).addScaledVector(m.v, -0.14);
        var ar = m.line.geometry.attributes.position.array;
        ar[0] = _mt.x; ar[1] = _mt.y; ar[2] = _mt.z;
        ar[3] = _mh.x; ar[4] = _mh.y; ar[5] = _mh.z;
        m.line.geometry.attributes.position.needsUpdate = true;
        m.line.material.opacity = Math.sin(Math.PI * ph) * 0.9 * decorK;
      }
    }

    /* ── 5.3 · fonds de carte ─────────────────────────────────────────────
       Le disque galactique est du DÉCOR : il situe la carte, mais il entre en
       concurrence avec les systèmes, qui sont l'information. D'où plusieurs
       partis pris, du plus spectaculaire au plus sobre — les deux derniers
       existent précisément pour que rien ne dispute la lisibilité. */
    var BACKGROUNDS = {
      spirale:   { label: "Spirale",   count: 1.00, size: 1.00, branches: 5, spin: 1.6,  power: 4, randomness: 0.20,
                   inside: "#ff6030", outside: "#1b3984", neb: 1.00 },
      barree:    { label: "Barrée",    count: 0.95, size: 1.05, branches: 2, spin: 2.7,  power: 3, randomness: 0.26,
                   inside: "#ffb347", outside: "#3a2a6e", neb: 0.90 },
      dense:     { label: "Dense",     count: 1.20, size: 0.85, branches: 7, spin: 1.15, power: 6, randomness: 0.14,
                   inside: "#ffd9a0", outside: "#123061", neb: 0.75 },
      nebuleuse: { label: "Nébuleuse", count: 0.85, size: 1.35, branches: 3, spin: 0.55, power: 2, randomness: 0.62,
                   inside: "#7ad0ff", outside: "#5a2a8a", neb: 1.40 },
      froide:    { label: "Froide",    count: 0.90, size: 1.00, branches: 4, spin: 1.9,  power: 4, randomness: 0.22,
                   inside: "#9fd8ff", outside: "#10305c", neb: 0.85 },
      sobre:     { label: "Sobre",     count: 0.28, size: 0.80, branches: 5, spin: 1.6,  power: 5, randomness: 0.18,
                   inside: "#6f7fa8", outside: "#111c33", neb: 0.25 },
      vide:      { label: "Vide",      count: 0,    size: 1.00, branches: 5, spin: 1.6,  power: 4, randomness: 0.20,
                   inside: "#6f7fa8", outside: "#111c33", neb: 0 }
    };
    var BG_BASE = { count: params.count, size: params.size };
    var bgStyle = "spirale";
    try { bgStyle = localStorage.getItem("aw3d_bg") || "spirale"; } catch (e) {}
    if (!BACKGROUNDS[bgStyle]) bgStyle = "spirale";
    /* Applique le parti pris DANS params : les curseurs du panneau lisent ce
       même objet (via syncParams), sinon bouger un curseur après un changement
       de fond repartait des anciennes valeurs et défaisait le fond. */
    function applyBackground(k) {
      var b = BACKGROUNDS[k] || BACKGROUNDS.spirale;
      params.count = Math.round(BG_BASE.count * b.count);
      params.size = BG_BASE.size * b.size;
      params.branches = b.branches;
      params.spin = b.spin;
      params.power = b.power;
      params.randomness = b.randomness;
      params.inside = b.inside;
      params.outside = b.outside;
      params.neb = b.neb;
    }
    applyBackground(bgStyle);

    /* ── le disque de particules ── */
    var galaxy = null, galaxyMat = null, nebula = null, coreGlow = null;
    function buildGalaxy() {
      if (galaxy) {
        galaxy.geometry.dispose(); ptDrop(galaxyMat); galaxyMat.dispose();
        scene.remove(galaxy); galaxy = null; galaxyMat = null;   /* les deux gardes vont par paire */
      }
      var n = params.count | 0;
      if (n <= 0) return;
      var pos = new Float32Array(n*3), col = new Float32Array(n*3),
          rnd = new Float32Array(n*3), sca = new Float32Array(n);
      var cIn = new T.Color(params.inside), cOut = new T.Color(params.outside), mix = new T.Color();
      for (var i = 0; i < n; i++) {
        /* 3 étoiles sur 10 en champ uniforme sur TOUT le disque (la carte
           entière est peuplée), le reste concentré dans les bras spiraux */
        var i3 = i*3, field = (i % 10) < 3, r, ang;
        if (field) {
          r = Math.sqrt(Math.random()) * params.radius * 1.15;
          ang = Math.random() * Math.PI*2;
        } else {
          /* 0.10 de rayon plancher + exposant adouci : l'amas central ne
             sature plus, les bras gardent leur densité */
          r = (0.10 + 0.90 * Math.pow(Math.random(), 1.15)) * params.radius;
          ang = (i % params.branches) / params.branches * Math.PI*2 + r * params.spin;
        }
        pos[i3] = Math.cos(ang)*r; pos[i3+1] = 0; pos[i3+2] = Math.sin(ang)*r;
        var amp = params.randomness * r + 0.02;
        rnd[i3] = jit()*amp; rnd[i3+1] = jit()*amp*0.45; rnd[i3+2] = jit()*amp;
        mix.copy(cIn).lerp(cOut, Math.min(r/params.radius, 1));
        col[i3] = mix.r; col[i3+1] = mix.g; col[i3+2] = mix.b;
        sca[i] = 0.35 + Math.random()*0.9;
      }
      var g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos,3));
      g.setAttribute("aColor", new T.BufferAttribute(col,3));
      g.setAttribute("aRandom", new T.BufferAttribute(rnd,3));
      g.setAttribute("aScale", new T.BufferAttribute(sca,1));
      galaxyMat = mat(params.size, false);
      galaxy = new T.Points(g, galaxyMat);
      /* DÉCOR, donc DERRIÈRE — et il faut le DIRE à three, la géométrie n'y
         suffit pas : un T.Points est trié sur UN point, le centre de sa
         bounding sphere, ici le centre du disque. Sans cette ligne, tout
         système plus lointain que ce centre est dessiné AVANT le nuage et se
         fait délaver par ses grains additifs (noms illisibles au fond, et qui
         redeviennent nets quand la caméra tourne : le signe de l'écart de z
         bascule). Aucun matériau touché, aucun coût par image. */
      galaxy.renderOrder = -10;
      scene.add(galaxy);

      /* voile de nébuleuse le long des bras + cœur galactique lumineux,
         comme la galaxie laiteuse de référence — de simples sprites doux
         additifs, quasi gratuits */
      if (nebula) { scene.remove(nebula); disposeTree(nebula); nebula = null; coreGlow = null; }
      var nebK = params.neb === undefined ? 1 : params.neb;
      if (nebK <= 0) return;            /* fond « Vide » : pas de voile non plus */
      nebula = new T.Group();
      decorKSet = -1;   /* nouveaux matériaux : l'estompage en cours doit s'y réappliquer */
      var nmix = new T.Color();
      /* la nébuleuse est le plus gros surdessin de la scène : on suit le parti
         pris choisi au lieu d'en poser 34 quoi qu'il arrive */
      var nCount = Math.max(6, Math.round(34 * Math.min(1, nebK)));
      for (var b = 0; b < nCount; b++) {
        var fr = (b + 1) / nCount;
        var rr = Math.pow(fr, 1.2) * params.radius * 0.92;
        var na = (b % params.branches) / params.branches * Math.PI * 2 + rr * params.spin +
                 (Math.random() - .5) * .5;
        nmix.copy(cIn).lerp(cOut, fr);
        var sp = new T.Sprite(new T.SpriteMaterial({map: softTex(), color: nmix.clone(),
          transparent: true, blending: T.AdditiveBlending, depthWrite: false,
          opacity: (.05 + (1 - fr) * .05) * nebK}));
        sp.position.set(Math.cos(na) * rr, (Math.random() - .5) * .06, Math.sin(na) * rr);
        sp.scale.setScalar(params.radius * (0.22 + fr * 0.34));
        nebula.add(sp);
      }
      coreGlow = new T.Sprite(new T.SpriteMaterial({map: haloTex(), color: 0xffd9a8,
        transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: .38}));
      coreGlow.scale.setScalar(params.radius * 0.16);
      nebula.add(coreGlow);
      var coreWhite = new T.Sprite(new T.SpriteMaterial({map: haloTex(), color: 0xffffff,
        transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: .75}));
      coreWhite.scale.setScalar(params.radius * 0.06);
      nebula.add(coreWhite);
      /* Une seule ligne pour les 36 sprites : sur un T.Group, renderOrder ne
         pose PAS un renderOrder, il pose le groupOrder de toute la descendance
         (three r160 : `if (object.isGroup) groupOrder = object.renderOrder`) —
         et groupOrder est la PREMIÈRE clé de tri, avant renderOrder. Le voile
         et le cœur passent donc derrière la carte entière d'un coup.
         Effet de bord assumé : la grille (renderOrder -1) repasse par-dessus
         le halo central au lieu d'être effacée par lui. */
      nebula.renderOrder = -10;
      scene.add(nebula);
    }
    function jit(){ return Math.pow(Math.random(), params.power) * (Math.random() < 0.5 ? 1 : -1); }

    /* ── 5.4 · l'état de la carte ─────────────────────────────────────── */

    var D = null;                      /* données du jeu */
    var group = null, unit = 1, extent = 30;
    var systems = [], planetPts = null, planetMat = null, clusterMat = null;
    var orbits = [], grid = null, sbg = null;
    /* courbe « back-out » douce (dépassement de quelques %) pour la cascade des planètes */
    function easeBackOut(x) { var c1 = 1.7, c3 = c1 + 1, u = x - 1; return 1 + c3 * u * u * u + c1 * u * u; }
    function elasticOut(x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }
    /* ── APPARITION DES PLANÈTES DU SYSTÈME OUVERT (14/09, « plus stylée, plus aléatoire ») ──
       Tirée au HASARD à chaque ouverture (Math.random, pas de graine) :
         · ordre de sortie mélangé, écarts irréguliers ;
         · une manière dominante pour l'ouverture, et environ une planète sur trois en change :
             0 SPIRALE : jaillit du soleil en tourbillon, léger saut au-dessus du plan ;
             1 CHUTE   : tombe de plus haut (ou d'en dessous) et de plus loin, en arc, puis se pose ;
             2 WARP    : surgit directement sur son orbite, grossit en élastique ;
         · sens et ampleur du tourbillon, hauteur et distance de départ, durée propre ;
         · un éclair à l'arrivée (au départ pour le warp). */
    function unfoldFx(ob, sy) {
      if (ob.fx && ob.fx.t0 === sy.unfoldT) return ob.fx;
      if (sy.fxT0 !== sy.unfoldT) {
        sy.fxT0 = sy.unfoldT;
        var ord = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        for (var j = ord.length - 1; j > 0; j--) { var r = Math.floor(Math.random() * (j + 1)), tmp = ord[j]; ord[j] = ord[r]; ord[r] = tmp; }
        sy.fxOrd = ord;
        sy.fxMode = Math.floor(Math.random() * 3);
      }
      var rank = sy.fxOrd[ob.k % 12];
      ob.fx = {
        t0: sy.unfoldT,
        mode: Math.random() < 0.65 ? sy.fxMode : Math.floor(Math.random() * 3),
        delay: rank * (0.06 + Math.random() * 0.06) + Math.random() * 0.14,
        dur: 0.75 + Math.random() * 0.6,
        swirl: (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 2.4),
        lift: (Math.random() < 0.72 ? 1 : -1) * (0.8 + Math.random() * 2.4),
        far: 1.35 + Math.random() * 0.7
      };
      return ob.fx;
    }

    /* ── PLANÈTES TEXTURÉES DU SYSTÈME SURVOLÉ ────────────────────────────────
       Comme la vue système (/Game/Map/SolarSystem, solar3d.js) : mêmes textures
       (assets/planets/, Solar System Scope CC BY 4.0), même archétype tiré de la
       même graine (idx × 7,3 + id % 50), mêmes zones et même règle « le type le
       moins servi du système » : une planète a le même visage dans les deux vues.
       Seul le système déployé en a (12 sphères au plus), posées sur les points de
       la cascade, dont les points s'effacent. Pas sur mobile. */
    var S3 = { sys: null, list: [], geo: null, light: null, amb: false, tex: {} };
    function s3Zone(i) { return i <= 3 ? "hot" : (i <= 7 ? "temperate" : "cold"); }
    var S3_ARCH = { hot: ["lava", "desert", "dead"], temperate: ["ocean", "continental", "desert", "ice"],
                    cold: ["gas", "ice", "dead"] };
    function s3World(n) { return "world" + n + "_day.jpg"; }
    var S3_FAM = {
      ocean: [s3World(2), s3World(4), s3World(7), s3World(3)],
      continental: [s3World(1), s3World(5), s3World(6), s3World(8)],
      desert: ["mars.jpg", "venus_surface.jpg"],
      ice: ["eris.jpg", "haumea.jpg", "moon.jpg"],
      lava: ["makemake.jpg", "venus_surface.jpg"],
      gas: ["jupiter.jpg", "saturn.jpg", "uranus.jpg", "neptune.jpg"],
      dead: ["moon.jpg", "mercury.jpg", "ceres.jpg"]
    };
    var S3_REPLI = { continental: "#3f7a46", ocean: "#2fa8b8", lava: "#8a2f18", ice: "#a8cbe8",
                     desert: "#b07a3c", gas: "#c08a4a", dead: "#5a5a62" };
    var S3_BASER = { gas: 1.3, ice: 0.85, lava: 0.8, desert: 0.85, ocean: 1.0, continental: 1.0, dead: 0.7 };
    /* taille des planètes texturées du système ouvert (×1 jusqu'au 14/09, ×1,8 à la demande
       « augmente la taille des planètes » ; l'écart entre deux orbites vaut ≈ 0,36 unit) */
    var S3_TAILLE = 3.0;   /* 1,8 puis 3,0 le 14/09 (« grossis encore ») — l'espacement des orbites suit (s3Layout) */
    function s3rand(s) { var v = Math.sin(s * 127.1) * 43758.5453; return v - Math.floor(v); }
    /* même chargement que solar3d : ImageBitmapLoader (réseau de l'extension, insensible à la
       CSP img-src de la page), <img> en repli ; rien hors ressource d'extension (WebView du mod) */
    /* ⚠ La même regex que TEX_URL_OK de solar3d : sans localhost/127.0.0.1 le labo
       (servi en http) n'avait JAMAIS de texture sur la carte — sphères unies. */
    /* + raw.githubusercontent.com : l'app Android n'embarque pas les textures, son shim les pointe sur
       le dépôt public de l'édition communauté (CORS « * », indispensable pour WebGL) */
    var S3_URL_OK = /^(chrome-extension|moz-extension|data|blob):|^https?:\/\/(localhost|127\.0\.0\.1)[:/]|^https:\/\/raw\.githubusercontent\.com\/|^https:\/\/astrowars\.games\/__awc\//;
    function s3Tex(name, lin) {
      var key = name + (lin ? "#lin" : "");
      if (S3.tex[key]) return S3.tex[key];
      S3.tex[key] = new Promise(function (res, rej) {
        var url;
        try { url = chrome.runtime.getURL("assets/planets/" + name); } catch (e) { rej(e); return; }
        if (!S3_URL_OK.test(url)) { rej(new Error("asset hors extension")); return; }
        var fin = function (t) {
          /* albédos, nuages, villes : sRGB ; spéculaire et relief : données linéaires */
          if (!lin) t.colorSpace = T.SRGBColorSpace;
          try { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1); } catch (e) {}
          t.needsUpdate = true;
          return t;
        };
        var viaImg = function () { new T.TextureLoader().load(url, function (t) { res(fin(t)); }, undefined, rej); };
        var ibl = null;
        try {
          /* au doigt : textures décodées à moitié de leur taille (mémoire graphique d'un téléphone) */
          var iblOpt = { imageOrientation: "flipY", premultiplyAlpha: "none" };
          if (MOBILE && !/ring_alpha/.test(name)) { iblOpt.resizeWidth = 512; iblOpt.resizeHeight = /_spec/.test(name) ? 128 : 256; iblOpt.resizeQuality = "medium"; }
          ibl = new T.ImageBitmapLoader().setOptions(iblOpt);
        }
        catch (e) { ibl = null; }
        if (!ibl) { viaImg(); return; }
        ibl.load(url, function (bmp) {
          var t = new T.Texture(bmp);
          t.flipY = false;
          res(fin(t));
        }, undefined, viaImg);
      });
      return S3.tex[key];
    }

    /* ── détail de la vue système (solar3d.js), recopié pour le bloc présenté ──
       relief + spéculaire + villes la nuit (mondes générés), nuages, voile vénusien,
       atmosphère au limbe, anneaux d'une géante sur deux, inclinaison d'axe ; mêmes
       fichiers, mêmes graines, mêmes réglages que la vue système. */
    var S3_ATMO = { continental: "#7ec0ff", ocean: "#63d8ff", lava: "#ff7a3a", ice: "#bfe4ff",
                    desert: "#f0c898", gas: "#e8c89a", dead: null };
    var S3_GAS_ATMO = { "jupiter.jpg": "#e8c090", "saturn.jpg": "#f0d8a8", "uranus.jpg": "#a0e0f0", "neptune.jpg": "#5878ff" };
    function s3Extra(map) {
      var m = /^world(\d)_day\.jpg$/.exec(map);
      if (m) return { earth: true, spec: "world" + m[1] + "_spec.jpg", normal: "world" + m[1] + "_normal.jpg", night: "world" + m[1] + "_night.jpg" };
      if (map === "venus_surface.jpg") return { veil: "venus_atmo.jpg" };
      return {};
    }
    function s3Geos() {
      if (S3.geos) return S3.geos;
      /* quatre variantes d'UV (miroirs) de la même sphère, comme PLANET_GEOS de solar3d */
      S3.geos = [0, 1, 2, 3].map(function (k) {
        var g = new T.SphereGeometry(1, 48, 32), uv = g.attributes.uv;
        for (var i = 0; k && i < uv.count; i++) {
          uv.setXY(i, (k & 1) ? 1 - uv.getX(i) : uv.getX(i), (k & 2) ? 1 - uv.getY(i) : uv.getY(i));
        }
        return g;
      });
      return S3.geos;
    }
    function s3NightMask(shader) {
      var key = "#include <emissivemap_fragment>";
      if (shader.fragmentShader.indexOf(key) < 0) return;
      shader.fragmentShader = shader.fragmentShader.replace(key, key +
        "\n#if NUM_POINT_LIGHTS > 0\n  vec3 awL = normalize(pointLights[0].position + vViewPosition);\n" +
        "  totalEmissiveRadiance *= smoothstep(0.18, -0.12, dot(normalize(vNormal), awL));\n#endif\n");
    }
    function s3Swap(mesh, mat, then) {
      var apply = function () { mesh.material = mat; if (then) then(); };
      if (typeof renderer.compileAsync !== "function") { apply(); return; }
      renderer.compileAsync(new T.Mesh(mesh.geometry, mat), camera, scene).then(apply, apply);
    }
    function s3Atmo(hex, amt) {
      if (!S3.sunU) S3.sunU = { value: new T.Vector3() };
      var m = new T.Mesh(s3Geos()[0], new T.ShaderMaterial({
        uniforms: { col: { value: new T.Color(hex) }, amt: { value: amt }, uSun: S3.sunU },
        vertexShader: "varying vec3 vN; varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0);" +
          " vN = normalize(mat3(modelMatrix) * normal); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }",
        fragmentShader: "uniform vec3 col; uniform float amt; uniform vec3 uSun; varying vec3 vN; varying vec3 vW;" +
          " void main(){ vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);" +
          " float rim = smoothstep(0.0, 0.34, -dot(N, V)); rim *= rim;" +
          " float sun = 0.22 + 0.78 * smoothstep(-0.35, 0.45, dot(N, normalize(uSun - vW)));" +
          " float a = rim * sun * amt; gl_FragColor = vec4(col * a, a); }",
        side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending
      }));
      m.scale.setScalar(1.07);
      m.renderOrder = 2;
      return m;
    }
    function s3Rings(tint) {
      var rIn = 1.28, rOut = 1.72, geo = new T.RingGeometry(rIn, rOut, 96, 1), pos = geo.attributes.position, v = new T.Vector3();
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        geo.attributes.uv.setXY(i, (v.length() - rIn) / (rOut - rIn), 0.5);
      }
      var mat = new T.MeshPhongMaterial({ color: tint, transparent: true, side: T.DoubleSide, depthWrite: false,
        opacity: 0.75, shininess: 4, specular: 0x050505 });
      var m = new T.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      m.visible = false;   /* un disque plein serait pire qu'aucun anneau */
      s3Tex("ring_alpha.png").then(function (t) {
        mat.map = t; mat.emissiveMap = t; mat.emissive.set(0xffffff); mat.emissiveIntensity = 1.25;
        mat.needsUpdate = true; m.visible = true;
      }, function () {});
      return m;
    }
    /* étiquette sous la planète, comme lblTex de solar3d : propriétaire [TAG] en couleur,
       puis « #n · pop · SB » (et le siège) */
    /* hauteur d'une étiquette de planète, en fraction de la hauteur de l'écran (taille FIXE :
       sizeAttenuation off) — 14/09 « on n'arrive pas à lire les noms » ; libres/inconnues plus petites */
    var S3_LBL_H = 0.062;   /* 0,074 puis 0,062 le 14/09 (« un poil trop gros par rapport aux planètes ») */
    function s3Label(s, p) {
      var W = 640, H = 180;
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var x = c.getContext("2d"), hex = planetHex(s, p), free = p.state === "free", unk = p.state === "unknown";
      x.textAlign = "left"; x.textBaseline = "alphabetic";
      x.shadowColor = "rgba(2,3,10,1)"; x.shadowBlur = 10;
      var owner = free ? "#" + p.idx + " libre" : unk ? "#" + p.idx + " inconnue" : (p.owner || "?");
      if (owner.length > 16) owner = owner.slice(0, 15) + "…";
      var tag = !free && !unk && p.tag ? " [" + p.tag + "]" : "";
      /* ligne 1 : propriétaire (blanc cassé) + [TAG] à la couleur de l'alliance, même taille */
      x.font = "700 70px 'Segoe UI',system-ui,sans-serif";
      var w1 = x.measureText(owner).width, w2 = tag ? x.measureText(tag).width : 0;
      var line2 = "";
      if (!free && !unk) {
        var parts = ["#" + p.idx, "pop " + (p.pop || 0)];
        if (p.sb > 0) parts.push("SB " + p.sb);
        if (p.siege) parts.push("⚔ siège");
        line2 = parts.join("  ·  ");
      }
      var fit = Math.min(1, (W - 24) / Math.max(1, w1 + w2));
      if (fit < 1) x.font = "700 " + Math.floor(70 * fit) + "px 'Segoe UI',system-ui,sans-serif";
      w1 = x.measureText(owner).width; w2 = tag ? x.measureText(tag).width : 0;
      var x0 = (W - w1 - w2) / 2;
      /* contour sombre : lisible sur les planètes et les nébuleuses */
      x.lineJoin = "round"; x.lineWidth = 10; x.strokeStyle = "rgba(3,4,10,.92)";
      x.strokeText(owner, x0, 78); if (tag) x.strokeText(tag, x0 + w1, 78);
      x.fillStyle = free || unk ? "rgba(185,198,230,.8)" : "#f2f5ff";
      x.fillText(owner, x0, 78);
      if (tag) { x.fillStyle = hex; x.fillText(tag, x0 + w1, 78); }
      var ink = w1 + w2;
      if (line2) {
        x.font = "600 46px 'Segoe UI',system-ui,sans-serif";
        var w3 = x.measureText(line2).width;
        x.lineWidth = 8; x.strokeText(line2, (W - w3) / 2, 146);
        x.fillStyle = p.siege ? "#ffb0b0" : "#b9c4e6";
        x.fillText(line2, (W - w3) / 2, 146);
        ink = Math.max(ink, w3);
      }
      var tx = new T.CanvasTexture(c);
      tx.colorSpace = T.SRGBColorSpace;
      tx.anisotropy = 4;
      var sp = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, depthTest: false,
        opacity: 0, sizeAttenuation: false }));
      /* sizeAttenuation off : l'échelle vaut une fraction de 2·tan(fov/2) — donc une hauteur fixe à l'écran */
      var k = (free || unk ? 0.62 : 1) * S3_LBL_H * 2 * Math.tan(camera.fov * Math.PI / 360);
      sp.scale.set(k * W / H, k, 1);
      sp.userData = { hFrac: (free || unk ? 0.62 : 1) * S3_LBL_H, hBase: (free || unk ? 0.62 : 1) * S3_LBL_H, ratio: W / H,
                      ink: (ink + 30) / W, prio: free || unk ? -1 : (p.pop || 0) + (p.sb || 0) * 0.1, alpha: 0 };
      sp.renderOrder = 5;
      sp.frustumCulled = false;
      sp.layers.set(LAYER_OPEN);
      sp.visible = false;
      return sp;
    }
    /* DÉ-ENCOMBREMENT des étiquettes de planètes du bloc présenté : les plus peuplées d'abord,
       une étiquette qui en chevaucherait une déjà placée s'efface (fondu). Hystérésis : une
       étiquette déjà affichée est testée avec une boîte réduite, pour ne pas clignoter quand
       deux planètes se croisent lentement. */
    var _s3Boxes = [];
    function s3Declutter(dt) {
      if (!S3.list.length) return;
      var cam = S3.sys === openSys && openF > 0 && openCam ? openCam : camera;
      var W = cw, H = ch, items = [];
      S3.list.forEach(function (it) {
        var sp = it.lbl;
        if (!sp || !sp.userData || !it.mesh.visible) { if (sp) sp.userData.want = 0; return; }
        _v.copy(sp.position).applyMatrix4(group.matrixWorld).project(cam);
        if (_v.z > 1) { sp.userData.want = 0; return; }
        var hpx = sp.userData.hFrac * H, wpx = sp.userData.ink * hpx * (640 / 180);
        items.push({ sp: sp, cx: (_v.x * .5 + .5) * W, cy: (-_v.y * .5 + .5) * H, w: wpx, h: hpx * 0.86 });
      });
      items.sort(function (a, b) { return b.sp.userData.prio - a.sp.userData.prio; });
      _s3Boxes.length = 0;
      items.forEach(function (a) {
        var shrink = a.sp.userData.alpha > 0.5 ? 0.82 : 1;
        var hw = a.w * shrink / 2, hh = a.h * shrink / 2, ok = true;
        for (var i = 0; i < _s3Boxes.length; i++) {
          var b = _s3Boxes[i];
          if (Math.abs(a.cx - b.cx) < hw + b.hw && Math.abs(a.cy - b.cy) < hh + b.hh) { ok = false; break; }
        }
        a.sp.userData.want = ok ? 1 : 0;
        if (ok) _s3Boxes.push({ cx: a.cx, cy: a.cy, hw: hw, hh: hh });
      });
      S3.list.forEach(function (it) {
        var u = it.lbl && it.lbl.userData;
        if (!u) return;
        u.alpha += ((u.want || 0) - u.alpha) * Math.min(1, (dt || 0.016) * 7);
      });
    }
    function s3Clear() {
      S3.list.forEach(function (it) {
        if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
        it.mesh.traverse(function (o) {
          if (!o.material) return;
          o.material.dispose();
          if (o.geometry && o.geometry.type === "RingGeometry") o.geometry.dispose();
        });
        if (it.lbl) {
          if (it.lbl.parent) it.lbl.parent.remove(it.lbl);
          if (it.lbl.material.map) it.lbl.material.map.dispose();
          it.lbl.material.dispose();
        }
        if (it.flash) { if (it.flash.parent) it.flash.parent.remove(it.flash); it.flash.material.dispose(); }
        if (it.ob.mesh3 === it.mesh) it.ob.mesh3 = null;
        if (it.ob.lbl3 === it.lbl) it.ob.lbl3 = null;
        if (it.ob.flash3 === it.flash) it.ob.flash3 = null;
      });
      S3.list = []; S3.sys = null;
      if (S3.light && S3.light.parent) S3.light.parent.remove(S3.light);
    }
    /* ── DISPOSITION DU SYSTÈME OUVERT ──────────────────────────────────────
       Avant : orbites fixes (0,30 + k × 0,055) × 6,5 — la première passait SUR l'anneau
       de possession à crans, et des planètes grossies se touchaient d'une orbite à
       l'autre. Maintenant, à partir du soleil déployé :
         · l'anneau à crans se resserre juste autour du soleil (donutOpen) ;
         · première orbite = bord extérieur de l'anneau + marge + rayon de la planète ;
         · chaque orbite suivante = précédente + rayon précédent + rayon suivant + marge.
       Rayon « encombrant » d'une planète = son atmosphère (×1,07) ou ses anneaux (×1,72).
       Les orbites tournant à des vitesses différentes, deux voisines se croisent : cet
       écart garantit qu'elles ne se touchent jamais (hors battement d'un siège). */
    var S3_MARGE = 0.07;   /* en unités de carte, entre deux planètes voisines */
    /* ── PLACEMENT EN ROUE À L'ANGLE D'OR (14/09, « améliore le placement, système trop large ») ──
       Avant : chaque planète gardait sa phase de la carte et sa vitesse propre ; elles finissaient
       groupées d'un côté, et il fallait écarter les orbites pour qu'elles ne se touchent pas en se
       croisant. Maintenant le système ouvert tourne D'UN BLOC, très lentement (PRESENT.wheel), et
       deux orbites voisines sont décalées de l'angle d'or (137,5°) : la disposition reste étalée en
       permanence, les étiquettes se gênent moins, et comme deux planètes ne se croisent plus jamais
       on peut resserrer les orbites. Les distances entre toutes les paires sont vérifiées (elles sont
       constantes, la roue étant rigide) ; si une paire se toucherait, l'écart grandit de 8 %. */
    var S3_GOLD = Math.PI * (3 - Math.sqrt(5));
    function s3Layout(sys) {
      var lvS = starIdx(sys.popLevel), rkS = sys.richK || 1;
      var sunR = unit * (0.24 + lvS * 0.035) * rkS * 2.2;          /* rayon du soleil déployé (cf. updateMap) */
      /* bande du donut : rayons 0,746 à 0,879 du demi-côté du plan (arc 104/128 px, trait 17 px) */
      var donutS = Math.max(sunR * 1.12 / 0.746, unit * 0.5);
      var its = S3.list.slice().sort(function (a, b) { return a.ob.k - b.ob.k; });
      /* rayon « encombrant » : atmosphère ×1,07 ; anneaux ×1,45 (inclinés) */
      var eff = its.map(function (it) { var ud = it.mesh.userData; return unit * ud.r * (ud.ringed ? 1.45 : 1.07); });
      var n = its.length, m = unit * S3_MARGE;
      its.forEach(function (it, i) { it.ob.gold = i; });
      sys.openRot = 0;
      sys.wheel0 = s3rand((+sys.id || 0) + 0.37) * Math.PI * 2;   /* départ propre à chaque système, stable */
      if (!n) { sys.radOpen = []; sys.donutOpen = donutS; sys.outerOpen = unit * 5.9; return; }
      var pairs = [];
      for (var i = 1; i < n; i++) pairs.push(eff[i - 1] + eff[i]);
      pairs.sort(function (a, b) { return a - b; });
      var med = pairs.length ? pairs[Math.floor(pairs.length / 2)] : eff[0] * 2;
      /* écart régulier resserré : ~0,7 × la paire médiane ; une orbite ne passe jamais à moins de
         0,72 × (rayon voisin + rayon) de la précédente, pour que les corps n'effacent pas les tracés */
      var G = med * 0.7 + m, radii = null;
      for (var essai = 0; essai < 30 && !radii; essai++) {
        var R = donutS * 0.879 + Math.max(G * 0.9, eff[0] * 1.4 + m * 2), rr = [R], ok = true;
        for (var j = 1; j < n; j++) { R += Math.max(G, (eff[j - 1] + eff[j]) * 0.72 + m); rr.push(R); }
        for (var a = 0; a < n && ok; a++) {
          for (var b = a + 1; b < n; b++) {
            var d = Math.sqrt(rr[a] * rr[a] + rr[b] * rr[b] - 2 * rr[a] * rr[b] * Math.cos((b - a) * S3_GOLD));
            if (d < eff[a] + eff[b] + m) { ok = false; break; }
          }
        }
        if (ok) radii = rr; else G *= 1.08;
      }
      if (!radii) { radii = []; var R2 = donutS * 0.879 + eff[0] + m * 2; for (var q = 0; q < n; q++) { if (q) R2 += eff[q - 1] + eff[q] + m; radii.push(R2); } }
      var rad = [];
      its.forEach(function (it, i2) { rad[it.ob.k] = radii[i2]; });
      sys.radOpen = rad;
      sys.donutOpen = donutS;
      sys.outerOpen = radii[n - 1] + eff[n - 1];
    }
    function s3Build(sys) {
      s3Clear();
      if (!group) return;
      if (!S3.geo) S3.geo = new T.SphereGeometry(1, 32, 20);
      if (!S3.amb) {
        var amb = new T.AmbientLight(0x4a5a8c, 1.15);
        amb.layers.enable(LAYER_OPEN);        /* les lumières sont filtrées par couche : la passe 3 doit les voir */
        scene.add(amb); S3.amb = true;
      }
      if (!S3.light) { S3.light = new T.PointLight(0xfff2dc, 3.4, 0, 0); S3.light.layers.enable(LAYER_OPEN); }
      group.add(S3.light);
      S3.sys = sys;
      var taken = { arch: {}, tex: {} };
      orbits.filter(function (ob) { return ob.s === sys && ob.p; })
        .sort(function (a, b) { return (a.p.idx || 0) - (b.p.idx || 0); })
        .forEach(function (ob) {
          var p = ob.p, seed = p.idx * 7.3 + ((+sys.id || 0) % 50), free = p.state === "free", arch;
          if (free) arch = "dead";
          else {
            var list = S3_ARCH[s3Zone(p.idx)], start = Math.floor(s3rand(seed + 11.3) * list.length) % list.length;
            var best = list[start], bestN = taken.arch[best] || 0;
            for (var k = 1; k < list.length && bestN > 0; k++) {
              var cand = list[(start + k) % list.length], n = taken.arch[cand] || 0;
              if (n < bestN) { best = cand; bestN = n; }
            }
            arch = best;
          }
          taken.arch[arch] = (taken.arch[arch] || 0) + 1;
          var fam = S3_FAM[arch], ts = Math.min(fam.length - 1, Math.floor(s3rand(seed + 1.7) * fam.length)), map = fam[ts];
          for (var q = 0; q < fam.length; q++) {
            var c2 = fam[(ts + q) % fam.length];
            if (!taken.tex[c2]) { taken.tex[c2] = 1; map = c2; break; }
          }
          var tint = new T.Color(1, 1, 1).lerp(new T.Color().setHSL(s3rand(seed), 0.5, 0.5), 0.08);
          if (arch === "ocean") tint.lerp(new T.Color("#9cd0ff"), 0.22);
          if (arch === "continental") tint.lerp(new T.Color("#e0f0c0"), 0.16);
          if (arch === "ice") tint.lerp(new T.Color("#bcd6ff"), 0.4);
          if (arch === "lava") tint.lerp(new T.Color("#ff9a48"), 0.5);
          var ex = s3Extra(map), earth = !!ex.earth, geos = s3Geos();
          var pg = new T.Group();
          var matP = new T.MeshPhongMaterial({ color: new T.Color(S3_REPLI[arch]), shininess: earth ? 26 : 6,
            specular: new T.Color(earth ? 0x66788a : 0x0c0c0c) });
          var body = new T.Mesh(geos[Math.floor(s3rand(seed + 23.9) * 4) & 3], matP);
          pg.add(body);
          /* toutes les cartes de la planète attendues ensemble, puis un matériau neuf compilé à part */
          var lights = Math.min(1, (p.pop || 0) / 6), withNight = earth && lights > 0;
          var wants = [s3Tex(map)];
          if (earth) { wants.push(s3Tex(ex.spec, true), s3Tex(ex.normal, true)); if (withNight) wants.push(s3Tex(ex.night)); }
          (function (body, matP, tint, arch, earth, withNight, lights) {
            Promise.allSettled(wants).then(function (rs) {
              var got = function (i) { return rs[i] && rs[i].status === "fulfilled" ? rs[i].value : null; };
              if (!got(0) || !body.parent) return;
              var m2 = new T.MeshPhongMaterial({ map: got(0), color: tint.clone(), shininess: earth ? 26 : 6,
                specular: new T.Color(earth ? 0x66788a : 0x0c0c0c) });
              if (arch === "lava") { m2.emissive.set("#4a1200"); m2.emissiveIntensity = 1.0; }
              if (earth) {
                if (got(1)) m2.specularMap = got(1);
                if (got(2)) { m2.normalMap = got(2); m2.normalScale.set(0.85, 0.85); }
                if (withNight && got(3)) {
                  m2.emissiveMap = got(3); m2.emissive.set("#ffb45a");
                  m2.emissiveIntensity = 0.3 + 1.1 * lights;
                  m2.onBeforeCompile = s3NightMask;
                }
              }
              s3Swap(body, m2, function () { matP.dispose(); });
            });
          })(body, matP, tint, arch, earth, withNight, lights);
          var clouds = null, cloudFile = earth ? "earth_clouds.jpg" : (ex.veil || null);
          if (cloudFile) {
            var cm = new T.MeshPhongMaterial({ color: 0xffffff, transparent: true, depthWrite: false,
              opacity: earth ? 1.0 : 0.42, shininess: 3, specular: 0x000000 });
            clouds = new T.Mesh(geos[Math.floor(s3rand(seed + 27.1) * 4) & 3], cm);
            clouds.scale.setScalar(1.018);
            clouds.renderOrder = 1;
            clouds.visible = false;
            (function (clouds, cm, earth) {
              s3Tex(cloudFile).then(function (t) {
                if (earth) cm.alphaMap = t; else cm.map = t;
                cm.needsUpdate = true; clouds.visible = true;
              }, function () {});
            })(clouds, cm, earth);
            pg.add(clouds);
          }
          var atmoHex = arch === "gas" ? (S3_GAS_ATMO[map] || S3_ATMO.gas) : S3_ATMO[arch];
          if (atmoHex) pg.add(s3Atmo(atmoHex, arch === "gas" ? 0.5 : 0.65));
          var ringed = arch === "gas" && s3rand(seed + 21.7) < 0.5;
          if (ringed) pg.add(s3Rings(new T.Color(S3_GAS_ATMO[map] || S3_ATMO.gas).lerp(new T.Color(1, 1, 1), 0.65)));
          /* inclinaison d'axe déterministe (anneaux franchement couchés), comme la vue système */
          pg.rotation.z = (s3rand(seed + 9.1) - 0.5) * 0.6;
          pg.rotation.x = ringed ? (s3rand(seed + 9.7) < 0.5 ? -1 : 1) * (0.45 + s3rand(seed + 9.9) * 0.35)
                                 : (s3rand(seed + 9.7) - 0.5) * 0.3;
          pg.visible = false;
          pg.userData = {
            r: S3_TAILLE * (free ? 0.066 : 0.1 * S3_BASER[arch] * (0.85 + Math.min(8, p.pop || 0) * 0.045)),
            spin: 0.06 + s3rand(seed + 13.7) * 0.16, rot0: s3rand(seed + 17.3) * Math.PI * 2,
            body: body, clouds: clouds, ringed: ringed
          };
          /* dessinées UNIQUEMENT en passe 3, à la place de présentation */
          pg.traverse(function (o) { o.layers.set(LAYER_OPEN); o.frustumCulled = false; });
          group.add(pg);
          var lbl = s3Label(sys, p);
          group.add(lbl);
          var flash = new T.Sprite(new T.SpriteMaterial({ map: haloTex(), color: free ? "#cfd8ff" : planetHex(sys, p),
            transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
          flash.frustumCulled = false; flash.visible = false; flash.renderOrder = 4;
          flash.layers.set(LAYER_OPEN);
          group.add(flash);
          ob.mesh3 = pg; ob.lbl3 = lbl; ob.flash3 = flash;
          S3.list.push({ ob: ob, mesh: pg, lbl: lbl, flash: flash });
        });
      s3Layout(sys);
    }
    var inspector = null, orbitLines = [], scanRing = null, rangeRing = null, visionRing = null;

    /* ── MASQUE SOUS LES ANNEAUX DU SYSTÈME OUVERT ──────────────────────────
       Estomper le décor ne suffisait pas : on voyait encore, entre les orbites,
       les systèmes voisins, leurs noms, leurs halos et le repère. Quand un
       système est ouvert (desktop), l'image se fait en TROIS passes :
         1. la scène normale ;
         2. un disque couleur fond de carte, dans le plan du système, rayon =
            anneau extérieur (+ balayage et dépassement de la cascade), dessiné
            PAR-DESSUS tout (depthTest off) ;
         3. la couche LAYER_OPEN seule, redessinée sur le disque : le nœud du
            système ouvert (sauf son halo d'alliance), ses orbites, ses planètes
            texturées, leurs lumières, et les flottes.
       Le disque vit dans sa propre scène, sa matrixWorld est calculée à la main
       (group.matrixWorld × position/rotation/échelle) : pas d'arbre à recomposer. */
    var LAYER_OPEN = 1, occScene = null, occ = null, occNode = null, occStars = null;
    var _occL = null, _occQ = null, _occS = null, _occP = null;
    function occTexture() {
      var c = document.createElement("canvas"); c.width = c.height = 256;
      var x = c.getContext("2d"), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.9, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
      var tx = new T.CanvasTexture(c);
      tx.colorSpace = T.SRGBColorSpace;
      return tx;
    }
    function occSetLayer(node, on) {
      if (!node) return;
      node.traverse(function (o) {
        if (o.renderOrder === -3) return;   /* halo d'alliance (infl) : reste sur la carte, sous le masque */
        /* ouvert : le système quitte la carte (couche 0) et n'est plus dessiné qu'en présentation */
        o.layers.set(on ? LAYER_OPEN : 0);
      });
    }
    /* système à masquer : l'actif s'il est déployé, sinon celui qui se replie */
    function occTarget(active) {
      if (active && active.deploy > .02 && active.vis) return active;
      if (S3.sys && S3.sys.deploy > .02 && S3.sys.vis) return S3.sys;
      return null;
    }
    /* ── PRÉSENTATION du système ouvert ─────────────────────────────────────
       Le bloc (soleil, orbites, planètes) glisse vers une place fixe de l'écran,
       à gauche et un peu haut, légèrement incliné vers la gauche ; la fiche va à
       droite (placeTip). La CARTE ne bouge pas : c'est une caméra à part
       (openCam), copie de la caméra principale braquée sur le système — même
       distance donc même zoom — décalée par setViewOffset et roulée. Le survol
       et le glissé de la carte continuent de viser la carte ; seules les
       planètes du bloc sont projetées avec openCam (clic / survol justes). */
    /* x, y   : place du bloc (fractions de l'écran)
       roll   : inclinaison de l'image (rad, > 0 = vers la gauche) — .10, .22, puis -.22 le 14/09
       pitch  : le plan des orbites est vu plus RASANT (rad ajoutés à l'angle depuis la verticale,
                plafonné à PITCH_MAX pour ne jamais passer sous le plan)
       disc   : opacité du masque sous les anneaux
       size   : rayon de l'anneau extérieur à l'écran, en fraction de la hauteur (le bloc n'est jamais plus petit) — plein écran
       sizeBloc : idem dans le bloc de la carte du jeu (hors plein écran), plus petit pour laisser la place à la fiche
       orbit  : vitesse des orbites du système ouvert (1 = celle de la carte) — « très lentement », 14/09
       spin   : vitesse de rotation propre des planètes du bloc (1 = vue système)
       wheel  : rotation d'ensemble du système ouvert (rad/s ; ,025 ≈ un tour en 4 min) — cf. s3Layout
       sizePortrait / yPortrait : téléphone en portrait — rayon en fraction de la LARGEUR (,44 débordait : perspective + inclinaison), centre à 30 % de la hauteur */
    var PRESENT = { x: .31, y: .47, roll: -.22, pitch: .38, disc: .82, size: .44, sizeBloc: .34, orbit: .06, spin: .35, wheel: .025, sizePortrait: .42, yPortrait: .30 }, PITCH_MAX = 1.36;   /* roll < 0 : penché à DROITE (14/09 « de l'autre côté, même inclinaison ») */
    var openCam = null, openSys = null, openF = 0, _openW = null, _openD = null, _openT = null, _openO = null;
    function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
    function updateOpenCam(s) {
      if (!openCam) {
        openCam = new T.PerspectiveCamera();
        _openW = new T.Vector3(); _openD = new T.Vector3(); _openT = new T.Vector3(); _openO = new T.Vector3();
      }
      openF = smooth01(s.deploy * 1.25);
      openCam.copy(camera, false);
      /* même orientation, même distance, mais braquée sur le système (en proportion de openF) */
      _openW.set(s.cx * unit, s.node.position.y, s.cy * unit).applyMatrix4(group.matrixWorld);
      _openD.copy(_openW).sub(target).multiplyScalar(openF);
      openCam.position.add(_openD);
      _openT.copy(target).add(_openD);                 /* point visé = cible → système */
      /* plan plus incliné : on tourne autour du point visé, en éloignant la caméra de la verticale */
      _openO.copy(openCam.position).sub(_openT);
      var rr = _openO.length() || 1;
      /* bloc en GRAND : distance telle que l'anneau extérieur (système déployé) fasse
         PRESENT.size de la hauteur — jamais plus loin que la caméra de la carte */
      var rFull = (s.outerOpen || unit * (.30 + 11 * .055) * 6.5) * 1.1;
      var portrait = ch > cw * 1.05;
      /* portrait (téléphone) : l'anneau extérieur fait PRESENT.sizePortrait de la LARGEUR */
      var sizeK = portrait ? PRESENT.sizePortrait * cw / ch : (isFull() ? PRESENT.size : PRESENT.sizeBloc);
      var dWant = rFull / (2 * sizeK * Math.tan(camera.fov * Math.PI / 360));
      /* taille FIXE à l'écran, quel que soit le zoom de la carte (avant : jamais plus loin que la caméra
         de la carte — après une recherche, qui rapproche la caméra, le système débordait du téléphone) */
      rr = rr + (dWant - rr) * openF;
      var ph = Math.acos(Math.max(-1, Math.min(1, _openO.y / (_openO.length() || 1)))), th = Math.atan2(_openO.x, _openO.z);
      var ph2 = ph >= PITCH_MAX ? ph : Math.min(PITCH_MAX, ph + PRESENT.pitch * openF);
      _openO.set(rr * Math.sin(ph2) * Math.sin(th), rr * Math.cos(ph2), rr * Math.sin(ph2) * Math.cos(th));
      openCam.position.copy(_openT).add(_openO);
      openCam.lookAt(_openT);
      openCam.rotateZ(-PRESENT.roll * (portrait ? 0.6 : 1) * openF);   /* caméra roulée à droite = image penchée à gauche */
      var W = Math.max(1, cw), H = Math.max(1, ch);
      var px = portrait ? 0.5 : PRESENT.x, py = portrait ? PRESENT.yPortrait : PRESENT.y;
      openCam.setViewOffset(W, H, (.5 - px) * W * openF, (.5 - py) * H * openF, W, H);
      openCam.updateMatrixWorld();
    }
    /* le pointeur est-il sur le bloc présenté ? (garde le système ouvert quand on va vers ses planètes) */
    var openEllipse = null;
    function onOpenBlock(mx, my) {
      var e = openEllipse;
      if (!e || !openSys || openF < .5) return false;
      var dx = mx - e.x, dy = my - e.y, c = Math.cos(-e.ang), sn = Math.sin(-e.ang);
      var u = dx * c - dy * sn, v = dx * sn + dy * c;
      return (u * u) / (e.a * e.a) + (v * v) / (e.b * e.b) <= 1;
    }
    function renderOpen(active) {
      var s = occTarget(active);
      if (occNode !== (s ? s.node : null)) {
        occSetLayer(occNode, false);
        occNode = s ? s.node : null;
        occSetLayer(occNode, true);
      }
      openSys = s;
      if (!s) { openF = 0; openEllipse = null; return; }
      updateOpenCam(s);
      if (!occScene) {
        occScene = new T.Scene();
        occScene.matrixWorldAutoUpdate = false;
        occ = new T.Mesh(new T.CircleGeometry(1, 96), new T.MeshBasicMaterial({
          color: 0x04050c, map: occTexture(), transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide }));
        occ.matrixAutoUpdate = false;
        occ.frustumCulled = false;
        occScene.add(occ);
        /* FOND D'ÉTOILES (14/09) : triangle plein écran, étoiles procédurales en coordonnées
           d'écran (3 couches, tailles et teintes variées, scintillement), voile de nébuleuse
           à la couleur du système. Additif : par-dessus le disque sombre, sous le système
           (passe 3) ; hors du bloc, le voile CSS les atténue comme le reste de la carte. */
        var stGeo = new T.BufferGeometry();
        stGeo.setAttribute("position", new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
        occStars = new T.Mesh(stGeo, new T.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uTint: { value: new T.Color("#9fb4ff") } },
          vertexShader: "void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }",
          fragmentShader: [
            "uniform float uTime; uniform float uAlpha; uniform vec3 uTint;",
            "float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }",
            "float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
            "  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }",
            "void main(){",
            "  vec2 uv = gl_FragCoord.xy; vec3 col = vec3(0.0);",
            "  for (int L = 0; L < 3; L++) {",
            "    float fl = float(L), cell = 16.0 + fl * 15.0;",
            "    vec2 g = uv / cell + fl * 7.13; vec2 id = floor(g); vec2 f = fract(g) - 0.5;",
            "    float r = h21(id + fl * 17.0);",
            "    if (r > 0.83 - fl * 0.04) {",
            "      vec2 off = vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5;",
            "      float d = length(f - off * 0.7);",
            "      float sz = mix(0.035, 0.11, h21(id + 11.3)) * (1.0 - fl * 0.22);",
            "      float tw = 0.55 + 0.45 * sin(uTime * (0.7 + 2.6 * h21(id + 5.5)) + r * 40.0);",
            "      float st = smoothstep(sz, 0.0, d) * tw * (1.0 - fl * 0.25);",
            "      vec3 c = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.88, 0.72), h21(id + 9.9));",
            "      col += c * st * 1.6;",
            "    }",
            "  }",
            "  float nb = vn(uv / 340.0 + vec2(uTime * 0.006, 0.0)) * 0.65 + vn(uv / 140.0) * 0.35;",
            "  col += uTint * pow(nb, 3.0) * 0.14;",
            "  gl_FragColor = vec4(col * uAlpha, 1.0);",
            "}"
          ].join("\n"),
          transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending
        }));
        occStars.frustumCulled = false;
        occStars.renderOrder = 1;
        occScene.add(occStars);
        _occL = new T.Matrix4(); _occQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
        _occS = new T.Vector3(); _occP = new T.Vector3();
      }
      var dep = Math.max(0, Math.min(1, s.deploy));
      var R = s.outerOpen ? (unit * .9 + (s.outerOpen * 1.12 - unit * .9) * dep)
                          : unit * (.30 + 11 * .055) * (1 + dep * 5.5) * 1.2;
      _occP.set(s.cx * unit, s.node.position.y, s.cy * unit);
      _occS.set(R, R, R);
      _occL.compose(_occP, _occQ, _occS);
      occ.matrixWorld.multiplyMatrices(group.matrixWorld, _occL);
      /* un peu de transparence : on devine la carte derrière le bloc */
      occ.material.opacity = Math.min(PRESENT.disc, dep * 1.6);
      if (occStars) {
        occStars.material.uniforms.uTime.value = clock.elapsedTime;
        occStars.material.uniforms.uAlpha.value = Math.min(1, dep * 1.4);
        if (s.hex && /^#[0-9a-f]{6}$/i.test(s.hex)) occStars.material.uniforms.uTint.value.set(s.hex);
      }

      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(occScene, openCam);
      renderer.clearDepth();
      openCam.layers.set(LAYER_OPEN);
      renderer.render(scene, openCam);
      renderer.autoClear = true;
    }
    var fleets = [], fleetGroup = null, loaded = null;
    /* Comme la carte du jeu : la couleur des astres suffit, les tags sur
       chaque système encombraient. Le halo d'alliance porte la lecture
       politique, le détail vient au survol. */
    /* tags : 0 aucun / 1 sans chevauchement / 2 tous — trois états, pas un
       booléen (cf. le bouton « Noms »). 1 reste le défaut. */
    var layers = {flat:false, grid:true, tags:1, star:false, fleets:true, fog:false};
    var LAYERS0 = {grid:true, tags:1, star:false, fleets:true, fog:false};
    var filters = {mine:false, ally:false, enemy:false, free:false};
    var range = 8, sel = null, hov = null, hovPlanet = null, hovFleet = null, circleGeo = null;

    /* ── 5.5 · textures et matériaux ───────────────────────────────────────
       TOUT ce qui est fabriqué ici est PARTAGÉ et mis en cache par clé.
       Quatre cicatrices, toutes payées cher, qui gouvernent ce bloc :

       ⚠ (1) three r160 a SUPPRIMÉ RGBFormat. `T.RGBFormat` vaut undefined, le
         constructeur de DataTexture retombe sur RGBA et réclame QUATRE octets
         par texel : une palette à 3 octets donne « texSubImage2D:
         ArrayBufferView not big enough », la texture reste NOIRE et tout ce
         qui lit ses couleurs est peint en noir sur noir — sans une seule
         erreur JS. Toute DataTexture ajoutée ici doit être en RGBAFormat
         explicite, 4 octets par entrée.

       ⚠ (2) fwidth() exige material.extensions = { derivatives: true }.
         Écrire la directive #extension dans le source du shader NE MARCHE
         PAS : three insère son préambule avant, la compilation échoue et le
         matériau tombe en silence.

       ⚠ (3) La géométrie d'un T.Sprite est PARTAGÉE par tout three : ne
         JAMAIS la disposer (cf. disposeTree).

       ⚠ (4) cached(kind, key) rend un matériau partagé PAR CLÉ : muter son
         .opacity ou son .color affecte tous ceux qui partagent la clé. Seul
         « syslbl » a une clé unique par système, c'est le seul qu'on ait le
         droit de fondre. */

    var texCache = {}, matCache = {};

    function haloTex() {
      if (texCache.halo) return texCache.halo;
      var c = document.createElement("canvas"); c.width = c.height = 128;
      var x = c.getContext("2d"), g = x.createRadialGradient(64,64,0,64,64,64);
      g.addColorStop(0,"rgba(255,255,255,1)"); g.addColorStop(.22,"rgba(255,255,255,.55)");
      g.addColorStop(.55,"rgba(255,255,255,.13)"); g.addColorStop(1,"rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0,0,128,128);
      texCache.halo = new T.CanvasTexture(c);
      return texCache.halo;
    }
    function softTex() {
      if (texCache.soft) return texCache.soft;
      var c = document.createElement("canvas"); c.width = c.height = 128;
      var x = c.getContext("2d"), g = x.createRadialGradient(64,64,0,64,64,64);
      g.addColorStop(0,"rgba(255,255,255,.5)"); g.addColorStop(.45,"rgba(255,255,255,.2)");
      g.addColorStop(1,"rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0,0,128,128);
      texCache.soft = new T.CanvasTexture(c);
      return texCache.soft;
    }
    /* Textures de TEXTE : pas de mipmaps. Elles ne sont ni carrées ni en
       puissance de deux (512×64), donc three les redimensionnait à l'envoi
       pour pouvoir construire la chaîne de mips — un redimensionnement de
       canvas par étiquette au démarrage, et un tiers de mémoire vidéo en plus,
       pour des mips qu'on ne voit jamais : sous le seuil d'affichage des noms,
       l'étiquette est déjà masquée. */
    function flatTex(c) {
      var t = new T.CanvasTexture(c);
      t.generateMipmaps = false;
      t.minFilter = T.LinearFilter;
      return t;
    }

    /* ── L'ANNEAU DE POSSESSION ────────────────────────────────────────────
       Le tour est divisé par le NOMBRE DE PLANÈTES PRISES, pas par douze : une
       prise = un cran sur tout le cercle, six = six crans de 60°, douze =
       douze crans de 30°. Une prise de plus RESSERRE les crans au lieu d'en
       allumer un de plus dans un cercle à trous — c'est la progression qui
       doit se voir. Le jeu entre deux crans se réduit avec leur nombre, sinon
       douze crans ne seraient plus que du vide.
       Chaque cran porte la couleur de l'alliance qui tient la planète, et les
       couleurs arrivent déjà GROUPÉES (cf. pris.sort() dans buildMap) pour que
       chaque alliance forme un arc d'un seul tenant.
       Rayon : r = 104 dans un canvas de 256, soit 104/128 = 0,8125 du demi-
       côté. Le quad étant à l'échelle unit*ringK, le rayon VISIBLE de l'anneau
       vaut donc unit*ringK*0,8125 — c'est ce nombre-là qu'il faut comparer aux
       distances entre systèmes, pas ringK. */
    function donutTex(key) {
      var k = "dn|" + key;
      if (texCache[k]) return texCache[k];
      var c = document.createElement("canvas"); c.width = c.height = 256;
      var x = c.getContext("2d");
      var cols = key ? key.split(",") : [];
      /* PAS DE RAIL DE FOND. Le cercle complet en filigrane servait à lire les
         crans comme une jauge, mais il se lisait surtout comme « les
         emplacements libres » — exactement ce qu'on ne veut pas montrer.
         L'anneau ne dessine plus que ce qui est PRIS, et rien d'autre. */
      var NC = cols.length;
      if (!NC) { texCache[k] = new T.CanvasTexture(c); return texCache[k]; }
      /* Le jeu entre deux crans est PROPORTIONNEL au pas, avec un plancher et
         un plafond. Un jeu fixe collait les crans quand ils étaient nombreux
         (à douze crans, 0,075 rad ne sépare presque rien) et découpait
         inutilement quand ils étaient deux. Plancher 0,055 : en dessous, deux
         crans voisins se touchent à l'écran et on ne peut plus les compter. */
      var PAS = Math.PI * 2 / NC;
      var JEU = Math.max(0.055, Math.min(0.16, PAS * 0.17));
      x.lineCap = "butt";
      for (var i2 = 0; i2 < NC; i2++) {
        var col = cols[i2];
        if (!col) continue;
        var a0 = -Math.PI / 2 + i2 * PAS + JEU;
        var a1 = -Math.PI / 2 + (i2 + 1) * PAS - JEU;
        x.beginPath(); x.arc(128, 128, 104, a0, a1);
        x.strokeStyle = col;
        x.lineWidth = 17;
        x.globalAlpha = .95;
        x.stroke();
      }
      x.globalAlpha = 1;
      texCache[k] = new T.CanvasTexture(c);
      return texCache[k];
    }

    /* Étiquette au format du jeu : « Korneforos [13] (6/-6) ». Les coordonnées
       y figurent, c'est ce qu'on lit pour se repérer ; « ID 13 » seul ne
       servait à rien. */
    function sysLblTex(name, id, cx, cy) {
      var k = "sl|" + name + "|" + id + "|" + cx + "/" + cy;
      if (texCache[k]) return texCache[k];
      /* Format RELEVÉ SUR LA CARTE DU JEU : un seul <span>, « Nom [id] (x/y) »
         d'un bloc, blanc pur, 9 px Verdana en graisse normale. On copie tout,
         sauf l'ombre portée qu'on garde : le jeu écrit sur un fond uni, nous
         sur une galaxie. */
      var c = document.createElement("canvas"); c.width = 512; c.height = 64;
      var x = c.getContext("2d");
      x.textAlign = "center"; x.textBaseline = "middle";
      x.shadowColor = "rgba(2,3,10,.95)"; x.shadowBlur = 8;
      /* L'ID EST PARTI EN HAUT, contre le tag d'alliance. En vue de dessus
         « Nom [id] (x/y) » tombait tres bas sous l'anneau, et cette ligne,
         la plus longue de la carte, reservait une boite de de-encombrement
         si large qu'elle faisait taire ses voisines. Il reste « Nom (x/y) ».
         `id` est garde en parametre : il fait partie de la cle de cache. */
      var txt = name + " (" + cx + "/" + cy + ")";
      var fs = 38;
      x.font = fs + "px Verdana, Geneva, sans-serif";
      var tw = x.measureText(txt).width;
      /* les lignes longues (« Ras al Asad al Shamaliyy [56] (-3/-12) »)
         débordaient du canvas : on réduit jusqu'à tenir dans les 512 px */
      if (tw > 496) {
        fs = Math.max(20, Math.floor(fs * 496 / tw));
        x.font = fs + "px Verdana, Geneva, sans-serif";
        tw = x.measureText(txt).width;
      }
      x.fillStyle = "#ffffff"; x.fillText(txt, 256, 34);
      texCache[k] = flatTex(c);
      /* Fraction du sprite réellement ENCRÉE. Le canvas fait toujours 512 px
         de large, mais « Rana [1] (0/0) » n'en noircit que 200 : réserver la
         largeur du sprite pour le dé-encombrement faisait taire des voisins
         pour du vide, d'où des noms manquants sans raison visible. */
      texCache[k].__inkW = Math.min(1, (tw + 16) / 512);
      return texCache[k];
    }

    /* Plusieurs tags d'alliance côte à côte, chacun dans SA couleur.
       ⚠ La clé est une liste "TAG:#hex,TAG2:#hex2" jointe et redécoupée par
       des VIRGULES : une couleur écrite hsl(332,65%,45%) la casse au mauvais
       endroit et l'écran affiche « TUGA · 65 · 45% ». Toutes les couleurs qui
       entrent ici viennent de tagColor/colorPour, qui ne rendent que du hex —
       ne jamais y faire entrer autre chose. */
    function allianceTexMulti(key) {
      var k = "anm|" + key;
      if (texCache[k]) return texCache[k];
      /* La cle se termine par "|<id du systeme>" : la ligne du haut porte les
         tags PUIS l'id. La partie avant "|" peut etre vide — un systeme sans
         alliance n'affiche alors que son id.
         ⚠ Consequence : cette texture est PROPRE A CHAQUE SYSTEME, la ou
         elle etait partagee par toute une alliance. Le canvas passe donc de
         640×80 a 448×56 (~3× moins de pixels) pour compenser. */
      var bar = key.lastIndexOf("|");
      var sysId = bar >= 0 ? key.slice(bar + 1) : "";
      var tagPart = bar >= 0 ? key.slice(0, bar) : key;
      var parts = tagPart ? tagPart.split(",").map(function (p2) {
        var i2 = p2.lastIndexOf(":");
        return { tag: p2.slice(0, i2), hex: p2.slice(i2 + 1) };
      }) : [];
      var CW = 448, CH = 56, MID = 30;
      var c = document.createElement("canvas"); c.width = CW; c.height = CH;
      var x = c.getContext("2d");
      x.textBaseline = "middle"; x.textAlign = "left";
      x.font = "600 34px 'Segoe UI', system-ui, sans-serif";
      x.lineJoin = "round"; x.miterLimit = 2;
      var sep = "  ·  ";
      var wids = parts.map(function (p2) { return x.measureText(p2.tag).width; });
      var sepW = parts.length > 1 ? x.measureText(sep).width : 0;
      var total = wids.reduce(function (a2, b2) { return a2 + b2; }, 0)
                + sepW * Math.max(0, parts.length - 1);
      var idTxt = sysId ? (parts.length ? " [" + sysId + "]" : "[" + sysId + "]") : "";
      x.font = "600 27px 'Segoe UI', system-ui, sans-serif";
      var idW = idTxt ? x.measureText(idTxt).width : 0;
      var cx2 = Math.max(3, (CW - (total + idW)) / 2);
      x.font = "600 34px 'Segoe UI', system-ui, sans-serif";
      parts.forEach(function (p2, i2) {
        x.globalAlpha = 1;
        /* cerne sombre : le jeu écrit sur sa grille, nous par-dessus une
           galaxie — sans cerne un tag sombre disparaît dans le fond. Il ne
           change pas la teinte ; c'est readableTag qui remonte la luminosité
           du TEXTE seul, les aplats gardent la couleur brute. */
        x.strokeStyle = "rgba(2,3,10,.92)"; x.lineWidth = 6;
        x.strokeText(p2.tag, cx2, MID);
        x.fillStyle = readableTag(p2.hex);
        x.fillText(p2.tag, cx2, MID);
        cx2 += wids[i2];
        if (i2 < parts.length - 1) {
          x.shadowBlur = 0; x.fillStyle = "rgba(190,200,235,.7)";
          x.fillText(sep, cx2, MID);
          cx2 += sepW;
        }
      });
      if (idTxt) {
        /* gris bleuté et plus petit : present, mais jamais en concurrence de
           lecture avec le tag, qui reste l'information principale de la ligne */
        x.font = "600 27px 'Segoe UI', system-ui, sans-serif";
        x.strokeStyle = "rgba(2,3,10,.92)"; x.lineWidth = 6;
        x.strokeText(idTxt, cx2, MID);
        x.fillStyle = "rgba(176,190,222,.95)";
        x.fillText(idTxt, cx2, MID);
      }
      /* flatTex et non CanvasTexture : le canvas n'est ni carré ni une
         puissance de deux, il payait un redimensionnement pour des mips
         jamais lues. */
      texCache[k] = flatTex(c);
      return texCache[k];
    }

    /* etiquette de vol : « → Al Bali #12 · 4 h 55 » ne tenait pas dans les
       256 px de textTex (texte coupe, enorme). Canvas de 512 et police
       reduite jusqu'a tenir, comme pour les noms de systemes. */
    var SHIP_ROT = 0;   /* le triangle pointe a DROITE (angle 0) */
    /* ── LABO : marqueur de flotte au choix (14/09, « à la place du cône triangle ») ──
       triangle  : l'actuel (mes vols et alliés)
       comete    : noyau brillant + longue queue qui s'estompe derrière la tête
       chevrons  : quatre chevrons en file derrière la tête, feux qui défilent
       dard      : petit vaisseau 3D (pyramide) orienté dans le sens du vol, réacteur
       flux      : grains qui coulent le long de l'arc restant, vers la cible
       insigne   : pastille ronde couleur de relation avec la puissance (CV) */
    var FLEET_STYLES = ["triangle", "comete", "chevrons", "dard", "flux", "insigne"];
    var FLEET_STYLE = "comete";   /* choisi le 14/09 */
    try { var fs0 = localStorage.getItem("labo_fleet_style"); if (FLEET_STYLES.indexOf(fs0) >= 0) FLEET_STYLE = fs0; } catch (e) {}
    function chevTex() {
      if (texCache.chev) return texCache.chev;
      var c = document.createElement("canvas"); c.width = c.height = 96;
      var x = c.getContext("2d");
      x.lineCap = "round"; x.lineJoin = "round";
      x.shadowColor = "rgba(255,255,255,.8)"; x.shadowBlur = 10;
      x.strokeStyle = "#ffffff"; x.lineWidth = 13;
      x.beginPath(); x.moveTo(30, 18); x.lineTo(66, 48); x.lineTo(30, 78); x.stroke();
      texCache.chev = flatTex(c);
      return texCache.chev;
    }
    function badgeTex(hex, txt) {
      var k = "badge|" + hex + "|" + txt;
      if (texCache[k]) return texCache[k];
      var c = document.createElement("canvas"); c.width = c.height = 128;
      var x = c.getContext("2d");
      x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2);
      x.fillStyle = "rgba(6,9,18,.92)"; x.fill();
      x.lineWidth = 9; x.strokeStyle = hex; x.shadowColor = hex; x.shadowBlur = 14; x.stroke();
      x.shadowBlur = 0;
      x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = "700 " + (txt.length > 3 ? 34 : 42) + "px 'Segoe UI', system-ui, sans-serif";
      x.fillText(txt, 64, 67);
      texCache[k] = flatTex(c);
      return texCache[k];
    }
    function fmtCv(cv) {
      cv = +cv || 0;
      return cv >= 1e6 ? (cv / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
        : cv >= 1e3 ? Math.round(cv / 1e3) + "k" : String(Math.round(cv));
    }
    var _shipTex = null;
    /* Marqueur de vol : un triangle plein, dessine sur canvas — aucune image a
       embarquer, identique sur PC et dans l'app. Nez a droite, cerne sombre
       pour rester lisible sur les bras de la galaxie. */
    function shipTex() {
      if (_shipTex) return _shipTex;
      /* delta effile : pointe fine, ailes en retrait, degrade blanc -> cyan
         et halo doux. 128 px pour rester net une fois reduit. */
      var c = document.createElement("canvas"); c.width = 128; c.height = 128;
      var x = c.getContext("2d");
      var path = function () {
        x.beginPath(); x.moveTo(118, 64); x.lineTo(22, 28); x.lineTo(44, 64); x.lineTo(22, 100); x.closePath();
      };
      x.shadowColor = "rgba(126,247,255,.9)"; x.shadowBlur = 14;
      path(); x.fillStyle = "rgba(126,247,255,.5)"; x.fill();
      x.shadowBlur = 0;
      path(); x.lineJoin = "round"; x.lineWidth = 5; x.strokeStyle = "rgba(4,5,12,.9)"; x.stroke();
      var g = x.createLinearGradient(44, 64, 118, 64);
      g.addColorStop(0, "#7ef7ff"); g.addColorStop(1, "#ffffff");
      path(); x.fillStyle = g; x.fill();
      _shipTex = flatTex(c);
      return _shipTex;
    }
    function fleetLblTex(txt) {
      var k = "fl|" + txt;
      if (texCache[k]) return texCache[k];
      var c = document.createElement("canvas"); c.width = 512; c.height = 64;
      var x = c.getContext("2d");
      x.textAlign = "center"; x.textBaseline = "middle";
      var fs = 34;
      x.font = "600 " + fs + "px 'Segoe UI', system-ui, sans-serif";
      var tw = x.measureText(txt).width;
      if (tw > 496) { fs = Math.max(18, Math.floor(fs * 496 / tw)); x.font = "600 " + fs + "px 'Segoe UI', system-ui, sans-serif"; }
      x.lineJoin = "round"; x.lineWidth = 6; x.strokeStyle = "rgba(4,5,12,.92)"; x.strokeText(txt, 256, 33);
      x.fillStyle = "#7ef7ff"; x.fillText(txt, 256, 33);
      texCache[k] = flatTex(c);
      return texCache[k];
    }
    function textTex(txt, hex, px) {
      var k = "t|" + txt + "|" + hex + "|" + px;
      if (texCache[k]) return texCache[k];
      var c = document.createElement("canvas"); c.width = 256; c.height = 64;
      var x = c.getContext("2d");
      x.font = "600 " + (px||40) + "px ui-monospace, monospace";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 7; x.strokeStyle = "rgba(4,5,12,.92)"; x.strokeText(txt, 128, 34);
      x.fillStyle = hex; x.fillText(txt, 128, 34);
      texCache[k] = flatTex(c);
      return texCache[k];
    }

    /* Géométries partagées : jamais disposées, cf. disposeTree. */
    var GEO_PLANE = new T.PlaneGeometry(2, 2);
    /* sphère plus ronde pour le plasma : la silhouette se voit, le détail
       vient du shader (pas de la géométrie) */
    var GEO_PLASMA = new T.SphereGeometry(1, 24, 18);
    var plasmaList = [];   /* matériaux plasma à animer dans loop() */

    /* bruit simplex 3D (Ashima) — version allégée du soleil de solar3d.js :
       4 octaves, pas de micro-fibres ni de taches, les astres sont petits */
    var PLASMA_NOISE = [
      "vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}",
      "vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}",
      "vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}",
      "vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}",
      "float snoise(vec3 v){",
      "  const vec2 C = vec2(1.0/6.0, 1.0/3.0);",
      "  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);",
      "  vec3 i  = floor(v + dot(v, C.yyy));",
      "  vec3 x0 = v - i + dot(i, C.xxx);",
      "  vec3 g = step(x0.yzx, x0.xyz);",
      "  vec3 l = 1.0 - g;",
      "  vec3 i1 = min(g.xyz, l.zxy);",
      "  vec3 i2 = max(g.xyz, l.zxy);",
      "  vec3 x1 = x0 - i1 + C.xxx;",
      "  vec3 x2 = x0 - i2 + C.yyy;",
      "  vec3 x3 = x0 - D.yyy;",
      "  i = mod289(i);",
      "  vec4 p = permute(permute(permute(",
      "        i.z + vec4(0.0, i1.z, i2.z, 1.0))",
      "      + i.y + vec4(0.0, i1.y, i2.y, 1.0))",
      "      + i.x + vec4(0.0, i1.x, i2.x, 1.0));",
      "  float n_ = 0.142857142857;",
      "  vec3 ns = n_ * D.wyz - D.xzx;",
      "  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);",
      "  vec4 x_ = floor(j * ns.z);",
      "  vec4 y_ = floor(j - 7.0 * x_);",
      "  vec4 x = x_ * ns.x + ns.yyyy;",
      "  vec4 y = y_ * ns.x + ns.yyyy;",
      "  vec4 h = 1.0 - abs(x) - abs(y);",
      "  vec4 b0 = vec4(x.xy, y.xy);",
      "  vec4 b1 = vec4(x.zw, y.zw);",
      "  vec4 s0 = floor(b0)*2.0 + 1.0;",
      "  vec4 s1 = floor(b1)*2.0 + 1.0;",
      "  vec4 sh = -step(h, vec4(0.0));",
      "  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;",
      "  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;",
      "  vec3 p0 = vec3(a0.xy, h.x);",
      "  vec3 p1 = vec3(a0.zw, h.y);",
      "  vec3 p2 = vec3(a1.xy, h.z);",
      "  vec3 p3 = vec3(a1.zw, h.w);",
      "  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));",
      "  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;",
      "  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);",
      "  m = m * m;",
      "  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));",
      "}",
      "float fbm(vec3 p){",
      "  float f = 0.0, a = 0.5;",
      "  for(int i = 0; i < 5; i++){ f += a * snoise(p); p *= 2.02; a *= 0.5; }",
      "  return f;",
      "}",
      "float ridged(vec3 p){",
      "  float f = 0.0, a = 0.5;",
      "  for(int i = 0; i < 4; i++){ f += a * abs(snoise(p)); p *= 2.13; a *= 0.5; }",
      "  return f;",
      "}"
    ].join("\n");

    /* Un matériau plasma PAR NIVEAU de population, partagé par tous les
       systèmes de ce niveau : des centaines d'astres à l'écran, un matériau
       par astre ferait autant de programmes GPU. */
    function plasmaMat(lvl) {
      var k = "plasma|" + lvl;
      if (matCache[k]) return matCache[k];
      var ember = new T.Color(starColor(lvl));
      var hot = ember.clone().lerp(new T.Color(1, 1, 1), 0.55);
      var dark = ember.clone().multiplyScalar(0.13);
      var m = new T.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          colDark: { value: dark },
          colEmber: { value: ember },
          colHot: { value: hot }
        },
        vertexShader: [
          "varying vec3 vPos;",
          "varying vec3 vNormalW;",
          "varying vec3 vViewW;",
          "void main(){",
          "  vPos = position;",
          "  vec4 wp = modelMatrix * vec4(position, 1.0);",
          "  vNormalW = normalize(mat3(modelMatrix) * normal);",
          "  vViewW = cameraPosition - wp.xyz;",
          "  gl_Position = projectionMatrix * viewMatrix * wp;",
          "}"
        ].join("\n"),
        fragmentShader: PLASMA_NOISE + [
          "uniform float time;",
          "uniform vec3 colDark;",
          "uniform vec3 colEmber;",
          "uniform vec3 colHot;",
          "varying vec3 vPos;",
          "varying vec3 vNormalW;",
          "varying vec3 vViewW;",
          "void main(){",
          "  vec3 p = normalize(vPos);",
          "  float t = time * 0.045;",
          "  vec3 warp = vec3(",
          "    fbm(p * 2.4 + vec3(t, 0.0, -t)),",
          "    fbm(p * 2.4 + vec3(13.7, t, 5.1)),",
          "    fbm(p * 2.4 + vec3(-t, 7.3, t))",
          "  );",
          "  float cells = fbm(p * 3.2 + warp * 2.2 + vec3(0.0, 0.0, t));",
          "  float v = cells * 0.5 + 0.5;",
          "  float fil = 1.0 - ridged(p * 5.5 + warp * 1.2 + vec3(0.0, t * 1.6, 0.0));",
          "  fil = pow(clamp(fil, 0.0, 1.0), 3.5);",
          "  float fin = 1.0 - ridged(p * 12.0 + warp * 1.8 + vec3(t * 1.2, 0.0, -t));",
          "  fin = pow(clamp(fin, 0.0, 1.0), 5.0);",
          "  float hs = smoothstep(0.5, 0.85, fbm(p * 1.4 + vec3(2.7, -t * 0.4, 8.1)) * 0.5 + 0.5);",
          "  vec3 col = mix(colDark, colEmber, smoothstep(0.10, 0.8, v));",
          "  col = mix(col, colHot, fil * 0.95);",
          "  col += colHot * fin * (0.22 + hs * 0.5);",
          "  col += mix(colHot, vec3(1.0), 0.45) * hs * pow(fil, 1.5) * 0.45;",
          "  float spot = fbm(p * 1.7 + vec3(t * 0.9, -t * 0.6, 4.2));",
          "  spot = smoothstep(0.14, 0.55, spot);",
          "  float spot2 = fbm(p * 3.6 + vec3(-t * 0.7, t * 0.5, 9.3));",
          "  spot2 = smoothstep(0.25, 0.6, spot2);",
          "  float sombre = clamp(spot * 0.7 + spot2 * 0.42, 0.0, 1.0);",
          "  col = mix(col, colDark * 0.45, sombre * 0.72);",
          "  float fres = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewW)), 0.0, 1.0), 2.2);",
          "  col += mix(colEmber, colHot, 0.35) * fres * 0.4;",
          "  gl_FragColor = vec4(col, 1.0);",
          "}"
        ].join("\n")
      });
      m.__cached = true;
      matCache[k] = m;
      plasmaList.push(m);
      return m;
    }

    /* Protubérances des soleils plasma : mêmes fils que solar3d, en version
       légère (8 par étoile, tubes 24×5) — elles poussent de A vers B puis se
       résorbent depuis A via les uniforms head/tail. Un clone de matériau par
       fil (uniforms propres) ; même shader → un seul programme GPU. */
    var FLAME_PROTO = null;
    function flameProtoMat() {
      if (FLAME_PROTO) return FLAME_PROTO;
      FLAME_PROTO = new T.ShaderMaterial({
        uniforms: {
          time: { value: 0 }, seed: { value: 0 }, opacity: { value: 1 },
          head: { value: 1 }, tail: { value: 0 },
          colA: { value: new T.Color(1, 1, 1) }, colB: { value: new T.Color(1, 1, 1) }
        },
        vertexShader: [
          "varying vec2 vUv;",
          "void main(){",
          "  vUv = uv;",
          "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "}"
        ].join("\n"),
        fragmentShader: PLASMA_NOISE + [
          "uniform float time;",
          "uniform float seed;",
          "uniform float opacity;",
          "uniform float head;",
          "uniform float tail;",
          "uniform vec3 colA;",
          "uniform vec3 colB;",
          "varying vec2 vUv;",
          "void main(){",
          "  float n = fbm(vec3(vUv.x * 7.0 - time * 1.3, vUv.y * 3.0 + seed, seed * 3.1));",
          "  float n2 = ridged(vec3(vUv.x * 12.0 - time * 2.1 + seed, vUv.y * 5.0, seed));",
          "  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.75, vUv.x);",
          "  float grow = 1.0 - smoothstep(head - 0.08, head, vUv.x);",
          "  float shrink = smoothstep(tail, tail + 0.08, vUv.x);",
          "  float a = clamp(n * 0.6 + 0.55, 0.0, 1.0) * edge * grow * shrink * opacity;",
          "  vec3 col = mix(colA * 1.2, colB, clamp(n2, 0.0, 1.0));",
          "  gl_FragColor = vec4(col * a * 1.4, a);",
          "}"
        ].join("\n"),
        blending: T.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide
      });
      return FLAME_PROTO;
    }
    function promDir() {
      var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      return new T.Vector3(s * Math.cos(a), s * Math.sin(a), u);
    }
    /* arc de Bézier sur la sphère UNITÉ — le groupe parent porte l'échelle */
    function promCurveUnit() {
      var n = promDir();
      var tg = new T.Vector3().crossVectors(n, promDir()).normalize();
      var p0 = n.clone().multiplyScalar(0.96);
      var span = 0.14 + Math.random() * 0.26;
      var h = 0.08 + Math.pow(Math.random(), 1.6) * 0.42;
      var p3 = n.clone().addScaledVector(tg, span).normalize().multiplyScalar(0.96);
      var c1 = p0.clone().normalize().multiplyScalar(1 + h).addScaledVector(tg, span * 0.25);
      var c2 = p3.clone().normalize().multiplyScalar(1 + h).addScaledVector(tg, -span * 0.25);
      return new T.CubicBezierCurve3(p0, c1, c2, p3);
    }
    function spawnMapProm(sv, pr, now) {
      if (pr.mesh) {
        sv.promG.remove(pr.mesh);
        pr.mesh.geometry.dispose();
        pr.mesh.material.dispose();
      }
      var geo = new T.TubeGeometry(promCurveUnit(), 24, 0.02 + Math.random() * 0.032, 5, false);
      var m2 = flameProtoMat().clone();
      m2.uniforms.seed.value = Math.random() * 100;
      m2.uniforms.colA.value = sv.plasMat.uniforms.colEmber.value;
      m2.uniforms.colB.value = sv.plasMat.uniforms.colHot.value;
      pr.mesh = new T.Mesh(geo, m2);
      pr.dur = 6 + Math.random() * 8;
      pr.t0 = now;
      sv.promG.add(pr.mesh);
    }

    /* Le cache de matériaux : trois familles seulement depuis que les styles
       d'icônes ont disparu. */
    function cached(kind, key) {
      var k = kind + "|" + key;
      if (matCache[k]) return matCache[k];
      var m;
      /* HALO D'INFLUENCE : la couleur de l'alliance, diffuse et faible. Deux
         systèmes voisins voient leurs halos se recouvrir et former une tache
         commune — c'est ce qui donne le sentiment de territoire, sans tracer
         la moindre frontière. */
      if (kind === "infl") m = new T.SpriteMaterial({map:softTex(), color:key, transparent:true,
        blending:T.AdditiveBlending, depthWrite:false, opacity:.20});
      else if (kind === "syslbl") { var q2 = key.split("|");
        m = new T.SpriteMaterial({map:sysLblTex(q2[0], q2[1], q2[2], q2[3]), transparent:true,
          depthWrite:false, opacity:.95}); }
      else if (kind === "anames")
        m = new T.SpriteMaterial({map:allianceTexMulti(key),
          transparent:true, depthWrite:false, opacity:.95});
      /* ⚠ side: DoubleSide, et surtout pas par prudence : un quad posé à plat
         dans le plan XZ a sa normale vers le BAS selon l'ordre de ses sommets.
         Sans DoubleSide (ou sans inverser le winding), la caméra ne voit que
         sa face arrière et les 267 anneaux disparaissent — sans erreur, sans
         trace, la géométrie est bien là. */
      else if (kind === "donut")
        m = new T.MeshBasicMaterial({map:donutTex(key), transparent:true, depthWrite:false,
          side:T.DoubleSide});
      else m = new T.MeshBasicMaterial({color:0xffffff});
      m.__cached = true;    /* jamais disposé : partagé via matCache */
      matCache[k] = m;
      return m;
    }

    /* Libère géométries et matériaux NON partagés d'un sous-arbre retiré —
       sans ça, chaque tick du curseur Rayon abandonnait tout l'ancien groupe
       en VRAM (lignes de flottes, amas, grille, étiquettes SB…). */
    function disposeTree(root) {
      if (!root) return;
      root.traverse(function (o) {
        /* la géométrie d'un Sprite est PARTAGÉE par tout three : ne pas y toucher */
        if (!o.isSprite && o.geometry && o.geometry !== GEO_PLANE &&
            o.geometry !== GEO_PLASMA) o.geometry.dispose();
        var mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        mats.forEach(function (mm) { if (!mm.__cached) mm.dispose(); });
      });
    }

    /* ══════════════════════════════════════════════════════════════════════
       5.6 · LA CARTE — un groupe three par système
       ══════════════════════════════════════════════════════════════════════ */

    function buildMap() {
      if (group) { s3Clear(); scene.remove(group); ptDrop(planetMat); ptDrop(clusterMat); disposeTree(group); }
      /* la sélection et les survols pointaient dans l'ancienne carte */
      sel = null; hov = null; hovPlanet = null; hovFleet = null; hideTip();
      group = new T.Group(); scene.add(group);
      systems = []; orbits = []; fleets = [];

      /* Échelle : le disque représente la carte ENTIÈRE (le jeu va jusqu'à
         ±31), pas le seul rectangle chargé — sinon les systèmes se tassent
         dans un coin du disque. La caméra, elle, se cale sur la zone chargée. */
      var maxAbs = 8, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      /* La « zone chargée » = ce que la PAGE du jeu a servi (le secteur
         affiché), pas les systèmes venus des scans d'alliance : depuis que
         ceux-ci couvrent toute la galaxie, « Zone » cadrait la galaxie
         entière et reculait la caméra au maximum. Repli sur tout si la page
         n'a rien servi (mod hors carte). */
      var servis = D.systems.filter(function (s) { return !s.fromScan; });
      if (!servis.length) servis = D.systems;
      D.systems.forEach(function (s) {
        maxAbs = Math.max(maxAbs, Math.abs(s.cx), Math.abs(s.cy));
      });
      servis.forEach(function (s) {
        minX = Math.min(minX, s.cx); maxX = Math.max(maxX, s.cx);
        minY = Math.min(minY, s.cy); maxY = Math.max(maxY, s.cy);
      });
      extent = Math.max(34, maxAbs + 3);
      unit = params.radius / extent;
      loaded = {
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
        r: Math.max(6, Math.max(maxX - minX, maxY - minY) / 2 + 3)
      };

      buildGrid();

      var sbG = new T.Group(); sbG.visible = layers.star;
      var pPos = [], pCol = [], pSca = [];
      var col = new T.Color();

      D.systems.forEach(function (s) {
        var node = new T.Group();
        /* Élévation par NIVEAU DE POPULATION : chaque niveau a son étage
           (0 = au plan, 8 = tout en haut), dosé par le curseur.
           ⚠ populationLevel vaut 0 PAR DÉFAUT HORS VISION : sur 267 systèmes,
           170 des 188 « niveau 0 » sont en réalité des « je ne sais pas ». Le
           relief, la teinte du plasma, le rayon du halo et la quatrième clé de
           tri des étiquettes sont donc dessinés sur une grandeur qui vaut zéro
           par ignorance dans les deux tiers des cas. C'est ASSUMÉ — la carte
           validée à l'écran est celle-là — mais ce n'est PAS une mesure : ne
           jamais s'en servir ailleurs comme d'un indicateur de richesse, et ne
           jamais le recalculer depuis les scans (la moyenne des populations
           n'est pas la même grandeur, cf. mergeScans). */
        var eb = starIdx(s.popLevel) / 8;
        node.position.set(s.cx * unit, eb * params.elev * unit * 4, s.cy * unit);

        var lvl = starIdx(s.popLevel);
        var pop = starColor(lvl);
        s.starHex = pop;

        /* HALO D'INFLUENCE : autour de chaque système tenu, une lueur à la
           couleur de son alliance. Les halos de systèmes voisins se recouvrent
           et forment une tache commune : c'est l'effet de territoire voulu en
           3D, sans tracer la moindre frontière. Sa taille croît avec le nombre
           de planètes tenues — un système bien colonisé rayonne plus loin. */
        if (s.tag && s.hex) {
          var infl = new T.Sprite(cached("infl", s.hex));
          var nPris = 0;
          if (s.planets) s.planets.forEach(function (pl) {
            if (pl.state === "held" || pl.state === "solo") nPris++;
          });
          infl.scale.setScalar(unit * (2.6 + Math.min(12, nPris) * 0.34));
          infl.position.y = -unit * 0.02;
          infl.renderOrder = -3;
          node.add(infl);
        }

        /* Soleil plasma animé (matériau partagé par niveau) + protubérances.
           Taille au NIVEAU de population, comme les icônes de la vraie carte. */
        var plasR = unit * (0.24 + lvl * 0.035);
        var plas = new T.Mesh(GEO_PLASMA, plasmaMat(lvl));
        plas.scale.setScalar(plasR);
        node.add(plas);
        var promG = new T.Group();
        promG.scale.setScalar(plasR);
        node.add(promG);
        var proms = [];
        for (var pk = 0; pk < 8; pk++) proms.push({ mesh: null, t0: 0, dur: 1 });

        /* ── L'ANNEAU DE POSSESSION ────────────────────────────────────────
           Les DOUZE emplacements, dans l'ordre. Un emplacement tenu porte la
           couleur de son alliance (ou le gris-bleu d'un colon sans alliance) ;
           libre et inconnu restent vides — l'anneau dit QUI TIENT, pas le taux
           d'occupation. Quand le jeu ne donne que l'agrégat systemOwnerships,
           on remplit les crans dans l'ordre : le compte est juste, seule la
           position exacte de chaque planète est perdue. */
        var slots = new Array(12);
        if (s.planets && s.planets.length) {
          s.planets.forEach(function (pl) {
            var idx = (pl.idx || 0) - 1;
            if (idx < 0 || idx > 11) return;
            if (pl.state === "held") {
              slots[idx] = (pl.tag && D.colors && D.colors[pl.tag]) ||
                (pl.tag ? tagColor(pl.tag) : null) || s.hex || "#b9c2d6";
            } else if (pl.state === "solo") slots[idx] = "#b9c2d6";
          });
        } else if (s.owns && s.owns.length) {
          var kSlot = 0;
          s.owns.forEach(function (o) {
            var oc = o.isUnknown || o.isFreePlanet ? null
              : o.allianceId ? (D.colors[o.allianceTag] || tagColor(o.allianceTag || "?"))
              : "#b9c2d6";
            for (var q5 = 0; q5 < (o.planetCount || 0) && kSlot < 12; q5++, kSlot++) {
              if (oc) slots[kSlot] = oc;
            }
          });
        }
        /* JAUGE et non plan : les crans pris sont ramenés au DÉBUT de l'anneau,
           les uns à la suite des autres. 6 planètes tenues = 6 crans pleins,
           8 = 8, 12 = le tour complet. Éparpiller les crans à la position
           exacte de leur emplacement donnait un anneau troué où l'on ne
           pouvait plus compter — or c'est le compte qui se lit.
           Le tri est LEXICOGRAPHIQUE sur la couleur : arbitraire, mais
           totalement DÉTERMINISTE — c'est lui seul qui garantit que chaque
           alliance forme un arc d'un seul tenant, et que le même système
           redonne le même anneau d'un chargement à l'autre. */
        var pris = [];
        for (var q6 = 0; q6 < 12; q6++) if (slots[q6]) pris.push(slots[q6]);
        pris.sort();
        /* La clé ne porte QUE les planètes prises : l'anneau se divise en
           autant de crans qu'il y en a, et ils occupent tout le tour. Une prise
           de plus = un cran de plus, chacun un peu plus étroit. */
        var donutKey = pris.slice(0, 12).join(",");

        var ring = new T.Mesh(GEO_PLANE, cached("donut", donutKey));
        ring.rotation.x = -Math.PI/2;
        ring.scale.setScalar(unit * 0.92);
        node.add(ring);

        /* nom + ID SOUS l'anneau, tags d'alliance AU-DESSUS (à leur couleur) */
        var lbl = new T.Sprite(cached("syslbl", s.name + "|" + s.id + "|" + s.cx + "|" + s.cy));
        /* canvas 512×64 : le sprite garde le même rapport, sinon le texte
           s'étire */
        lbl.scale.set(unit * 2.45, unit * 0.306, 1);
        /* largeur du TEXTE, en cellules : sert de boîte au dé-encombrement */
        var lblInk = 2.45 * ((lbl.material.map && lbl.material.map.__inkW) || 1);
        lbl.position.y = -unit * 0.5;
        node.add(lbl);
        /* TOUS les tags d'alliance présents (chacun dans sa couleur), pas
           seulement le dominant — ex. Rana tenu par TUGA et AO — SUIVIS de
           l'id du système.
           Le sprite du haut existe maintenant pour TOUT système : sans
           alliance il ne porte que « [id] ». Sinon un système neutre perdait
           purement et simplement son id, parti de la ligne du bas. */
        var aTags = (s.atags && s.atags.length) ? s.atags : (s.tag ? [s.tag] : []);
        var akey = aTags.slice(0, 3).map(function (tg) {
          return tg + ":" + (D.colors[tg] || tagColor(tg));
        }).join(",") + "|" + s.id;
        var lblTop = new T.Sprite(cached("anames", akey));
        /* Réduit : à 3,1/4,2 unités la ligne du haut était plus grande que le
           nom. Le canvas ayant rétréci dans le même rapport, la densité de
           pixels du texte ne bouge pas. */
        var aw = aTags.length > 1 ? 3.3 : 2.5;
        lblTop.scale.set(unit * aw, unit * aw / 8, 1);   /* ratio canvas 448×56 */
        lblTop.userData.w = aw;   /* largeur de base, relue quand le système ouvert agrandit ses étiquettes */
        lblTop.position.y = unit * 0.8;
        node.add(lblTop);
        group.add(node);

        var sbSprite = null;
        if (s.sbMax > 0) {
          sbSprite = new T.Sprite(new T.SpriteMaterial({map:textTex("SB " + s.sbMax, "#ffd24a", 34),
            transparent:true, depthWrite:false, opacity:.9}));
          sbSprite.scale.set(unit * 3.6, unit * .9, 1);
          sbSprite.position.set(s.cx * unit, node.position.y + unit * .6, s.cy * unit + unit * 1.3);
          sbG.add(sbSprite);
        }

        var view = Object.create(s);
        view.node = node;
        view.plas = plas; view.plasMat = plas.material; view.promG = promG; view.proms = proms;
        view.ring = ring; view.lblTop = lblTop; view.elevBase = eb;
        view.lbl = lbl; view.sb = sbSprite; view.deploy = 0; view.dim = 1;
        view.lblInk = lblInk;

        /* ── RICHESSE DU SYSTÈME ──────────────────────────────────────────
           Ce round, populationLevel vaut 0 ou 1 sur les 267 systèmes servis et
           les deux premières teintes sont deux gris argentés indiscernables :
           l'échelle de couleur par niveau ne porte AUCUNE information. Ce qui
           sépare vraiment un système, c'est le nombre de planètes COLONISÉES.
           On le lit sur owns (systemOwnerships) : c'est le champ que le jeu
           renseigne même en SIMPLE VISION, là où planets[] est vide, et c'est
           déjà lui qui colore le donut. Repli sur les planètes pour les
           systèmes qui ne viennent que des scans en base.
           Surtout PAS s.pop : c'est une somme de NIVEAUX (0-96), nulle dès que
           planets[] manque — elle mesure la couverture de scan autant que la
           richesse. Un système entièrement inconnu tombe donc au plancher :
           c'est voulu, le donut gris dit déjà « on ne sait pas ». */
        var rColo = 0;
        if (s.owns && s.owns.length) {
          s.owns.forEach(function (ow) {
            if (!ow.isUnknown && !ow.isFreePlanet) rColo += (+ow.planetCount || 0);
          });
        } else {
          s.planets.forEach(function (pln) {
            if (pln.state === "held" || pln.state === "solo") rColo++;
          });
        }
        /* Racine carrée : sur cette carte presque tout est à 0 ou 1 colonie,
           c'est donc EN BAS de l'échelle que la lecture compte (0 → ×0,78,
           1 → ×1,03 : l'écart saute aux yeux). Saturation à 8 pour qu'un
           système à 12 planètes n'écrase pas ses voisins.
           Plancher 0,78 et non 0 : un système vide doit rester DISCRET, pas
           disparaître — le rayon de clic, lui, reste figé à 26 px (40 mobile),
           un astre invisible ne deviendrait pas plus facile à viser. */
        view.richK = 0.78 + 0.72 * Math.sqrt(Math.min(1, rColo / 8));
        view.sx = 0; view.sy = 0; view.vis = false;
        systems.push(view);

        s.planets.forEach(function (p, k) {
          col.set(p.state === "held" ? s.hex : p.state === "solo" ? SOLO_HEX
            : p.state === "unknown" ? UNKN_HEX : FREE_HEX);
          orbits.push({s:view, p:p, k:k, rad: unit * (0.30 + k * 0.055),
            ph: (p.idx / 12) * Math.PI * 2, sp: (0.55 + (k % 5) * 0.09) / (1 + k * 0.22),
            sx:0, sy:0, vis:false});
          pPos.push(0,0,0);
          pCol.push(col.r*.92+.08, col.g*.92+.08, col.b*.92+.08);
          pSca.push(.55 + (k % 3) * .12);
        });
      });

      var pg = new T.BufferGeometry();
      pg.setAttribute("position", new T.Float32BufferAttribute(pPos, 3));
      pg.setAttribute("aColor", new T.Float32BufferAttribute(pCol, 3));
      pg.setAttribute("aScale", new T.Float32BufferAttribute(pSca, 1));
      planetMat = mat(110, true);
      planetPts = new T.Points(pg, planetMat);
      planetPts.frustumCulled = false;
      group.add(planetPts);

      /* Amas d'étoiles : un petit nuage serré AUTOUR de chaque système, teinté
         à la couleur de son niveau de pop — pas un semis au hasard. Il suit la
         carte puisqu'il vit dans le même groupe. Il donne de la matière au
         système sans le noyer : peu de grains, resserrés (rayon divisé par
         deux), plus petits et plus sombres. */
      var K = MOBILE ? 6 : 10, cPos = [], cCol = [], cSca = [];
      var ccol = new T.Color(), cbase = new T.Color("#9fb4ff");
      systems.forEach(function (sv) {
        ccol.set(sv.starHex).lerp(cbase, 0.55).multiplyScalar(0.55);
        for (var q = 0; q < K; q++) {
          var rr = Math.pow(Math.random(), 1.8) * unit * 0.55 + unit * 0.16;
          var aa = Math.random() * Math.PI * 2;
          var yy = (Math.random() - 0.5) * unit * 0.28;
          cPos.push(sv.cx * unit + Math.cos(aa) * rr, yy, sv.cy * unit + Math.sin(aa) * rr);
          var f = 0.7 + Math.random() * 0.4;
          cCol.push(ccol.r * f, ccol.g * f, ccol.b * f);
          cSca.push(0.2 + Math.random() * 0.35);
        }
      });
      var cg2 = new T.BufferGeometry();
      cg2.setAttribute("position", new T.Float32BufferAttribute(cPos, 3));
      cg2.setAttribute("aColor", new T.Float32BufferAttribute(cCol, 3));
      cg2.setAttribute("aScale", new T.Float32BufferAttribute(cSca, 1));
      clusterMat = mat(70, true);
      var clusterPts = new T.Points(cg2, clusterMat);
      clusterPts.frustumCulled = false;
      /* dernier nuage à souffrir du tri sur un point unique : ses grains sont
         semés à moins de 0,71 unit du centre de chaque système, donc PILE sur
         la zone de l'étiquette (lblDBc tombe à 0,45 unit en vue rasante).
         -1 = même étage que la grille, qui est déjà à -1 : les deux couches de
         repère passent sous les systèmes. Pas -10 : on est DANS le groupe de
         la carte, pas dans le décor extérieur. */
      clusterPts.renderOrder = -1;
      group.add(clusterPts);

      /* ── RAYON DES ANNEAUX : plafonné par le voisinage ──────────────────
         Un rayon fixe se recouvre dès que deux systèmes sont sur des cases
         adjacentes, et deux anneaux imbriqués ne se lisent plus ni l'un ni
         l'autre. On mesure donc, pour chaque système, la distance à son plus
         proche voisin, et on borne son rayon à 42 % de cette distance : deux
         voisins immédiats se frôlent sans jamais se croiser, et un système
         isolé garde le rayon plein.
         Calculé une seule fois ici — O(n²) sur 267 systèmes, soit 71 000
         comparaisons, une fois par construction — pas à chaque image. */
      (function rayons() {
        for (var a = 0; a < systems.length; a++) {
          var sa = systems[a], best = 1e9;
          for (var b = 0; b < systems.length; b++) {
            if (b === a) continue;
            var sb = systems[b];
            var dx = sa.cx - sb.cx, dy = sa.cy - sb.cy;
            var d2 = dx * dx + dy * dy;
            if (d2 < best) best = d2;
          }
          var d = Math.sqrt(best);
          /* 0,92 est le rayon plein ; on ne descend jamais sous 0,34, sinon
             l'anneau devient trop petit pour qu'on y compte les crans */
          sa.ringK = Math.max(0.34, Math.min(0.92, d * 0.42));
        }
      })();

      sbg = sbG; group.add(sbG);

      /* capitales : le système le plus central de chaque alliance. Sert de clé
         de tri au dé-encombrement, pour qu'une alliance garde toujours au
         moins un nom lisible. */
      var bary = {};
      systems.forEach(function (s) {
        if (!s.tag) return;
        var b = bary[s.tag] || (bary[s.tag] = {x:0, y:0, n:0});
        b.x += s.cx; b.y += s.cy; b.n++;
      });
      Object.keys(bary).forEach(function (tag) {
        var b = bary[tag], bx = b.x/b.n, by = b.y/b.n, best = null, bd = 1e9;
        systems.forEach(function (s) {
          if (s.tag !== tag) return;
          var d = (s.cx-bx)*(s.cx-bx) + (s.cy-by)*(s.cy-by);
          if (d < bd) { bd = d; best = s; }
        });
        if (best) best.capital = true;
      });

      buildInspector();
      buildFleets();
      applyFilters();

      /* Le panneau peut ne pas exister (bundle du mod chargé sans lui) : on ne
         plante pas la construction de la carte pour trois compteurs. */
      var elS = document.getElementById("aw3d-nsys");
      var elP = document.getElementById("aw3d-npl");
      var elF = document.getElementById("aw3d-nfl");
      if (elS) elS.textContent = systems.length;
      if (elP) elP.textContent = orbits.length;
      if (elF) elF.textContent = fleets.length;
    }

    function buildGrid() {
      if (grid) { group.remove(grid); disposeTree(grid); grid = null; }
      if (!layers.grid) return;
      /* LE QUADRILLAGE DU JEU, à l'identique. La carte native n'en dessine pas
         en SVG : c'est une simple classe CSS sur #mapBackground —
           background-size: 50px 50px;
           background-image: linear-gradient(to right, rgb(40,40,40) 1px, transparent 1px),
                             linear-gradient(rgb(40,40,40) 1px, transparent 1px);
         Donc mailles carrées régulières, traits de 1 px, UNE seule couleur
         (gris neutre), aucune hiérarchie de lignes, aucun dégradé. Mes trois
         niveaux de bleu et mon atténuation radiale étaient une invention — et
         les trois LineSegments qui les portaient sont restés vides jusqu'à
         leur suppression. */
      /* Pas de la grille : UNE case = UNE unité de jeu, en dur et assumé.
         Vérifié sur la carte native — entre les graduations -3, -2, -1, 0, 1…
         de la réglette du bas il y a exactement une maille. J'étais à 5, d'où
         un quadrillage cinq fois trop lâche qui ne correspondait à rien. Le
         curseur « Graduation » qui prétendait le régler n'a jamais rien fait :
         il a disparu avec ce commentaire pour seule trace. */
      var g = new T.Group(), half = extent, step = 1;
      var all = [];
      /* Décalage d'une DEMI-unité : les lignes passent entre les coordonnées,
         pas dessus. Chaque système, qui est à des coordonnées entières, tombe
         ainsi au centre de sa case au lieu d'être posé sur une intersection —
         c'est ce qu'on lit sur la carte du jeu. */
      for (var i = -half; i <= half; i += step) {
        var p = (i + 0.5) * unit, e = (half + 0.5) * unit;
        all.push(p, 0, -e, p, 0, e);
        all.push(-e, 0, p, e, 0, p);
      }
      var ggeo = new T.BufferGeometry();
      ggeo.setAttribute("position", new T.Float32BufferAttribute(all, 3));
      /* rgb(40,40,40) = #282828, la valeur exacte du jeu. En perspective les
         lignes convergent et se superposent, ce qui les fait paraître bien plus
         claires qu'en 2D : on descend l'opacité pour retrouver le même
         « à peine perceptible » que sur la carte native. */
      var gl = new T.LineSegments(ggeo, new T.LineBasicMaterial({color:0x282828,
        transparent:true, opacity:.16, depthWrite:false}));
      gl.renderOrder = -1;
      g.add(gl);
      /* Les coordonnées ne sont PAS semées dans la scène : le jeu les porte
         sur deux réglettes d'axes en bord de cadre (mapAxes.js — SVG de 20 px,
         X en bas, Y à gauche, traits et texte en #777, 10 px sans-serif). On
         fait pareil, en overlay écran : c'est plus fidèle, toujours lisible
         quelle que soit l'inclinaison, et ça supprime ~90 sprites de la scène.
         Voir updateAxes(). */

      /* couronnes de distance de la vraie carte 2D (renderDistanceRings du
         jeu) : un cercle tous les 5 de rayon autour de Rana (0/0), et les
         coordonnées rondes inscrites tous les 45° */
      var cpts = [];
      for (var ca = 0; ca <= 96; ca++) {
        var th = ca/96 * Math.PI*2;
        cpts.push(new T.Vector3(Math.cos(th), 0, Math.sin(th)));
      }
      var cgeo = new T.BufferGeometry().setFromPoints(cpts);
      for (var ri = 1; ri <= 8; ri++) {
        var rr2 = ri * 5;
        if (rr2 > extent) break;
        var lc = new T.LineLoop(cgeo, new T.LineBasicMaterial({color:0x5b8fb8,
          transparent:true, opacity:.6, depthWrite:false}));
        lc.scale.setScalar(rr2 * unit);
        g.add(lc);
        for (var rj = 0; rj < 8; rj++) {
          var an2 = Math.PI/4 * rj;
          var gx2 = Math.round(Math.cos(an2) * rr2), gy2 = Math.round(Math.sin(an2) * rr2);
          var sp2 = new T.Sprite(new T.SpriteMaterial({
            map:textTex("(" + gx2 + "/" + gy2 + ")", "#5f89ad", 30),
            transparent:true, depthWrite:false, opacity:.85}));
          sp2.scale.set(unit*2.6, unit*.65, 1);
          sp2.position.set(Math.cos(an2)*rr2*unit, unit*.4, Math.sin(an2)*rr2*unit);
          g.add(sp2);
        }
      }
      grid = g; group.add(g);
      decorKSet = -1;   /* idem décor : repère reconstruit pendant qu'un système est ouvert */
    }

    function buildInspector() {
      var pts = [];
      for (var a = 0; a <= 72; a++) {
        var t = a/72 * Math.PI*2;
        pts.push(new T.Vector3(Math.cos(t), 0, Math.sin(t)));
      }
      circleGeo = new T.BufferGeometry().setFromPoints(pts);
      var insp = new T.Group(); insp.visible = false;
      orbitLines = [];
      for (var k = 0; k < 12; k++) {
        var l = new T.LineLoop(circleGeo, new T.LineBasicMaterial({color:0x9fb0e8,
          transparent:true, opacity:.16, depthWrite:false}));
        insp.add(l); orbitLines.push(l);
      }
      scanRing = new T.LineLoop(circleGeo, new T.LineBasicMaterial({color:0x7ef7ff,
        transparent:true, opacity:.6, depthWrite:false}));
      insp.add(scanRing);
      inspector = insp; group.add(insp);
      /* orbites : seulement en passe 3 (présentation) ; au doigt pas de présentation, elles restent sur la carte */
      insp.traverse(function (o) { o.layers.set(LAYER_OPEN); });

      rangeRing = new T.LineLoop(circleGeo, new T.LineBasicMaterial({color:0xffb347,
        transparent:true, opacity:.75, depthWrite:false}));
      rangeRing.visible = false; group.add(rangeRing);

      visionRing = new T.LineLoop(circleGeo, new T.LineBasicMaterial({color:0x7ef7ff,
        transparent:true, opacity:.35, depthWrite:false}));
      visionRing.position.set(D.origin.x * unit, 0, D.origin.y * unit);
      visionRing.scale.setScalar((D.vision || 15) * unit);
      visionRing.visible = layers.fog;
      group.add(visionRing);
    }

    /* ── LES FLOTTES EN VOL : des paraboles ────────────────────────────────
       flottes : mapData.fleets si le jeu en sert, sinon rien. */
    function buildFleets() {
      if (fleetGroup) { group.remove(fleetGroup); }
      fleetGroup = new T.Group();
      fleetGroup.visible = layers.fleets;
      fleets = [];
      var byId = {};
      systems.forEach(function (s) { byId[s.id] = s; });

      /* les VRAIS champs de mapData.fleets : originPosition/targetPosition
         (coordonnées, pas des ids), launchTime/arrivalTime, relation */
      var tgtN = {};   /* cible -> nb d'arcs deja traces : on les etage */
      (D.fleets || []).forEach(function (raw) {
        var op = raw.originPosition, tp = raw.targetPosition;
        var from = op ? {cx: +op.x, cy: +op.y} : byId[raw.fromSystemId || raw.originSystemId];
        var to = tp ? {cx: +tp.x, cy: +tp.y} : byId[raw.toSystemId || raw.targetSystemId];
        if (!from || !to) return;
        var rel = raw.relation || "";
        var hex = rel === "enemy" ? "#ff5252"
          : (rel === "own" || rel === "self" || rel === "mine") ? "#ffffff"
          : rel === "ally" ? "#2f7bff"
          : (raw.allianceTag && D.colors[raw.allianceTag]) || SOLO_HEX;
        /* Parabole et non segment : l'apex vaut la DURÉE du vol, donc un arc
           rasant qui pointe sur chez moi se lit comme une frappe courte sans
           avoir à lire l'ETA. 2,2 × racine(heures), plafonné à 12 cases. */
        var dur = (raw.launchTime && (raw.arrivalTime || raw.arrivalAt))
          ? (Date.parse(raw.arrivalTime || raw.arrivalAt) - Date.parse(raw.launchTime)) / 3600000
          : Math.hypot(to.cx - from.cx, to.cy - from.cy) * 1.35;
        /* 14/09 « réduis les hauteurs des paraboles » : 2,2 × √h plafonné à 12 → 1,2 × √h plafonné à 6,5 */
        var apex = Math.min(6.5, 1.2 * Math.sqrt(Math.max(0.2, dur))) * unit;
        /* plusieurs vols vers la meme cible : chaque arc suivant monte de 22 %
           pour qu'on ne voie pas un fagot indistinct */
        var tk = to.cx + "/" + to.cy, tn = tgtN[tk] | 0; tgtN[tk] = tn + 1;
        apex *= 1 + 0.18 * tn;
        var SEGA = 24;
        var geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array((SEGA + 1) * 3), 3));
        var own = rel === "own" || rel === "self" || rel === "mine";
        /* MES vols : arc a pleine opacite, doublé d'un second trace additif
           (WebGL ignore linewidth > 1, c'est la seule facon d'epaissir), et
           tete plus grosse. A 0,4 d'opacite on ne distinguait pas l'arc du
           fond etoile. */
        var line = new T.Line(geo, new T.LineBasicMaterial({color:hex, transparent:true,
          opacity: own ? .95 : .4, depthWrite:false, blending:T.AdditiveBlending}));
        var glow = null;
        if (own) {
          glow = new T.Line(geo, new T.LineBasicMaterial({color:hex, transparent:true,
            opacity:.55, depthWrite:false, blending:T.AdditiveBlending}));
          glow.frustumCulled = false; fleetGroup.add(glow);
        }
        var head = new T.Sprite(new T.SpriteMaterial({map:haloTex(), color:hex, transparent:true,
          blending:T.AdditiveBlending, depthWrite:false, opacity: own ? .35 : .95}));
        head.scale.setScalar(unit * (own ? 1.5 : 1.1));
        /* MES vols : un TUBE le long du trajet restant (une ligne WebGL fait
           toujours 1 px, quel que soit le zoom) et le vaisseau du jeu en tete,
           oriente dans le sens du vol. Le tube est reconstruit 3 fois par
           seconde dans la boucle, pas a chaque image. */
        var tube = null, ship = null, ally = rel === "ally";
        if (own || ally) {
          /* les alliees ont aussi leur tube (plus fin) : une ligne 1 px se
             perdait dans le fond etoile */
          tube = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({color:hex, transparent:true,
            opacity: own ? .55 : .45, depthWrite:false, blending:T.AdditiveBlending}));
          tube.frustumCulled = false; fleetGroup.add(tube);
          tube.userData.r = own ? 0.06 : 0.045;
        }
        if ((own || ally) && FLEET_STYLE === "triangle") {
          ship = new T.Sprite(new T.SpriteMaterial({map:shipTex(), transparent:true, depthWrite:false,
            opacity: own ? 1 : .9, color: own ? "#ffffff" : hex}));
          var ssz = own ? 0.95 : 0.62;
          ship.scale.set(unit * ssz, unit * ssz, 1);
          ship.frustumCulled = false; fleetGroup.add(ship);
        }
        /* traînée lumineuse derrière la tête : dégradé de couleur par sommet
           (en additif, un sommet noir est invisible → fondu naturel) */
        var TN = FLEET_STYLE === "comete" ? 40 : 14;
        var tgeo = new T.BufferGeometry();
        tgeo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(TN * 3), 3));
        var tcol = new Float32Array(TN * 3);
        var hc = new T.Color(hex);
        for (var ti = 0; ti < TN; ti++) {
          var f2 = Math.pow(ti / (TN - 1), 2);
          tcol[ti*3] = hc.r * f2; tcol[ti*3+1] = hc.g * f2; tcol[ti*3+2] = hc.b * f2;
        }
        tgeo.setAttribute("color", new T.Float32BufferAttribute(tcol, 3));
        var trail = new T.Line(tgeo, new T.LineBasicMaterial({vertexColors:true, transparent:true,
          opacity:.9, depthWrite:false, blending:T.AdditiveBlending}));
        /* ⚠ piège n° 3 : scene.matrixWorldAutoUpdate = false, tout objet ajouté
           après coup doit renoncer au test de frustum, sinon il est jugé hors
           champ sur une matrice périmée et n'est jamais dessiné. */
        line.frustumCulled = false; trail.frustumCulled = false; head.frustumCulled = false;
        fleetGroup.add(line); fleetGroup.add(trail); fleetGroup.add(head);
        /* ── objets du marqueur choisi (FLEET_STYLE) ── */
        var mk = { style: FLEET_STYLE };
        var addSp = function (tex, color, op, blend) {
          var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, color: color, transparent: true, depthWrite: false,
            opacity: op, blending: blend ? T.AdditiveBlending : T.NormalBlending }));
          sp.frustumCulled = false; fleetGroup.add(sp); return sp;
        };
        if (FLEET_STYLE === "comete") {
          mk.core = addSp(haloTex(), "#ffffff", 1, true);
          head.material.opacity = own ? .75 : .9;
        } else if (FLEET_STYLE === "chevrons") {
          mk.chev = [0, 1, 2, 3].map(function () { return addSp(chevTex(), hex, .9, true); });
        } else if (FLEET_STYLE === "dard") {
          var dg = new T.ConeGeometry(1, 3.2, 4, 1);
          dg.rotateY(Math.PI / 4);
          mk.dart = new T.Mesh(dg, new T.MeshBasicMaterial({ color: own ? "#ffffff" : hex, transparent: true, opacity: .95, depthWrite: false }));
          mk.dart.frustumCulled = false; fleetGroup.add(mk.dart);
          mk.engine = addSp(haloTex(), hex, .9, true);
          head.material.opacity = .25;
        } else if (FLEET_STYLE === "flux") {
          var FN = 16, fgeo = new T.BufferGeometry();
          fgeo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(FN * 3), 3));
          mk.flow = new T.Points(fgeo, new T.PointsMaterial({ color: hex, size: unit * 0.42, map: haloTex(), transparent: true,
            depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, opacity: own ? 1 : .85 }));
          mk.flow.frustumCulled = false; mk.flowN = FN; fleetGroup.add(mk.flow);
          head.material.opacity = .6;
        } else if (FLEET_STYLE === "insigne") {
          mk.badge = addSp(badgeTex(hex, fmtCv(raw.combatValue)), "#ffffff", 1, false);
          head.material.opacity = .35;
        }
        fleets.push({
          from:from, to:to, line:line, trail:trail, trailN:TN, head:head, hex:hex, rel:rel,
          own: own, glow: glow, lbl: null, lblTxt: "", tube: tube, ship: ship, tubeAt: 0,
          apex:apex, seg:SEGA, dur:dur, mk: mk,
          owner: bareOwner(raw.ownerName || raw.playerName) || "?",
          tag: raw.allianceTag || "",
          cv: raw.combatValue || 0,
          ships: Array.isArray(raw.ships) ? raw.ships : null,
          originName: raw.originName || "", targetName: raw.targetName || "",
          cur: raw.currentPosition || null,
          t0: raw.launchTime ? Date.parse(raw.launchTime) : NaN,
          t1: raw.arrivalTime ? Date.parse(raw.arrivalTime)
             : raw.arrivalAt ? Date.parse(raw.arrivalAt) : NaN,
          eta: 0, p: 0, sx:0, sy:0, vis:false
        });
      });
      group.add(fleetGroup);
    }

    /* own / ally / enemy — les relations du jeu ("friendly", "self"...) et
       celles de Holocron ("ally", "enemy") ramenees a trois cases */
    var fleetCycle = {};
    /* visibilite par categorie : l'oeil du menu Flottes. Une categorie
       masquee garde ses vols (compteurs, cycle) mais n'affiche ni arc ni
       marqueur, et n'est plus cliquable. */
    var fleetVis = { own: true, ally: true, enemy: true };
    function fleetCat(f2) {
      if (f2.own) return "own";
      var r = f2.rel || "";
      if (r === "enemy") return "enemy";
      if (r === "ally" || r === "friendly") return "ally";
      return f2.tag && D && D.myTag && f2.tag === D.myTag ? "ally" : (f2.tag ? "enemy" : "");
    }
    function applyFilters() {
      var any = filters.mine || filters.ally || filters.enemy || filters.free;
      systems.forEach(function (s) {
        s.dim = (!any
          || (filters.mine && s.isMine)
          || (filters.ally && s.hasAlly)
          || (filters.enemy && s.hasEnemy)
          || (filters.free && !s.hasEnemy)) ? 1 : .12;
      });
    }

    /* ══════════════════════════════════════════════════════════════════════
       5.7 · CAMÉRA, RÉGLETTES, BOUCLE
       ══════════════════════════════════════════════════════════════════════ */

    var clock = new T.Clock(), running = false;
    var orbit = {theta:.6, phi:.95, dist:9, tTheta:.6, tPhi:.95, tDist:9};
    /* mode cinéma : après 30 s sans interaction, la caméra dérive seule */
    var lastAct = 0, cinema = false;
    var target = new T.Vector3(), tTarget = new T.Vector3(), focusRef = null;
    var _v = new T.Vector3(), _ft = new T.Vector3(), _vdir = new T.Vector3();
    var _lblDn = new T.Vector3(), _gq = new T.Quaternion();
    /* Pixels par cellule à l'écran, à la distance de la caméra.
       ⚠ EN RETARD D'UNE IMAGE, exprès : la boucle le lit (seuil de création des
       protubérances) AVANT qu'updateMap ne l'écrive. Ce n'est pas un oubli,
       c'est le comportement qui marche — ne pas « corriger », et ne jamais
       passer cette variable en const. */
    var pxCellNow = 24;
    /* ── DURÉE D'OUVERTURE d'un système (survol / sélection) ────────────────
       rate : vitesse d'écartement des orbites (approche exponentielle, 95 % en ≈ 3 / rate s)
       step : écart de départ entre deux planètes de la cascade (s)
       dur  : trajet d'une planète jusqu'à son orbite (s)
       → dernière planète posée à 11 × step + dur.
       Avant (14/09) : rate 7, step .07, dur .45 → orbites à 95 % en 0,43 s, cascade finie en 1,22 s.
       Maintenant ×2 : orbites à 95 % en 0,86 s, cascade finie en 2,44 s. */
    var UNFOLD = { rate: 3.5, step: .14, dur: .9 };

    function distFor(radiusCells) {
      var R = radiusCells * unit;
      var tan = Math.tan(camera.fov * Math.PI/360);
      var a = Math.max(.6, camera.aspect);
      return Math.max(1.2, Math.min(60, R / (tan * Math.min(1, a)) * (layers.flat ? 1.12 : .95)));
    }
    function fitDist() { return distFor(extent * 1.05); }
    /* vue par défaut : la portion de carte que le jeu a réellement servie */
    function fitLoaded() {
      if (!loaded) return;
      var cx = loaded.cx, cy = loaded.cy, r = loaded.r;
      /* Quand la page a servi (presque) toute la galaxie — c'est le cas du
         mod Android, qui pose ses 200+ systemes d'un coup — « la zone
         chargee » n'a plus de sens : on cadre 10 cases autour du centre
         COURANT de la carte du jeu (centerX/centerY de l'URL), sinon du
         centre annonce par la page, sinon de mon systeme. */
      if (r > 14) {
        var c = null;
        try {
          var u = new URLSearchParams(location.search);
          if (u.has("centerX") && u.has("centerY")) c = { x: +u.get("centerX"), y: +u.get("centerY") };
        } catch (e) {}
        if (!c && D && D.center && (+D.center.x || +D.center.y)) c = { x: +D.center.x, y: +D.center.y };
        if (!c) { var h = systems.filter(function (s) { return s.isMine; })[0]; if (h) c = { x: h.cx, y: h.cy }; }
        if (c && isFinite(c.x) && isFinite(c.y)) { cx = c.x; cy = c.y; r = 10; }
      }
      focusRef = {x: cx, y: cy};
      /* 1,45 x le rayon de la zone la faisait tenir dans un tiers de l'ecran :
         on cadre au plus juste, la zone REMPLIT la vue */
      orbit.tDist = distFor(r * (layers.flat ? 0.85 : 1.0));
    }

    /* ── réglettes d'axes, calquées sur mapAxes.js du jeu ─────────────────
       Deux SVG en bord de cadre : X en bas (20 px de haut), Y à gauche (20 px
       de large), traits et texte en #777, 10 px sans-serif, graduations de
       10 px. Le pas est choisi comme dans le jeu : le plus petit de
       [1,2,5,10]×10^n qui laisse au moins 50 px entre deux graduations. */
    var axX = null, axY = null, axKey = "";
    var SVGNS = "http://www.w3.org/2000/svg";
    function ensureAxes() {
      if (axX) return;
      axX = document.createElementNS(SVGNS, "svg");
      axX.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:20px;pointer-events:none;z-index:28;";
      axY = document.createElementNS(SVGNS, "svg");
      axY.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:20px;pointer-events:none;z-index:28;";
      ui.appendChild(axX); ui.appendChild(axY);
    }
    function axStep(minPx) {
      /* pixels par unité de jeu, mesurés sur la projection réelle */
      var a = projGame(0, 0), b2 = projGame(1, 0);
      var ppu = Math.hypot(b2.x - a.x, b2.y - a.y);
      if (!(ppu > 0)) return 5;
      var want = minPx / ppu, mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, want))));
      var cand = [1, 2, 5, 10];
      for (var k = 0; k < 6; k++) {
        for (var c = 0; c < 4; c++) {
          var st = cand[c] * mag;
          if (st >= want) return Math.max(1, Math.round(st));
        }
        mag *= 10;
      }
      return Math.max(1, Math.round(want));
    }
    var _pv = null;
    function projGame(gx, gy) {
      if (!_pv) _pv = new T.Vector3();
      _pv.set(gx * unit, 0, gy * unit).applyMatrix4(group.matrixWorld).project(camera);
      return { x: (_pv.x * .5 + .5) * cw, y: (-_pv.y * .5 + .5) * ch };
    }
    function updateAxes() {
      if (!group || !layers.grid) { if (axX) { axX.style.display = "none"; axY.style.display = "none"; } return; }
      ensureAxes();
      axX.style.display = ""; axY.style.display = "";
      var st = axStep(50), half = extent;
      /* on ne redessine que si le cadrage a réellement bougé */
      var key = st + "|" + Math.round(projGame(0, 0).x) + "|" + Math.round(projGame(0, 0).y) +
                "|" + Math.round(cw) + "|" + Math.round(ch);
      if (key === axKey) return;
      axKey = key;
      function clear(sv) { while (sv.firstChild) sv.removeChild(sv.firstChild); }
      function line(sv, x1, y1, x2, y2) {
        var l = document.createElementNS(SVGNS, "line");
        l.setAttribute("x1", x1); l.setAttribute("y1", y1);
        l.setAttribute("x2", x2); l.setAttribute("y2", y2);
        l.setAttribute("stroke", "#777"); l.setAttribute("stroke-width", "1");
        sv.appendChild(l);
      }
      function text(sv, x, y, s, anchor, base) {
        var t2 = document.createElementNS(SVGNS, "text");
        t2.setAttribute("x", x); t2.setAttribute("y", y);
        t2.setAttribute("fill", "#777"); t2.setAttribute("font-size", "10");
        t2.setAttribute("font-family", "sans-serif");
        t2.setAttribute("text-anchor", anchor);
        t2.setAttribute("dominant-baseline", base);
        t2.textContent = s;
        sv.appendChild(t2);
      }
      /* Un SVG garde sa taille intrinsèque de 300×150 tant qu'on ne la fixe
         pas : inset:0 ne suffit pas. Le jeu la pose explicitement, nous aussi. */
      axX.style.width = cw + "px"; axX.style.height = "20px";
      axY.style.width = "20px"; axY.style.height = ch + "px";
      clear(axX); clear(axY);
      line(axX, 0, 20, cw, 20);
      line(axY, 0, 0, 0, ch);
      /* En perspective, l'échelle varie d'un bord à l'autre du cadre : un pas
         unique en unités de jeu donne des graduations serrées d'un côté et
         étalées de l'autre. On garde donc le pas du jeu, mais on saute toute
         graduation qui tomberait à moins de 42 px de la précédente. */
      var lastX = -1e9, lastY = -1e9;
      for (var v = -Math.ceil(half / st) * st; v <= half; v += st) {
        var px = projGame(v, 0).x;
        if (px > -40 && px < cw + 40 && Math.abs(px - lastX) >= 42) {
          lastX = px;
          line(axX, px, 20, px, 10);
          text(axX, px + 2, 10, String(v), "start", "hanging");
        }
        var py = projGame(0, v).y;
        if (py > -40 && py < ch + 40 && Math.abs(py - lastY) >= 24) {
          lastY = py;
          line(axY, 0, py, 10, py);
          text(axY, 4, py - 3, String(v), "start", "middle");
        }
      }
    }

    /* Géométrie du canvas mise en cache : getBoundingClientRect() et
       clientWidth/Height étaient relus à CHAQUE pointermove et à chaque image,
       ce qui force un calcul de mise en page. resize() est le seul endroit où
       ces valeurs changent réellement. */
    var cw = 1, ch = 1, rectL = 0, rectT = 0;
    function syncRect() {
      var r = canvas.getBoundingClientRect();
      rectL = r.left; rectT = r.top;
    }
    function resize() {
      var w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
      cw = w; ch = h;
      syncRect();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(Math.min(MOBILE ? 1.9 : 2, devicePixelRatio));
      /* les points sont dimensionnés en pixels physiques dans le shader : leur
         uniforme doit suivre le ratio réel, sinon ils sont dessinés trop gros */
      var pr = renderer.getPixelRatio();
      for (var pi = 0; pi < ptMats.length; pi++) ptMats[pi].uniforms.uPixelRatio.value = pr;
    }

    function trap(e) {
      /* toute exception de la boucle finit VISIBLE : overlay + attribut DOM */
      try {
        var txt = String((e && e.stack) || e);
        document.documentElement.setAttribute("data-aw3d-err", txt.slice(0, 800));
        console.error("[AW3D] boucle plantée:", e);
        msg("Erreur 3D : " + esc((e && e.message) || e));
      } catch (e2) {}
    }

    var frameAcc = 0;
    function loop() {
      if (!running) return;
      if (ctxLost) return;         /* contexte mort : ne pas le marteler */
      if (document.hidden) {       /* app en arrière-plan : rien à brûler */
        requestAnimationFrame(loop);
        return;
      }
      /* Le S24 rafraîchit à 120 Hz : la boucle disposait de 8,3 ms par image
         là où le PC en a 16,7. On plafonne à 60 sur mobile — le budget double,
         et personne ne voit la différence sur une carte qui dérive lentement.
         ⚠ getDelta() est appelé ICI et NULLE PART AILLEURS : il consomme le
         compteur. On l'accumule et on le transmet au corps, sinon on
         réintroduit exactement le bug de dt volé corrigé en 1.1.80. */
      frameAcc += clock.getDelta();
      if (MOBILE && frameAcc < 1 / 60) { requestAnimationFrame(loop); return; }
      try {
        var dt = Math.min(.05, frameAcc), t = clock.elapsedTime;
        frameAcc = 0;
        /* l'horloge n'appartient qu'à la boucle : les entrées ne font que
           lever actPending, on le consomme ici (cf. commentaire sur actPending) */
        if (actPending) { lastAct = t; actPending = false; }
        /* cisaillement en BALANCEMENT (sinus lent) : les bras ondulent sans
           jamais s'enrouler en anneaux comme avec un temps linéaire */
        if (galaxyMat) galaxyMat.uniforms.uTime.value = Math.sin(t * 0.045) * 10;
        /* ×3 : la surface de plasma bouge visiblement même vue de loin */
        for (var pi = 0; pi < plasmaList.length; pi++) plasmaList[pi].uniforms.time.value = t * 3;
        /* Protubérances : croissance A→B, plateau, résorption depuis A.
           Zoom sémantique : de loin, pas de protubérances (elles seraient
           sous-pixel). NOTE D'EXÉCUTION connue et tolérée : le seuil est
           GLOBAL, pas par système — au franchissement des 9 px par cellule,
           plusieurs milliers d'allocations tombent dans une seule image et la
           vue accroche un instant. Défaut documenté pour qu'on ne le
           « découvre » pas à nouveau dans six mois. */
        var promsOn = pxCellNow >= 9;
        for (var s2 = 0; s2 < systems.length; s2++) {
          var sv2 = systems[s2];
          if (!sv2.proms) continue;
          if (sv2.promG) sv2.promG.visible = promsOn;
          if (!promsOn) continue;
          for (var pj = 0; pj < sv2.proms.length; pj++) {
            var pr2 = sv2.proms[pj];
            if (!pr2.mesh) {   /* premier passage : spawn désynchronisé */
              spawnMapProm(sv2, pr2, t);
              pr2.t0 = t - Math.random() * pr2.dur;
              continue;
            }
            var ph2 = (t - pr2.t0) / pr2.dur;
            if (ph2 >= 1) { spawnMapProm(sv2, pr2, t); continue; }
            var uu = pr2.mesh.material.uniforms;
            uu.head.value = Math.min(1, ph2 / 0.35);
            uu.tail.value = Math.max(0, (ph2 - 0.65) / 0.35);
            uu.opacity.value = 0.85 * Math.min(1, ph2 / 0.08) * Math.min(1, (1 - ph2) / 0.08);
            uu.time.value = t;
          }
        }
        /* le ciel de fond dérive lentement, indépendamment de la carte */
        if (skyDome) skyDome.rotation.y = t * 0.005;
        updateMeteors(t);
        /* la galaxie tourne par SA MESH, calée sur le groupe des systèmes :
           même sens, même vitesse — le shader ne gère plus que le cisaillement */
        if (galaxy && group) galaxy.rotation.y = group.rotation.y;
        if (nebula && group) nebula.rotation.y = group.rotation.y;
        /* le cœur respire doucement, comme la référence */
        if (coreGlow) coreGlow.scale.setScalar(params.radius * 0.16 * (1 + 0.06 * Math.sin(t * 0.8)));
        updateMap(t, dt);
        updateVeil();
        updateAxes();   /* réglettes de coordonnées, redessinées seulement si le cadrage a bougé */
        updateFocus();
        /* mode cinéma : dérive lente le long de la galaxie après 30 s de calme.
           PAS au doigt : sur téléphone on pose l'appareil, on revient, et la
           vue avait pivoté, basculé et reculé toute seule — ça se lisait comme
           « les gestes ne répondent pas / c'est à l'envers ». */
        if (!MOBILE && t - lastAct > 30 && !hov && !sel) {
          if (!cinema) { cinema = true; focusRef = null; }
          orbit.tTheta += dt * 0.03;
          if (!layers.flat) orbit.tPhi = 0.85 + Math.sin(t * 0.05) * 0.12;
          var caC = t * 0.015;
          tTarget.set(Math.cos(caC) * params.radius * 0.45, 0, Math.sin(caC) * params.radius * 0.45);
          orbit.tDist = distFor(13);
        } else if (cinema && t - lastAct <= 30) {
          cinema = false;
        }
        updateCamera(dt);
        /* La scène est mise à jour UNE fois, ici, juste avant le rendu :
           renderer.render() la recomposait intégralement une seconde fois
           après updateMap, soit deux parcours complets de l'arbre par image. */
        scene.updateMatrixWorld();
        renderer.render(scene, camera);
        renderOpen(sel || hov);   /* passes 2 et 3 : masque sous les anneaux du système ouvert */
      } catch (e) { running = false; trap(e); return; }
      requestAnimationFrame(loop);
    }

    function updateFocus() {
      if (!focusRef || !group) return;
      _ft.set(focusRef.x * unit, 0, focusRef.y * unit).applyMatrix4(group.matrixWorld);
      tTarget.copy(_ft);
    }
    function updateCamera(dt) {
      orbit.theta += (orbit.tTheta - orbit.theta) * .08;
      orbit.phi += (orbit.tPhi - orbit.phi) * .08;
      orbit.dist += (orbit.tDist - orbit.dist) * .08;
      target.lerp(tTarget, Math.min(1, dt * 4));
      camera.position.x = target.x + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta);
      camera.position.y = target.y + orbit.dist * Math.cos(orbit.phi);
      camera.position.z = target.z + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta);
      camera.lookAt(target);
    }

    /* ══════════════════════════════════════════════════════════════════════
       5.8 · LE DÉ-ENCOMBREMENT DES ÉTIQUETTES
       ──────────────────────────────────────────────────────────────────────
       C'est la partie qui a demandé le plus de reprises, et elle ne se
       rediscute pas. Les sept règles qui la font tenir, chacune payée par un
       scintillement à l'écran :
         1. Aucune clé de tri ne doit varier EN CONTINU : ni pxCell brut (deux
            voisines permutaient à chaque image), ni deploy (promener la souris
            reclassait tout le monde). Palier de doublement de taille, puis
            l'id en départage — c'est stable.
         2. Le concours ne se rejoue PAS à chaque image, ni sur un chronomètre :
            le filet à 2 s rebattait les cartes indéfiniment pendant la dérive
            cinéma. On mesure le déplacement ACCUMULÉ de la caméra et on ne
            rejoue que si la vue a vraiment changé.
         3. Fondu de ~0,35 s à l'apparition ET à la disparition.
         4. Le survol NE DÉCLENCHE PAS de nouveau concours : le système survolé
            est allumé hors concours.
         5. La boîte réservée est la largeur de l'ENCRE du texte (__inkW), pas
            celle du sprite.
         6. Le tag d'alliance a son PROPRE concours, dans la MÊME grille : le
            décrocher complètement le laisse s'empiler sur les noms, le coupler
            au nom le fait disparaître avec lui.
         7. Un nom qui vient d'apparaître ne peut pas être éteint avant une
            demi-seconde (temps de séjour).
       Ce bloc ne lit que systems, camera, orbit.dist, hov/sel et les positions
       écran ; il n'écrit que dans les sprites d'étiquette.
       ══════════════════════════════════════════════════════════════════════ */

    var _lblList = [], _lblGrid = null, _lblGW = 0, _lblGH = 0;
    /* liste SEPAREE pour la passe des tags : elle tourne maintenant AVANT
       celle des noms, qui continue d'utiliser _lblList. */
    var _lblListT = [];
    var LBL_CELL = 14;                    /* finesse de la grille, en pixels */
    function lblFree(x0, y0, x1, y1, gw, gh) {
      var i0 = Math.max(0, (x0 / LBL_CELL) | 0), i1 = Math.min(gw - 1, (x1 / LBL_CELL) | 0);
      var j0 = Math.max(0, (y0 / LBL_CELL) | 0), j1 = Math.min(gh - 1, (y1 / LBL_CELL) | 0);
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++)
        if (_lblGrid[j * gw + i]) return false;
      return true;
    }
    function lblMark(x0, y0, x1, y1, gw, gh) {
      var i0 = Math.max(0, (x0 / LBL_CELL) | 0), i1 = Math.min(gw - 1, (x1 / LBL_CELL) | 0);
      var j0 = Math.max(0, (y0 / LBL_CELL) | 0), j1 = Math.min(gh - 1, (y1 / LBL_CELL) | 0);
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) _lblGrid[j * gw + i] = 1;
    }
    /* ⚠ Ordre STABLE : aucune clé ne doit varier en continu avec la caméra.
       Trier sur pxCell (la taille à l'écran) faisait permuter deux voisines à
       chaque image dès qu'on se déplaçait, et comme une seule des deux obtient
       la place, les deux noms clignotaient. `lblOn` d'abord : une étiquette
       déjà affichée garde sa place tant qu'elle la mérite — c'est ce qui rend
       l'ensemble collant. Dernière clé : l'id, arbitraire mais FIXE, pour que
       deux systèmes à égalité soient toujours départagés pareil. */
    /* ⚠ Aucune clé ne doit varier en continu. `deploy` était en tête : il
       monte et descend en fondu sur le système survolé, donc PROMENER LA
       SOURIS sur la carte reclassait tout le monde et redistribuait les
       places — c'est ce qui restait du scintillement. Le survol est traité
       hors concours (voir placeLabels), il n'a plus rien à faire ici. */
    function lblPalier(s) { return Math.round(Math.log(Math.max(1, s.pxCell)) / Math.LN2); }
    function cmpLbl(a, b) {
      return ((b.lblOn ? 1 : 0) - (a.lblOn ? 1 : 0))
        || ((b.isMine ? 1 : 0) - (a.isMine ? 1 : 0))
        || ((b.capital ? 1 : 0) - (a.capital ? 1 : 0))
        || (starIdx(b.popLevel) - starIdx(a.popLevel))
        /* Priorité au plus PROCHE — mais par paliers de doublement de taille,
           pas sur la valeur continue : sinon deux systèmes de taille voisine
           permutent dès qu'on bouge d'un pixel, et se volent la place à tour
           de rôle. Un palier ne change qu'au facteur 2, donc jamais par
           accident. */
        || (lblPalier(b) - lblPalier(a))
        || ((+a.id || 0) - (+b.id || 0));
    }
    var _lblAcc = 9, _lblKey = "", _lblCam = new T.Vector3(), _lblQ = new T.Quaternion(), _lblFirst = true;
    function placeLabels(w, h, dt) {
      /* ⚠ `hov` NE FAIT PLUS PARTIE de la clé : il change à chaque passage de
         souris sur un système, et forçait donc un nouveau concours — donc de
         nouveaux gagnants — à chaque mouvement du curseur. */
      var key = (sel ? sel.id : "") + "|" + (layers.flat ? 1 : 0);
      _lblAcc += (dt || 0.016);
      /* ── Quand rejouer le concours ? ──────────────────────────────────
         PAS sur un chronomètre. Le filet de sécurité à 2 s qui restait ici
         rebattait les cartes toutes les deux secondes pendant la dérive
         cinéma — qui ne s'arrête jamais — et c'est exactement le « ça
         disparaît puis ça revient » qu'il restait à l'écran.
         On mesure donc le déplacement ACCUMULÉ de la caméra depuis la
         dernière décision, et on ne rejoue que lorsque la vue a réellement
         changé : plus de 6 % de la distance de vue, ou plus de 2,5° de
         rotation. Une dérive lente ne déclenche alors qu'une poignée de
         recalculs par minute, chacun fondu en 0,35 s. */
      var bouge = camera.position.distanceTo(_lblCam) > orbit.dist * 0.06 ||
                  Math.abs(camera.quaternion.dot(_lblQ)) < 0.99976;
      if (key !== _lblKey || _lblFirst || (bouge && _lblAcc >= 0.35)) {
        _lblKey = key; _lblFirst = false;
        _lblCam.copy(camera.position); _lblQ.copy(camera.quaternion);
        decideLabels(w, h, _lblAcc);
        _lblAcc = 0;
      }
      for (var q = 0; q < systems.length; q++) {
        var sq = systems[q];
        if (!sq.lbl) continue;
        /* survolé, sélectionné ou déployé : allumé quoi qu'ait dit le
           concours, et sans le rejouer. C'est instantané et ça ne déloge
           personne. */
        var force = (sq === hov || sq === sel || sq.deploy > .25) && sq.vis && sq.lblWant;
        fadeLbl(sq, (sq.lblOn || force) ? 1 : 0, dt);
      }
    }
    function decideLabels(w, h, dt) {
      /* Plus de seuil de distance : TOUT système devant la caméra concourt
         pour son nom. Le seuil (17 px par cellule) écartait d'office la moitié
         de la carte — c'est lui qui donnait l'impression qu'il « manque » des
         noms. Reste le seul filtre qui se justifie : deux étiquettes ne
         peuvent pas occuper la même place à l'écran. On écarte simplement ce
         qui est trop petit pour être lu du tout (2 px par cellule). */
      _lblList.length = 0;
      var i, s;
      for (i = 0; i < systems.length; i++) {
        s = systems[i];
        if (!s.lbl) continue;
        if (s.lblWant && s.vis && s.pxCell > 2) {
          _lblList.push(s);
        } else {
          s.lblOn = false;
        }
      }
      _lblList.sort(cmpLbl);
      var gw = Math.ceil(w / LBL_CELL) + 1, gh = Math.ceil(h / LBL_CELL) + 1;
      if (!_lblGrid || _lblGW !== gw || _lblGH !== gh) {
        _lblGW = gw; _lblGH = gh; _lblGrid = new Uint8Array(gw * gh);
      } else _lblGrid.fill(0);

      for (i = 0; i < _lblList.length; i++) {
        s = _lblList[i];
        var px = s.pxCell;
        /* boîte englobant le nom (2,85 cellules de large au maximum).
           Plafonnée : tout près, une étiquette mesure des milliers de pixels
           et repeindrait la grille entière à chaque image pour rien. */
        /* On réserve l'ENCRE, pas le sprite : cf. __inkW dans sysLblTex. */
        var hw = Math.min(260, px * (s.lblInk || 2.45) * 0.5);
        var x0 = s.sx - hw, x1 = s.sx + hw;
        /* Plus rien à réserver AU-DESSUS : le tag d'alliance a maintenant sa
           propre règle d'affichage et ne participe plus à CE concours. La bande
           qu'on lui gardait doublait la hauteur de chaque boîte et faisait
           taire des noms pour de la place qu'ils n'occupaient pas. */
        /* Boite = LE TEXTE, pas la bande depuis le centre du systeme. Partir
           de s.sy reservait aussi l'anneau : depuis que les deux lignes
           sont collees a l'anneau et que les tags passent en premier, la
           bande du nom de A rencontrait le tag de B juste en dessous et
           perdait -- la moitie des noms disparaissait. Le sprite fait
           0,306 cellule de haut : +-0,17 autour de son centre. */
        var y0 = s.sy + Math.max(0, (s.lblDBc - 0.17) * px);
        var y1 = s.sy + Math.min(130 + (s.lblDBc - 0.17) * px, (s.lblDBc + 0.17) * px);
        /* Mode « tous les noms » : on n'interroge plus la grille. Le
           dé-encombrement tait forcément des noms sur une carte dense, et il
           n'y a pas de réglage bon en toute circonstance — parfois on veut une
           carte lisible, parfois on veut TOUT voir, quitte au chevauchement.
           Le choix revient donc à l'utilisateur (bouton « Noms », trois états). */
        var ok = (layers.tags === 2) ? true : lblFree(x0, y0, x1, y1, gw, gh);
        /* survolé, sélectionné ou déployé : toujours lisible, quoi qu'il arrive */
        if (!ok && (s === sel || s === hov || s.deploy > .25)) ok = true;
        /* Temps de séjour : un nom qui vient d'apparaître ne peut pas être
           éteint avant une demi-seconde. Sans ce délai, deux étiquettes qui
           se frôlent pendant un déplacement se relayaient d'une image à
           l'autre — c'est ce qui restait du scintillement. */
        s.lblAge = (s.lblAge || 0) + (dt || 0.016);
        if (!ok && s.lblOn && s.lblAge < 0.5) ok = true;
        if (ok !== s.lblOn) s.lblAge = 0;
        s.lblOn = ok;
        /* Une étiquette qui s'efface occupe encore la place pendant sa
           disparition : on la marque tant qu'elle est lisible, sinon sa
           remplaçante s'allume par-dessus et les deux se superposent. */
        if (ok || s.lblA > 0.35) lblMark(x0, y0, x1, y1, gw, gh);
      }
      /* Les tags passent APRES les noms, mais avec des boites qui epousent le
         texte (voir plus haut) : ils ne perdent plus contre des bandes vides.
         L'ordre inverse (tags d'abord) avait ete essaye le 2026-09-09 : dans
         une colonne serree, le tag de B tuait le NOM de A juste au-dessus --
         la moitie des noms disparaissait. Un nom vaut plus qu'un tag voisin. */
      _placeTags(gw, gh);
    }

    /* Placement de la ligne du HAUT (tags d'alliance + id du systeme).
       Appelee APRES les noms, dans la meme grille d'occupation : un tag evite
       les noms deja poses et les tags se cedent la place entre eux.

       Le seuil de taille est passe de 9 a 4 px par cellule. A 9, un systeme
       affichait deja son nom (seuil 2) mais restait muet sur son alliance :
       c'est ce qui laissait des anneaux colores anonymes sur la moitie de la
       carte. */
    function _placeTags(gw, gh) {
      var i, s;
      for (i = 0; i < systems.length; i++) systems[i].tagOn = false;
      _lblListT.length = 0;
      for (i = 0; i < systems.length; i++) {
        s = systems[i];
        if (s.lblTop && s.vis && layers.tags && s.pxCell > 4) _lblListT.push(s);
      }
      _lblListT.sort(cmpLbl);
      for (i = 0; i < _lblListT.length; i++) {
        s = _lblListT[i];
        var pt = s.pxCell;
        /* largeur reelle : les tags PUIS « [id] ». Sans le terme d'id la boite
           etait trop courte et deux lignes voisines se chevauchaient malgre
           le de-encombrement. */
        var nTag = (s.atags && s.atags.length) ? s.atags.length : (s.tag ? 1 : 0);
        var cTag = nTag ? ((s.atags && s.atags.length) ? s.atags.join("").length : s.tag.length) : 0;
        var nCar = cTag + 3 * Math.max(0, nTag - 1) + String(s.id).length + 3;
        var lt = nCar * 0.62 * pt * 0.14 + pt * 0.22;
        var tx0 = s.sx - lt, tx1 = s.sx + lt;
        /* meme logique que le nom : la boite epouse le texte (+-0,17) */
        var ty0 = s.sy - (s.lblDTc + 0.17) * pt;
        var ty1 = s.sy - (s.lblDTc - 0.17) * pt;
        var okT = (layers.tags === 2) ? true : lblFree(tx0, ty0, tx1, ty1, gw, gh);
        if (!okT && (s === sel || s === hov || s.deploy > .25)) okT = true;
        s.tagOn = okT;
        if (okT) lblMark(tx0, ty0, tx1, ty1, gw, gh);
      }
    }

    /* Apparition et disparition en fondu plutôt qu'en tout-ou-rien : même
       quand la décision est juste, un nom qui surgit d'un coup pendant un
       déplacement se lit comme un clignotement.
       Les DEUX lignes peuvent désormais être fondues : leurs clés cached()
       portent l'id du système, donc chaque matériau lui appartient en propre.
       C'était faux du tag tant que sa clé ne portait que l'alliance. */
    function fadeLbl(s, target, dt) {
      /* ~0,35 s de fondu : assez lent pour qu'un changement se lise comme une
         transition et jamais comme un clignotement */
      var k = Math.min(1, (dt || 0.016) * 5);
      if (s.lblA === undefined) s.lblA = 0;
      /* hors champ : on coupe net, sinon un fantôme réapparaît au retour */
      if (!s.vis) s.lblA = target ? s.lblA : 0;
      s.lblA += (target - s.lblA) * k;
      if (s.lblA < 0.004) s.lblA = 0;
      else if (s.lblA > 0.996) s.lblA = 1;
      s.lbl.material.opacity = 0.95 * s.lblA;
      s.lbl.visible = s.lblA > 0;
      /* Le tag d'alliance garde sa PROPRE décision de placement (il tient dans
         un quart de la place d'un nom, et c'est l'information la plus demandée
         sur cette carte : il n'a pas à disparaître parce qu'un nom a perdu le
         concours). En revanche il peut MAINTENANT être fondu comme le nom :
         depuis que sa clé cached() porte l'id du système ("TAG:#hex|id"), son
         matériau lui appartient en propre. Tant qu'il était partagé par toute
         une alliance, y toucher les faisait tous fondre ensemble — d'où le
         tout-ou-rien qu'on lui imposait. */
      if (s.lblTop) {
        if (s.topA === undefined) s.topA = 0;
        var tt = s.tagOn ? 1 : 0;
        if (!s.vis) s.topA = tt ? s.topA : 0;
        s.topA += (tt - s.topA) * k;
        if (s.topA < 0.004) s.topA = 0;
        else if (s.topA > 0.996) s.topA = 1;
        s.lblTop.material.opacity = 0.95 * s.topA;
        s.lblTop.visible = s.topA > 0;
      }
    }

    /* ══════════════════════════════════════════════════════════════════════
       5.9 · LA MISE À JOUR PAR IMAGE
       ══════════════════════════════════════════════════════════════════════ */

    function updateMap(t, dt) {
      if (!group) return;
      group.rotation.y = -t * params.rigid;
      /* PREMIÈRE des deux mises à jour de matrices (cf. l'en-tête du § 5).
         Sans `true` : seule la rotation du groupe change ici, three réinvalide
         de lui-même les enfants dont on écrit position/scale plus bas. Forcer
         recomposait ~2 900 Object3D par image pour rien. */
      group.updateMatrixWorld();
      var w = cw, h = ch;   /* mesurés dans resize(), pas relus par image */
      camera.updateMatrixWorld();

      /* pixels par cellule à une distance de 1 : divisé par la distance d'un
         système, il donne sa taille réelle à l'écran */
      var pxUnit = (h * .5) / Math.tan(camera.fov * Math.PI/360) * unit;
      pxCellNow = pxUnit / orbit.dist;
      var active = sel || hov;

      /* Direction « bas de l'écran » ramenée dans le repère du groupe (la
         galaxie peut pivoter) — les étiquettes restent SOUS l'anneau de
         possession et le tag d'alliance AU-DESSUS quel que soit l'angle.
         L'écart suit l'inclinaison caméra : l'anneau à plat occupe tout son
         rayon vu de dessus, presque rien vu en rasant. */
      _lblDn.set(0, -1, 0).applyQuaternion(camera.quaternion);
      if (layers.flat) _lblDn.y = 0;
      if (_lblDn.lengthSq() < 1e-6) _lblDn.set(0, 0, 1);
      group.getWorldQuaternion(_gq).invert();
      _lblDn.applyQuaternion(_gq);
      if (layers.flat) _lblDn.y = 0;
      if (_lblDn.lengthSq() < 1e-6) _lblDn.set(0, 0, 1);
      _lblDn.normalize();
      camera.getWorldDirection(_vdir);
      var lblTilt = Math.abs(_vdir.y);          /* 1 = vue de dessus */

      var dmax = 0;
      for (var i = 0; i < systems.length; i++) {
        var s = systems[i];
        /* ouverture posée (UNFOLD.rate), repli vif (7) : survoler la carte ne doit pas traîner */
        s.deploy += ((s === active ? 1 : 0) - s.deploy) * Math.min(1, dt * (s === active ? UNFOLD.rate : 7));
        if (s.deploy > dmax) dmax = s.deploy;
        /* horloge de la cascade des planètes : départ quand le système devient actif */
        if (s === active) { if (s.unfoldT == null) s.unfoldT = t; } else if (s.deploy < .02) s.unfoldT = null;
        if (s === S3.sys) s.openRot = (s.openRot || 0) + dt * PRESENT.wheel;
        var fog = layers.fog && !s.inVision ? .3 : 1;
        var op = s.dim * fog, sc = 1 + s.deploy * 2.2;
        var lv = starIdx(s.popLevel);
        /* TAILLE = RICHESSE (cf. « RICHESSE DU SYSTÈME » dans buildMap).
           Le niveau de population ne différencie plus rien sur cette carte :
           c'est donc la taille de l'astre qui doit porter l'information. On
           multiplie des setScalar qui existaient DÉJÀ — coût nul par image,
           mobile compris — et scale est une propriété de l'OBJET, donc aucun
           matériau cached() n'est muté au passage.
           Le facteur va dans la BASE, JAMAIS dans le (1 + deploy * 1.2) :
           sinon l'amplitude du survol changerait d'un système à l'autre. */
        var rk = s.richK || 1;
        /* L'anneau suit, mais bien plus doucement : il dit déjà la COMPOSITION
           par ses crans colorés, il ne prend ici qu'un peu de MAGNITUDE. */
        if (s === S3.sys && s.donutOpen) {
          /* système ouvert : l'anneau à crans reste collé au soleil, les planètes orbitent au-delà */
          var ring0 = unit * (s.ringK || 0.92);
          s.ring.scale.setScalar(ring0 + (s.donutOpen - ring0) * Math.min(1, s.deploy));
        } else s.ring.scale.setScalar(unit * (s.ringK || 0.92) * sc);
        if (s.plas) {
          /* plas et promG DOIVENT garder exactement le même scalaire : les
             protubérances sont des arcs tracés sur la sphère unité */
          var plr = unit * (0.24 + lv * 0.035) * rk * (1 + s.deploy * 1.2);
          s.plas.scale.setScalar(plr);
          if (s.promG) s.promG.scale.setScalar(plr);
        }
        s.node.visible = op > .2 || s.deploy > .02;
        if (s.lbl) {
          /* nom+ID sous l'anneau, tag d'alliance au-dessus, orientés écran.
             Écarts gardés EN CELLULES : placeLabels en refait des pixels. */
          /* L'astre grossit avec la richesse : sans ce report, un système riche
             finirait par manger son propre nom en vue rasante — lblDBc tombe à
             0,45 cellule quand le rayon du soleil monte à ~0,41. Le terme
             resserre aussi (légèrement) l'étiquette des systèmes vides, ce qui
             les rend plus compacts donc plus discrets.
             placeLabels rebâtit sa boîte de dé-encombrement sur ces deux
             valeurs : il suit tout seul, rien d'autre à toucher. */
          /* ⚠ L'écart part du RAYON RÉEL DE L'ANNEAU, pas d'une constante.
             Depuis que le rayon est plafonné par le voisinage (ringK varie de
             0,34 à 0,92 selon la densité), un écart fixe plaçait le nom loin
             sous l'anneau des systèmes serrés et à cheval sur celui des
             systèmes isolés. Le rayon visible du disque vaut ringK × 0,8125
             (le trait fait 17 px sur un canvas de 256 dont le rayon utile est
             104) : on se pose juste dessous, plus une marge fixe qui, elle,
             suit l'inclinaison de la caméra. */
          var rA = (s.ringK || 0.92) * 0.8125;
          /* Marges resserrees : le nom se lisait comme appartenant au
             systeme du DESSOUS en vue de dessus (rA vaut deja ~0,75, la
             marge fixe et le terme d'inclinaison ajoutaient 0,60 de plus).
             On garde la logique — l'ecart part du rayon reel de l'anneau —
             en divisant la marge par deux. */
          /* Le rayon de l'anneau compte pour rA x lblTilt et non rA : vu de
             biais, l'anneau est une ellipse dont le demi-axe VERTICAL a l'ecran
             vaut rA x sin(inclinaison). Prendre rA entier posait le nom a une
             demi-cellule sous l'anneau des qu'on inclinait. Le +0,19 est la
             demi-hauteur du sprite (0,153) plus une marge de 4 centiemes :
             le haut du texte affleure l'anneau. */
          /* système ouvert (présentation) : nom et tags d'alliance ×2,6, décalés d'autant */
          var FL = s === openSys && openF > 0 ? 1 + 1.6 * openF * Math.min(1, w / Math.max(1, h) * 1.4) : 1;
          s.lbl.scale.set(unit * 2.45 * FL, unit * 0.306 * FL, 1);
          if (s.lblTop) { var aw2 = s.lblTop.userData.w || 2.5; s.lblTop.scale.set(unit * aw2 * FL, unit * aw2 / 8 * FL, 1); }
          s.lblDBc = rA * lblTilt + 0.19 * FL + s.deploy * 0.9 + (rk - 1) * 0.30;
          s.lblDTc = rA * lblTilt + 0.18 * FL + s.deploy * 1.2 + (rk - 1) * 0.30;
          s.lbl.position.copy(_lblDn).multiplyScalar(unit * s.lblDBc);
          if (s.lblTop) s.lblTop.position.copy(_lblDn).multiplyScalar(-unit * s.lblDTc);
          if (FL > 1 && openEllipse && S3.down && openCam) {
            /* Système ouvert : les étiquettes calculées pour la caméra de la CARTE tombaient au
               milieu des orbites (et de travers : la présentation est inclinée). On les pose au-dessus
               du bloc, dans le repère de la caméra de présentation : tags d'alliance en haut, puis
               « Nom [ID] (x/y) », juste au-dessus du bord de l'ellipse du bloc. */
            var eo = openEllipse;
            var extPx = Math.sqrt(Math.pow(eo.a * Math.sin(eo.ang), 2) + Math.pow(eo.b * Math.cos(eo.ang), 2));
            _v.set(s.cx * unit, s.node.position.y, s.cy * unit).applyMatrix4(group.matrixWorld);
            var wppL = 2 * Math.tan(openCam.fov * Math.PI / 360) * _v.distanceTo(openCam.position) / Math.max(1, h);
            var nameH = unit * 0.306 * FL, tagH = s.lblTop ? unit * (s.lblTop.userData.w || 2.5) / 8 * FL : 0;
            var dName = (extPx + 8) * wppL + nameH * 0.5;
            var dTag = dName + nameH * 0.5 + tagH * 0.5 + 4 * wppL;
            if (!S3.upL) S3.upL = new T.Vector3();
            S3.upL.copy(S3.down).multiplyScalar(-dName);
            s.lbl.position.lerp(S3.upL, openF);
            if (s.lblTop) { S3.upL.copy(S3.down).multiplyScalar(-dTag); s.lblTop.position.lerp(S3.upL, openF); }
          }
          if (layers.flat) {
            s.lbl.position.y = unit * .06;
            if (s.lblTop) s.lblTop.position.y = unit * .06;
          }
          /* la visibilité se tranche plus bas, une fois les positions écran
             connues : seuil PAR SYSTÈME puis dé-encombrement */
          s.lblWant = op > .5 && layers.tags;
        }
        if (s.sb) s.sb.visible = layers.star && op > .5;
        /* getWorldPosition() remonte toute la chaîne de parents et refait
           group.updateMatrix() — 300 fois par image, pour un group dont la
           matrice vient d'être calculée. On projette depuis les coordonnées,
           comme le font déjà les flottes et les orbites. */
        _v.set(s.cx * unit, s.node.position.y, s.cy * unit).applyMatrix4(group.matrixWorld);
        /* Combien de pixels vaut une cellule À CET ENDROIT. En perspective,
           un système de l'horizon est dix fois plus loin que celui de devant :
           les juger tous sur orbit.dist (pxCellNow) était la cause des noms
           empilés en bouillie au fond. */
        s.pxCell = pxUnit / Math.max(1e-3, _v.distanceTo(camera.position));
        _v.project(camera);
        s.vis = _v.z < 1 && s.node.visible;
        s.sx = (_v.x*.5+.5) * w; s.sy = (-_v.y*.5+.5) * h;
      }
      decorFade(dmax);

      placeLabels(w, h, dt);

      if (planetPts) {
        var arr = planetPts.geometry.attributes.position.array;
        var sca = planetPts.geometry.attributes.aScale.array;
        /* zoom sémantique : très près, les 12 planètes en orbite grossissent */
        var zf = Math.max(1, Math.min(3, pxCellNow / 70));
        /* planètes texturées : seul le système actif (ou celui qui se replie) en a */
        if (true) {   /* 14/09 : aussi au doigt (testé sur l'émulateur : 60 i/s système ouvert) */
          if (active && active !== S3.sys && active.deploy > .02) s3Build(active);
          else if (S3.sys && S3.sys !== active && S3.sys.deploy < .02) s3Clear();
          if (S3.sys && S3.light) {
            S3.light.position.set(S3.sys.cx * unit, S3.sys.node.position.y, S3.sys.cy * unit);
            if (S3.sunU) S3.sunU.value.copy(S3.light.position).applyMatrix4(group.matrixWorld);
            /* « bas de l'écran » ramené dans le repère du groupe : les étiquettes restent SOUS leur planète */
            if (!S3.down) { S3.down = new T.Vector3(); S3.gq = new T.Quaternion(); }
            var lcam = S3.sys === openSys && openF > 0 && openCam ? openCam : camera;
            S3.down.set(0, -1, 0).applyQuaternion(lcam.quaternion).applyQuaternion(group.getWorldQuaternion(S3.gq).invert());
          }
        }
        for (var o = 0; o < orbits.length; o++) {
          var ob = orbits[o], sy = ob.s, dp = sy.deploy, swirl = 0, lift = 0, sk = -1, flashK = -1;
          /* DÉPLOIEMENT EN CASCADE (horloge propre, cf. s.unfoldT) : au survol, les planètes
             quittent le soleil l'une après l'autre (orbite intérieure d'abord, 70 ms d'écart),
             en spirale, dépassent leur orbite d'environ 10 % puis s'y posent ; la dernière
             arrive vers 1,2 s. Au repli, elles rentrent ensemble (sy.deploy). */
          if (sy === active && sy.unfoldT != null && sy === S3.sys && ob.mesh3) {
            var fx = unfoldFx(ob, sy), e0 = (t - sy.unfoldT - fx.delay) / fx.dur, ek = Math.max(0, Math.min(1, e0));
            if (fx.mode === 0) {            /* SPIRALE */
              dp = easeBackOut(ek); swirl = (1 - ek) * fx.swirl;
              lift = Math.sin(Math.PI * ek) * Math.abs(fx.lift) * 0.3; sk = Math.min(1, ek * 1.8);
            } else if (fx.mode === 1) {     /* CHUTE */
              var ec = 1 - Math.pow(1 - ek, 3);
              dp = 1 + (fx.far - 1) * (1 - ec); swirl = (1 - ec) * fx.swirl * 0.45;
              lift = (1 - ec) * fx.lift; sk = Math.min(1, ek * 2.4);
            } else {                        /* WARP */
              dp = 1; swirl = (1 - ek) * 0.3 * (fx.swirl < 0 ? -1 : 1); sk = elasticOut(ek);
            }
            /* éclair : à l'arrivée (0,6 s), ou dès le surgissement pour le warp */
            if (fx.mode === 2) { if (e0 >= 0 && e0 < 0.55 / fx.dur) flashK = e0 * fx.dur / 0.55; }
            else if (e0 >= 1 && e0 < 1 + 0.6 / fx.dur) flashK = (e0 - 1) * fx.dur / 0.6;
          } else if (sy === active && sy.unfoldT != null) {
            /* cascade d'origine (mobile, planètes en points) */
            var ek2 = Math.max(0, Math.min(1, (t - sy.unfoldT - ob.k * UNFOLD.step) / UNFOLD.dur));
            dp = easeBackOut(ek2);
            swirl = (1 - ek2) * 2.4;
          }
          var k = 1 + dp * 5.5;
          /* angle accumulé : la vitesse peut changer (système ouvert → très lent) sans que la planète saute */
          var kSp = sy === openSys ? 1 + (PRESENT.orbit - 1) * smooth01(sy.deploy * 1.5) : 1 + sy.deploy * .4;
          ob.acc = (ob.acc || 0) + dt * ob.sp * kSp;
          var ro = sy === S3.sys && sy.radOpen ? sy.radOpen[ob.k] : null;
          /* système ouvert : roue à l'angle d'or (cf. s3Layout) ; ailleurs, la phase et la vitesse de la carte */
          var an = ro != null && ob.gold != null ? (sy.wheel0 || 0) + (sy.openRot || 0) + ob.gold * S3_GOLD + swirl
                                                 : ob.ph + ob.acc + swirl;
          var rad = ro != null ? ob.rad + (ro - ob.rad) * dp : ob.rad * k;
          var x = sy.cx * unit + Math.cos(an) * rad, z = sy.cy * unit + Math.sin(an) * rad;
          var ey = sy.node.position.y + lift * unit;
          arr[o*3] = x; arr[o*3+1] = ey; arr[o*3+2] = z;
          /* planète assiégée : battement de cœur tant que le système est déployé */
          var beat = ob.p && ob.p.siege && sy.deploy > .5 ? 1 + .5 * Math.pow(Math.max(0, Math.sin(t * 6)), 8) : 1;
          /* planètes texturées du système actif (cf. S3) : la sphère prend la place du point */
          if (ob.mesh3) {
            var m3 = ob.mesh3, dq = sk >= 0 ? sk : Math.max(0, dp);
            m3.visible = sy.node.visible && dq > .01;
            m3.position.set(x, ey, z);
            var rad3 = unit * m3.userData.r * dq * beat, ud3 = m3.userData;
            m3.scale.setScalar(Math.max(1e-4, rad3));
            ud3.rotAcc = (ud3.rotAcc || 0) + dt * ud3.spin * PRESENT.spin;
            if (ud3.body) ud3.body.rotation.y = ud3.rot0 + ud3.rotAcc;
            if (ud3.clouds) ud3.clouds.rotation.y = ud3.rot0 + 0.4 + ud3.rotAcc * 1.3;
            if (ob.flash3) {
              ob.flash3.visible = m3.visible && flashK >= 0 && flashK < 1;
              if (ob.flash3.visible) {
                ob.flash3.position.set(x, ey, z);
                ob.flash3.scale.setScalar(unit * m3.userData.r * (2.2 + 7 * flashK));
                ob.flash3.material.opacity = (1 - flashK) * (1 - flashK) * 0.95;
              }
            }
            if (ob.lbl3 && S3.down) {
              var lk = Math.max(0, Math.min(1, (dq - 0.55) * 2.5)), lu = ob.lbl3.userData;
              /* portrait : taille rapportée à la largeur (sinon les noms mangeaient l'écran d'un téléphone) */
              var hf = lu.hBase * Math.min(1, w / Math.max(1, h) * 1.15);
              if (Math.abs(hf - lu.hFrac) > 1e-4 || !lu.scaled) {
                lu.hFrac = hf; lu.scaled = true;
                var kk = hf * 2 * Math.tan(camera.fov * Math.PI / 360);
                ob.lbl3.scale.set(kk * lu.ratio, kk, 1);
              }
              var lka = lk * (lu.alpha == null ? 1 : lu.alpha);
              ob.lbl3.visible = m3.visible && lka > 0.02;
              ob.lbl3.material.opacity = lka;
              /* sous la planète : son rayon (anneaux compris) + la demi-hauteur de l'étiquette,
                 convertie de pixels en unités à la distance de la caméra de présentation */
              var lcam3 = sy === openSys && openF > 0 && openCam ? openCam : camera;
              _v.set(x, ey, z).applyMatrix4(group.matrixWorld);
              var wpp = 2 * Math.tan(lcam3.fov * Math.PI / 360) * _v.distanceTo(lcam3.position) / Math.max(1, h);
              var loff = rad3 * (ud3.ringed ? 1.72 : 1.07) + (lu.hFrac * h * 0.5 + 4) * wpp;
              ob.lbl3.position.set(x + S3.down.x * loff, ey + S3.down.y * loff, z + S3.down.z * loff);
            }
          }
          sca[o] = ob.mesh3 ? 0 : (.55 + (o % 3) * .12) * (1 + dp * 2.4) * beat * zf * (sy.node.visible ? 1 : 0);
          /* seules les planètes du système déployé sont cliquables */
          ob.vis = sy.deploy > .5;
          if (ob.vis) {
            /* planètes du bloc présenté : projetées là où elles sont DESSINÉES (openCam) */
            _v.set(x, ey, z).applyMatrix4(group.matrixWorld).project(sy === openSys && openF > 0 && openCam ? openCam : camera);
            ob.sx = (_v.x*.5+.5) * w; ob.sy = (-_v.y*.5+.5) * h;
            ob.vis = _v.z < 1;
          }
        }
        planetPts.geometry.attributes.position.needsUpdate = true;
        planetPts.geometry.attributes.aScale.needsUpdate = true;
        if (S3.sys) s3Declutter(dt);
      }

      if (inspector) {
        if (active && active.deploy > .02) {
          inspector.visible = true;
          inspector.position.set(active.cx * unit, active.node.position.y, active.cy * unit);
          var lay = active === S3.sys && active.radOpen ? active.radOpen : null;
          for (var k2 = 0; k2 < 12; k2++) {
            var base2 = unit * (.30 + k2 * .055);
            if (lay) {
              var ro2 = lay[k2];
              orbitLines[k2].visible = ro2 != null;
              if (ro2 != null) orbitLines[k2].scale.setScalar(base2 + (ro2 - base2) * active.deploy);
            } else {
              orbitLines[k2].visible = true;
              orbitLines[k2].scale.setScalar(base2 * (1 + active.deploy * 5.5));
            }
            orbitLines[k2].material.opacity = .32 * active.deploy;
          }
          var ph = (t * .55) % 1;
          var rmax = lay ? (unit * (.30 + 11 * .055) + (active.outerOpen - unit * (.30 + 11 * .055)) * active.deploy) * 1.05
                         : unit * (.30 + 11 * .055) * (1 + active.deploy * 5.5) * 1.12;
          scanRing.scale.setScalar(.12 * rmax + ph * rmax);
          scanRing.material.opacity = (1 - ph) * .55 * active.deploy;
        } else inspector.visible = false;
      }

      if (rangeRing) {
        if (sel) {
          rangeRing.visible = true;
          rangeRing.position.set(sel.cx * unit, sel.node.position.y, sel.cy * unit);
          rangeRing.scale.setScalar(range * unit);
        } else rangeRing.visible = false;
      }

      updateFleets(t, w, h);

      /* le tip suit la tête de flotte en mouvement AVANT tout le reste */
      if (hovFleet && hovFleet.vis) placeTip(hovFleet.sx, hovFleet.sy);
      else if (hovPlanet && hovPlanet.vis) placeTip(hovPlanet.sx, hovPlanet.sy);
      else if (hov && hov.vis) placeTip(hov.sx, hov.sy);
      else if (sel && sel.vis) placeTip(sel.sx, sel.sy);
    }

    function updateFleets(t, w, h) {
      if (!fleetGroup) return;
      fleetGroup.visible = layers.fleets;
      if (!layers.fleets) return;
      var now = Date.now(), fy = unit * .18;   /* léger surplomb du plan */
      fleets.forEach(function (f) {
        var p;
        /* categorie masquee (oeil du menu Flottes) : tout eteint, non cliquable */
        var onCat = fleetVis[fleetCat(f)] !== false;
        f.line.visible = onCat; f.head.visible = onCat;
        if (f.trail) f.trail.visible = onCat;
        if (f.glow) f.glow.visible = onCat;
        if (f.tube) f.tube.visible = onCat;
        if (f.ship) f.ship.visible = onCat;
        if (f.lbl) f.lbl.visible = onCat;
        if (f.mk) {
          ["core", "dart", "engine", "flow", "badge"].forEach(function (k) { if (f.mk[k]) f.mk[k].visible = onCat; });
          if (f.mk.chev && !onCat) f.mk.chev.forEach(function (c) { c.visible = false; });
        }
        if (!onCat) { f.vis = false; return; }
        if (isFinite(f.t0) && isFinite(f.t1) && f.t1 > f.t0) {
          /* vraie progression temporelle : le marqueur avance en direct */
          p = (now - f.t0) / (f.t1 - f.t0);
          f.eta = Math.max(0, (f.t1 - now) / 1000);
        } else if (f.cur) {
          /* repli : la position instantanée servie par le jeu, projetée */
          var vx = f.to.cx - f.from.cx, vy = f.to.cy - f.from.cy;
          var L2 = vx*vx + vy*vy || 1;
          p = ((+f.cur.x - f.from.cx)*vx + (+f.cur.y - f.from.cy)*vy) / L2;
          f.eta = isFinite(f.t1) ? Math.max(0, (f.t1 - now) / 1000) : 0;
        } else {
          p = (t * .05) % 1;
          f.eta = 0;
        }
        f.p = Math.max(0, Math.min(1, p));
        var ax = f.from.cx*unit, az = f.from.cy*unit, bx = f.to.cx*unit, bz = f.to.cy*unit;
        /* Bézier quadratique : point de contrôle au milieu, soulevé de l'apex.
           En vue de dessus l'apex retombe à zéro : la parabole s'écrase et
           redevient le segment d'avant — c'est le comportement voulu, la
           hauteur ne se lit qu'en 3D. */
        var mx = (ax + bx) * .5, mz = (az + bz) * .5, ap = layers.flat ? 0 : f.apex;
        var bez = function (u, o) {
          var v = 1 - u;
          o.x = v*v*ax + 2*v*u*mx + u*u*bx;
          o.y = fy + 2*v*u*ap;
          o.z = v*v*az + 2*v*u*mz + u*u*bz;
          return o;
        };
        var _b = {x:0, y:0, z:0};
        bez(f.p, _b);
        var x = _b.x, hy = _b.y, z = _b.z;
        /* l'arc affiche le trajet RESTANT : de la tête jusqu'à la cible */
        var pos = f.line.geometry.attributes.position.array;
        for (var si = 0; si <= f.seg; si++) {
          var u2 = f.p + (1 - f.p) * (si / f.seg);
          bez(u2, _b);
          pos[si*3] = _b.x; pos[si*3+1] = _b.y; pos[si*3+2] = _b.z;
        }
        f.line.geometry.attributes.position.needsUpdate = true;
        f.head.position.set(x, hy, z);
        f.head.scale.setScalar(unit * ((f.own ? 1.6 : 1.0) + Math.sin(t * 4 + f.p * 9) * 0.18));
        if (f.own || f.tube) {
          /* Tube sur le trajet RESTANT : sous-courbe [p,1] de la Bezier
             quadratique (de Casteljau) : Q0 = B(p), Q1 = (1-p)P1 + pP2, Q2 = P2. */
          if (f.tube && t - (f.tubeAt || 0) > 0.33) {
            f.tubeAt = t;
            var q0 = new T.Vector3(x, hy, z);
            var q1 = new T.Vector3((1 - f.p) * mx + f.p * bx, fy + (1 - f.p) * ap, (1 - f.p) * mz + f.p * bz);
            var q2 = new T.Vector3(bx, fy, bz);
            var old = f.tube.geometry;
            f.tube.geometry = new T.TubeGeometry(new T.QuadraticBezierCurve3(q0, q1, q2), 40, unit * (f.tube.userData.r || 0.06), 6, false);
            if (old) old.dispose();
          }
          /* le vaisseau : pose sur la tete, tourne vers la cible. L'angle est
             pris A L'ECRAN entre la tete et un point un peu plus loin sur
             l'arc — un sprite ne tourne que dans le plan de l'ecran. */
          if (f.ship) {
            f.ship.position.set(x, hy + unit * 0.05, z);
            bez(Math.min(1, f.p + 0.03), _b);
            _v.set(x, hy, z).applyMatrix4(group.matrixWorld).project(camera);
            var sx1 = _v.x, sy1 = _v.y;
            _v.set(_b.x, _b.y, _b.z).applyMatrix4(group.matrixWorld).project(camera);
            f.ship.material.rotation = Math.atan2(_v.y - sy1, (_v.x - sx1) * camera.aspect) + SHIP_ROT;
          }
        }
        /* Etiquette sur MES vols : cible + temps restant, grosso modo (a la
           minute). La texture n'est refaite que quand le texte change. */
        if (f.own) {
          var etaTxt = !isFinite(f.t1) ? "ETA ?" : (f.eta > 0 ? fmtEta(Math.ceil(f.eta / 60) * 60) : "arrivée");
          var txt = "→ " + (f.targetName || "?") + "  ·  " + etaTxt;
          if (txt !== f.lblTxt) {
            f.lblTxt = txt;
            var tex = fleetLblTex(txt);
            if (!f.lbl) {
              f.lbl = new T.Sprite(new T.SpriteMaterial({map:tex, transparent:true, depthWrite:false, opacity:.95}));
              f.lbl.frustumCulled = false;
              fleetGroup.add(f.lbl);
            } else { f.lbl.material.map = tex; f.lbl.material.needsUpdate = true; }
            /* canvas 512x64 : ratio 8:1, meme gabarit que le nom d'un systeme */
            f.lbl.scale.set(unit * 2.8, unit * 0.35, 1);
          }
          f.lbl.position.set(x, hy + unit * 0.75, z);
          f.lbl.visible = true;
        }
        /* la traînée court de l'origine à la tête, SUR la courbe */
        if (f.trail) {
          var tp2 = f.trail.geometry.attributes.position.array;
          for (var ti2 = 0; ti2 < f.trailN; ti2++) {
            var tu0 = f.mk && f.mk.core ? Math.max(0, f.p - 0.3) : 0;   /* comète : queue sur les 30 % derrière la tête */
            bez(tu0 + (f.p - tu0) * (ti2 / (f.trailN - 1)), _b);
            tp2[ti2*3] = _b.x; tp2[ti2*3+1] = _b.y; tp2[ti2*3+2] = _b.z;
          }
          f.trail.geometry.attributes.position.needsUpdate = true;
        }
        /* ── marqueur choisi ── */
        var mk = f.mk || {};
        var angAt = function (u) {   /* angle À L'ÉCRAN de la tangente de l'arc en u (comme le triangle) */
          bez(Math.max(0, Math.min(1, u)), _b);
          _v.set(_b.x, _b.y, _b.z).applyMatrix4(group.matrixWorld).project(camera);
          var ax0 = _v.x, ay0 = _v.y;
          bez(Math.max(0, Math.min(1, u + 0.02)), _b);
          _v.set(_b.x, _b.y, _b.z).applyMatrix4(group.matrixWorld).project(camera);
          return Math.atan2(_v.y - ay0, (_v.x - ax0) * camera.aspect);
        };
        if (mk.core) {
          mk.core.position.set(x, hy, z);
          mk.core.scale.setScalar(unit * (f.own ? .55 : .42) * (1 + Math.sin(t * 7 + f.p * 11) * .12));
        }
        if (mk.chev) {
          var run = (t * 2.2) % 4;
          for (var ci = 0; ci < mk.chev.length; ci++) {
            var cu = f.p - 0.012 - ci * 0.028;
            var csp = mk.chev[ci];
            csp.visible = cu > 0;
            if (cu <= 0) continue;
            bez(cu, _b);
            csp.position.set(_b.x, _b.y, _b.z);
            var lit = Math.max(0, 1 - Math.abs(((ci - run) % 4 + 4) % 4 - 0) / 1.2);
            csp.material.opacity = (0.35 + 0.65 * lit) * (1 - ci * 0.16);
            csp.material.rotation = angAt(cu);
            var cs = unit * (f.own ? .62 : .48) * (1 - ci * 0.12);
            csp.scale.set(cs, cs, 1);
          }
        }
        if (mk.dart) {
          mk.dart.position.set(x, hy + unit * .02, z);
          bez(Math.min(1, f.p + 0.015), _b);
          var ddx = _b.x - x, ddy = _b.y - hy, ddz = _b.z - z, dl = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1;
          if (!mk.q) { mk.q = new T.Quaternion(); mk.up = new T.Vector3(0, 1, 0); mk.dir = new T.Vector3(); }
          mk.dir.set(ddx / dl, ddy / dl, ddz / dl);
          mk.dart.quaternion.setFromUnitVectors(mk.up, mk.dir);
          mk.dart.scale.setScalar(unit * (f.own ? .16 : .12));
          /* réacteur : juste derrière la pyramide, qui scintille */
          mk.engine.position.set(x - mk.dir.x * unit * .32, hy - mk.dir.y * unit * .32, z - mk.dir.z * unit * .32);
          mk.engine.scale.setScalar(unit * (.45 + Math.sin(t * 23 + f.p * 5) * .08));
        }
        if (mk.flow) {
          var fpos = mk.flow.geometry.attributes.position.array, ph0 = (t * .45) % 1;
          for (var fi = 0; fi < mk.flowN; fi++) {
            bez(f.p + (1 - f.p) * ((fi + ph0) / mk.flowN), _b);
            fpos[fi * 3] = _b.x; fpos[fi * 3 + 1] = _b.y; fpos[fi * 3 + 2] = _b.z;
          }
          mk.flow.geometry.attributes.position.needsUpdate = true;
        }
        if (mk.badge) {
          mk.badge.position.set(x, hy + unit * .1, z);
          mk.badge.scale.setScalar(unit * (f.own ? .95 : .8));
        }
        _v.set(x, hy, z).applyMatrix4(group.matrixWorld).project(camera);
        f.vis = _v.z < 1;
        f.sx = (_v.x*.5+.5)*w; f.sy = (-_v.y*.5+.5)*h;
      });
    }

    /* ══════════════════════════════════════════════════════════════════════
       5.10 · POINTAGE, FICHES, ENTRÉES
       ──────────────────────────────────────────────────────────────────────
       Le pointage se fait EN ESPACE ÉCRAN, pas au raycast. C'est plus simple,
       mais surtout : le raycast de three ignore tout objet dont `visible` est
       faux, et cette carte en masque en permanence (filtres, brouillard, zoom
       sémantique) — la leçon a déjà été payée sur la vue système.
       ══════════════════════════════════════════════════════════════════════ */

    function pickSystem(mx, my) {
      /* au doigt la cible doit être large : 26 px, c'est la moitié d'un bout
         de doigt, et le système est ce qu'on cherche à atteindre */
      var R = MOBILE ? 40 : 26, best = null, bd = R*R;
      for (var i = 0; i < systems.length; i++) {
        var s = systems[i];
        if (!s.vis) continue;
        var dx = s.sx-mx, dy = s.sy-my, d = dx*dx+dy*dy;
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    function pickPlanet(mx, my) {
      /* au doigt on resserre au contraire : les planètes en orbite gravitent
         AUTOUR du système, à 15 px elles interceptaient le tap destiné au
         système et on n'arrivait jamais à ouvrir la vue du système */
      var R = MOBILE ? 7 : 15, best = null, bd = R*R;
      for (var i = 0; i < orbits.length; i++) {
        var o = orbits[i];
        if (!o.vis) continue;
        var dx = o.sx-mx, dy = o.sy-my, d = dx*dx+dy*dy;
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }
    function pickFleet(mx, my) {
      if (!layers.fleets) return null;
      var best = null, bd = 16*16;
      for (var i = 0; i < fleets.length; i++) {
        var f = fleets[i];
        if (!f.vis) continue;
        var dx = f.sx-mx, dy = f.sy-my, d = dx*dx+dy*dy;
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    }

    /* ── la fiche ── */
    var tipEl = null;
    function tip() { return tipEl || (tipEl = document.getElementById("aw3d-tip")); }
    /* voile sombre au survol/sélection : tout s'estompe AUTOUR du système visé,
       jamais le système lui-même. La zone claire épouse son anneau d'orbite le
       plus large tel qu'il apparaît à l'écran (une ellipse, penchée comme la
       caméra) : avant, un cercle fixe de ~90 px assombrissait les orbites dès
       que le système se déployait. Dégradé CSS, aucun coût GPU. */
    var veil = null, _veilV = null, _veilC = null;
    function veilEllipse(a2) {
      /* rayon de la 12e orbite (cf. orbitLines) + le dépassement de la cascade
         et du balayage (scanRing va jusqu'à ×1,12) */
      var dep = Math.max(0, Math.min(1, a2.deploy || 0));
      var R = a2 === S3.sys && a2.outerOpen ? (unit * .9 + (a2.outerOpen * 1.08 - unit * .9) * dep)
                                            : unit * (.30 + 11 * .055) * (1 + dep * 5.5) * 1.14;
      if (!_veilV) { _veilV = new T.Vector3(); _veilC = new T.Vector3(); }
      var y = a2.node ? a2.node.position.y : 0;
      var vcam = a2 === openSys && openF > 0 && openCam ? openCam : camera;   /* le voile suit le bloc présenté */
      _veilC.set(a2.cx * unit, y, a2.cy * unit).applyMatrix4(group.matrixWorld).project(vcam);
      if (_veilC.z > 1) return null;
      var cx = (_veilC.x * .5 + .5) * cw, cy = (-_veilC.y * .5 + .5) * ch;
      /* 24 points de l'anneau projetés : le plus loin donne le grand axe (et son
         angle), le plus proche le petit axe */
      var aMax = 0, aMin = Infinity, ang = 0;
      for (var i = 0; i < 24; i++) {
        var th = i / 24 * Math.PI * 2;
        _veilV.set(a2.cx * unit + Math.cos(th) * R, y, a2.cy * unit + Math.sin(th) * R)
          .applyMatrix4(group.matrixWorld).project(vcam);
        if (_veilV.z > 1) return null;
        var dx = (_veilV.x * .5 + .5) * cw - cx, dy = (-_veilV.y * .5 + .5) * ch - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > aMax) { aMax = d; ang = Math.atan2(dy, dx); }
        if (d < aMin) aMin = d;
      }
      return { x: cx, y: cy, a: Math.max(40, aMax), b: Math.max(26, aMin), ang: ang };
    }
    var vctx = null, veilKey = "";
    function updateVeil() {
      /* au doigt aussi depuis le 14/09 : le canevas n'est redessiné que quand l'ellipse bouge */
      var a2 = hov || sel;
      if (!veil) {
        /* ⚠ Canevas 2D À LA TAILLE DE L'ÉCRAN, redessiné seulement quand l'ellipse
           bouge. Un <div> tourné de 2 × la diagonale (≈ 3 500 px de côté) avec un
           radial-gradient recalculé à chaque image figeait l'onglet (écran noir,
           renderer « unresponsive ») : ne pas y revenir. */
        veil = document.createElement("canvas");
        veil.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;" +
          "transition:opacity .3s;z-index:5;";
        canvas.parentNode.appendChild(veil);
        vctx = veil.getContext("2d");
      }
      var e = a2 && a2.vis ? veilEllipse(a2) : null;
      openEllipse = e && a2 === openSys ? e : null;
      if (!e || !vctx) { veil.style.opacity = "0"; return; }
      var W = Math.max(1, Math.round(cw)), H = Math.max(1, Math.round(ch));
      if (veil.width !== W || veil.height !== H) { veil.width = W; veil.height = H; veilKey = ""; }
      var A = e.a + 14, B = e.b + 14;
      var key = Math.round(e.x) + "|" + Math.round(e.y) + "|" + Math.round(A) + "|" + Math.round(B) + "|" + e.ang.toFixed(2);
      if (key !== veilKey) {
        veilKey = key;
        /* RIEN par-dessus le système : sombre (0,8) partout, puis on PERCE une ellipse
           pleine jusqu'à l'anneau extérieur (+ marge) qui s'estompe jusqu'à 1,6 × —
           même rampe que l'ancien dégradé. (La lueur colorée du centre, qui
           faussait les couleurs, est retirée.) */
        vctx.setTransform(1, 0, 0, 1, 0, 0);
        vctx.globalCompositeOperation = "source-over";
        vctx.clearRect(0, 0, W, H);
        vctx.fillStyle = "rgba(3,4,10,.8)";
        vctx.fillRect(0, 0, W, H);
        vctx.globalCompositeOperation = "destination-out";
        vctx.translate(e.x, e.y);
        vctx.rotate(e.ang);
        vctx.scale(1, B / A);
        var g = vctx.createRadialGradient(0, 0, 0, 0, 0, A * 1.6);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1 / 1.6, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        vctx.fillStyle = g;
        vctx.beginPath();
        vctx.arc(0, 0, A * 1.6, 0, Math.PI * 2);
        vctx.fill();
        vctx.setTransform(1, 0, 0, 1, 0, 0);
        vctx.globalCompositeOperation = "source-over";
      }
      veil.style.opacity = "1";
    }
    /* Taille de la fiche mesurée UNE fois par contenu, pas à chaque image.
       placeTip est appelée dans la boucle : lire offsetWidth/offsetHeight y
       forçait un calcul de mise en page synchrone à chaque frame, juste après
       les écritures de style — le motif qui fait tressauter une page. */
    var tipW = 280, tipH = 240, lastTipX = -9999, lastTipY = -9999;
    function measureTip() {
      var el = tip();
      tipW = el.offsetWidth || 280;
      tipH = el.offsetHeight || 240;
      lastTipX = lastTipY = -9999;   /* forcer un repositionnement */
    }
    function placeTip(sx, sy) {
      var el = tip();
      if (el.classList.contains("big")) {
        /* portrait : bandeau en bas, réduit (CSS .sheet) ; plein écran : grande fiche ;
           dans le bloc de la carte : compacte, ou réduite si le bloc est bas */
        var sheet = ch > cw * 1.05;
        /* bandeau dans un bloc bas (carte dans la page, téléphone) : sans le tableau des 12 planètes,
           les propriétaires sont écrits sous les planètes ; le tableau revient en plein écran */
        var mini = sheet && ch < 700;
        if (el.classList.contains("mini") !== mini) { el.classList.toggle("mini", mini); measureTip(); }
        if (el.classList.contains("sheet") !== sheet) {
          el.classList.toggle("sheet", sheet);
          if (!sheet) { el.style.removeProperty("bottom"); el.__bot = null; }
          measureTip();
        }
        var tmode = sheet ? "tiny" : isFull() ? "" : (ch >= 540 ? "compact" : "tiny");
        var tcur = el.classList.contains("compact") ? "compact" : el.classList.contains("tiny") ? "tiny" : "";
        if (tmode !== tcur) {
          el.classList.remove("compact", "tiny");
          if (tmode) el.classList.add(tmode);
          measureTip();
        }
        if (sheet) {
          /* bandeau : juste au-dessus de la barre rapide, qui passe sur deux rangées en portrait */
          var qb = document.getElementById("aw3d-quickbar");
          var bot = (qb && qb.offsetHeight ? qb.offsetHeight + 8 : 48) + 10;
          if (el.__bot !== bot) { el.__bot = bot; el.style.setProperty("bottom", bot + "px", "important"); }
          return;
        }
        /* système ouvert : le bloc est à gauche (PRESENT.x), la fiche à DROITE, centrée
           dans l'espace libre et verticalement ; jamais sous le panneau Réglages 3D */
        var right = cw - 16;
        var pnl = document.getElementById("aw3d-panel");
        if (pnl && pnl.classList.contains("on") && !pnl.classList.contains("collapsed")) {
          var pr = pnl.getBoundingClientRect();
          if (pr.width && pr.left - rectL > cw * .5) right = Math.min(right, pr.left - rectL - 16);
        }
        var blockR = openEllipse ? openEllipse.x + Math.max(openEllipse.a, openEllipse.b) : cw * (PRESENT.x + .24);
        var zoneL = Math.min(cw - tipW - 16, blockR + 20);
        var top = (ch - tipH) / 2;
        var bx = Math.min(right - tipW, Math.max(zoneL, (zoneL + right - tipW) / 2));
        if (bx < zoneL && pnl && right < cw - 16) {
          /* pas la place entre le bloc et le panneau : la fiche passe SOUS le panneau, calée à droite */
          var pb = pnl.getBoundingClientRect().bottom - rectT + 12;
          if (pb + tipH <= ch - 8) { bx = cw - 16 - tipW; top = Math.max(pb, top); }
        }
        /* la fiche suit le bloc pendant qu'il glisse : on la recale dès que sa place change */
        var bl = Math.round(Math.max(8, bx)), bt = Math.round(Math.max(8, Math.min(ch - tipH - 8, top)));
        if (bl === lastTipX && bt === lastTipY) return;
        lastTipX = bl; lastTipY = bt;
        el.style.left = bl + "px";
        el.style.top = bt + "px";
        return;
      }
      /* au doigt la fiche normale est ancrée en haut de la carte (CSS) : la poser près
         du système la mettait sous le doigt qui vient d'appuyer */
      if (MOBILE) return;
      var x = sx | 0, y = sy | 0;
      if (x === lastTipX && y === lastTipY) return;   /* rien n'a bougé */
      lastTipX = x; lastTipY = y;
      /* bien à droite de l'astre pour ne pas couvrir le système ; s'il n'y a
         plus la place, on passe à gauche plutôt que de recouvrir */
      var left = sx + 150;
      if (left + tipW > cw - 8) left = sx - 150 - tipW;
      el.style.left = Math.max(8, left) + "px";
      el.style.top = Math.max(8, Math.min(ch - tipH - 8, sy - 60)) + "px";
    }
    function planetHex(s, p) {
      return p.state === "held" ? (D.colors[p.tag] || s.hex)
        : p.state === "solo" ? SOLO_HEX
        : p.state === "unknown" ? UNKN_HEX : FREE_HEX;
    }
    function fmtEta(sec) {
      if (!(sec > 0)) return "arrivée";
      if (sec < 60) return "< 1 min";
      var hh = Math.floor(sec/3600), mm = Math.floor((sec%3600)/60);
      return hh ? hh + " h " + (mm < 10 ? "0" : "") + mm : mm + " min";
    }

    function showSystemTip(s) {
      var hidden = layers.fog && !s.inVision;
      var label = hidden ? "hors vision" : (s.tag || (s.owners.length ? "solo" : "libre"));

      /* flottes en orbite relevées par le calque flottes */
      var orb = (D.orbitsAt && D.orbitsAt[String(s.id)]) || [];
      var orbHtml = "";
      if (orb.length && !hidden) {
        var byOwner = {};
        orb.forEach(function (f) {
          var k = (f.owner || "?") + (f.tag ? " [" + f.tag + "]" : "");
          byOwner[k] = (byOwner[k] || 0) + (f.CV || 0);
        });
        var rows = Object.keys(byOwner).sort(function (a, b) { return byOwner[b] - byOwner[a]; });
        orbHtml = '<div class="t-o" style="margin-top:7px">' +
          '<span style="color:#ffb347;font-weight:700">EN ORBITE</span> ' +
          rows.slice(0, 4).map(function (k) {
            return '<b>' + esc(k) + '</b> ' + Math.round(byOwner[k]) + ' CV';
          }).join(" · ") +
          (rows.length > 4 ? " +" + (rows.length - 4) : "") + '</div>';
      }
      /* le tableau #/Pop/SB/Propriétaire des planètes PRISES seulement : les libres et les
         inconnues tiennent chacune sur une ligne (« 5 libres : #4 · #6… ») — 12 lignes
         cachaient les systèmes voisins. Le tag est dans l'en-tête : une ligne ne le répète
         que s'il diffère. Couleurs éclaircies pour le texte (readableTag), ⚔ = assiégée. */
      var rowsP = "", libres = [], inconnues = [];
      if (!hidden) s.planets.forEach(function (p) {
        if (p.state === "free") { libres.push(p.idx); return; }
        if (p.state === "unknown") { inconnues.push(p.idx); return; }
        var txt = p.owner + (p.tag && p.tag !== s.tag ? " [" + p.tag + "]" : "");
        rowsP += '<tr><td>' + p.idx + '</td><td>' + p.pop + '</td><td>' + (p.sb || "·") + '</td>' +
          '<td style="color:' + readableTag(planetHex(s, p), 0.74) + '">' + esc(txt) +
            (p.siege ? '<span class="t-sg" title="assiégée">⚔</span>' : '') + '</td></tr>';
      });
      var tabHtml = (rowsP
        ? '<table class="t-tab"><tr><th>#</th><th>Pop</th><th>SB</th><th>Propriétaire</th></tr>' + rowsP + '</table>'
        : "") +
        (libres.length ? '<div class="t-g"><b>' + libres.length + (libres.length > 1 ? " libres" : " libre") +
          '</b> : #' + libres.join(" · #") + '</div>' : "") +
        (inconnues.length ? '<div class="t-g"><b>' + inconnues.length + (inconnues.length > 1 ? " inconnues" : " inconnue") +
          '</b> : #' + inconnues.join(" · #") + '</div>' : "");
      tip().innerHTML =
        '<div class="t-n">' + esc(s.name) + '</div>' +
        '<div class="t-h"><span class="t-t" style="color:' + readableTag(s.hex, 0.74) + '">' +
          '<i style="background:' + s.hex + '"></i>' + esc(label) + '</span>' +
          '<span class="t-xy">[' + s.id + '] ' + s.cx + '/' + s.cy + ' · sect. ' + s.sector + '</span></div>' +
        tabHtml +
        orbHtml +
        /* la liste des colons doublait le tableau : elle ne reste que s'il est vide */
        (hidden || rowsP ? "" : '<div class="t-o">aucun colon</div>') +
        '<div class="t-f"><span>niveau ' + (hidden ? "?" : s.popLevel) + '</span>' +
          '<span>pop ' + (hidden ? "?" : s.pop) + '</span>' +
          (s.sbMax && !hidden ? '<span style="color:#ffd24a">SB ' + s.sbMax + '</span>' : '') +
          (sel === s ? '<b>portée ' + range + '</b>' : '') + '</div>';
      tip().classList.toggle("big", true);   /* système ouvert : grande fiche (à droite, ou en bandeau en portrait — placeTip) */
      tip().classList.add("on");
      measureTip();   /* mesure unique par contenu, cf. placeTip */
      placeTip(s.sx, s.sy);
    }

    function showPlanetTip(ob) {
      var p = ob.p, s = ob.s, hex = planetHex(s, p);
      tip().innerHTML =
        '<div class="t-n">' + esc(p.name || (s.name + " #" + p.idx)) + '</div>' +
        '<div class="t-h"><span class="t-t" style="color:' + hex + '">' +
          '<i style="background:' + hex + '"></i>' +
          esc(p.state === "free" ? "libre" : p.state === "unknown" ? "non scannée" : (p.tag || "solo")) +
          '</span><span class="t-xy">planète ' + p.idx + '/12</span></div>' +
        '<div class="t-o"><b>' + esc(p.owner) + '</b></div>' +
        '<div class="t-f"><span>pop ' + p.pop + '</span>' +
          (p.sb ? '<span style="color:#ffd24a">SB ' + p.sb + '</span>' : '<span>pas de SB</span>') +
          (p.siege ? '<b>assiégée</b>' : '') + '</div>' +
        (p.id ? '<div class="t-f"><span>clic → fiche planète</span></div>' : '');
      tip().classList.toggle("big", s === openSys);
      tip().classList.add("on");
      measureTip();
      placeTip(ob.sx, ob.sy);
    }

    function showFleetTip(f) {
      var ships = (f.ships || []).map(function (sh) { return sh.count + " " + sh.name; }).join(", ");
      if (MOBILE) {
        /* deux lignes : la fiche pleine cachait la carte */
        tip().innerHTML =
          '<div class="t-n" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">' + esc(f.owner) +
            (f.tag ? ' <span style="color:' + f.hex + '">[' + esc(f.tag) + ']</span>' : '') +
            '<span class="t-xy" style="margin-left:auto">' + Math.round(f.cv || 0) + ' CV' + (ships ? ' · ' + esc(ships) : '') + '</span></div>' +
          '<div class="t-o">' + esc(f.originName || (f.from.cx + "/" + f.from.cy)) +
            ' → <b>' + esc(f.targetName || (f.to.cx + "/" + f.to.cy)) + '</b> · ETA <b style="color:#ffb347">' +
            (isFinite(f.t1) ? fmtEta(f.eta) + ' (' + new Date(f.t1).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}) + ')' : "inconnue") + '</b></div>';
        tip().classList.add("on");
        return;
      }
      tip().innerHTML =
        '<div class="t-n">' + esc(f.owner) +
          (f.tag ? ' <span style="color:' + f.hex + '">[' + esc(f.tag) + ']</span>' : '') + '</div>' +
        '<div class="t-h"><span class="t-t" style="color:' + f.hex + '">' +
          '<i style="background:' + f.hex + '"></i>' + esc(f.rel || "flotte") + '</span>' +
          '<span class="t-xy">' + Math.round(f.cv || 0) + ' CV</span></div>' +
        (ships ? '<div class="t-o" style="margin-top:6px">' + esc(ships) + '</div>' : '') +
        '<div class="t-o">' + esc(f.originName || (f.from.cx + "/" + f.from.cy)) +
          ' → <b>' + esc(f.targetName || (f.to.cx + "/" + f.to.cy)) + '</b></div>' +
        '<div class="t-f"><span>ETA <b style="color:#ffb347">' + (isFinite(f.t1) ? fmtEta(f.eta) : "inconnue") + '</b></span>' +
          (isFinite(f.t1) ? '<span>' + new Date(f.t1).toLocaleTimeString("fr-FR",
            {hour:"2-digit", minute:"2-digit"}) + '</span>' : '') + '</div>';
      tip().classList.remove("big");
      tip().classList.add("on");
      measureTip();
      placeTip(f.sx, f.sy);
    }
    function hideTip() { if (tipEl) tipEl.classList.remove("on"); }

    /* ── actions du jeu ── */
    var openLink = null;
    function actions() {
      if (!openLink) {
        openLink = document.getElementById("aw3d-open");
        if (!openLink) return;
        onTap(openLink, function (e) {
          e.preventDefault();
          if (sel) location.href = "/Game/Map/SolarSystem/" + sel.id;
        });
      }
      if (!openLink) return;
      openLink.hidden = !sel;
    }

    /* ── entrées ── */
    var dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0;

    /* Déplacement dans le plan de la carte : un pixel d'écran vaut d'autant
       plus de terrain que la caméra est loin, et la composante verticale est
       étirée par l'inclinaison. */
    function panBy(dx, dy) {
      if (!group) return;
      var k = 2 * orbit.dist * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, ch);
      var sinp = Math.max(.3, Math.sin(orbit.phi));
      var rx = Math.cos(orbit.theta), rz = -Math.sin(orbit.theta);
      var fx = -Math.sin(orbit.theta), fz = -Math.cos(orbit.theta);
      var wx = -(dx * k) * rx + (dy * k / sinp) * fx;
      var wz = -(dx * k) * rz + (dy * k / sinp) * fz;
      _ft.copy(tTarget); _ft.x += wx; _ft.z += wz;
      group.worldToLocal(_ft);
      focusRef = {x: _ft.x / unit, y: _ft.z / unit};
    }

    var rotating = false, rotateMode = false;
    /* ⚠ CAUSE DIRECTE DES SACCADES AU GLISSÉ, à ne jamais réintroduire :
       THREE.Clock.getElapsedTime() appelle getDelta() en interne, qui remet le
       compteur à zéro. L'appeler ici, à chaque pointermove — donc plusieurs
       fois par image pendant un glissé — VOLAIT le delta de la frame : la
       boucle recevait un dt quasi nul et toute l'animation se figeait par
       à-coups. On ne fait plus que lever un drapeau ; la boucle, seule
       propriétaire de l'horloge, le consomme. */
    var actPending = false;
    ["pointerdown", "pointermove", "wheel"].forEach(function (ev) {
      canvas.addEventListener(ev, function () { actPending = true; }, { passive: true });
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    /* Tactile (app Android) : un doigt = déplacer, deux doigts = pincer pour
       zoomer. Sans ça la carte est fixe au doigt — `wheel` n'existe pas en
       tactile et il n'y a pas de bouton droit pour la rotation. */
    var ptrs = new Map(), pinch0 = 0, pinchDist0 = 0, isTouch = false, tapSel = null;
    /* etat du geste a deux doigts : ecart, milieu et angle du pas precedent */
    var g2 = null, g2upd = {};
    /* ── APPUI LONG = FICHE ────────────────────────────────────────────────
       Au doigt, l'appui simple se ratait : un pouce bouge de plus de 16 px
       pendant un « tap » et le geste partait en deplacement, la fiche ne
       venait jamais. Rester appuye LONG_PRESS_MS sur un systeme (doigt a
       moins de LONG_PRESS_PX de son point de depart) affiche sa fiche, quoi
       que fasse le geste ensuite. */
    var LONG_PRESS_MS = 1000, LONG_PRESS_PX = 28;
    /* inclinaison a deux doigts : radians par pixel vertical. Signe : doigts
       vers le HAUT (dy < 0) = phi augmente = plus de perspective. Si ca
       parait a l'envers au pouce, c'est ICI qu'on change le signe. */
    var TILT_K = 0.0035, TILT_MAX = 1.30;   /* 120 px = ~24 degres ; plafond avant de raser le plan */
    var lpTimer = null, lpX = 0, lpY = 0;
    function lpCancel() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
    function lpStart(x, y) {
      lpCancel();
      lpX = x; lpY = y;
      lpTimer = setTimeout(function () {
        lpTimer = null;
        var st = pickSystem(lpX - rectL, lpY - rectT);
        if (!st) return;
        hov = st; tapSel = st; showSystemTip(st);
        /* le relacher qui suivra ne doit ni naviguer ni fermer la fiche */
        downX = lpX - 999; downY = lpY;
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
      }, LONG_PRESS_MS);
    }
    function span2() {
      var it = Array.from(ptrs.values());
      return it.length < 2 ? 0 : Math.hypot(it[0].x - it[1].x, it[0].y - it[1].y);
    }
    function geste2() {
      var it = Array.from(ptrs.values());
      if (it.length < 2) return null;
      return { d: Math.hypot(it[0].x - it[1].x, it[0].y - it[1].y),
               mx: (it[0].x + it[1].x) / 2, my: (it[0].y + it[1].y) / 2,
               a: Math.atan2(it[1].y - it[0].y, it[1].x - it[0].x) };
    }
    canvas.addEventListener("pointerdown", function (e) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      isTouch = e.pointerType !== "mouse";
      if (ptrs.size === 2) {
        /* deux doigts : on quitte le déplacement pour le pincement */
        lpCancel();
        dragging = false;
        pinch0 = span2(); pinchDist0 = orbit.tDist;
        g2 = geste2(); g2upd = {};
        return;
      }
      if (isTouch) lpStart(e.clientX, e.clientY);
      dragging = true;
      rotating = rotateMode || e.button === 2 || e.button === 1 || e.shiftKey;
      lastX = downX = e.clientX; lastY = downY = e.clientY;
      canvas.classList.add("dragging");
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lpTimer && Math.hypot(e.clientX - lpX, e.clientY - lpY) > LONG_PRESS_PX) lpCancel();
      if (ptrs.size >= 2 && pinch0 > 0) {
        /* Android livre un pointermove PAR doigt. Traiter le geste a chaque
           evenement lisait un milieu deplace de moitie et un angle/ecart
           faux entre les deux doigts : rotation et zoom parasites, et le
           deplacement paraissait ne pas repondre. On attend que les deux
           doigts aient donne leur nouvelle position. */
        g2upd[e.pointerId] = 1;
        if (Object.keys(g2upd).length < 2) return;
        g2upd = {};
        /* ── deux doigts : zoom VERS les doigts + deplacement + rotation ──
           L'ancien pincement ne faisait que changer la distance, vers le
           centre de l'ecran : la zone qu'on voulait agrandir filait hors
           champ, et bouger les deux doigts ensemble ne deplacait rien. */
        var g = geste2();
        if (g && g2) {
          var r = g2.d > 0 && g.d > 0 ? g2.d / g.d : 1;      /* < 1 = on ecarte = zoom avant */
          if (r !== 1) {
            orbit.tDist = Math.max(1, Math.min(60, orbit.tDist * r));
            /* garder sous les doigts le point qu'ils encadrent : apres un zoom
               de facteur r, un point a (ox,oy) du centre file en (ox/r,oy/r) */
            var ox = g.mx - rectL - cw / 2, oy = g.my - rectT - ch / 2;
            panBy(ox * (1 - 1 / r), oy * (1 - 1 / r));
          }
          /* Deux doigts qui glissent ENSEMBLE :
               · verticalement  = INCLINER la vue (comme Google Maps : vers
                                  le haut = plus de perspective, vers le bas
                                  = retour vers la vue de dessus) ;
               · horizontalement = deplacer, en « poussant » la camera (sens
                                  inverse du glisser a un doigt, a la demande).
             Avant, le vertical deplacait aussi : on croyait incliner et la
             carte filait « a l'envers ». Le deplacement, c'est UN doigt. */
          var mdx = g.mx - g2.mx, mdy = g.my - g2.my;
          orbit.tPhi = Math.max(.03, Math.min(TILT_MAX, orbit.tPhi - mdy * TILT_K));
          if (layers.flat && orbit.tPhi > .2) { layers.flat = false; NS.flatSync && NS.flatSync(false); }
          panBy(-mdx, 0);
          var da = g.a - g2.a;
          if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
          /* sous 0,02 rad par pas (~1 degre), c'est du tremblement, pas une
             rotation voulue : on ne pivote pas */
          if (Math.abs(da) > 0.02) orbit.tTheta -= da;
          g2 = g;
        }
        return;
      }
      var mx = e.clientX - rectL, my = e.clientY - rectT;
      if (dragging) {
        var ddx = e.clientX - lastX, ddy = e.clientY - lastY;
        if (rotating) {
          orbit.tTheta -= ddx * .006;
          orbit.tPhi = Math.max(.03, Math.min(Math.PI - .03, orbit.tPhi - ddy * .006));
        } else {
          panBy(ddx, ddy);
        }
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      if (isTouch) return;   /* pas de survol au doigt : la fiche vient de l'appui */
      var pl = pickPlanet(mx, my);
      if (pl) { hovPlanet = pl; hov = pl.s; canvas.style.cursor = "pointer"; showPlanetTip(pl); return; }
      if (hovPlanet) { hovPlanet = null; if (hov) showSystemTip(hov); else if (sel) showSystemTip(sel); }
      var fl = pickFleet(mx, my);
      if (fl) { hovFleet = fl; canvas.style.cursor = "pointer"; showFleetTip(fl); return; }
      if (hovFleet) {
        /* sortie du survol flotte : rendre la main au système encore survolé */
        hovFleet = null;
        canvas.style.cursor = hov ? "pointer" : "";
        if (hov) showSystemTip(hov); else if (sel) showSystemTip(sel); else hideTip();
      }
      var s = pickSystem(mx, my);
      /* le bloc présenté a glissé à gauche : aller vers ses planètes ne doit pas le refermer */
      if (!s && hov && hov === openSys && onOpenBlock(mx, my)) s = hov;
      if (s !== hov) {
        hov = s;
        canvas.style.cursor = s ? "pointer" : "";
        if (!sel) { if (s) showSystemTip(s); else hideTip(); }
        else if (s) showSystemTip(s);
      }
    });
    function stopDrag() { dragging = false; rotating = false; canvas.classList.remove("dragging"); }
    canvas.addEventListener("pointerup", function (e) {
      lpCancel();
      var wasPinch = ptrs.size >= 2;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) { pinch0 = 0; g2 = null; }
      stopDrag();
      if (wasPinch) {
        /* un doigt reste pose : il reprend le deplacement sans a-coup, au
           lieu d'etre ignore jusqu'a ce qu'on le releve */
        var rest = Array.from(ptrs.values())[0];
        if (rest) { dragging = true; rotating = false; lastX = rest.x; lastY = rest.y;
                    /* downX decale : le relacher de ce doigt ne doit pas passer pour un appui */
                    downX = rest.x - 999; downY = rest.y; canvas.classList.add("dragging"); }
        return;   /* fin de pincement : ce n'est pas un appui */
      }
      /* un doigt bouge toujours un peu : 6 px annulaient des taps légitimes */
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > (isTouch ? 16 : 6)) return;
      var mx = e.clientX - rectL, my = e.clientY - rectT;

      /* Au doigt, le SYSTÈME passe avant la planète : il est la cible utile
         (il ouvre la vue du système) et les planètes qui l'entourent
         interceptaient sinon tous les taps. À la souris on garde la priorité
         d'origine, le curseur étant assez précis pour viser une planète. */
      if (isTouch) {
        var st = pickSystem(mx, my);
        if (st) {
          hov = st; showSystemTip(st);
          if (tapSel !== st) { tapSel = st; return; }
          tapSel = null;
          location.href = "/Game/Map/SolarSystem/" + st.id;
          return;
        }
      }
      var pl = pickPlanet(mx, my);
      if (pl) {
        if (isTouch) { showPlanetTip(pl); if (tapSel !== pl.p) { tapSel = pl.p; return; } }
        if (pl.p.id) window.open("/Game/Planets/Planet/" + pl.p.id, "_blank");
        return;
      }
      /* clic sur une tête de flotte : on garde le tip ouvert, on ne navigue
         pas vers un système voisin non visé */
      var fl2 = pickFleet(mx, my);
      if (fl2) { if (isTouch) showFleetTip(fl2); return; }
      var s = pickSystem(mx, my);
      /* Au doigt le survol n'existe pas : le 1er appui montre la fiche, le 2e
         sur la MÊME cible ouvre la page. Sinon on quitterait la carte au
         moindre effleurement, sans avoir rien pu lire. */
      if (s && isTouch) {
        hov = s; showSystemTip(s);
        if (tapSel !== s) { tapSel = s; return; }
      }
      tapSel = null;
      /* clic simple sur un système → sa page dans le jeu */
      if (s) { location.href = "/Game/Map/SolarSystem/" + s.id; return; }
      sel = null; hideTip(); actions();
    });
    canvas.addEventListener("dblclick", function (e) {
      var s = pickSystem(e.clientX - rectL, e.clientY - rectT);
      if (s) location.href = "/Game/Map/SolarSystem/" + s.id;
    });
    canvas.addEventListener("pointercancel", function (e) {
      lpCancel();
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) { pinch0 = 0; g2 = null; }
      stopDrag();
    });
    canvas.addEventListener("pointerleave", function () {
      stopDrag(); hov = null; hovPlanet = null; hovFleet = null; if (!sel) hideTip();
    });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      orbit.tDist = Math.max(1, Math.min(60, orbit.tDist * (1 + Math.sign(e.deltaY) * .12)));
    }, {passive:false});

    /* ══════════════════════════════════════════════════════════════════════
       5.11 · L'API PUBLIQUE — la seule chose que l'interface connaisse
       ══════════════════════════════════════════════════════════════════════ */
    return {
      params: params,
      /* Rend l'objet params À JOUR. Un changement de fond de carte réécrit
         count, size, branches, spin, power, randomness : sans ce point
         d'entrée, les curseurs du panneau gardaient les anciennes valeurs et
         le premier curseur bougé défaisait le fond qu'on venait de choisir. */
      syncParams: function () { return params; },
      setData: function (d) {
        D = d;
        buildGalaxy();
        buildMap();
        resize();
        /* Rana (0/0) reste le cœur de la galaxie, mais la caméra s'ouvre
           d'office SUR MES systèmes ; « Centre » ramène à Rana. */
        focusRef = null;
        target.set(0, 0, 0); tTarget.set(0, 0, 0);
        orbit.dist = orbit.tDist = fitDist();
        var home = null, hi;
        for (hi = 0; hi < systems.length; hi++) if (systems[hi].isMine) { home = systems[hi]; break; }
        if (home) focusRef = {x: home.cx, y: home.cy};
        else if (d.origin && (+d.origin.x || +d.origin.y)) focusRef = {x: +d.origin.x, y: +d.origin.y};
        console.info("[AW3D] orientation de départ:",
          home ? home.name : (focusRef ? "origine " + focusRef.x + "/" + focusRef.y : "aucune (Rana)"));
        if (focusRef) orbit.tDist = 4.2;
        /* transition 2D→3D : la caméra arrive de très haut, à plat, et
           plonge en douceur vers la cible (le lissage fait l'animation) */
        orbit.phi = .07;
        orbit.theta = orbit.tTheta - .7;
        orbit.dist = Math.min(60, fitDist() * 1.5);
      },
      start: function () {
        if (running) return;
        running = true;
        resize();
        clock.getDelta();
        requestAnimationFrame(loop);
        addEventListener("resize", resize);
      },
      stop: function () { running = false; removeEventListener("resize", resize); },
      bgLabel: function (k) { return (BACKGROUNDS[k] || {}).label || k; },
      bgCurrent: function () { return bgStyle; },
      setBackground: function (k) {
        if (!BACKGROUNDS[k] || k === bgStyle) return;
        bgStyle = k;
        try { localStorage.setItem("aw3d_bg", k); } catch (e) {}
        applyBackground(k);
        /* seul le disque est reconstruit : les systèmes, la grille et les
           flottes ne dépendent pas du parti pris de fond */
        buildGalaxy();
      },
      setRotateMode: function (v) { rotateMode = !!v; },
      tagsMode: function () { return layers.tags | 0; },
      setTagsMode: function (v) {
        layers.tags = v | 0;
        try { localStorage.setItem("aw3d_tags_mode", String(layers.tags)); } catch (e) {}
      },
      setLayer: function (k, v) {
        layers[k] = v;
        if (k === "flat") {
          orbit.tPhi = v ? .045 : .95;
          orbit.tTheta = v ? 0 : .6;
          /* on garde le zoom courant (plafonné) au lieu de reculer sur toute
             la galaxie — la vue de dessus reculait beaucoup trop */
          if (v) orbit.tDist = Math.min(orbit.tDist, fitDist() * 0.6);
        } else if (k === "grid") { buildGrid(); }
        else if (k === "star" && sbg) sbg.visible = v;
        else if (k === "fog" && visionRing) visionRing.visible = v;
      },
      setFilter: function (k, v) { filters[k] = v; applyFilters(); },
      setRange: function (v) { range = v; if (sel) showSystemTip(sel); },
      /* ── réglages enregistrables (bouton « Enregistrer les réglages ») ── */
      getSettings: function () {
        var p = {};
        ["count", "radius", "branches", "spin", "randomness", "rigid", "speed", "elev"]
          .forEach(function (k) { p[k] = params[k]; });
        return { layers: { grid: !!layers.grid, tags: layers.tags | 0, star: !!layers.star,
                           fleets: !!layers.fleets, fog: !!layers.fog },
                 fleetVis: { own: fleetVis.own, ally: fleetVis.ally, enemy: fleetVis.enemy },
                 params: p, bg: bgStyle, range: range };
      },
      applySettings: function (o) {
        if (!o) return;
        if (o.bg && BACKGROUNDS[o.bg] && o.bg !== bgStyle) this.setBackground(o.bg);
        var L = o.layers || {};
        ["grid", "star", "fleets", "fog"].forEach(function (k) {
          if (k in L && !!L[k] !== !!layers[k]) app.setLayer(k, !!L[k]);
        });
        if ("tags" in L) app.setTagsMode(L.tags | 0);
        var P2 = o.params || {}, radiusChanged = false, any = false;
        Object.keys(P2).forEach(function (k) {
          if (!(k in params) || !isFinite(+P2[k]) || +P2[k] === params[k]) return;
          params[k] = +P2[k]; any = true;
          if (k === "radius") radiusChanged = true;
          if (k === "speed" && galaxyMat) galaxyMat.uniforms.uSpeed.value = params[k];
          if (k === "elev") systems.forEach(function (s2) {
            s2.node.position.y = s2.elevBase * params[k] * unit * 4;
            if (s2.sb) s2.sb.position.y = s2.node.position.y + unit * .6;
          });
        });
        /* une seule reconstruction, pas une par curseur */
        if (any) { buildGalaxy(); if (radiusChanged && D) buildMap(); }
        if (isFinite(+o.range)) this.setRange(+o.range);
        if (o.fleetVis) ["own", "ally", "enemy"].forEach(function (k) { if (k in o.fleetVis) fleetVis[k] = !!o.fleetVis[k]; });
      },
      resetSettings: function () {
        this.applySettings({ bg: "spirale", layers: LAYERS0, params: PARAMS0, range: 8, fleetVis: { own: true, ally: true, enemy: true } });
        if (layers.flat) { layers.flat = false; NS.flatSync && NS.flatSync(false); orbit.tPhi = .95; orbit.tTheta = .6; }
      },
      setParam: function (k, v) {
        params[k] = v;
        if (k === "speed" && galaxyMat) galaxyMat.uniforms.uSpeed.value = v;
        else if (k === "rigid") { /* consommé par la boucle via group.rotation */ }
        else if (k === "elev") {
          systems.forEach(function (s) {
            s.node.position.y = s.elevBase * v * unit * 4;
            if (s.sb) s.sb.position.y = s.node.position.y + unit * .6;
          });
        }
        /* le rayon change l'échelle case→monde : toute la carte se refait */
        else if (k === "radius") { buildGalaxy(); if (D) buildMap(); }
        else buildGalaxy();
      },
      refreshFleets: function () { if (D) buildFleets(); },
      /* LABO : changer de marqueur sans recharger (reconstruit les flottes) */
      setFleetStyle: function (st) {
        if (FLEET_STYLES.indexOf(st) < 0) return;
        FLEET_STYLE = st;
        try { localStorage.setItem("labo_fleet_style", st); } catch (e) {}
        if (D) buildFleets();
      },
      fleetVis: function () { return { own: fleetVis.own, ally: fleetVis.ally, enemy: fleetVis.enemy }; },
      setFleetVis: function (cat, on) { if (cat in fleetVis) fleetVis[cat] = !!on; },
      fleetCounts: function () {
        var c = { own: 0, ally: 0, enemy: 0 };
        fleets.forEach(function (f2) { var k = fleetCat(f2); if (k) c[k]++; });
        return c;
      },
      goTo: function (what) {
        if (what === "view") fitLoaded();
        /* « Centre » : fitDist() (toute la galaxie, 34+ cases de rayon)
           reculait la camera au maximum et les systemes devenaient des
           points ; on se pose au coeur a une distance ou ils se lisent */
        else if (what === "origin") { focusRef = null; tTarget.set(0,0,0); orbit.tDist = Math.min(fitDist(), distFor(14)); }
        else if (what === "fleet" || (typeof what === "string" && what.indexOf("fleet:") === 0)) {
          /* « Flottes » : cadrer un vol de la categorie demandee (own / ally /
             enemy) et montrer sa fiche ; un second appui passe au vol suivant
             de la meme categorie. Sans vol : un mot, pas de deplacement. */
          var cat = what === "fleet" ? "own" : what.slice(6);
          var pool = fleets.filter(function (f2) { return fleetCat(f2) === cat; });
          if (!pool.length) {
            msg(cat === "own" ? "Aucune flotte en vol." : cat === "ally" ? "Aucune flotte alliée connue en vol." : "Aucune flotte ennemie connue en vol.");
            setTimeout(clearMsg, 1800);
            return;
          }
          if (fleetVis[cat] === false) { fleetVis[cat] = true; if (NS.paintFleetEyes) NS.paintFleetEyes(); }
          fleetCycle[cat] = ((fleetCycle[cat] | 0) + 1) % pool.length;
          var fl = pool[fleetCycle[cat]];
          var pcx = fl.from.cx + (fl.to.cx - fl.from.cx) * fl.p;
          var pcy = fl.from.cy + (fl.to.cy - fl.from.cy) * fl.p;
          focusRef = {x: pcx, y: pcy};
          /* zoom MODERE : 1,8 x l'envergure du vol, jamais sous 9 cases —
             a 0,9 x on tombait le nez sur le marqueur */
          var span = Math.max(3, Math.hypot(fl.to.cx - fl.from.cx, fl.to.cy - fl.from.cy));
          orbit.tDist = distFor(Math.max(9, span * 1.8));
          hovFleet = fl; showFleetTip(fl);
        }
        else if (what === "spiral" && D.spiral) { focusRef = {x:D.spiral.x, y:D.spiral.y}; orbit.tDist = Math.min(orbit.tDist, 4.2); }
        else if (what === "home") {
          var home = systems.filter(function (s) { return s.isMine; })[0]
            || systems.filter(function (s) { return s.cx === D.origin.x && s.cy === D.origin.y; })[0];
          if (!home) return;
          focusRef = {x:home.cx, y:home.cy};
          orbit.tDist = Math.min(orbit.tDist, 4.2);
          /* « Mon système » RECADRE, il n'ouvre plus la fiche (demande de
             gege : la fiche vient de l'appui long). Et il RAMÈNE la vue 3D
             inclinée : une fois en vue de dessus, c'est le geste attendu pour
             retrouver la perspective — au doigt, on n'y arrivait pas. */
          if (layers.flat) { layers.flat = false; NS.flatSync && NS.flatSync(false); }
          orbit.tPhi = .95; orbit.tTheta = .6;
          sel = null; hideTip(); actions();
        }
      },
      search: function (q) {
        q = (q || "").trim().toLowerCase();
        if (q.length < 2) return;
        var hit = null;
        for (var i = 0; i < systems.length; i++) {
          var n = systems[i].name.toLowerCase();
          if (n.indexOf(q) === 0) { hit = systems[i]; break; }
          if (!hit && n.indexOf(q) >= 0) hit = systems[i];
        }
        if (hit) {
          sel = hit; showSystemTip(hit); actions();
          focusRef = {x:hit.cx, y:hit.cy};
          orbit.tDist = Math.min(orbit.tDist, 4.5);
        }
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6 · CÂBLAGE DU PANNEAU
     ──────────────────────────────────────────────────────────────────────
     Chaque contrôle est cherché puis TESTÉ. Sans ces gardes, un seul élément
     manquant (panneau amputé, bundle du mod sans son HTML) levait une
     exception attrapée par le try d'open(), et l'utilisateur lisait
     « Erreur 3D » sans jamais savoir pourquoi.
     ══════════════════════════════════════════════════════════════════════ */

  var SLIDERS = [["count", 0], ["radius", 1], ["branches", 0], ["spin", 2],
                 ["randomness", 2], ["rigid", 3], ["speed", 2], ["elev", 2]];

  function refreshSliders() {
    if (!panelEl || !app) return;
    var p = app.syncParams();
    SLIDERS.forEach(function (pair) {
      var id = pair[0], dec = pair[1];
      var el = document.getElementById("aw3d-" + id), out = document.getElementById("aw3d-" + id + "Out");
      if (!el || !out) return;
      el.value = p[id];
      out.textContent = dec ? (+p[id]).toFixed(dec) : Math.round(p[id]).toLocaleString("fr-FR");
    });
  }

  function wirePanel() {
    if (!ui || ui.__wired) return;
    ui.__wired = true;

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ui.classList.contains("on")) {
        if (isFull()) { setFull(false); return; }   /* Échap : d'abord sortir du plein écran */
        rememberView("2d"); close();
        return;
      }
      if ((e.key === "f" || e.key === "F") && ui.classList.contains("on") && !e.ctrlKey && !e.metaKey && !e.altKey &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") && !(e.target && e.target.isContentEditable)) {
        setFull(!isFull());
      }
    });

    if (panelEl) {
      /* ── LE BOUTON « NOMS » A TROIS ÉTATS ─────────────────────────────
         aucun → sans chevauchement → tous. Il intercepte le clic avant le
         câblage générique des calques, qui ne sait faire que du booléen. */
      var chipNoms = panelEl.querySelector('[data-l="tags"]');
      if (chipNoms) {
        var peindreNoms = function (v) {
          chipNoms.setAttribute("aria-pressed", v ? "true" : "false");
          chipNoms.textContent = v === 2 ? "Tous les noms" : "Noms";
        };
        var memNoms = 1;
        try { memNoms = parseInt(localStorage.getItem("aw3d_tags_mode"), 10); } catch (e) {}
        if (!(memNoms >= 0 && memNoms <= 2)) memNoms = 1;
        if (app && app.setTagsMode) app.setTagsMode(memNoms);
        peindreNoms(memNoms);
        chipNoms.addEventListener("click", function (e) {
          e.stopImmediatePropagation();
          var v = (((app && app.tagsMode) ? app.tagsMode() : 1) + 1) % 3;
          if (app && app.setTagsMode) app.setTagsMode(v);
          peindreNoms(v);
        }, true);
      }

      panelEl.querySelectorAll("[data-l]").forEach(function (b) {
        onTap(b, function () {
          var on = b.getAttribute("aria-pressed") !== "true";
          b.setAttribute("aria-pressed", String(on));
          app.setLayer(b.dataset.l, on);
        });
      });
      panelEl.querySelectorAll("[data-go]").forEach(function (b) {
        onTap(b, function () { app.goTo(b.dataset.go); });
      });
      panelEl.querySelectorAll("[data-f]").forEach(function (c) {
        c.addEventListener("change", function () { app.setFilter(c.dataset.f, c.checked); });
      });
      /* Fond de carte : les libellés viennent de BACKGROUNDS, côté moteur, pour
         n'avoir qu'un seul endroit à modifier quand on ajoute un parti pris. */
      panelEl.querySelectorAll("[data-bg]").forEach(function (b) {
        b.textContent = app.bgLabel(b.dataset.bg);
        if (b.dataset.bg === app.bgCurrent()) b.setAttribute("aria-pressed", "true");
        onTap(b, function () {
          panelEl.querySelectorAll("[data-bg]").forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          app.setBackground(b.dataset.bg);
          /* les curseurs suivent le fond : cf. syncParams */
          refreshSliders();
        });
      });
    }

    ui.querySelectorAll("[data-qgo]").forEach(function (b) {
      onTap(b, function () { app.goTo(b.dataset.qgo); });
    });
    var fmenu = document.getElementById("aw3d-fleetmenu"), fbtn = document.getElementById("aw3d-fleetbtn");
    if (fmenu && fbtn) {
      var majCompteurs = function () {
        if (!app || !app.fleetCounts) return;
        var c = app.fleetCounts();
        ["own", "ally", "enemy"].forEach(function (k) { var e = document.getElementById("aw3d-fm-" + k); if (e) e.textContent = c[k]; });
      };
      onTap(fbtn, function () {
        var open = fmenu.hidden;
        if (open) majCompteurs();
        fmenu.hidden = !open;
        fbtn.style.borderColor = open ? "#ffb347" : "";
      });
      /* les vols arrivent apres l'ouverture (scans, Holocron) : on rafraichit
         les compteurs tant que le menu est visible */
      setInterval(function () { if (fmenu && !fmenu.hidden) majCompteurs(); }, 2000);
      /* un choix referme le menu ; le cadrage se fait via data-qgo ci-dessus */
      fmenu.querySelectorAll(".aw3d-fm").forEach(function (row) {
        onTap(row, function (e) {
          if (e && e.target && e.target.closest && e.target.closest(".aw3d-fm-eye")) return;
          fmenu.hidden = true; fbtn.style.borderColor = "";
        });
      });
      /* l'oeil : masque / affiche les paraboles de la categorie, sans cadrer */
      var peindreYeux = function () {
        if (!app || !app.fleetVis) return;
        var v = app.fleetVis();
        fmenu.querySelectorAll(".aw3d-fm-eye").forEach(function (el) { el.classList.toggle("off", v[el.dataset.fvis] === false); });
      };
      NS.paintFleetEyes = peindreYeux;
      NS.labFleetStyle = function (st) { if (app && app.setFleetStyle) app.setFleetStyle(st); };
      fmenu.querySelectorAll(".aw3d-fm-eye").forEach(function (el) {
        /* (pas de stopPropagation en capture : sur la cible elle-meme il
           bloquerait aussi les ecouteurs bubble d'onTap) */
        onTap(el, function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          var cat = el.dataset.fvis;
          app.setFleetVis(cat, app.fleetVis()[cat] === false);
          peindreYeux();
        });
      });
      peindreYeux();
    }
    var fullBtn = ui.querySelector("#aw3d-fullbtn");
    if (fullBtn) onTap(fullBtn, function () { setFull(!isFull()); });
    var flatBtn = ui.querySelector("#aw3d-flat");
    /* l'état visuel du bouton, partagé avec « Mon système » qui rétablit la 3D */
    NS.flatSync = function (on) {
      if (!flatBtn) return;
      flatBtn.setAttribute("aria-pressed", String(!!on));
      flatBtn.style.borderColor = on ? "#ffb347" : "";
    };
    if (flatBtn) onTap(flatBtn, function () {
      var on = flatBtn.getAttribute("aria-pressed") !== "true";
      NS.flatSync(on);
      app.setLayer("flat", on);
    });

    var search = document.getElementById("aw3d-search");
    if (search) search.addEventListener("input", function (e) { app.search(e.target.value); });

    /* Le mode pivot était le SEUL contrôle câblé en "click" : au doigt, dans
       l'app Android, il ne répondait donc jamais (cf. onTap). */
    var rm = document.getElementById("aw3d-rotmode");
    if (rm) onTap(rm, function () {
      var on = rm.getAttribute("aria-pressed") !== "true";
      rm.setAttribute("aria-pressed", String(on));
      app.setRotateMode(on);
    });

    var rg = document.getElementById("aw3d-range");
    if (rg) rg.addEventListener("input", function () {
      var out = document.getElementById("aw3d-rangeOut");
      if (out) out.textContent = rg.value + " cases";
      app.setRange(parseInt(rg.value, 10));
    });

    refreshSliders();
    SLIDERS.forEach(function (pair) {
      var id = pair[0], dec = pair[1];
      var el = document.getElementById("aw3d-" + id), out = document.getElementById("aw3d-" + id + "Out");
      if (!el || !out) return;
      el.addEventListener("input", function () {
        var v = parseFloat(el.value);
        out.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString("fr-FR");
        app.setParam(id, v);
      });
    });

    /* ── Enregistrer / Réinitialiser ──────────────────────────────────
       Tout changement (calque, fond, curseur, portée, Noms) marque le
       bouton « Enregistrer » ; l'enregistrement fige l'ensemble dans
       localStorage (aw3d_settings) et il est réappliqué à chaque ouverture.
       « Réinitialiser » efface la mémoire et revient aux réglages d'usine,
       sans recharger la page. */
    var saveBtn = document.getElementById("aw3d-save"), resetBtn = document.getElementById("aw3d-reset");
    var applying = false;
    function markDirty() {
      if (applying || !saveBtn) return;
      saveBtn.classList.add("dirty");
      saveBtn.textContent = "Enregistrer les réglages •";
    }
    ["setLayer", "setParam", "setBackground", "setRange", "setTagsMode"].forEach(function (m) {
      var orig = app[m];
      if (typeof orig !== "function") return;
      app[m] = function () { var r = orig.apply(app, arguments); markDirty(); return r; };
    });
    NS.applySavedSettings = function () {
      var o = null;
      try { o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch (e) {}
      if (!o) return;
      applying = true;
      try { app.applySettings(o); syncPanelFromApp(); } finally { applying = false; }
    };
    if (saveBtn) onTap(saveBtn, function () {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.getSettings())); } catch (e) {}
      saveBtn.classList.remove("dirty");
      saveBtn.textContent = "✓ Enregistré";
      setTimeout(function () { saveBtn.textContent = "Enregistrer les réglages"; }, 1500);
    });
    if (resetBtn) onTap(resetBtn, function () {
      try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem("aw3d_bg"); localStorage.removeItem("aw3d_tags_mode"); } catch (e) {}
      applying = true;
      try { app.resetSettings(); syncPanelFromApp(); } finally { applying = false; }
      if (saveBtn) { saveBtn.classList.remove("dirty"); saveBtn.textContent = "Enregistrer les réglages"; }
    });
  }

  var SETTINGS_KEY = "aw3d_settings";
  /* Remet le panneau en accord avec l'état du moteur (après application ou
     réinitialisation) : puces de calques, « Noms », fond, curseurs, portée. */
  function syncPanelFromApp() {
    if (!panelEl || !app || !app.getSettings) return;
    var o = app.getSettings();
    panelEl.querySelectorAll("[data-l]").forEach(function (b) {
      var k = b.dataset.l;
      if (k === "tags") { b.setAttribute("aria-pressed", o.layers.tags ? "true" : "false"); b.textContent = o.layers.tags === 2 ? "Tous les noms" : "Noms"; }
      else if (k in o.layers) b.setAttribute("aria-pressed", o.layers[k] ? "true" : "false");
    });
    panelEl.querySelectorAll("[data-bg]").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.bg === o.bg ? "true" : "false"); });
    if (NS.paintFleetEyes) NS.paintFleetEyes();
    var rg = document.getElementById("aw3d-range"), ro = document.getElementById("aw3d-rangeOut");
    if (rg) rg.value = o.range;
    if (ro) ro.textContent = o.range + " cases";
    refreshSliders();
  }

  /* ══════════════════════════════════════════════════════════════════════
     7 · DÉMARRAGE
     ══════════════════════════════════════════════════════════════════════ */

  /* Empreinte de build, lisible depuis la page : c'est le seul moyen de
     vérifier en une ligne que le rechargement de l'extension a bien pris le
     fichier courant. À mettre à jour À LA MAIN. */
  try { document.documentElement.setAttribute("data-aw3d-build", "v17 · refonte modulaire"); } catch (e) {}

  /* Les deux calques 2D vivent dans aw-carte-2d.js, chargé APRÈS nous. C'est
     ici qu'on les monte, parce que c'est ici qu'on observe déjà l'apparition
     de #mapToolbar — et mount() est idempotent, on peut le rappeler. */
  function monter2d() {
    if (NS.map2d && NS.map2d.mount) NS.map2d.mount();
  }

  function boot() {
    addToolbarButton();
    monter2d();
    document.addEventListener("keydown", function (e) {
      if (e.key !== "3" || e.ctrlKey || e.altKey || e.metaKey) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      toggle();
    });
    /* Le voisin 2D peut n'être pas encore exécuté au moment du boot (ordre du
       manifeste, ou bundle du mod) : on repasse une fois la pile vidée. */
    setTimeout(monter2d, 0);
    if (!document.getElementById("aw3d-btn")) {
      var obs = new MutationObserver(function () {
        addToolbarButton(); monter2d();
        if (document.getElementById("aw3d-btn")) obs.disconnect();
      });
      obs.observe(document.body, {childList:true, subtree:true});
      setTimeout(function () { obs.disconnect(); }, 20000);
    }
  }

  NS.open = open;
  NS.close = close;
  NS.toggle = toggle;
  NS.loaded.push("map3d");

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
