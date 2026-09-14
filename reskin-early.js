// Early theme injection - runs at document_start
// Applies theme CSS variables AND game-skin class BEFORE first paint
// NB: l'ancien reskin (aw-reskin-active / game-reskin.css) est retiré — remplacé
// par le skin du jeu de cockpit.css (html.awc-gameskin, actif par défaut).
(function() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  // Skin du jeu (nav + tableaux) : actif par défaut, opt-out via Réglages → Thème
  try { document.documentElement.classList.add("awc-gameskin"); } catch (e) { /* ignore */ }
  // Jauges : style et épaisseur posés avant le premier paint, sinon les barres
  // du jeu s'affichent une fraction de seconde à l'ancienne à chaque navigation.
  var STYLES = ["grad", "neon", "stripes", "pulse", "scan", "segments", "glass", "hud"];
  var SIZES = ["fine", "med", "big"];
  try { document.documentElement.classList.add("awc-gauge-on", "awc-gauge-neon", "awc-gauge-h-fine"); } catch (e) { /* ignore */ }

  // Portée de la page : Science a ses propres réglages, tout le reste suit ceux
  // des Planètes. Même règle que gauges.js et cockpit.js.
  var scope = /^\/Game\/Science/i.test(location.pathname || "") ? "science" : "planets";

  chrome.storage.local.get(["aw_game_skin", "aw_theme",
                            "aw_gauge_style", "aw_gauge_size",   // ancien réglage global, repris si présent
                            "aw_gauge_style_planets", "aw_gauge_size_planets",
                            "aw_gauge_style_science", "aw_gauge_size_science",
                            "aw_gauge_color_planets", "aw_gauge_color_science"], function(result) {
    if (result.aw_game_skin === false) {
      document.documentElement.classList.remove("awc-gameskin");
    }
    var root = document.documentElement;
    var gs = result["aw_gauge_style_" + scope] || result.aw_gauge_style;
    if (gs && gs !== "neon") {
      root.classList.remove("awc-gauge-neon");
      // "off" (ou valeur inconnue) : on retire aussi le marqueur → barres d'origine
      if (STYLES.indexOf(gs) >= 0) root.classList.add("awc-gauge-" + gs);
      else root.classList.remove("awc-gauge-on");
    }
    var sz = result["aw_gauge_size_" + scope] || result.aw_gauge_size;
    if (sz && sz !== "fine" && SIZES.indexOf(sz) >= 0) {
      root.classList.remove("awc-gauge-h-fine");
      root.classList.add("awc-gauge-h-" + sz);
    }
    // Couleurs de jauge par page (vide = accent du thème)
    if (result.aw_gauge_color_planets) root.style.setProperty("--awg-c-planets", result.aw_gauge_color_planets);
    if (result.aw_gauge_color_science) root.style.setProperty("--awg-c-science", result.aw_gauge_color_science);
    // L'ancien flag reskin ne doit plus jamais s'appliquer
    document.documentElement.classList.remove("aw-reskin-active");

    // Apply theme CSS variables immediately
    var theme = result.aw_theme;
    if (theme) {
      var root = document.documentElement;
      // Accent explicitement choisi : uniquement s'il DIFFÈRE du turquoise par
      // défaut (content.js enregistre le thème complet même sans choix).
      // Doit rester aligné sur DEFAULT_THEME.primary de content.js.
      if (theme.primary) {
        root.style.setProperty("--aw-turquoise", theme.primary);
        // même couleur en « r, g, b » : les skins HUD / Verre en dérivent --aw-accent-rgb
        var hx = /^#?([0-9a-f]{6})$/i.exec(String(theme.primary).trim());
        if (hx) {
          var n = parseInt(hx[1], 16);
          root.style.setProperty("--aw-turquoise-rgb", (n >> 16) + ", " + ((n >> 8) & 255) + ", " + (n & 255));
        }
        if (String(theme.primary).toLowerCase() !== "#2ad2d8") {
          root.classList.add("awc-custom-accent");
        }
      }
      if (theme.secondary)  root.style.setProperty("--aw-border", theme.secondary);
      if (theme.background) root.style.setProperty("--aw-background", theme.background);
      if (theme.panelBg)    root.style.setProperty("--aw-panel-bg", theme.panelBg);
      if (theme.text)       root.style.setProperty("--aw-text", theme.text);
      if (theme.pink)       root.style.setProperty("--aw-neon-pink", theme.pink);
      if (theme.green)      root.style.setProperty("--aw-neon-green", theme.green);
      if (theme.blue)       root.style.setProperty("--aw-blue", theme.blue);
    }
  });
})();


// ── Apparence du cockpit (HUD / Verre / Classique) + polices embarquées ─────
// Classe posée AVANT le premier paint (Verre par défaut depuis le 13/09/2026, rien à
// régler), puis corrigée dès que le storage répond. Les polices vivent dans assets/fonts/ :
// déclarées ici via chrome.runtime.getURL (marche aussi sous Firefox, où
// __MSG_@@extension_id__ ne donne pas l'UUID moz-extension).
(function () {
  var root = document.documentElement;
  try { root.classList.add("awc-skin-glass"); } catch (e) { /* ignore */ }
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      var u = function (f) { return chrome.runtime.getURL("assets/fonts/" + f); };
      var css =
        "@font-face{font-family:'Rajdhani';font-style:normal;font-weight:500;font-display:swap;src:url('" + u("Rajdhani-500.woff2") + "') format('woff2')}" +
        "@font-face{font-family:'Rajdhani';font-style:normal;font-weight:600;font-display:swap;src:url('" + u("Rajdhani-600.woff2") + "') format('woff2')}" +
        "@font-face{font-family:'Rajdhani';font-style:normal;font-weight:700;font-display:swap;src:url('" + u("Rajdhani-700.woff2") + "') format('woff2')}" +
        "@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400 500;font-display:swap;src:url('" + u("JetBrainsMono-var.woff2") + "') format('woff2')}" +
        "@font-face{font-family:'Manrope';font-style:normal;font-weight:400 700;font-display:swap;src:url('" + u("Manrope-400-700.woff2") + "') format('woff2')}";
      var st = document.createElement("style");
      st.id = "awc-fonts";
      st.textContent = css;
      (document.head || root).appendChild(st);
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    chrome.storage.local.get(["aw_cockpit_skin"], function (r) {
      var s = r && r.aw_cockpit_skin;
      if (s === "hud") { root.classList.remove("awc-skin-glass"); root.classList.add("awc-skin-hud"); }
      else if (s === "classic") { root.classList.remove("awc-skin-glass"); }
    });
  } catch (e) { /* ignore */ }
})();

// ── awc-early-flag : anti-flash du cockpit v3 ─────────────────────────────
// Pose html.awc-on des le document_start pour que cockpit.css masque les
// panneaux historiques AVANT leur injection (sinon ils flashent a chaque
// navigation).
try {
  document.documentElement.classList.add("awc-on");
} catch (e) { /* ignore */ }
