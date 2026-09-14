/* ═══════════════════════════════════════════════════════════════
   AW Cockpit — app Android (édition communauté) : les API chrome.* de l'extension
   Chargé au document_start dans toutes les frames https://astrowars.games (early.js),
   et par popup.html (menu de l'app, dans son iframe).
   ⚠ Dans une WebView il n'y a pas de « monde isolé » : les scripts de l'extension
   tournent dans la page. Ce fichier ne pose que window.chrome et window.__awc*.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.__awcApp) return;

  var VERSION = "@@VERSION@@";
  var BASE = location.origin + "/__awc/";
  var P = "awc:";                                  // préfixe des clés chrome.storage dans localStorage
  var app = window.__awcApp = { version: VERSION, base: BASE, android: true };
  var inAwcFrame = location.pathname.indexOf("/__awc/") === 0;

  /* ── pont natif : WebViewCompat.addWebMessageListener (« AWCNative »), repli addJavascriptInterface ── */
  var waiting = {}, seq = 0, hooked = false;
  function onNative(data) {
    var m;
    try { m = typeof data === "string" ? JSON.parse(data) : data; } catch (e) { return; }
    var cb = m && m.id && waiting[m.id];
    if (cb) { delete waiting[m.id]; cb(m); }
  }
  window.__awcNativeMsg = onNative;
  function send(msg) {
    var s = JSON.stringify(msg);
    try {
      var N = window.AWCNative;
      if (N && typeof N.postMessage === "function") {
        if (!hooked) { hooked = true; N.onmessage = function (ev) { onNative(ev.data); }; }
        N.postMessage(s);
        return true;
      }
      if (window.AWCNativeJ && typeof window.AWCNativeJ.postMessage === "function") { window.AWCNativeJ.postMessage(s); return true; }
    } catch (e) { /* pont absent : aperçu dans un navigateur */ }
    return false;
  }
  function ask(msg, ms) {
    return new Promise(function (res) {
      var id = "q" + (++seq) + "." + Date.now();
      msg.id = id;
      var timer = setTimeout(function () { if (waiting[id]) { delete waiting[id]; res(null); } }, ms || 20000);
      waiting[id] = function (m) { clearTimeout(timer); res(m); };
      if (!send(msg)) { clearTimeout(timer); delete waiting[id]; res(null); }
    });
  }
  app.send = send;
  app.ask = ask;

  /* ── chrome.storage.local sur localStorage ── */
  var listeners = [];
  function store() { try { return window.localStorage; } catch (e) { return null; } }
  function readRaw(k) { var s = store(); try { return s ? s.getItem(P + k) : null; } catch (e) { return null; } }
  function parse(raw) { if (raw === null || raw === undefined) return undefined; try { return JSON.parse(raw); } catch (e) { return undefined; } }
  function allKeys() {
    var s = store(), out = [];
    try { for (var i = 0; s && i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(P) === 0) out.push(k.slice(P.length)); } } catch (e) { /* ignore */ }
    return out;
  }
  function fire(changes) {
    if (!Object.keys(changes).length) return;
    setTimeout(function () {
      listeners.slice().forEach(function (fn) {
        try { fn(changes, "local"); } catch (e) { console.warn("[AWC] storage.onChanged", e); }
      });
    }, 0);
  }
  /* comme l'API Chrome : rappel asynchrone s'il y en a un, promesse sinon */
  function done(cb, val) {
    if (typeof cb === "function") { setTimeout(function () { cb(val); }, 0); return undefined; }
    return Promise.resolve(val);
  }
  var local = {
    get: function (keys, cb) {
      if (typeof keys === "function") { cb = keys; keys = null; }
      var out = {}, list;
      if (keys === null || keys === undefined) list = allKeys();
      else if (typeof keys === "string") list = [keys];
      else if (Array.isArray(keys)) list = keys;
      else { list = Object.keys(keys); list.forEach(function (k) { out[k] = keys[k]; }); }
      list.forEach(function (k) { var v = parse(readRaw(k)); if (v !== undefined) out[k] = v; });
      return done(cb, out);
    },
    set: function (items, cb) {
      var s = store(), changes = {};
      Object.keys(items || {}).forEach(function (k) {
        var json;
        try { json = JSON.stringify(items[k]); } catch (e) { return; }
        if (json === undefined) return;
        var old = readRaw(k);
        if (old === json) return;                    // valeur identique : Chrome ne notifie pas non plus
        try { s.setItem(P + k, json); } catch (e) { console.warn("[AWC] stockage plein, clé ignorée :", k); return; }
        changes[k] = { newValue: JSON.parse(json) };
        if (old !== null) changes[k].oldValue = parse(old);
      });
      fire(changes);
      return done(cb);
    },
    remove: function (keys, cb) {
      var s = store(), changes = {};
      (typeof keys === "string" ? [keys] : (keys || [])).forEach(function (k) {
        var old = readRaw(k);
        if (old === null) return;
        try { s.removeItem(P + k); } catch (e) { return; }
        changes[k] = { oldValue: parse(old) };
      });
      fire(changes);
      return done(cb);
    },
    clear: function (cb) { return local.remove(allKeys(), cb); },
    getBytesInUse: function (keys, cb) { if (typeof keys === "function") cb = keys; return done(cb, 0); },
  };
  var onChanged = {
    addListener: function (fn) { if (typeof fn === "function" && listeners.indexOf(fn) < 0) listeners.push(fn); },
    removeListener: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    hasListener: function (fn) { return listeners.indexOf(fn) >= 0; },
  };
  /* changement fait par un autre document de la même origine (le menu de l'app, dans son iframe) */
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key.indexOf(P) !== 0) return;
    var k = e.key.slice(P.length), ch = {};
    ch[k] = {};
    if (e.oldValue !== null) ch[k].oldValue = parse(e.oldValue);
    if (e.newValue !== null) ch[k].newValue = parse(e.newValue);
    fire(ch);
  });

  /* ── mise à jour : dernière Release GitHub (même contrat que background.js, APK au lieu des ZIP) ── */
  var REPO = "Jetrohbu/aw-cockpit-communaute", CHECK_KEY = "aw_update_check", APK = "aw-cockpit-communaute.apk";
  var DAY = 24 * 3600 * 1000, RETRY = 3600 * 1000, running = null;
  function kv(k, v) { var o = {}; o[k] = v; return o; }
  function getJson(url) {
    return ask({ op: "http", url: url }).then(function (r) {
      if (!r || r.status !== 200 || typeof r.body !== "string") throw new Error("HTTP " + (r ? r.status : "hors app"));
      return JSON.parse(r.body);
    });
  }
  function doCheck(force) {
    return local.get(CHECK_KEY).then(function (st) {
      var prev = st[CHECK_KEY] || {};
      if (!force && prev.next && Date.now() < prev.next) return prev;
      return getJson("https://api.github.com/repos/" + REPO + "/releases/latest").then(function (rel) {
        var tag = String(rel.tag_name || ""), version = tag.replace(/^v/i, "");
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("tag " + tag);
        var a = (rel.assets || []).filter(function (x) { return x.name === APK; })[0];
        var apk = (a && a.browser_download_url) || null;
        return getJson("https://raw.githubusercontent.com/" + REPO + "/" + encodeURIComponent(tag) + "/site/aw-cockpit-communaute/version.json")
          .then(function (j) { return (j.releases || []).filter(function (x) { return x.version === version; })[0] || null; },
                function () { return null; })
          .then(function (notes) {
            var out = { at: Date.now(), next: Date.now() + DAY, error: null, latest: null };
            /* Release sans APK (version pour navigateurs seulement) : rien à proposer à l'app */
            if (apk) {
              out.latest = { version: version, page: rel.html_url || null, date: rel.published_at || null,
                             apk: apk, zip: apk, zip_chrome: apk, zip_firefox: apk, notes: notes };
            }
            return local.set(kv(CHECK_KEY, out)).then(function () { return out; });
          });
      }).catch(function (e) {
        var out = Object.assign({}, prev, { at: Date.now(), next: Date.now() + RETRY, error: String((e && e.message) || e) });
        return local.set(kv(CHECK_KEY, out)).then(function () { return out; });
      });
    });
  }
  function updateCheck(force) {
    if (!running) {
      running = doCheck(force).then(function (r) { running = null; return r; }, function () { running = null; return null; });
    }
    return running;
  }
  app.updateCheck = updateCheck;

  /* ── liens : le jeu reste dans l'app, le reste part dans le navigateur ── */
  function openUrl(url) {
    if (!url) return;
    var u;
    try { u = new URL(url, location.href); } catch (e) { return; }
    if (u.origin === location.origin && u.pathname.indexOf("/__awc/") !== 0) {
      var top = window.top;
      if (top !== window) {
        /* depuis le menu de l'app : on le ferme ; on ne quitte la page que si elle n'est pas déjà dans le jeu */
        try { top.__awcApp.closeMenu(); } catch (e) { /* ignore */ }
        if (/^\/(Game|Identity)\//i.test(top.location.pathname)) return;
      }
      top.location.href = u.href;
      return;
    }
    send({ op: "open", url: u.href });
  }
  app.openUrl = openUrl;
  var nativeOpen = window.open;
  window.open = function (url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) { send({ op: "open", url: u.href }); return null; }
    } catch (e) { /* URL illisible : comportement normal */ }
    return nativeOpen.apply(window, arguments);
  };
  if (inAwcFrame && window.top !== window) {
    window.close = function () { try { window.top.__awcApp.closeMenu(); } catch (e) { /* ignore */ } };
  }

  /* ── window.chrome ── */
  function noEvent() { return { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } }; }
  try {
    var C = window.chrome && typeof window.chrome === "object" ? window.chrome : (window.chrome = {});
    C.storage = { local: local, sync: local, onChanged: onChanged };
    C.runtime = {
      id: "aw-cockpit-android",
      lastError: undefined,
      getURL: function (p) { return BASE + String(p || "").replace(/^\/+/, ""); },
      getManifest: function () {
        return { manifest_version: 3, name: "AW Cockpit — Édition communauté", short_name: "AW Cockpit", version: VERSION };
      },
      sendMessage: function (msg, cb) {
        if (typeof msg === "string") { msg = cb; cb = arguments[2]; }     // forme (extensionId, message, rappel)
        var p = msg && msg.type === "awcc_update_check" ? updateCheck(!!msg.force) : Promise.resolve(undefined);
        if (typeof cb === "function") { p.then(function (r) { cb(r); }, function () { cb(undefined); }); return undefined; }
        return p;
      },
      onMessage: noEvent(), onInstalled: noEvent(), onStartup: noEvent(),
    };
    C.tabs = { create: function (o, cb) { openUrl(o && o.url); return done(cb); } };
  } catch (e) {
    console.warn("[AWC] window.chrome non modifiable", e);
  }

  if (inAwcFrame || window.top !== window) return;

  /* ── après une mise à jour de l'app : la carte « quoi de neuf » (même drapeau que background.js) ── */
  try {
    var seen = readRaw("awc_app_version");
    if (seen !== JSON.stringify(VERSION)) {
      if (seen !== null) local.set({ aw_pending_update_toast: VERSION });
      local.set({ awc_app_version: VERSION });
    }
  } catch (e) { /* ignore */ }

  /* ── au doigt, le jeu annule touchstart sur certaines pages : Android ne produit alors AUCUN click.
        On le rejoue sur les commandes du cockpit (préfixes awc- / aw3d- / aw-), jamais sur la carte
        ni sur les éléments du jeu. <html> porte lui-même des classes awc-* : on s'arrête avant. ── */
  var CTRL = "button,a[href],[role=button],[role=tab],[role=switch],input,select,textarea,label,summary";
  function cockpitControl(el) {
    var c = el && el.closest ? el.closest(CTRL) : null;
    for (var n = c; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var id = n.id || "", cls = typeof n.className === "string" ? n.className : "";
      if (/^aw(c|3d)?-/.test(id) || /(^|\s)aw(c|3d)?-/.test(cls)) return c;
    }
    return null;
  }
  var touch = null;
  document.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { touch = null; return; }
    var t = e.touches[0];
    touch = { ev: e, x: t.clientX, y: t.clientY, at: Date.now(), target: e.target };
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!touch || !e.touches.length) return;
    var t = e.touches[0];
    if (Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y) > 12) touch = null;
  }, { capture: true, passive: true });
  document.addEventListener("touchend", function (e) {
    var s = touch;
    touch = null;
    if (!s || Date.now() - s.at > 700 || !e.changedTouches.length) return;
    var pt = e.changedTouches[0];
    setTimeout(function () {                         // après tous les écouteurs : defaultPrevented définitif
      if (!s.ev.defaultPrevented && !e.defaultPrevented) return;       // le navigateur produira son click
      var el = cockpitControl(s.target && s.target.nodeType === 1 ? s.target : s.target && s.target.parentElement);
      if (!el) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { try { el.focus(); } catch (x) { /* ignore */ } }
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window,
        clientX: pt.clientX, clientY: pt.clientY, screenX: pt.screenX, screenY: pt.screenY }));
    }, 0);
  }, { capture: true, passive: true });

  /* ── bouton retour d'Android : d'abord ce qui est ouvert par-dessus la page ── */
  window.__awcBack = function () {
    if (document.getElementById("awc-app-sheet")) { if (app.closeMenu) app.closeMenu(); return true; }
    var uh = document.querySelector("#awc-uh-backdrop .awc-uh-x");
    if (uh) { uh.click(); return true; }
    var toast = document.querySelector("#awc-update-toast .awc-toast-x");
    if (toast) { toast.click(); return true; }
    if (document.querySelector(".aw3d-full")) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
    var close = document.documentElement.classList.contains("awc-open") && document.getElementById("awc-close");
    if (close) { close.click(); return true; }
    return false;
  };
})();
