/* AW Cockpit — app Android : popup.html ouvert dans la feuille du menu de l'app.
   Chargé par popup.html (version APK) entre popup-i18n.js et popup.js. */
(function () {
  "use strict";
  document.documentElement.classList.add("awc-app");

  /* textes qui parlent de l'extension ou du navigateur */
  var D = window.AW_POPUP_I18N || {};
  var O = {
    fr: {
      welcome_lead: "Deux réglages et l'app est prête : ta langue et ton pseudo AstroWars.",
      privacy_line: "Aucun compte, rien n'est envoyé : tes réglages restent sur ton téléphone (seule lecture : la dernière version sur GitHub, 1×/jour).",
    },
    en: { privacy_line: "No account, nothing is sent: your settings stay on your phone (only read: the latest version on GitHub, once a day)." },
    es: { privacy_line: "Sin cuenta, no se envía nada: tus ajustes se quedan en tu teléfono (única lectura: la última versión en GitHub, 1 vez al día)." },
    de: { privacy_line: "Kein Konto, nichts wird gesendet: deine Einstellungen bleiben auf deinem Handy (einzige Abfrage: neueste Version auf GitHub, 1× täglich)." },
  };
  Object.keys(O).forEach(function (l) { if (D[l]) Object.assign(D[l], O[l]); });

  function close() { try { window.top.__awcApp.closeMenu(); } catch (e) { /* aperçu hors app */ } }

  /* premier lancement : choisir la langue AVANT l'écran de bienvenue (langue jamais enregistrée) */
  var LANGS = [["fr", "Français", "FR"], ["en", "English", "EN"], ["es", "Español", "ES"], ["de", "Deutsch", "DE"]];
  function langStep() {
    var box = document.createElement("section");
    box.id = "awc-lang-step";
    var nav = String(navigator.language || "").slice(0, 2).toLowerCase();
    box.innerHTML =
      '<img class="awc-ls-logo" src="assets/astrowars-logo-rail.png" alt="">' +
      '<h1>AW Cockpit</h1>' +
      '<p class="awc-ls-sub" translate="no">Choisis ta langue · Choose your language<br>Elige tu idioma · Wähle deine Sprache</p>' +
      '<div class="awc-ls-grid" translate="no">' + LANGS.map(function (l) {
        return '<button type="button" lang="' + l[0] + '" data-pick="' + l[0] + '"' + (l[0] === nav ? ' class="awc-ls-sug"' : "") +
          '><b>' + l[1] + '</b><small>' + l[2] + '</small></button>';
      }).join("") + "</div>";
    document.querySelector(".app").prepend(box);
    document.documentElement.classList.add("awc-langstep");
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pick]");
      if (!b) return;
      var sw = document.querySelector('.langs [data-lang="' + b.dataset.pick + '"]');
      if (sw) sw.click();                        // popup.js enregistre la langue et retraduit l'accueil
      document.documentElement.classList.remove("awc-langstep");
      box.remove();
      /* popup.js place le curseur dans le pseudo : au téléphone le clavier masquerait l'accueil */
      setTimeout(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }, 150);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (new URLSearchParams(location.search).get("welcome") === "1") {
      chrome.storage.local.get("aw_language", function (r) { if (!(r && r.aw_language)) langStep(); });
    }
    var x = document.createElement("button");
    x.type = "button";
    x.className = "awc-app-x";
    x.setAttribute("aria-label", "×");
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>';
    x.addEventListener("click", close);
    document.body.appendChild(x);
    /* toucher à côté de la carte : fermer */
    document.body.addEventListener("click", function (e) { if (e.target === document.body) close(); });
  });
})();
