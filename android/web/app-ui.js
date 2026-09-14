/* AW Cockpit — app Android : le menu de l'extension (popup.html : langue, pseudo, apparence, alertes)
   s'ouvre dans une feuille par-dessus la page — bouton dans le rail — et l'écran de bienvenue
   s'affiche au premier lancement (l'extension l'ouvre dans un onglet à l'installation).
   Dernier morceau de idle.js. */
(function () {
  "use strict";
  var app = window.__awcApp;
  if (!app || window.top !== window) return;

  var TIP = {
    fr: "Menu de l'app : langue, pseudo, alertes",
    en: "App menu: language, name, alerts",
    es: "Menú de la app: idioma, nombre, alertas",
    de: "App-Menü: Sprache, Name, Warnungen",
  };
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
    '<path d="M4 7h9M17.5 7H20M4 17h3.5M12 17h8"/><circle cx="15.2" cy="7" r="2.3"/><circle cx="9.7" cy="17" r="2.3"/></svg>';

  function openMenu(welcome) {
    if (document.getElementById("awc-app-sheet")) return;
    var sheet = document.createElement("div");
    sheet.id = "awc-app-sheet";
    var frame = document.createElement("iframe");
    frame.src = app.base + "popup.html" + (welcome ? "?welcome=1" : "");
    frame.title = "AW Cockpit";
    sheet.appendChild(frame);
    document.body.appendChild(sheet);
    requestAnimationFrame(function () { sheet.classList.add("awc-in"); });
  }
  function closeMenu() {
    var sheet = document.getElementById("awc-app-sheet");
    if (sheet) sheet.remove();
  }
  app.openMenu = openMenu;
  app.closeMenu = closeMenu;

  function paintTip(b, lang) {
    var tip = TIP[lang] || TIP.fr;
    b.dataset.tip = tip;
    b.setAttribute("aria-label", tip);
  }
  function railButton() {
    var rail = document.getElementById("awc-rail");
    if (!rail) return false;
    if (document.getElementById("awc-app-menu")) return true;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "awc-app-menu";
    b.className = "awc-rail-btn";
    b.innerHTML = ICON;
    paintTip(b, "fr");
    chrome.storage.local.get("aw_language", function (r) { paintTip(b, r && r.aw_language); });
    chrome.storage.onChanged.addListener(function (ch) { if (ch.aw_language) paintTip(b, ch.aw_language.newValue); });
    b.addEventListener("click", function () { openMenu(false); });
    rail.insertBefore(b, rail.querySelector(".awc-rail-spacer"));
    return true;
  }
  /* le rail est construit par cockpit.js après lecture des réglages (asynchrone) */
  if (!railButton()) {
    var mo = new MutationObserver(function () { if (railButton()) mo.disconnect(); });
    mo.observe(document.body || document.documentElement, { childList: true });
    setTimeout(function () { mo.disconnect(); }, 20000);
  }

  /* premier lancement : bienvenue une seule fois, comme l'onglet ouvert par l'extension à l'installation */
  chrome.storage.local.get("aw_welcome_done", function (r) {
    if (r && r.aw_welcome_done) return;
    chrome.storage.local.set({ aw_welcome_done: true });
    openMenu(true);
  });
})();
