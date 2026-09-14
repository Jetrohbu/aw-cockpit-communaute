/* ═══════════════════════════════════════════════════════════════
   AW Cockpit — app Android : document_start
   Modèle assemblé par build_apk.py → assets/web/early.js, injecté par
   WebViewCompat.addDocumentStartJavaScript avant tout script de la page :
   pont chrome.* (app-shim.js), feuilles de style, reskin-early.js, puis
   chargement des scripts document_idle (/__awc/idle.js).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (window.__awcEarly) return;
  window.__awcEarly = true;
  var doc = document, root = doc.documentElement;
  if (!root || !/html/i.test(doc.contentType || "text/html")) return;

  /*@@SHIM@@*/

  /* menu de l'app (iframe /__awc/popup.html) ou iframe du jeu : le pont suffit */
  if (location.pathname.indexOf("/__awc/") === 0 || window.top !== window) return;

  var V = "@@VERSION@@";
  function nativeEval(what) { try { window.__awcApp.send({ op: "eval", what: what }); } catch (e) { /* ignore */ } }

  /* CSS de l'extension + réglages de l'app. blocking="render" : le premier rendu attend la feuille
     (lue dans l'APK, quelques ms), comme les CSS d'une extension — la page d'origine ne flashe pas. */
  var link = doc.createElement("link");
  link.rel = "stylesheet";
  link.id = "awc-app-css";
  link.href = "/__awc/app.css?v=" + V;
  link.setAttribute("blocking", "render");
  link.onerror = function () { nativeEval("css"); };
  (doc.head || root).appendChild(link);

  try {
    /*@@RESKIN_EARLY@@*/
  } catch (e) {
    console.warn("[AWC] reskin-early.js", e);
  }

  function idle() {
    var s = doc.createElement("script");
    s.src = "/__awc/idle.js?v=" + V;
    s.async = false;
    s.onerror = function () { nativeEval("idle"); };
    (doc.head || doc.documentElement).appendChild(s);
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", idle, { once: true });
  else idle();
})();
