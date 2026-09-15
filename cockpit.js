// ═══════════════════════════════════════════════════════════════
// AW Cockpit — Édition communauté
// Coquille d'interface : un rail à droite (Apparence, À propos) et une
// colonne de réglages. Pas de compte, rien n'est envoyé : côté jeu, la seule
// requête est la page News (alerte incoming). Les réglages vivent dans
// chrome.storage.local. Nouvelle version : background.js lit la dernière
// Release GitHub au plus 1×/jour, ce script affiche la carte « Nouvelle version » ;
// l'installation reste manuelle (ZIP à décompresser à la place de l'ancien dossier).
// ═══════════════════════════════════════════════════════════════
(function () {
  "use strict";
  if (window.__awcCommunityLoaded) return;
  window.__awcCommunityLoaded = true;

  /* ── stockage (tolère l'absence de chrome.* pour les aperçus) ── */
  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  const sGet = (keys) => new Promise((res) => {
    if (!hasChrome) return res({});
    try { chrome.storage.local.get(keys, (r) => res(r || {})); } catch (e) { res({}); }
  });
  const sSet = (obj) => { if (hasChrome) { try { chrome.storage.local.set(obj); } catch (e) { /* ignore */ } } };
  const sRemove = (keys) => { if (hasChrome) { try { chrome.storage.local.remove(keys); } catch (e) { /* ignore */ } } };

  /* ── i18n : translations.js expose t()/AW_t ; repli sur le français ── */
  const LANG_KEY = "aw_language";
  let lang = "fr";
  function T(key, fallbackFr) {
    try {
      const fn = (typeof window !== "undefined" && window.AW_t) || (typeof t === "function" ? t : null);
      if (fn) {
        const v = fn("cockpit_" + key, lang);
        if (v && v !== "cockpit_" + key) return v;
      }
    } catch (e) { /* dictionnaire absent */ }
    return fallbackFr;
  }

  const UPDATE_PAGE = "https://holocron-gt.fr/static/aw-cockpit-communaute.html";
  const STATE_KEY = "aw_cockpit_state";
  const WIDTH_KEY = "aw_cockpit_panel_w";
  const BG_KEY = "aw_cockpit_bg";
  const BGANIM_KEY = "aw_cockpit_bg_anim";
  const BGANIM_MODES = ["off", "stars", "drift", "full"];
  const GAMESKIN_KEY = "aw_game_skin";
  const SKIN_KEY = "aw_cockpit_skin";
  const SKINS = ["glass", "hud", "classic"];
  const RAIL_HIDDEN_KEY = "aw_cockpit_rail_hidden";
  const THEME_KEY = "aw_theme";
  const DEFAULT_ACCENT = "#2ad2d8";
  const MAP_ICONS_KEY = "aw_map_icons_enabled";
  const MAP_ICON_STYLE_KEY = "aw_map_icons_style";
  const TERRITORY_KEY = "aw_territory_colors_enabled";
  const TOAST_FLAG = "aw_pending_update_toast";
  const TOAST_SEEN = "aw_update_toast_seen";
  const CHECK_KEY = "aw_update_check";                 // écrit par background.js (Release GitHub)
  const AVAIL_DISMISSED = "aw_update_avail_dismissed"; // version dont la carte a été fermée

  /* ── notes de version de l'édition communauté ── */
  const UPDATE_NOTES = {
    "1.0.9": {
      title: "Vue 3D des systèmes retirée, app Android plus lisible au téléphone",
      points: [
        "La vue 3D sur la page d'un système est retirée : la carte 3D de la galaxie garde ses systèmes ouverts en grand, avec leurs planètes détaillées",
        "App Android : choix de la langue au premier lancement, puis écran d'accueil dans cette langue",
        "App Android : News en cartes lisibles, page Trade qui tient dans l'écran, languette du rail en bas à droite",
        "App Android : icône d'AstroWars, menu de l'app toujours au-dessus de la carte 3D",
      ],
    },
    "1.0.8": {
      title: "Vue système 3D mieux cadrée, plein écran de la carte réparé au doigt",
      points: [
        "Vue 3D d'un système : tout le système tient dans l'image, même sur un écran étroit, et on peut reculer davantage",
        "Caméra automatique de la vue système moins collée aux planètes et à l'étoile",
        "Carte 3D au doigt (tablette, téléphone) : le système s'ouvre d'un appui, disposition adaptée au portrait, taille fixe à l'écran",
        "Carte 3D en plein écran au doigt : les boutons Mon système, Centre, Vue dessus et Quitter le plein écran ne passent plus sous le panneau Réglages 3D",
      ],
    },
    "1.0.7": {
      title: "Carte 3D : systèmes en grand, planètes détaillées, plein écran",
      points: [
        "Carte 3D : au survol, le système s'ouvre en grand sur la gauche, légèrement incliné, et sa fiche (les 12 planètes et leurs propriétaires) s'affiche à droite",
        "Planètes détaillées comme la vue système (relief, nuages, atmosphère, anneaux, villes la nuit), avec le propriétaire et l'alliance écrits sous chacune",
        "Planètes bien réparties autour de l'étoile et qui ne se touchent jamais, apparition animée, fond d'étoiles, le reste de la carte masqué derrière le système",
        "Flottes en vol : marqueur « comète » et paraboles moins hautes",
        "Nouveau : carte 3D en plein écran (bouton en bas à gauche ou touche F, Échap pour revenir)",
      ],
    },
    "1.0.6": {
      title: "Alerte de nouvelle version, aide et rapport de bug",
      points: [
        "Une carte « Nouvelle version » apparaît dans le jeu quand une mise à jour sort, avec le bouton Télécharger (vérification sur GitHub une fois par jour, rien n'est envoyé)",
        "À propos : état de la mise à jour, « Vérifier maintenant », « Signaler un bug » et « Questions fréquentes »",
        "Code source et versions publiés sur GitHub",
      ],
    },
    "1.0.5": {
      title: "Barres de défilement dans tous les thèmes",
      points: [
        "Barres de défilement visibles partout aux couleurs de ton apparence : Classique, HUD ou Verre, couleur d'accent comprise",
        "Pages du jeu : leurs barres de défilement prennent aussi la couleur du thème quand « Skin du jeu » est activé",
      ],
    },
    "1.0.4": {
      title: "Un ZIP pour Chrome, un ZIP pour Firefox",
      points: [
        "Chrome, Edge, Brave et Opera : plus d'avertissement « background.scripts » dans la page des extensions",
        "Firefox : version dédiée, à télécharger avec le bouton « Version Firefox » de la page",
      ],
    },
    "1.0.3": {
      title: "Compatible Firefox",
      points: [
        "L'extension s'installe aussi dans Firefox 128 ou plus récent (module temporaire : voir la page de téléchargement)",
      ],
    },
    "1.0.2": {
      title: "Section Team Holocron",
      points: [
        "À propos : nouvelle section Team Holocron",
        "Les crédits et licences (textures, polices, rendu 3D) sont regroupés dans le fichier CREDITS.txt de l'extension",
      ],
    },
    "1.0.1": {
      title: "Carte 3D de toute la galaxie, écran d'accueil, News en cartes",
      points: [
        "Carte : la vue 3D s'ouvre directement et montre toute la galaxie, plus seulement les secteurs autour du centre ; panneau Réglages 3D refait en onglets Vue · Style · Galaxie",
        "Écran d'accueil à l'installation et nouveau menu de l'icône : langue, pseudo, apparence, couleur d'accent, fond et alerte d'attaque",
        "Page News en cartes avec HUD et Verre, badge « Toi » sur les messages qui te visent, et option « Seulement si elle vise mes planètes » pour le fond rouge",
        "Couleurs d'alliance du jeu respectées dans la vue 3D, les territoires et la vue système",
        "Buildings : les niveaux en cours ressortent en jaune dans toutes les apparences, y compris ceux que ton stock de PP suffit à terminer (infobulle avec les PP investis)",
      ],
    },
    "1.0.0": {
      title: "Première version de l'édition communauté",
      points: [
        "Trois apparences au choix : Verre (panneaux translucides, par défaut), HUD (cockpit technique, filets cyan) et Classique ; la couleur d'accent les colore toutes",
        "Les pages du jeu suivent l'apparence : onglets, tableaux, News, rapports de combat, boutons, fenêtres, barre et filtres de la carte",
        "Barres de progression en jauges graduées, réglables séparément pour les Planètes et la Science (style, épaisseur, couleur)",
        "Fond spatial derrière le jeu, avec animation optionnelle (étoiles, nébuleuse)",
        "Fond rouge automatique quand une flotte ennemie arrive, d'après les incoming de ta page News",
        "Carte : 7 styles d'icônes de systèmes, vue 3D de la galaxie et territoires 2D à partir des données de la page",
        "Vue 3D de chaque système solaire avec planètes texturées",
        "Planètes : vue multi-planètes côte à côte et temps jusqu'au prochain niveau de population",
        "Trade : filtre par tier, bouton Afficher / Masquer Use Supply Unit, colonnes Coût PP et Temps farm, convertisseur PP ⇄ $",
        "Aucun serveur tiers : l'extension ne parle qu'au jeu, pas de compte, rien n'est envoyé",
      ],
    },
  };

  /* ── icônes ── */
  const I = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z"/></svg>',
    appearance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.6-9-7.6z" stroke-linejoin="round"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>',
    about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>',
    hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 5v14" stroke-linecap="round"/></svg>',
    show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 4h6v6M20 4l-9 9" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke-linecap="round"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const MODULES = [
    { id: "appearance", tip: "Apparence", icon: I.appearance, render: renderAppearance },
    { id: "about", tip: "À propos", icon: I.about, render: renderAbout },
  ];
  const TITLES = { appearance: "Apparence", about: "À propos" };
  const mod = (id) => MODULES.find((m) => m.id === id);

  let current = null;
  let skin = "glass";

  /* ═══════════ coquille ═══════════ */
  function buildShell() {
    const rail = document.createElement("nav");
    rail.id = "awc-rail";
    rail.setAttribute("aria-label", "AW Cockpit");

    const logo = document.createElement("div");
    logo.className = "awc-logo";
    logo.title = "AW Cockpit — Édition communauté";
    if (hasChrome && chrome.runtime && chrome.runtime.getURL) {
      const img = document.createElement("img");
      img.alt = "AstroWars";
      img.addEventListener("error", () => { img.src = chrome.runtime.getURL("assets/astrowars-logo.png"); }, { once: true });
      img.src = chrome.runtime.getURL("assets/astrowars-logo-rail.png");
      logo.appendChild(img);
    } else {
      logo.innerHTML = I.logo;
    }
    rail.appendChild(logo);

    MODULES.forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "awc-rail-btn";
      b.dataset.mod = m.id;
      b.dataset.tip = T("tip_" + m.id, m.tip);
      b.setAttribute("aria-label", T("tip_" + m.id, m.tip));
      b.innerHTML = m.icon;
      b.addEventListener("click", () => railClick(m.id));
      rail.appendChild(b);
    });

    const spacer = document.createElement("div");
    spacer.className = "awc-rail-spacer";
    rail.appendChild(spacer);

    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "awc-rail-btn";
    hide.id = "awc-rail-hide";
    hide.dataset.tip = T("hide_rail", "Masquer le rail");
    hide.innerHTML = I.hide;
    hide.addEventListener("click", () => setRailHidden(true));
    rail.appendChild(hide);

    let ver = "";
    try { ver = chrome.runtime.getManifest().version || ""; } catch (e) { /* aperçu */ }
    if (ver) {
      const vtag = document.createElement("div");
      vtag.id = "awc-ver";
      vtag.textContent = "v" + ver;
      vtag.title = T("history", "Historique des versions");
      vtag.style.cursor = "pointer";
      vtag.addEventListener("click", () => showUpdateHistory());
      rail.appendChild(vtag);
    }

    const panel = document.createElement("aside");
    panel.id = "awc-panel";
    panel.innerHTML =
      '<div id="awc-resize" title="' + T("resize", "Redimensionner") + '"></div>' +
      '<div id="awc-head">' +
        '<h1 id="awc-title"></h1>' +
        '<div id="awc-who"><span class="awc-who-dot"></span>' + T("community", "Édition communauté") + " · " + T("offline", "aucun serveur tiers") + "</div>" +
        '<button type="button" id="awc-close" title="' + T("collapse", "Replier") + '">' + I.close + "</button>" +
      "</div>" +
      '<div id="awc-body"></div>';

    // bouton de rappel quand le rail est masqué
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = "awc-rail-tab";
    tab.title = T("show_rail", "Afficher le rail AW Cockpit");
    tab.innerHTML = I.show;
    tab.addEventListener("click", () => setRailHidden(false));

    // calque de fond : nébuleuse derrière la page
    const bg = document.createElement("div");
    bg.id = "awc-bg";
    if (hasChrome && chrome.runtime && chrome.runtime.getURL) {
      bg.style.backgroundImage = 'url("' + chrome.runtime.getURL("assets/space-bg.jpg") + '")';
    }
    ["awc-bg-s1", "awc-bg-s2"].forEach((cls) => {
      const layer = document.createElement("div");
      layer.className = "awc-bg-stars " + cls;
      bg.appendChild(layer);
    });

    document.body.appendChild(bg);
    document.body.append(rail, panel, tab);
    panel.querySelector("#awc-close").addEventListener("click", closeAll);
    initResize(panel.querySelector("#awc-resize"));
    document.documentElement.classList.add("awc-on");
  }

  /* ═══════════ redimensionnement de la colonne ═══════════ */
  function applyPanelWidth(w) {
    document.documentElement.style.setProperty("--awc-panel-w", Math.round(w) + "px");
  }
  function initResize(handle) {
    let active = false;
    handle.addEventListener("pointerdown", (ev) => {
      active = true;
      handle.classList.add("awc-active");
      document.documentElement.classList.add("awc-resizing");
      handle.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    handle.addEventListener("pointermove", (ev) => {
      if (!active) return;
      const railW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--awc-rail-w"), 10) || 52;
      applyPanelWidth(Math.min(820, Math.max(320, window.innerWidth - ev.clientX - railW)));
    });
    const stop = () => {
      if (!active) return;
      active = false;
      handle.classList.remove("awc-active");
      document.documentElement.classList.remove("awc-resizing");
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--awc-panel-w"), 10) || 400;
      sSet({ [WIDTH_KEY]: w });
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  /* ═══════════ navigation ═══════════ */
  function railClick(id) {
    if (current === id) return closeAll();
    openSide(id);
  }
  function openSide(id) {
    const m = mod(id);
    if (!m) return;
    const body = document.getElementById("awc-body");
    body.innerHTML = "";
    m.render(body);
    document.getElementById("awc-title").textContent = T("title_" + id, TITLES[id]);
    document.getElementById("awc-panel").dataset.mod = id;
    body.scrollTop = 0;
    document.documentElement.classList.add("awc-open");
    current = id;
    syncRail(); saveState();
  }
  function closeAll() {
    document.documentElement.classList.remove("awc-open");
    const body = document.getElementById("awc-body");
    if (body) body.innerHTML = "";
    current = null;
    syncRail(); saveState();
  }
  function syncRail() {
    document.querySelectorAll(".awc-rail-btn[data-mod]").forEach((b) => b.classList.toggle("awc-on", b.dataset.mod === current));
  }
  function saveState() { sSet({ [STATE_KEY]: { open: !!current, mod: current } }); }

  function setRailHidden(hidden) {
    if (hidden) closeAll();
    document.documentElement.classList.toggle("awc-rail-hidden", !!hidden);
    sSet({ [RAIL_HIDDEN_KEY]: !!hidden });
  }

  /* ═══════════ petits contrôles ═══════════ */
  function awcKicker(text) {
    const k = document.createElement("div");
    k.className = "awc-kicker";
    k.textContent = text;
    return k;
  }
  function awcRow(label, hint) {
    const row = document.createElement("div");
    row.className = "awc-set-row";
    if (hint) row.title = hint;
    const span = document.createElement("span");
    span.className = "awc-set-label";
    span.textContent = label;
    row.appendChild(span);
    return row;
  }
  function awcSwitch(label, on, onChange, hint) {
    const row = awcRow(label, hint);
    const tog = document.createElement("button");
    tog.type = "button";
    tog.className = "awc-toggle" + (on ? " awc-on" : "");
    tog.setAttribute("aria-pressed", on ? "true" : "false");
    tog.addEventListener("click", () => {
      const next = !tog.classList.contains("awc-on");
      tog.classList.toggle("awc-on", next);
      tog.setAttribute("aria-pressed", next ? "true" : "false");
      onChange(next);
    });
    row.appendChild(tog);
    return row;
  }
  function awcSelect(label, opts, cur, onChange) {
    const row = awcRow(label);
    const sel = document.createElement("select");
    sel.className = "awc-select";
    opts.forEach(([v, txt]) => { const o = document.createElement("option"); o.value = v; o.textContent = txt; sel.appendChild(o); });
    sel.value = cur;
    sel.addEventListener("change", () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }
  function awcHint(text) {
    const d = document.createElement("div");
    d.className = "awc-hint";
    d.textContent = text;
    return d;
  }

  /* ═══════════ apparence : skins ═══════════ */
  function applySkin(s) {
    const v = SKINS.indexOf(s) >= 0 ? s : "glass";
    const c = document.documentElement.classList;
    c.toggle("awc-skin-hud", v === "hud");
    c.toggle("awc-skin-glass", v === "glass");
    return v;
  }
  function setSkin(s) { skin = applySkin(s); sSet({ [SKIN_KEY]: skin }); }

  function applyBgAnim(mode) {
    const m = BGANIM_MODES.indexOf(mode) >= 0 ? mode : "off";
    BGANIM_MODES.forEach((v) => document.documentElement.classList.toggle("awc-bganim-" + v, v !== "off" && v === m));
    return m;
  }

  /* ═══════════ apparence : jauges (réglages par page) ═══════════ */
  const GAUGE_STYLES = ["grad", "neon", "stripes", "pulse", "scan", "segments", "glass", "hud"];
  const GAUGE_SIZES = ["fine", "med", "big"];
  const GAUGE_KEYS = {
    planets: { style: "aw_gauge_style_planets", size: "aw_gauge_size_planets", color: "aw_gauge_color_planets" },
    science: { style: "aw_gauge_style_science", size: "aw_gauge_size_science", color: "aw_gauge_color_science" },
  };
  let gaugePrefs = { planets: { style: "neon", size: "fine" }, science: { style: "neon", size: "fine" } };
  const currentScope = () => (/^\/Game\/Science/i.test(location.pathname || "") ? "science" : "planets");

  function applyGaugeClasses() {
    const p = gaugePrefs[currentScope()];
    const c = document.documentElement.classList;
    GAUGE_STYLES.forEach((s) => c.remove("awc-gauge-" + s));
    GAUGE_SIZES.forEach((s) => c.remove("awc-gauge-h-" + s));
    c.toggle("awc-gauge-on", p.style !== "off");
    if (p.style !== "off") c.add("awc-gauge-" + (GAUGE_STYLES.includes(p.style) ? p.style : "neon"));
    c.add("awc-gauge-h-" + (GAUGE_SIZES.includes(p.size) ? p.size : "fine"));
    try { if (window.AWGauges) window.AWGauges.apply(); } catch (e) { /* ignore */ }
    try { if (window.AWPlanetsEnhance) window.AWPlanetsEnhance.rerun(); } catch (e) { /* ignore */ }
  }
  function themeAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--aw-turquoise").trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : DEFAULT_ACCENT;
  }
  function gaugeColor(scope) {
    return document.documentElement.style.getPropertyValue("--awg-c-" + scope).trim() || themeAccent();
  }
  function setGaugeColor(scope, v) {
    if (v) document.documentElement.style.setProperty("--awg-c-" + scope, v);
    else document.documentElement.style.removeProperty("--awg-c-" + scope);
    sSet({ [GAUGE_KEYS[scope].color]: v || "" });
  }

  /* ═══════════ apparence : couleur d'accent ═══════════ */
  function applyAccent(color) {
    const root = document.documentElement;
    const hx = /^#?([0-9a-f]{6})$/i.exec(String(color || "").trim());
    if (hx && color.toLowerCase() !== DEFAULT_ACCENT) {
      const n = parseInt(hx[1], 16);
      root.style.setProperty("--aw-turquoise", color);
      root.style.setProperty("--aw-turquoise-rgb", (n >> 16) + ", " + ((n >> 8) & 255) + ", " + (n & 255));
      root.classList.add("awc-custom-accent");
    } else {
      root.style.removeProperty("--aw-turquoise");
      root.style.removeProperty("--aw-turquoise-rgb");
      root.classList.remove("awc-custom-accent");
    }
  }
  function setAccent(color) {
    applyAccent(color);
    if (color && color.toLowerCase() !== DEFAULT_ACCENT) sSet({ [THEME_KEY]: { primary: color } });
    else sRemove([THEME_KEY]);
  }

  function renderAppearance(body) {
    // ── apparence de l'outil ──
    body.appendChild(awcKicker(T("sect_skin", "Apparence")));
    const segs = document.createElement("div");
    segs.className = "awc-segs awc-skin-segs";
    [["glass", T("skin_glass", "Verre")], ["hud", T("skin_hud", "HUD")], ["classic", T("skin_classic", "Classique")]].forEach(([v, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "awc-seg" + (skin === v ? " awc-on" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        setSkin(v);
        segs.querySelectorAll(".awc-seg").forEach((x) => x.classList.toggle("awc-on", x === b));
      });
      segs.appendChild(b);
    });
    body.appendChild(segs);
    body.appendChild(awcHint(T("skin_hint", "Verre : panneaux translucides. HUD : cockpit technique, filets cyan. Classique : calé sur les couleurs du jeu.")));

    const root = document.documentElement;
    body.appendChild(awcSwitch(T("game_skin", "Appliquer aux pages du jeu"), root.classList.contains("awc-gameskin"), (on) => {
      root.classList.toggle("awc-gameskin", on);
      sSet({ [GAMESKIN_KEY]: on });
    }, T("game_skin_hint", "Onglets, tableaux, boutons, fenêtres et carte du jeu")));

    // ── fond ──
    body.appendChild(awcKicker(T("sect_display", "Fond")));
    body.appendChild(awcSwitch(T("bg_image", "Image de fond"), !root.classList.contains("awc-nobg"), (on) => {
      root.classList.toggle("awc-nobg", !on);
      sSet({ [BG_KEY]: on });
    }));
    const curAnim = BGANIM_MODES.find((m) => m !== "off" && root.classList.contains("awc-bganim-" + m)) || "off";
    body.appendChild(awcSelect(T("bg_anim", "Fond animé"),
      [["off", "Statique"], ["stars", "Étoiles défilantes"], ["drift", "Nébuleuse (respiration)"], ["full", "Étoiles + nébuleuse"]],
      curAnim, (v) => sSet({ [BGANIM_KEY]: applyBgAnim(v) })));
    body.appendChild(awcSwitch(T("incoming_alert", "Fond rouge si une flotte ennemie arrive"), incomingOn, (on) => {
      incomingOn = on;
      sSet({ [INCOMING_KEY]: on });
      if (on) refreshIncoming(0); else scheduleAlert();
    }, T("incoming_alert_hint", "D'après les incoming de ta page News (relue au plus toutes les 5 min pendant que tu joues)")));

    // ── couleur d'accent ──
    body.appendChild(awcKicker(T("sect_accent", "Couleur d'accent")));
    const sw = document.createElement("div");
    sw.className = "awc-swatches";
    ["#2ad2d8", "#ff8c00", "#a855f7", "#ef4444", "#10b981", "#3b82f6"].forEach((col) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "awc-swatch"; b.style.background = col; b.title = col;
      b.addEventListener("click", () => { setAccent(col); pick.value = col; });
      sw.appendChild(b);
    });
    body.appendChild(sw);
    const accRow = awcRow(T("custom_color", "Couleur personnalisée"));
    const pick = document.createElement("input");
    pick.type = "color"; pick.className = "awc-colorpick"; pick.value = themeAccent();
    pick.addEventListener("input", () => setAccent(pick.value));
    const accReset = document.createElement("button");
    accReset.type = "button"; accReset.className = "awc-chip-reset"; accReset.textContent = "↺";
    accReset.title = T("accent_reset", "Revenir à la couleur du skin");
    accReset.addEventListener("click", () => { setAccent(""); pick.value = DEFAULT_ACCENT; });
    accRow.append(pick, accReset);
    body.appendChild(accRow);

    // ── jauges ──
    const STYLE_OPTS = [
      ["segments", "Segments LED"], ["glass", "Verre poli (arrondi)"], ["hud", "HUD hachuré"], ["grad", "Graduée (sobre)"],
      ["neon", "Néon · anim balayage"], ["stripes", "Néon · anim hachures"], ["pulse", "Néon · anim pulsation"],
      ["scan", "Néon · anim scanner"], ["off", "Barres d'origine"],
    ];
    const SIZE_OPTS = [["fine", "Fine"], ["med", "Moyenne"], ["big", "Épaisse"]];
    const here = currentScope();
    const gaugeGroup = (scope, titre) => {
      body.appendChild(awcKicker(titre + (scope === here ? " · " + T("current_page", "page courante") : "")));
      body.appendChild(awcSelect(T("gauge_style", "Style"), STYLE_OPTS, gaugePrefs[scope].style, (v) => {
        gaugePrefs[scope].style = v; sSet({ [GAUGE_KEYS[scope].style]: v }); if (scope === currentScope()) applyGaugeClasses();
      }));
      body.appendChild(awcSelect(T("gauge_size", "Épaisseur"), SIZE_OPTS, gaugePrefs[scope].size, (v) => {
        gaugePrefs[scope].size = v; sSet({ [GAUGE_KEYS[scope].size]: v }); if (scope === currentScope()) applyGaugeClasses();
      }));
      const row = awcRow(T("gauge_color", "Couleur"));
      const gp = document.createElement("input");
      gp.type = "color"; gp.className = "awc-colorpick"; gp.value = gaugeColor(scope);
      gp.addEventListener("input", () => setGaugeColor(scope, gp.value));
      const gr = document.createElement("button");
      gr.type = "button"; gr.className = "awc-chip-reset"; gr.textContent = "↺";
      gr.title = T("gauge_color_reset", "Reprendre la couleur d'accent");
      gr.addEventListener("click", () => { setGaugeColor(scope, ""); gp.value = themeAccent(); });
      row.append(gp, gr);
      body.appendChild(row);
    };
    gaugeGroup("planets", T("gauges_planets", "Jauges — Planètes"));
    gaugeGroup("science", T("gauges_science", "Jauges — Science"));

    // ── carte ──
    const mapKicker = awcKicker(T("sect_map", "Carte du jeu"));
    body.appendChild(mapKicker);
    sGet([MAP_ICONS_KEY, MAP_ICON_STYLE_KEY, TERRITORY_KEY]).then((r) => {
      const mapBox = document.createElement("div");
      mapBox.appendChild(awcSwitch(T("map_icons", "Icônes de systèmes redessinées"), !!r[MAP_ICONS_KEY], (on) => sSet({ [MAP_ICONS_KEY]: on })));
      mapBox.appendChild(awcSelect(T("map_icon_style", "Style d'icônes"),
        [["crosshair", "Viseur"], ["orb", "Orbe"], ["hex", "Hexagone"], ["star", "Étoile"], ["diamond", "Losange"], ["pulse", "Pulsation"], ["ringed", "Anneau"]],
        r[MAP_ICON_STYLE_KEY] || "crosshair", (v) => sSet({ [MAP_ICON_STYLE_KEY]: v })));
      mapBox.appendChild(awcSwitch(T("territory_colors", "Couleurs des territoires"), !!r[TERRITORY_KEY], (on) => sSet({ [TERRITORY_KEY]: on }),
        T("territory_hint", "Une couleur par alliance sur les zones de la carte du jeu (désactiver recharge la carte)")));
      mapBox.appendChild(awcHint(T("map_hint", "La vue 3D (bouton « Vue 3D » ou touche 3) et les territoires 2D se trouvent dans la barre d'outils de la carte.")));
      mapKicker.after(mapBox);
    });

    // ── rail ──
    body.appendChild(awcKicker(T("sect_rail", "Rail")));
    body.appendChild(awcSwitch(T("hide_rail", "Masquer le rail"), false, (on) => { if (on) setRailHidden(true); },
      T("hide_rail_hint", "Une petite languette à droite de l'écran le fait revenir")));
  }

  /* ═══════════ À propos ═══════════ */
  function renderAbout(body) {
    let ver = "";
    try { ver = chrome.runtime.getManifest().version || ""; } catch (e) { /* aperçu */ }
    const card = document.createElement("div");
    card.className = "awc-about";
    const logoUrl = hasChrome && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL("assets/astrowars-logo-rail.png") : "";
    card.innerHTML =
      (logoUrl ? '<img class="awc-about-logo" alt="" src="' + logoUrl + '">' : "") +
      '<div class="awc-about-name">AW Cockpit</div>' +
      '<div class="awc-about-sub">' + T("community", "Édition communauté") + (ver ? " · v" + ver : "") + "</div>";
    body.appendChild(card);

    const privacy = document.createElement("div");
    privacy.className = "awc-about-privacy";
    privacy.innerHTML = I.shield + "<span>" + T("privacy", "Pas de compte, rien n'est envoyé : l'extension ne parle qu'au jeu, et lit une fois par jour le numéro de la dernière version sur GitHub. Tes réglages restent dans ton navigateur.") + "</span>";
    body.appendChild(privacy);

    body.appendChild(awcKicker(T("sect_updates", "Mises à jour")));
    const status = document.createElement("div");
    status.className = "awc-hint awc-about-status";
    body.appendChild(status);
    const up = document.createElement("button");
    up.type = "button";
    up.className = "awc-primary awc-about-update";
    body.appendChild(up);
    const paintStatus = (res) => {
      const L = res && res.latest;
      const avail = L && newerThan(L.version, ver);
      if (avail) {
        status.textContent = T("upd_available", "Nouvelle version disponible :") + " v" + L.version;
        up.innerHTML = I.external + "<span>" + T("upd_download", "Télécharger") + " v" + L.version + "</span>";
        up.onclick = () => openUrl(downloadUrl(L));
      } else {
        status.textContent = (res && res.error && !L)
          ? T("upd_error", "Vérification impossible pour l'instant (hors ligne ?).")
          : T("upd_uptodate", "Tu as la dernière version.") + (res && res.at ? " " + T("upd_checked", "Vérifié le") + " " + new Date(res.at).toLocaleString() : "");
        up.innerHTML = I.external + "<span>" + T("upd_check_now", "Vérifier maintenant") + "</span>";
        up.onclick = () => {
          up.disabled = true;
          status.textContent = T("upd_checking", "Vérification…");
          requestUpdateCheck(true).then((r) => { up.disabled = false; paintStatus(r); });
        };
      }
    };
    sGet([CHECK_KEY]).then((st) => paintStatus(st[CHECK_KEY]));
    const page = document.createElement("button");
    page.type = "button";
    page.className = "awc-btn awc-btn-wide";
    page.textContent = T("check_updates", "Voir la page des mises à jour");
    page.addEventListener("click", () => openUrl(UPDATE_PAGE + "?lang=" + lang));
    body.appendChild(page);
    body.appendChild(awcHint(T("updates_hint2", "Une fois par jour, l'extension lit le numéro de la dernière version publiée sur GitHub (rien n'est envoyé). Pour mettre à jour : télécharger le ZIP, remplacer le contenu de ton dossier, puis recharger l'extension.")));
    const hist = document.createElement("button");
    hist.type = "button";
    hist.className = "awc-btn awc-btn-wide";
    hist.textContent = T("history", "Historique des versions");
    hist.addEventListener("click", showUpdateHistory);
    body.appendChild(hist);

    body.appendChild(awcKicker(T("sect_help", "Aide")));
    const bug = document.createElement("button");
    bug.type = "button";
    bug.className = "awc-btn awc-btn-wide";
    bug.textContent = T("report_bug", "Signaler un bug");
    // la page pré-remplit version, navigateur, apparence et page du jeu ; envoi via GitHub ou copie pour Discord
    bug.addEventListener("click", () => openUrl(UPDATE_PAGE + "?lang=" + lang + "&v=" + encodeURIComponent(ver) +
      "&skin=" + encodeURIComponent(skin) + "&page=" + encodeURIComponent(location.pathname) + "#bug"));
    body.appendChild(bug);
    const faq = document.createElement("button");
    faq.type = "button";
    faq.className = "awc-btn awc-btn-wide";
    faq.textContent = T("faq", "Questions fréquentes");
    faq.addEventListener("click", () => openUrl(UPDATE_PAGE + "?lang=" + lang + "#faq"));
    body.appendChild(faq);

    body.appendChild(awcKicker(T("sect_team", "Team Holocron")));
    body.appendChild(awcHint(T("team_hint", "AW Cockpit est imaginé et développé par la Team Holocron, pour toute la communauté AstroWars : gratuit, sans compte et sans publicité.")));
    body.appendChild(awcHint(T("team_thanks", "Merci à tous les joueurs qui le testent et font remonter leurs idées. Bon jeu, et que la Force soit avec ta flotte !")));
    // Les mentions de licence (textures CC BY 4.0, polices SIL OFL, three.js MIT) restent dans
    // CREDITS.txt et en pied de la page de téléchargement (vue système 3D retirée de l'édition le 16/09/2026).
  }

  /* ═══════════ historique des versions + toast après mise à jour ═══════════ */
  function sortedVersions() {
    return Object.keys(UPDATE_NOTES).sort((a, b) => {
      const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
      return (pb[0] - pa[0]) || (pb[1] - pa[1]) || (pb[2] - pa[2]);
    });
  }
  function showUpdateHistory() {
    if (document.getElementById("awc-uh-backdrop")) return;
    let cur = null;
    try { cur = chrome.runtime.getManifest().version; } catch (e) { /* aperçu */ }
    const vers = sortedVersions();
    const items = vers.map((v, i) => {
      const n = UPDATE_NOTES[v];
      const now = v === cur;
      return '<div class="awc-uh-item' + (now ? " awc-uh-now" : "") + (i >= 3 ? " awc-uh-closed" : "") + '">' +
        '<button type="button" class="awc-uh-row" aria-expanded="' + (i < 3) + '">' +
          '<span class="awc-uh-dot" aria-hidden="true"></span>' +
          '<span class="awc-uh-ver">v' + v + "</span>" +
          (now ? '<span class="awc-uh-cur">' + T("current", "actuelle") + "</span>" : "") +
          '<span class="awc-uh-count">' + n.points.length + " " + T("changes", "nouveautés") + "</span>" +
          '<span class="awc-uh-chev" aria-hidden="true">' + I.chevron + "</span>" +
        "</button>" +
        '<div class="awc-uh-title">' + n.title + "</div>" +
        '<ul class="awc-uh-list">' + n.points.map((p) => "<li>" + p + "</li>").join("") + "</ul>" +
        "</div>";
    }).join("");
    const bd = document.createElement("div");
    bd.id = "awc-uh-backdrop";
    bd.innerHTML =
      '<div class="awc-uh-card" role="dialog" aria-label="Historique des versions">' +
        '<div class="awc-uh-head">' +
          '<div class="awc-uh-htitle">' + T("history", "Historique des versions") + "</div>" +
          '<div class="awc-uh-hsub">AW Cockpit · ' + T("community", "Édition communauté") + (cur ? " · <b>v" + cur + "</b>" : "") + "</div>" +
          '<button type="button" class="awc-uh-x awc-toast-x" title="' + T("close_simple", "Fermer") + '">' + I.close + "</button>" +
        "</div>" +
        '<div class="awc-uh-body">' + items + "</div>" +
      "</div>";
    document.body.appendChild(bd);
    const close = () => { document.removeEventListener("keydown", onKey); bd.remove(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    bd.addEventListener("click", (e) => {
      if (e.target === bd) return close();
      const row = e.target.closest(".awc-uh-row");
      if (row) {
        const closed = row.parentElement.classList.toggle("awc-uh-closed");
        row.setAttribute("aria-expanded", String(!closed));
      }
    });
    bd.querySelector(".awc-uh-x").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
  }

  /* ═══════════ nouvelle version disponible (Release GitHub, lue par background.js) ═══════════ */
  function newerThan(a, b) {
    const pa = String(a || "").split(".").map(Number), pb = String(b || "0").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }
  function curVersion() {
    try { return chrome.runtime.getManifest().version || ""; } catch (e) { return ""; }
  }
  function requestUpdateCheck(force) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage({ type: "awcc_update_check", force: !!force }, (r) => {
          void chrome.runtime.lastError;   // service worker endormi / contexte invalidé : pas bloquant
          res(r || null);
        });
      } catch (e) { res(null); }
    });
  }
  function openUrl(url) { if (url) window.open(url, "_blank", "noopener"); }
  function downloadUrl(L) {
    const firefox = /firefox/i.test(navigator.userAgent);
    return (firefox ? L.zip_firefox : L.zip_chrome) || L.zip || L.page || UPDATE_PAGE;
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function showAvailableToast(L) {
    if (document.getElementById("awc-update-toast")) return;
    const SHOWN = 3;
    const n = L.notes ? ((L.notes.i18n && L.notes.i18n[lang]) || L.notes) : null;
    const t = document.createElement("div");
    t.id = "awc-update-toast";                     // même habillage que le toast « quoi de neuf » dans les 3 skins
    t.className = "awc-toast awc-avail";
    t.innerHTML =
      '<button type="button" class="awc-toast-x" title="' + T("close_simple", "Fermer") + '">' + I.close + "</button>" +
      '<div class="awc-toast-badge">' + T("upd_badge_new", "Nouvelle version") + "</div>" +
      '<div class="awc-toast-ver">AW&nbsp;Cockpit&nbsp;<b>v' + escHtml(L.version) + "</b>" +
        '<span class="awc-avail-cur"> · ' + T("upd_yours", "toi :") + " v" + escHtml(curVersion()) + "</span></div>" +
      (n && n.title
        ? '<div class="awc-toast-title">' + escHtml(n.title) + "</div>" +
          '<ul class="awc-toast-list">' + (n.points || []).slice(0, SHOWN).map((p) => "<li>" + escHtml(p) + "</li>").join("") + "</ul>"
        : "") +
      '<div class="awc-avail-how">' + T("upd_how", "Décompresse le ZIP à la place de ton dossier, puis ↻ dans la page des extensions et Ctrl+Maj+R sur le jeu.") + "</div>" +
      '<div class="awc-toast-actions">' +
        '<button type="button" class="awc-avail-more">' + T("upd_details", "Détails") + "</button>" +
        '<button type="button" class="awc-toast-ok">' + T("upd_download", "Télécharger") + "</button>" +
      "</div>";
    document.body.appendChild(t);
    const close = () => {
      sSet({ [AVAIL_DISMISSED]: L.version });      // plus rien pour cette version ; la suivante réapparaîtra
      t.classList.remove("awc-toast-in");
      setTimeout(() => t.remove(), 340);
    };
    t.querySelector(".awc-toast-x").addEventListener("click", close);
    t.querySelector(".awc-avail-more").addEventListener("click", () => openUrl(UPDATE_PAGE + "?lang=" + lang + "#versions"));
    t.querySelector(".awc-toast-ok").addEventListener("click", () => { openUrl(downloadUrl(L)); close(); });
    setTimeout(() => t.classList.add("awc-toast-in"), 40);
  }
  function maybeShowAvailable() {
    requestUpdateCheck(false).then((res) => {
      const L = res && res.latest;
      if (!L || !newerThan(L.version, curVersion())) return;
      sGet([AVAIL_DISMISSED]).then((d) => { if (d[AVAIL_DISMISSED] !== L.version) showAvailableToast(L); });
    });
  }

  function showUpdateToast(ver, note) {
    if (document.getElementById("awc-update-toast")) return;
    const SHOWN = 4;
    const t = document.createElement("div");
    t.id = "awc-update-toast";
    t.className = "awc-toast";
    t.innerHTML =
      '<button type="button" class="awc-toast-x" title="' + T("close_simple", "Fermer") + '">' + I.close + "</button>" +
      '<div class="awc-toast-badge">' + T("update_badge", "Mise à jour") + "</div>" +
      '<div class="awc-toast-ver">AW&nbsp;Cockpit&nbsp;<b>v' + ver + "</b></div>" +
      (note
        ? '<div class="awc-toast-title">' + note.title + "</div>" +
          '<ul class="awc-toast-list">' + note.points.slice(0, SHOWN).map((p) => "<li>" + p + "</li>").join("") + "</ul>" +
          (note.points.length > SHOWN ? '<div class="awc-toast-more">+ ' + (note.points.length - SHOWN) + " " + T("more_in_history", "autres nouveautés dans l'historique") + "</div>" : "")
        : "") +
      '<div class="awc-toast-actions"><button type="button" class="awc-toast-ok">' + T("discover", "Découvrir") + "</button></div>";
    document.body.appendChild(t);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      sSet({ [TOAST_SEEN]: ver });
      sRemove([TOAST_FLAG]);
      t.classList.remove("awc-toast-in");
      setTimeout(() => t.remove(), 340);
    };
    t.querySelector(".awc-toast-x").addEventListener("click", close);
    t.querySelector(".awc-toast-ok").addEventListener("click", () => { close(); try { showUpdateHistory(); } catch (e) { /* ignore */ } });
    setTimeout(() => t.classList.add("awc-toast-in"), 40);
  }

  /* ═══════════ alerte incoming : fond rouge ═══════════
     Source : la page News du jeu, rien d'autre. Une cellule td.msg.player-incoming
     (flotte ENNEMIE ; player-friendlyincoming = alliée, ignorée) porte l'heure
     d'arrivée annoncée (« 09:45:00 - sept. 13 », heure de Paris, mois dans la
     langue de la session). Tant qu'une de ces heures est à venir (+10 min de marge),
     fond rouge sur toutes les pages. Lecture : la page News quand on l'ouvre, sinon
     un GET /Game/News au plus toutes les 5 min, seulement quand on navigue. */
  const INCOMING_KEY = "aw_incoming_alert";   // réglage (défaut : activé)
  const INCOMING_MINE_KEY = "aw_incoming_mine"; // seulement les attaques contre MON pseudo
  const PSEUDO_KEY = "aw_game_player_name";    // pseudo AstroWars saisi dans le menu de l'icône
  const ALERT_UNTIL_KEY = "aw_alert_until";   // fin de l'alerte (ms epoch), partagée entre onglets
  const NEWS_TS_KEY = "aw_news_checked_at";   // dernière lecture des News
  const NEWS_EVERY_MS = 5 * 60 * 1000;
  const ALERT_GRACE_MS = 10 * 60 * 1000;
  const MOIS = { jan: 0, janv: 0, feb: 1, fev: 1, "fév": 1, "févr": 1, mar: 2, mars: 2, apr: 3, avr: 3, may: 4, mai: 4,
    jun: 5, juin: 5, jul: 6, juil: 6, aug: 7, "aoû": 7, "août": 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11, "déc": 11 };
  let incomingOn = true;
  let incomingMine = false;
  let pseudo = "";
  let alertUntil = 0;
  let alertTimer = 0;

  function parisOffsetMin(d) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000;
  }
  function etaFrom(txt, now) {
    const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*-\s*([A-Za-zÀ-ÿ]{3,5})\.?\s*(\d{1,2})/i.exec(txt || "");
    if (!m) return null;
    let h = +m[1];
    if (m[4]) { const pm = /pm/i.test(m[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    const mo = MOIS[m[5].toLowerCase()];
    if (mo == null) return null;
    const y = new Date(now).getUTCFullYear();
    let best = null;
    [y - 1, y, y + 1].forEach((yy) => {        // pas d'année dans le texte : la plus proche de maintenant
      const wall = Date.UTC(yy, mo, +m[6], h, +m[2], +(m[3] || 0));
      const t = wall - parisOffsetMin(new Date(wall)) * 60000;
      if (best == null || Math.abs(t - now) < Math.abs(best - now)) best = t;
    });
    return best;
  }
  function targetOf(td) {
    const a = td.querySelector('a[href*="/Game/Players/Profile/"]');
    return (a ? a.textContent : "").trim().toLowerCase();
  }
  function hostileEtas(doc) {
    const now = Date.now();
    const me = pseudo.trim().toLowerCase();
    return [...doc.querySelectorAll("td.msg.player-incoming")]
      .filter((td) => !(incomingMine && me) || targetOf(td) === me)
      .map((td) => etaFrom(td.textContent, now)).filter(Boolean);
  }
  /* News : badge « Toi » sur les messages dont la cible est mon pseudo */
  function markMyNews() {
    const me = pseudo.trim().toLowerCase();
    document.querySelectorAll("td.msg").forEach((td) => {
      const mine = !!me && targetOf(td) === me;
      td.classList.toggle("aw-news-me", mine);
      let badge = td.querySelector(".aw-me-badge");
      if (mine && !badge) {
        badge = document.createElement("span");
        badge.className = "aw-me-badge";
        td.appendChild(badge);
      }
      if (badge) {
        if (mine) badge.textContent = T("me_badge", { fr: "Toi", en: "You", es: "Tú", de: "Du" }[lang] || "Toi");
        else badge.remove();
      }
    });
  }
  function paintWho() {
    const who = document.getElementById("awc-who");
    if (!who) return;
    const name = pseudo.trim();
    who.innerHTML = '<span class="awc-who-dot"></span>';
    who.appendChild(document.createTextNode(name
      ? name + " · " + T("community", "Édition communauté")
      : T("community", "Édition communauté") + " · " + T("offline", "aucun serveur tiers")));
  }
  function applyAlertBg(on) {
    document.documentElement.classList.toggle("awc-alert", !!on);
    const bg = document.getElementById("awc-bg");
    if (bg && hasChrome && chrome.runtime && chrome.runtime.getURL) {
      bg.style.backgroundImage = 'url("' + chrome.runtime.getURL(on ? "assets/space-bg-alert.jpg" : "assets/space-bg.jpg") + '")';
    }
  }
  function scheduleAlert() {
    clearTimeout(alertTimer);
    const left = alertUntil - Date.now();
    const on = incomingOn && left > 0;
    applyAlertBg(on);
    if (on) alertTimer = setTimeout(scheduleAlert, Math.min(left + 500, 2147483000));
  }
  function recordEtas(etas) {
    const now = Date.now();
    const future = etas.filter((t) => t + ALERT_GRACE_MS > now);
    alertUntil = future.length ? Math.max(...future) + ALERT_GRACE_MS : 0;
    sSet({ [ALERT_UNTIL_KEY]: alertUntil, [NEWS_TS_KEY]: now });
    scheduleAlert();
  }
  async function refreshIncoming(lastCheck) {
    if (!incomingOn) return;
    // page 1 des News déjà affichée : on la lit, sans requête
    if (/^\/Game\/News\/?$/i.test(location.pathname) && !/[?&]page=(?!1\b)\d+/i.test(location.search)) {
      recordEtas(hostileEtas(document));
      return;
    }
    if (!/^\/Game\//i.test(location.pathname)) return;           // pages publiques : pas de session
    if (Date.now() - (lastCheck || 0) < NEWS_EVERY_MS) return;
    try {
      const res = await fetch("/Game/News", { credentials: "same-origin" });
      if (!res.ok || !/\/Game\/News/i.test(res.url)) return;       // redirigé (déconnecté) : on ne conclut rien
      recordEtas(hostileEtas(new DOMParser().parseFromString(await res.text(), "text/html")));
    } catch (e) { /* hors ligne */ }
  }

  /* ═══════════ init ═══════════ */
  async function init() {
    const st = await sGet([STATE_KEY, WIDTH_KEY, BG_KEY, BGANIM_KEY, SKIN_KEY, RAIL_HIDDEN_KEY, LANG_KEY, TOAST_FLAG, TOAST_SEEN, THEME_KEY,
      GAUGE_KEYS.planets.style, GAUGE_KEYS.planets.size, GAUGE_KEYS.science.style, GAUGE_KEYS.science.size,
      INCOMING_KEY, ALERT_UNTIL_KEY, NEWS_TS_KEY, INCOMING_MINE_KEY, PSEUDO_KEY]);
    incomingOn = st[INCOMING_KEY] !== false;
    incomingMine = st[INCOMING_MINE_KEY] === true;   // défaut : moi + mon alliance (ce que listent les News)
    pseudo = String(st[PSEUDO_KEY] || "");
    alertUntil = +st[ALERT_UNTIL_KEY] || 0;
    lang = st[LANG_KEY] || "fr";
    skin = applySkin(st[SKIN_KEY] || "glass");
    ["planets", "science"].forEach((scope) => {
      gaugePrefs[scope] = { style: st[GAUGE_KEYS[scope].style] || "neon", size: st[GAUGE_KEYS[scope].size] || "fine" };
    });
    applyGaugeClasses();
    document.documentElement.classList.toggle("awc-nobg", st[BG_KEY] === false);
    applyBgAnim(st[BGANIM_KEY] || "off");
    applyAccent(st[THEME_KEY] && st[THEME_KEY].primary);

    buildShell();
    if (st[WIDTH_KEY]) applyPanelWidth(st[WIDTH_KEY]);
    document.documentElement.classList.toggle("awc-rail-hidden", !!st[RAIL_HIDDEN_KEY]);

    const state = st[STATE_KEY] || {};
    if (state.open && state.mod && mod(state.mod) && !st[RAIL_HIDDEN_KEY]) openSide(state.mod);

    if (st[TOAST_FLAG] && st[TOAST_SEEN] !== st[TOAST_FLAG]) showUpdateToast(st[TOAST_FLAG], UPDATE_NOTES[st[TOAST_FLAG]]);
    else maybeShowAvailable();

    paintWho();
    if (/^\/Game\/News/i.test(location.pathname)) markMyNews();
    scheduleAlert();                      // alerte déjà connue : fond rouge sans attendre
    refreshIncoming(+st[NEWS_TS_KEY] || 0);

    if (hasChrome) {
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== "local") return;
          if (changes[SKIN_KEY] && changes[SKIN_KEY].newValue && changes[SKIN_KEY].newValue !== skin) skin = applySkin(changes[SKIN_KEY].newValue);
          if (changes[LANG_KEY]) { lang = changes[LANG_KEY].newValue || "fr"; if (current) openSide(current); }
          // un autre onglet a lu les News, ou le réglage a changé
          if (changes[ALERT_UNTIL_KEY]) { alertUntil = +changes[ALERT_UNTIL_KEY].newValue || 0; scheduleAlert(); }
          if (changes[INCOMING_KEY]) { incomingOn = changes[INCOMING_KEY].newValue !== false; scheduleAlert(); }
          // depuis le menu de l'icône : accent, fond, pseudo, filtre « mes planètes »
          if (changes[THEME_KEY]) applyAccent(changes[THEME_KEY].newValue && changes[THEME_KEY].newValue.primary);
          if (changes[BG_KEY]) document.documentElement.classList.toggle("awc-nobg", changes[BG_KEY].newValue === false);
          if (changes[PSEUDO_KEY] || changes[INCOMING_MINE_KEY]) {
            if (changes[PSEUDO_KEY]) pseudo = String(changes[PSEUDO_KEY].newValue || "");
            if (changes[INCOMING_MINE_KEY]) incomingMine = changes[INCOMING_MINE_KEY].newValue === true;
            paintWho();
            if (/^\/Game\/News/i.test(location.pathname)) markMyNews();
            refreshIncoming(0);
          }
        });
      } catch (e) { /* contexte invalidé */ }
    }
  }

  try { window.AW_showUpdateHistory = showUpdateHistory; } catch (e) { /* ignore */ }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();
})();
