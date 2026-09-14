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
  document.addEventListener("DOMContentLoaded", function () {
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
