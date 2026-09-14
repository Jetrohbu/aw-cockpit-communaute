// AW Extension - Map Icon Replacer v2
// Replaces native star*.gif icons with custom SVGs
// Supports multiple icon styles + toggle on/off

(function () {
  if (window.__awMapEnhanceLoaded) return;
  window.__awMapEnhanceLoaded = true;

  const STORAGE_KEYS = {
    mapIconsEnabled: "aw_map_icons_enabled",
    mapIconsStyle: "aw_map_icons_style",
    allianceColors: "aw_alliance_colors",
    territoryColorsEnabled: "aw_territory_colors_enabled",
  };

  // Icon packs: style -> format -> filename
  // Couleur encodée par le jeu via star0..star8 (échantillonné : star0 gris clair,
  // 1 gris, 2 teal, 3 vert, 4 or, 5 orange, 6 rouge, 7 magenta, 8 violet).
  const STAR_TO_COLOR = {
    star0: "silver", star1: "grey", star2: "teal", star3: "green",
    star4: "gold", star5: "orange", star6: "red", star7: "purple_pink", star8: "deep_purple",
  };
  const ICON_COLORS = ["silver", "grey", "teal", "green", "gold", "orange", "red", "purple_pink", "deep_purple"];
  const ICON_STYLES = ["crosshair", "orb", "hex", "star", "diamond", "pulse", "ringed"];
  const ICON_PACKS = {};
  ICON_STYLES.forEach((st) => {
    ICON_PACKS[st] = {};
    ICON_COLORS.forEach((col) => { ICON_PACKS[st][col] = `assets/icons/${st}/${st}_${col}.svg`; });
  });

  let enabled = false;
  let currentStyle = "crosshair";
  let originalSrcs = new Map(); // img element -> original src
  let observer = null;
  let allianceColors = {};
  let territoryColorsEnabled = false;
  let territoryObserver = null;

  // ========================================
  //   STORAGE
  // ========================================

  function loadSettings() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage) return resolve();
      chrome.storage.local.get([
        STORAGE_KEYS.mapIconsEnabled,
        STORAGE_KEYS.mapIconsStyle,
        STORAGE_KEYS.allianceColors,
        STORAGE_KEYS.territoryColorsEnabled,
      ], (r) => {
        enabled = !!r[STORAGE_KEYS.mapIconsEnabled];
        currentStyle = r[STORAGE_KEYS.mapIconsStyle] || "crosshair";
        allianceColors = r[STORAGE_KEYS.allianceColors] || {};
        territoryColorsEnabled = !!r[STORAGE_KEYS.territoryColorsEnabled];
        resolve();
      });
    });
  }

  function saveSettings() {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    chrome.storage.local.set({
      [STORAGE_KEYS.mapIconsEnabled]: enabled,
      [STORAGE_KEYS.mapIconsStyle]: currentStyle,
      [STORAGE_KEYS.territoryColorsEnabled]: territoryColorsEnabled,
    });
  }

  // ========================================
  //   ICON REPLACEMENT
  // ========================================

  function getExtUrl(filename) {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(filename);
    }
    return filename;
  }

  function colorForStar(origSrc) {
    const m = (origSrc || "").match(/star(\d+)\.gif/i);
    const key = m ? "star" + m[1] : null;
    return (key && STAR_TO_COLOR[key]) || "grey";
  }
  function getIconForSystem(origSrc) {
    const pack = ICON_PACKS[currentStyle] || ICON_PACKS.crosshair;
    return getExtUrl(pack[colorForStar(origSrc)] || pack.grey);
  }

  function replaceIcons() {
    if (!enabled) return;
    const planets = document.querySelectorAll(".map-planet");
    let count = 0;

    planets.forEach(el => {
      const img = el.querySelector("img");
      if (!img) return;

      // Save original src if not already saved (= le star*.gif natif = la couleur du jeu)
      if (!originalSrcs.has(img)) {
        originalSrcs.set(img, img.src);
      }

      const newSrc = getIconForSystem(originalSrcs.get(img));
      if (img.src !== newSrc) {
        img.src = newSrc;
        img.style.width = "30px";
        img.style.height = "30px";
        img.style.borderRadius = "0";
        img.style.background = "transparent";
        img.style.border = "none";
        img.style.padding = "0";
        count++;
      }
    });

    if (count > 0) {
      console.log(`[MAP ICONS] ✅ Applied ${currentStyle} icons to ${count} systems`);
    }
  }

  function restoreIcons() {
    originalSrcs.forEach((originalSrc, img) => {
      if (img && img.parentElement) {
        img.src = originalSrc;
        img.style.width = "";
        img.style.height = "";
        img.style.borderRadius = "";
        img.style.background = "";
        img.style.border = "";
        img.style.padding = "";
      }
    });
    console.log(`[MAP ICONS] ↩️ Restored ${originalSrcs.size} original icons`);
  }

  // ========================================
  //   MUTATION OBSERVER (new sectors loaded)
  // ========================================

  function startObserver() {
    if (observer) return;
    const mapContent = document.getElementById("mapContent");
    if (!mapContent) return;

    observer = new MutationObserver(() => {
      if (enabled) replaceIcons();
    });
    observer.observe(mapContent, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ========================================
  //   TOGGLE & STYLE CONTROLS
  // ========================================

  function setupControls() {
    // Icons Toggle
    const toggle = document.getElementById("aw-map-icons-toggle");
    if (toggle) {
      toggle.checked = enabled;
      toggle.addEventListener("change", () => {
        enabled = toggle.checked;
        saveSettings();
        if (enabled) {
          replaceIcons();
          startObserver();
        } else {
          restoreIcons();
          stopObserver();
        }
        const styleGroup = document.getElementById("aw-map-icons-style-group");
        if (styleGroup) styleGroup.style.display = enabled ? "" : "none";
        console.log("[MAP ICONS]", enabled ? "ON" : "OFF");
      });
      const styleGroup = document.getElementById("aw-map-icons-style-group");
      if (styleGroup) styleGroup.style.display = enabled ? "" : "none";
    }

    // Icon Style selector
    const styleSelect = document.getElementById("aw-map-icons-style");
    if (styleSelect) {
      styleSelect.value = currentStyle;
      styleSelect.addEventListener("change", () => {
        currentStyle = styleSelect.value;
        saveSettings();
        if (enabled) {
          document.querySelectorAll(".map-planet img").forEach(img => { delete img.dataset.awStyle; });
          replaceIcons();
        }
        console.log("[MAP ICONS] Style changed to:", currentStyle);
      });
    }

    // Territory Colors Toggle
    const tToggle = document.getElementById("aw-territory-colors-toggle");
    if (tToggle) {
      tToggle.checked = territoryColorsEnabled;
      tToggle.addEventListener("change", () => {
        territoryColorsEnabled = tToggle.checked;
        saveSettings();
        const tContainer = document.getElementById("aw-territory-colors-section");
        if (tContainer) tContainer.style.display = territoryColorsEnabled ? "" : "none";
        if (territoryColorsEnabled) {
          buildTerritoryColorUI();
          if (isMapPage()) {
            recolorTerritories();
            startTerritoryObserver();
          }
        } else {
          stopTerritoryObserver();
          if (isMapPage()) location.reload(); // Restore original colors
        }
        console.log("[TERRITORY COLORS]", territoryColorsEnabled ? "ON" : "OFF");
      });
      const tContainer = document.getElementById("aw-territory-colors-section");
      if (tContainer) tContainer.style.display = territoryColorsEnabled ? "" : "none";
      if (territoryColorsEnabled) buildTerritoryColorUI();
    }
  }

  // ========================================
  //   TERRITORY COLOR OVERRIDE
  // ========================================

  // Color helpers for territories (same logic as ICON_PACKS colors)
  const SPECIAL_COLORS = {
    APP: "#8b5cf6", FITH: "#ff9100", HNU: "#18d4ff",
    FORK: "#3b82f6", PUNX: "#ff4fd8", SSS: "#7fff00",
    GOAT: "#f8f8ff", LOW: "#ff6347", AO: "#ff8c00", RAID: "#ff0000",
  };
  const COLOR_PALETTE = ["#3b82f6","#ef4444","#22c55e","#a855f7","#f97316","#10b981","#eab308","#6366f1","#ec4899","#14b8a6"];

  function getColorForTag(tag) {
    if (!tag) return "#888";
    const n = tag.toUpperCase();
    if (allianceColors[n]) return allianceColors[n];
    if (SPECIAL_COLORS[n]) return SPECIAL_COLORS[n];
    const h = Array.from(n).reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
    return COLOR_PALETTE[h % COLOR_PALETTE.length];
  }

  // Couleur d'ORIGINE (celle du jeu) d'un élément de la couche territoires. Après un
  // premier passage, l'attribut fill porte NOTRE couleur : sans cette mémoire, retirer un
  // choix laissait l'ancienne couleur choisie au lieu de revenir à celle du jeu. Si le jeu
  // repeint lui-même l'élément, sa nouvelle couleur redevient l'origine.
  function gameFill(el) {
    const cur = el.getAttribute("fill");
    const mine = el.getAttribute("data-aw-fill");
    if (mine && cur === mine) return el.getAttribute("data-aw-fill0") || cur;
    if (cur) el.setAttribute("data-aw-fill0", cur);
    el.removeAttribute("data-aw-fill");
    return cur;
  }
  function paintFill(el, color) {
    el.setAttribute("fill", color);
    el.setAttribute("data-aw-fill", color);
  }

  function recolorTerritories() {
    if (!territoryColorsEnabled) return;

    // Find the territories SVG layer
    // TerritoriesMapLayer creates an SVG container (not a div)
    const container = document.getElementById("container");
    if (!container) return;

    // The territories layer is an SVG inside mapContent's layer system
    const svgs = container.querySelectorAll("svg");
    let count = 0;

    svgs.forEach(svg => {
      const texts = svg.querySelectorAll("text");
      const circles = svg.querySelectorAll("circle");
      if (!texts.length || !circles.length) return;

      // Build list of territory text labels (alliance tags, not coordinate labels)
      const tagTexts = [];
      texts.forEach(txt => {
        const tag = (txt.textContent || "").trim().toUpperCase();
        // Skip coordinate labels like "(5/10)" and distance ring labels
        if (!tag || tag.match(/^\(.*\)$/) || tag.match(/^-?\d+\/-?\d+$/)) return;
        tagTexts.push({
          el: txt,
          tag: tag,
          x: parseFloat(txt.getAttribute("x")),
          y: parseFloat(txt.getAttribute("y")),
          origFill: gameFill(txt),
        });
      });

      if (!tagTexts.length) return;

      // For each text, find the circle that has the SAME original fill color
      // AND is close to the text position. This is reliable because the game
      // creates each circle+text pair with the same color.
      const usedCircles = new Set();

      tagTexts.forEach(tt => {
        // couleur du jeu par défaut : seule une couleur CHOISIE dans « Couleur par alliance » la remplace
        // (le menu range les tags en majuscules sans ponctuation)
        const color = allianceColors[tt.tag] || allianceColors[tt.tag.replace(/[^A-Z0-9]/g, "")]
          || tt.origFill || getColorForTag(tt.tag);

        // Recolor text
        paintFill(tt.el, color);

        // Find matching circle: same original color AND nearby
        let bestCircle = null;
        let bestDist = Infinity;

        circles.forEach(circle => {
          if (usedCircles.has(circle)) return;
          const cx = parseFloat(circle.getAttribute("cx"));
          const cy = parseFloat(circle.getAttribute("cy"));
          const r = parseFloat(circle.getAttribute("r")) || 0;

          // Skip non-territory circles (distance rings are large, origin is small)
          if (r < 5 || r > 200) return;

          const dist = Math.sqrt((cx - tt.x) ** 2 + (cy - tt.y) ** 2);

          // The text is at angle from center at distance radius+5
          // So max distance between circle center and text is roughly radius + 15
          if (dist < r + 20 && dist < bestDist) {
            // Check if fill color matches the text's original color
            const circleFill = (gameFill(circle) || "").toLowerCase();
            const textFill = (tt.origFill || "").toLowerCase();

            if (circleFill === textFill) {
              bestDist = dist;
              bestCircle = circle;
            }
          }
        });

        // Fallback: if no color match found, just take the closest unmatched circle
        if (!bestCircle) {
          bestDist = Infinity;
          circles.forEach(circle => {
            if (usedCircles.has(circle)) return;
            const r = parseFloat(circle.getAttribute("r")) || 0;
            if (r < 5 || r > 200) return;
            const cx = parseFloat(circle.getAttribute("cx"));
            const cy = parseFloat(circle.getAttribute("cy"));
            const dist = Math.sqrt((cx - tt.x) ** 2 + (cy - tt.y) ** 2);
            if (dist < r + 20 && dist < bestDist) {
              bestDist = dist;
              bestCircle = circle;
            }
          });
        }

        if (bestCircle) {
          paintFill(bestCircle, color);
          bestCircle.setAttribute("stroke", color);
          usedCircles.add(bestCircle);
          count++;
        }
      });
    });

    if (count > 0) {
      console.log(`[MAP ENHANCE] 🎨 Recolored ${count} territory zones`);
    }
  }

  function startTerritoryObserver() {
    if (territoryObserver) return;
    const container = document.getElementById("container");
    if (!container) return;

    territoryObserver = new MutationObserver(() => {
      if (territoryColorsEnabled) {
        setTimeout(recolorTerritories, 200);
      }
    });
    territoryObserver.observe(container, { childList: true, subtree: true });
  }

  function stopTerritoryObserver() {
    if (territoryObserver) {
      territoryObserver.disconnect();
      territoryObserver = null;
    }
  }

  // ========================================
  //   TERRITORY COLOR PICKER UI (in theme panel)
  // ========================================

  // ── Sélecteur de couleurs : UN SEUL, celui du dashboard ──────────────
  // Ce fichier proposait sa PROPRE liste de pickers dans
  // #aw-territory-colors-container, alimentée en cherchant "tag":"…" dans les
  // <script type="module"> de la page — détection cassée depuis que le jeu a
  // réécrit sa carte, et de toute façon jamais visible : le cockpit ne
  // re-parente pas ce conteneur dans ses Réglages.
  // Or les deux UI écrivaient dans LA MÊME clé de stockage (aw_alliance_colors) :
  // celle du dashboard (#aw-alliance-colors-container, « Couleurs des
  // alliances ») fait donc déjà le travail, et elle EST dans le cockpit.
  // On ne garde ici qu'un renvoi, pour l'ancien panneau thème flottant.
  function buildTerritoryColorUI() {
    const existing = document.getElementById("aw-territory-colors-container");
    if (!existing) return;
    existing.innerHTML =
      '<div style="color:rgba(255,255,255,0.45);font-size:0.8em;padding:8px;line-height:1.6;">' +
      "Choisis la couleur de chaque alliance dans <b>Couleurs des alliances</b> " +
      "(Réglages du cockpit) : elle s'applique à la légende AW <i>et</i> aux zones " +
      "de territoire de la carte du jeu." +
      "</div>";
  }

  // Repaint à la demande depuis content.js quand une couleur d'alliance change
  // (les deux fichiers partagent la clé aw_alliance_colors).
  window.AWMapEnhance = {
    recolorTerritories: function () {
      if (typeof chrome === "undefined" || !chrome.storage) return;
      chrome.storage.local.get([STORAGE_KEYS.allianceColors], (r) => {
        allianceColors = r[STORAGE_KEYS.allianceColors] || {};
        if (territoryColorsEnabled && isMapPage()) recolorTerritories();
      });
    },
  };

  // ========================================
  //   INIT
  // ========================================

  function isMapPage() {
    return /\/Game\/Map(\/|$|\?)/.test(location.pathname);
  }

  async function init() {
    await loadSettings();

    // (édition communauté : pas d'interface héritée à attendre)

    // Only run on map page
    if (!isMapPage()) return;

    const waitForRender = (attempts) => {
      if (attempts <= 0) return;
      if (document.querySelectorAll(".map-planet").length > 0) {
        setTimeout(() => {
          if (enabled) {
            replaceIcons();
            startObserver();
          }
          if (territoryColorsEnabled) {
            recolorTerritories();
            startTerritoryObserver();
          }
        }, 500);
      } else {
        setTimeout(() => waitForRender(attempts - 1), 300);
      }
    };

    waitForRender(30);
  }

  // Édition communauté : les réglages se font dans le panneau Apparence du
  // cockpit (chrome.storage) — on les applique en direct, sans recharger.
  function listenSettings() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local") return;
      if (ch[STORAGE_KEYS.mapIconsStyle]) {
        currentStyle = ch[STORAGE_KEYS.mapIconsStyle].newValue || "crosshair";
        if (enabled && isMapPage()) replaceIcons();
      }
      if (ch[STORAGE_KEYS.mapIconsEnabled]) {
        enabled = !!ch[STORAGE_KEYS.mapIconsEnabled].newValue;
        if (!isMapPage()) return;
        if (enabled) { replaceIcons(); startObserver(); }
        else { restoreIcons(); stopObserver(); }
      }
      if (ch[STORAGE_KEYS.territoryColorsEnabled]) {
        territoryColorsEnabled = !!ch[STORAGE_KEYS.territoryColorsEnabled].newValue;
        if (!isMapPage()) return;
        if (territoryColorsEnabled) { recolorTerritories(); startTerritoryObserver(); }
        else { stopTerritoryObserver(); location.reload(); } // couleurs d'origine du jeu
      }
    });
  }
  listenSettings();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 500);
  }
})();
