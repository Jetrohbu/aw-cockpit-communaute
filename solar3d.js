// ── AW Solar 3D ──────────────────────────────────────────────────────────
// Vue 3D d'un système sur /Game/Map/SolarSystem/{id} : soleil plasma
// procédural (protubérances animées), planètes TEXTURÉES (pack Solar System
// Scope, CC BY 4.0, dans assets/planets/) éclairées par l'étoile : jour/nuit,
// nuages, villes la nuit selon la pop, anneaux de géantes, atmosphère au
// limbe, planètes libres = mondes morts — archétype tiré d'une graine stable
// par planète, teinte au type de monde ou au niveau de pop comme les icônes,
// 12 orbites en « horloge », orbite colorée au propriétaire, planètes
// surélevées au-dessus de l'anneau. Données = le tableau #solarSystem de la
// page elle-même (zéro requête au jeu).
(function () {
  "use strict";
  const M = location.pathname.match(/^\/Game\/Map\/SolarSystem\/(\d+)/);
  if (!M) return;
  // L'app Android réinjecte ses scripts plusieurs fois par page (onPageFinished,
  // doUpdateVisitedHistory, puis des relances différées) : sans ce garde on
  // empilerait un panneau et un contexte WebGL par injection. Se baser sur le
  // DOM plutôt que sur un drapeau global le remet à zéro tout seul quand la
  // navigation SPA change de système.
  if (document.getElementById("aw-s3d")) return;
  const SYSTEM_ID = parseInt(M[1], 10);

  /* Pointeur grossier ou petit écran : on allège tout ce qui coûte du GPU.
     Un tampon 2560×430 à densité 2 fait 4,4 Mpx — de quoi faire refuser la
     création du contexte quand la mémoire graphique est déjà sollicitée. */
  let MOBILE = false;
  try { MOBILE = matchMedia("(pointer:coarse)").matches; } catch (e) {}
  MOBILE = MOBILE || Math.min(window.innerWidth, window.innerHeight) < 700;

  /* Mode de couleur des planètes, mémorisé. « type » par défaut : la couleur
     vient de la matière du monde (rendu des références). « pop » : la teinte
     encode le niveau de population, comme les icônes de la carte.
     Au niveau du module : le bouton de l'en-tête le lit hors de start(). */
  let colorMode = "type";
  try { colorMode = localStorage.getItem("aw_s3d_colormode") || "type"; } catch (e) {}

  // ── Scrape du tableau de la page ───────────────────────────────────────
  function parsePlanets() {
    const rows = document.querySelectorAll("#solarSystem tr");
    const planets = [];
    rows.forEach((tr) => {
      if (tr.classList.contains("collapse") || tr.classList.contains("head")) return;
      const tds = tr.querySelectorAll("td");
      if (tds.length < 4) return;
      const idx = parseInt(tds[0].textContent.trim(), 10);
      if (!idx || idx > 12) return;
      const popTxt = tds[1].textContent.trim();
      const sbTxt = tds[2].textContent.trim();
      let owner = tds[3].textContent.trim().replace(/\s+/g, " ");
      const hasFleet = /🚀/.test(owner);
      owner = owner.replace(/🚀/g, "").trim();
      let tag = "";
      const mt = owner.match(/\[([^\]]{1,8})\]\s*$/);
      if (mt) { tag = mt[1]; owner = owner.replace(/\[[^\]]{1,8}\]\s*$/, "").trim(); }
      const profile = tds[3].querySelector('a[href*="/Profile/"]');
      let planetId = null;
      const fl = tr.querySelector('a[href^=".fleetsPlanet"], a[data-bs-target^=".fleetsPlanet"]');
      const flTxt = (fl && (fl.getAttribute("href") || fl.getAttribute("data-bs-target"))) || "";
      const mid = flTxt.match(/fleetsPlanet(\d+)/);
      if (mid) planetId = mid[1];
      planets.push({
        idx: idx,
        pop: /^\d+$/.test(popTxt) ? parseInt(popTxt, 10) : 0,
        popUnknown: !/^\d+$/.test(popTxt),
        sb: /^\d+$/.test(sbTxt) ? parseInt(sbTxt, 10) : 0,
        owner: owner, tag: tag,
        free: /^(Free Planet|Planète libre)$/i.test(owner),
        unknown: /^(Unknown|Inconnu)$/i.test(owner),
        mine: tr.classList.contains("owner"),
        fleet: hasFleet,
        profileHref: profile ? profile.getAttribute("href") : null,
        planetId: planetId,
      });
    });
    return planets;
  }

  function tagColor(tag) {
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ",68%,62%)";
  }
  function cssToHex(c) {
    const cv = document.createElement("canvas").getContext("2d");
    cv.fillStyle = c; return cv.fillStyle;
  }

  // ── Panneau ────────────────────────────────────────────────────────────
  const table = document.querySelector("#solarSystem");
  if (!table) return;
  const host = table.closest("table") || table;

  const wrap = document.createElement("div");
  wrap.id = "aw-s3d";
  const collapsed = (function () {
    try { return localStorage.getItem("aw_s3d_collapsed") === "1"; } catch (e) { return false; }
  })();
  const title = (document.title.match(/Astro Wars\s*-\s*(.+)$/) || [, "Système " + SYSTEM_ID])[1];
  wrap.innerHTML =
    '<div class="aw-s3d-head">' +
      '<span class="aw-s3d-title">🪐 ' + title.replace(/</g, "&lt;") + " — vue 3D</span>" +
      '<span class="aw-s3d-actions">' +
        '<button type="button" class="aw-s3d-color" title="La couleur des planètes indique leur type de monde, ou leur niveau de population"></button>' +
        '<button type="button" class="aw-s3d-toggle">' + (collapsed ? "Afficher" : "Réduire") + "</button>" +
      "</span>" +
    "</div>" +
    '<div class="aw-s3d-body"' + (collapsed ? ' style="display:none"' : "") + ">" +
      '<canvas class="aw-s3d-canvas"></canvas>' +
      '<div class="aw-s3d-tip" style="display:none"></div>' +
      '<div class="aw-s3d-hint">glisser : pivoter · molette : zoom · clic planète : ouvrir · textures : Solar System Scope (CC BY 4.0)</div>' +
    "</div>";
  const st = document.createElement("style");
  st.textContent = [
    "#aw-s3d{margin:10px 0 14px;border:1px solid rgba(120,140,190,.25);border-radius:10px;",
    "  background:#04050c;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;}",
    "#aw-s3d .aw-s3d-head{display:flex;align-items:center;justify-content:space-between;",
    "  padding:7px 12px;background:rgba(16,20,38,.85);border-bottom:1px solid rgba(120,140,190,.18);}",
    "#aw-s3d .aw-s3d-title{color:#dfe6ff;font-size:.82rem;letter-spacing:.05em;text-transform:uppercase;}",
    "#aw-s3d .aw-s3d-actions{display:flex;gap:6px;align-items:center;}",
    "#aw-s3d .aw-s3d-toggle,#aw-s3d .aw-s3d-color{cursor:pointer;font-size:.72rem;padding:3px 10px;",
    "  border-radius:4px;touch-action:manipulation;",
    "  border:1px solid rgba(140,160,220,.35);background:rgba(30,38,66,.6);color:#c8d2f0;}",
    "@media (pointer:coarse){#aw-s3d .aw-s3d-toggle,#aw-s3d .aw-s3d-color{padding:8px 12px;min-height:38px;}}",
    /* en portrait mobile 430 px mangent tout l'écran : on borne au viewport */
    "#aw-s3d .aw-s3d-body{position:relative;height:430px;max-height:60vh;}",
    /* Au doigt, compromis : 250 px rendaient les planètes trop petites pour
       qu'on y voie quoi que ce soit. 320 px laissent de la surface au rendu
       tout en gardant le tableau accessible sans défiler. */
    "@media (pointer:coarse){#aw-s3d .aw-s3d-body{height:320px;max-height:46vh;}}",
    /* touch-action:none — sans ça, dans l'app Android, le glissé part dans le
       scroll de la page et le pincement zoome toute la WebView */
    "#aw-s3d .aw-s3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;",
    "  cursor:grab;touch-action:none;}",
    "#aw-s3d .aw-s3d-canvas.drag{cursor:grabbing;}",
    "#aw-s3d .aw-s3d-tip{position:absolute;pointer-events:none;z-index:5;background:rgba(8,11,24,.94);",
    "  border:1px solid rgba(140,160,220,.4);border-radius:7px;padding:7px 10px;color:#eef2ff;",
    "  font-size:.78rem;line-height:1.45;max-width:230px;box-shadow:0 4px 18px rgba(0,0,0,.5);}",
    "#aw-s3d .aw-s3d-hint{position:absolute;right:10px;bottom:7px;color:rgba(190,200,235,.4);",
    "  font-size:.68rem;pointer-events:none;}",
  ].join("\n");
  document.head.appendChild(st);
  host.parentNode.insertBefore(wrap, host);

  const btn = wrap.querySelector(".aw-s3d-toggle");
  const body = wrap.querySelector(".aw-s3d-body");

  /* click ne suffit pas dans l'app : un script de la page annule touchstart,
     donc Android ne synthétise jamais de click. On câble aussi pointerup. */
  function onTap(el, fn) {
    if (!el) return;
    let t0 = 0, x0 = 0, y0 = 0, done = 0;
    el.addEventListener("pointerdown", (e) => { t0 = Date.now(); x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      if (Date.now() - t0 > 700) return;
      if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12) return;
      done = Date.now();
      fn(e);
    });
    el.addEventListener("click", (e) => {
      if (Date.now() - done < 700) return;
      fn(e);
    });
  }

  /* Toute panne dure se dit à l'écran : un panneau noir muet ne se diagnostique
     pas, et c'est exactement ce qu'on avait sur un contexte WebGL refusé. */
  function fatal(txt) {
    body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;' +
      'height:100%;color:#8f9ac0;font-size:.82rem;text-align:center;padding:0 18px;' +
      'line-height:1.5">' + txt + "</div>";
  }
  let started = false;
  /* Bascule de couleur : rechargement de la page plutôt que reconstruction de
     la scène. Les matériaux, les graines et les archétypes sont figés à la
     construction ; tout refaire à chaud demanderait de démonter proprement
     douze matériaux, leurs couches (nuages, atmosphère, anneaux) et leurs
     textures, pour un réglage qu'on change deux fois dans sa vie. */
  const colorBtn = wrap.querySelector(".aw-s3d-color");
  function paintColorBtn() {
    colorBtn.textContent = colorMode === "type" ? "Couleur : type" : "Couleur : pop";
  }
  paintColorBtn();
  onTap(colorBtn, () => {
    colorMode = colorMode === "type" ? "pop" : "type";
    try { localStorage.setItem("aw_s3d_colormode", colorMode); } catch (e) {}
    paintColorBtn();
    location.reload();
  });

  onTap(btn, () => {
    const hide = body.style.display !== "none";
    body.style.display = hide ? "none" : "";
    btn.textContent = hide ? "Afficher" : "Réduire";
    try { localStorage.setItem("aw_s3d_collapsed", hide ? "1" : "0"); } catch (e) {}
    if (!hide && !started) start();
  });

  if (!collapsed) start();

  // ── Scène three.js ─────────────────────────────────────────────────────
  async function start() {
    if (started) return; started = true;
    const T_START = performance.now();
    const since = () => Math.round(performance.now() - T_START) + " ms";
    // three.js : dans l'app Android il est déjà là (bundle IIFE global injecté
    // avant nous) ; dans l'extension PC on l'importe depuis ses propres fichiers
    // (la CSP du jeu interdit tout CDN). Un seul source pour les deux mondes.
    let T = window.THREE || null;
    if (!T) {
      try { T = await import(chrome.runtime.getURL("vendor/three.module.min.js")); }
      catch (e) {
        // Échouer en silence donnait un panneau noir sans explication :
        // on le dit à l'écran, sinon le premier retour est « la 3D est noire ».
        console.warn("[AW-S3D] three KO:", e);
        fatal("Vue 3D indisponible : three.js n'a pas pu être chargé.");
        return;
      }
    }

    console.log("[AW-S3D] three importé à " + since());
    const planets = parsePlanets();
    let colors = {}, gameColors = {}, sysLevels = {};
    await new Promise((res) => {
      try {
        chrome.storage.local.get(["aw_alliance_colors", "aw3d_game_colors", "aw_system_levels"], (r) => {
          colors = r.aw_alliance_colors || {};
          gameColors = r.aw3d_game_colors || {};
          sysLevels = r.aw_system_levels || {};
          res();
        });
      } catch (e) { res(); }
    });

    const canvas = wrap.querySelector(".aw-s3d-canvas");
    const tip = wrap.querySelector(".aw-s3d-tip");
    // Création du contexte : sur mobile elle ÉCHOUE si la mémoire GPU est
    // saturée (plusieurs contextes vivants, tampon trop grand). On sacrifie
    // l'antialiasing et on plafonne la densité de pixels — un tampon en
    // 2560×430 à ratio 2, c'est 4,4 Mpx pour un panneau de 430 px de haut.
    let renderer;
    try {
      renderer = new T.WebGLRenderer({
        canvas: canvas,
        antialias: !MOBILE,
        alpha: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
    } catch (e) {
      console.warn("[AW-S3D] contexte WebGL refusé:", e);
      fatal("Vue 3D indisponible : le contexte graphique n'a pas pu être créé. " +
            "Ferme les autres onglets 3D ou relance l'application.");
      return;
    }
    if (!renderer.getContext()) {
      fatal("Vue 3D indisponible : contexte graphique absent.");
      return;
    }
    /* La netteté est le premier facteur de « détail » perçu : les textures
       sont identiques sur mobile et sur PC, seule la résolution changeait.
       1,4 rendait la surface visiblement floue — on remonte près du PC, ce que
       la libération des contextes (pagehide) permet maintenant. */
    renderer.setPixelRatio(Math.min(MOBILE ? 1.9 : 2, window.devicePixelRatio || 1));
    // Un contexte perdu (mise en veille, app en arrière-plan, pression mémoire)
    // laissait un canvas mort et silencieux : on le dit, et on arrête la boucle
    // au lieu de marteler un contexte invalide.
    let ctxLost = false;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      ctxLost = true;
      fatal("Contexte 3D perdu. Rouvre la page pour le rétablir.");
    }, false);
    const scene = new T.Scene();
    scene.background = new T.Color(0x04050c);
    const camera = new T.PerspectiveCamera(46, 2, 0.1, 900);
    /* Un T.Points SANS map est dessiné en CARRÉS (gl_PointSize) : les grains
       lointains passent pour des pixels, mais dès qu'un point s'approche de la
       caméra on voit un franc carré blanc en plein ciel. Tous les nuages de
       points partagent donc ce petit disque. */
    let DOT_TEX = null;
    function dotTex() {
      if (!DOT_TEX) DOT_TEX = radialTex("rgba(255,255,255,1)", "rgba(255,255,255,0)");
      return DOT_TEX;
    }
    const group = new T.Group();
    scene.add(group);

    // étoiles de fond
    (function stars() {
      const n = 420, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 60 + Math.random() * 90, a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI;
        pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
        pos[i * 3 + 1] = Math.sin(e) * r * 0.6;
        pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos, 3));
      /* étoiles opaques : à 0,7 d'opacité elles étaient délavées sur le fond */
      scene.add(new T.Points(g, new T.PointsMaterial({
        color: 0x8899cc, size: 0.35, map: dotTex(), transparent: true, depthWrite: false,
      })));
    })();

    function radialTex(inner, outer) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const x = c.getContext("2d");
      const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
      g.addColorStop(0, inner); g.addColorStop(1, outer);
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(c);
    }

    // ── textures du pack (assets/planets/, Solar System Scope CC BY 4.0) ──
    // Un chargement par fichier, partagé entre toutes les planètes qui s'en
    // servent. ImageBitmapLoader = fetch → ImageBitmap : ça passe par le
    // réseau de l'extension, insensible à la CSP img-src de la page (un <img>
    // vers chrome-extension:// peut y être refusé) ; TextureLoader en repli.
    // Le bitmap est retourné à la création (imageOrientation flipY) parce que
    // UNPACK_FLIP_Y_WEBGL est ignoré sur les ImageBitmap — d'où flipY=false.
    // ⚠ setOptions REMPLACE l'objet d'options du loader (r160) : il faut
    // redire le premultiplyAlpha:"none" que posait le constructeur, sinon le
    // RGB de ring_alpha.png est multiplié par son alpha au décodage PUIS par
    // le blending de three — zones translucides deux fois trop sombres
    // (UNPACK_PREMULTIPLY_ALPHA_WEBGL est ignoré lui aussi sur un bitmap).
    // ⚠ On ne part chercher une texture QUE sur une ressource d'extension (ou
    // la maquette locale) : dans la WebView Android le shim du mod résout
    // getURL en chemin relatif au jeu, et chaque fichier deviendrait deux
    // requêtes 404 vers astrowars.games (fetch, puis <img> de repli). Là on
    // rejette sans réseau : planètes unies, couleur d'archétype, tant que le
    // mod n'embarque pas assets/planets/ dans sa table de data-URI.
    const TEX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
    const TEX_URL_OK = /^(chrome-extension|moz-extension|data|blob):|^https?:\/\/(localhost|127\.0\.0\.1)[:/]|^https:\/\/astrowars\.games\/__awc\//;
    const texCache = {};
    /* Chrono de chargement : combien de fichiers ce système attend, et quand le
       dernier arrive — c'est ce qui fait « le temps que le bloc 3D arrive ». */
    const texStat = { n: 0, done: 0, t0: performance.now() };
    function texDone() {
      texStat.done++;
      if (texStat.done === texStat.n) {
        console.log("[AW-S3D] textures : " + texStat.n + " fichiers en " +
                    Math.round(performance.now() - texStat.t0) + " ms");
      }
    }
    function finishTex(t, opts) {
      /* albédos, émissifs, nuages, fond : sRGB ; données (spéculaire,
         normales) : linéaire, three ne doit PAS les décoder */
      if (!opts.linear) t.colorSpace = T.SRGBColorSpace;
      if (opts.mapping) t.mapping = opts.mapping;
      t.anisotropy = TEX_ANISO;
      t.needsUpdate = true;
      return t;
    }
    function loadTex(name, opts) {
      opts = opts || {};
      if (opts.filter) return loadTexFiltered(name, opts);
      if (texCache[name]) return texCache[name];
      texStat.n++;
      texCache[name] = new Promise((res, rej) => {
        let url;
        try { url = chrome.runtime.getURL("assets/planets/" + name); }
        catch (e) { rej(e); return; }   /* pas d'extension du tout : repli uni */
        if (!TEX_URL_OK.test(url)) { rej(new Error("asset hors extension : " + url)); return; }
        const viaImg = () => {
          new T.TextureLoader().load(url, (t) => res(finishTex(t, opts)), undefined, rej);
        };
        let ibl = null;
        try { ibl = new T.ImageBitmapLoader().setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" }); }
        catch (e) { ibl = null; }
        if (!ibl) { viaImg(); return; }
        ibl.load(url, (bmp) => {
          const t = new T.Texture(bmp);
          t.flipY = false;
          res(finishTex(t, opts));
        }, undefined, viaImg);
      });
      texCache[name].then(texDone, texDone);   /* chrono, quelle que soit l'issue */
      return texCache[name];
    }
    /* Variante d'une texture passée par un filtre CSS de canvas 2D
       (hue-rotate, saturate…) : la texture de base est redessinée une fois
       sur un canvas, et la CanvasTexture obtenue est partagée à son tour
       (clé = fichier + filtre). Le canvas hérite de l'orientation de la
       source — bitmap déjà retourné ou <img> droit — donc de son flipY. */
    function loadTexFiltered(name, opts) {
      const key = name + "#" + opts.filter;
      if (texCache[key]) return texCache[key];
      texCache[key] = loadTex(name, { linear: opts.linear }).then((base) => {
        const img = base.image;
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const x = c.getContext("2d");
        /* pas de filtre 2D (vieille WebView) : la copie ne servirait à rien */
        if (!x || !("filter" in x)) return base;
        x.filter = opts.filter;
        x.drawImage(img, 0, 0);
        /* <img> de repli cross-origin (chrome-extension:// vu de la page) :
           le canvas serait SOUILLÉ et l'upload WebGL lèverait à chaque image
           rendue — getImageData lève au même critère, on le sonde ici et on
           rend la texture de base, non filtrée, plutôt que de casser la scène */
        try { x.getImageData(0, 0, 1, 1); } catch (e) { return base; }
        const t = new T.CanvasTexture(c);
        t.flipY = base.flipY;
        return finishTex(t, opts);
      });
      return texCache[key];
    }
    /* la texture arrive → fn ; elle échoue → on le dit (une fois par fichier,
       douze planètes partagent les mêmes) et onFail ajuste le repli */
    const texWarned = {};
    /* Compile le matériau EN PARALLÈLE (KHR_parallel_shader_compile via
       compileAsync, r152+) avant de l'accrocher au mesh : sinon chaque texture
       qui arrive fait recompiler le shader Phong en plein rendu, et sur ANGLE/
       D3D ces compilations synchrones se voient — la scène bégaie pendant que
       les douze planètes s'habillent. Sans compileAsync (vieux three du mod) on
       accroche directement. */
    function swapWhenCompiled(mesh, newMat, then) {
      const apply = () => { mesh.material = newMat; if (then) then(); };
      if (typeof renderer.compileAsync !== "function") { apply(); return; }
      const probe = new T.Mesh(mesh.geometry, newMat);
      renderer.compileAsync(probe, camera, scene).then(apply, apply);
    }
    function whenTex(name, opts, fn, onFail) {
      loadTex(name, opts).then(fn, (e) => {
        if (!texWarned[name]) {
          texWarned[name] = 1;
          console.warn("[AW-S3D] texture KO:", name, (e && e.message) || e);
        }
        if (onFail) onFail(e);
      });
    }
    /* Fond : Voie lactée équirectangulaire, très atténuée pour ne pas
       concurrencer les étiquettes (les T.Points d'étoiles restent par-dessus).
       Pas sur mobile : three la convertit en cubemap 6×1024² — ~30 Mo de GPU
       sur des WebView déjà à la limite du contexte. */
    if (!MOBILE) {
      whenTex("stars_milky_way.jpg", { mapping: T.EquirectangularReflectionMapping }, (t) => {
        scene.background = t;
        scene.backgroundIntensity = 0.3;
      });
    }

    // ── effets d'ambiance : lueur zodiacale, nébuleuses, comète, étoiles ──
    const fx = { comet: null, tail: [], shoot: null, shootAt: 5, twinkle: null };
    (function ambiance() {
      // halo zodiacal : fin disque de poussière dans le plan des orbites
      const zo = new T.Mesh(
        new T.CircleGeometry(8.5, 48),
        new T.MeshBasicMaterial({
          map: radialTex("rgba(255,214,160,0.30)", "rgba(255,180,110,0)"),
          transparent: true, depthWrite: false,
          blending: T.AdditiveBlending, side: T.DoubleSide, opacity: 0.42,
        })
      );
      zo.rotation.x = -Math.PI / 2; zo.position.y = -0.03;
      group.add(zo);
      // nébuleuses lointaines : quelques taches colorées à peine visibles
      const hues = ["rgba(120,150,255,0.16)", "rgba(190,120,255,0.13)",
                    "rgba(90,220,220,0.12)", "rgba(255,140,180,0.10)"];
      for (let i = 0; i < 7; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({
          map: radialTex(hues[i % hues.length], "rgba(0,0,0,0)"),
          transparent: true, depthWrite: false, blending: T.AdditiveBlending,
          opacity: 0.5 + Math.random() * 0.3,
        }));
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        s.position.set(q * Math.cos(a), u * 0.6, q * Math.sin(a)).multiplyScalar(95 + Math.random() * 45);
        s.scale.setScalar(26 + Math.random() * 40);
        scene.add(s);
      }
      // couche d'étoiles scintillantes (opacité pulsée dans la boucle)
      const n = 160, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 60 + Math.random() * 90, a2 = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI;
        pos[i * 3] = Math.cos(a2) * Math.cos(e) * r;
        pos[i * 3 + 1] = Math.sin(e) * r * 0.6;
        pos[i * 3 + 2] = Math.sin(a2) * Math.cos(e) * r;
      }
      const g2 = new T.BufferGeometry();
      g2.setAttribute("position", new T.BufferAttribute(pos, 3));
      /* Opaques elles aussi. Le scintillement ne passe donc plus par l'opacité
         mais par la COULEUR : même effet à l'œil, sans transparence. */
      fx.twinkle = new T.PointsMaterial({
        color: 0xd8e2ff, size: 0.55, map: dotTex(), transparent: true, depthWrite: false,
      });
      scene.add(new T.Points(g2, fx.twinkle));
      // comète : tête brillante + queue de poussière qui fuit le soleil
      fx.comet = new T.Sprite(new T.SpriteMaterial({
        map: radialTex("rgba(210,235,255,1)", "rgba(0,0,0,0)"),
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      }));
      fx.comet.scale.setScalar(0.55);
      group.add(fx.comet);
      for (let i = 0; i < 12; i++) {
        const t2 = new T.Sprite(new T.SpriteMaterial({
          map: radialTex("rgba(170,210,255,0.8)", "rgba(0,0,0,0)"),
          transparent: true, depthWrite: false, blending: T.AdditiveBlending,
          opacity: 0.4 * (1 - i / 12),
        }));
        t2.scale.setScalar(0.34 + i * 0.05);
        group.add(t2);
        fx.tail.push(t2);
      }
      // étoile filante (sprites réutilisés à chaque passage)
      fx.shoot = { s: [], t0: -1, from: new T.Vector3(), dir: new T.Vector3() };
      for (let i = 0; i < 5; i++) {
        const m2 = new T.Sprite(new T.SpriteMaterial({
          map: radialTex("rgba(255,255,255,1)", "rgba(0,0,0,0)"),
          transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0,
        }));
        m2.scale.setScalar(0.5 - i * 0.07);
        scene.add(m2);
        fx.shoot.s.push(m2);
      }
    })();
    function fxUpdate(tt) {
      // scintillement discret du fond, par la luminosité et non par l'opacité
      const tw = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(tt * 2.1) * Math.sin(tt * 3.7));
      fx.twinkle.color.setRGB(0.847 * tw, 0.886 * tw, 1.0 * tw);
      // comète sur orbite elliptique inclinée, plus lente ; la queue TRAÎNE
      // derrière le déplacement (légèrement repoussée par le soleil), jamais
      // devant — sinon elle semble avancer à reculons
      const th = tt * 0.02 + 1.3;
      fx.comet.position.set(Math.cos(th) * 17.5 - 6.0, 1.6 + Math.sin(th * 2.0) * 0.4, Math.sin(th) * 8.5);
      const away = fx.comet.position.clone().normalize();
      const vel = new T.Vector3(-Math.sin(th) * 17.5, Math.cos(th * 2.0) * 0.8, Math.cos(th) * 8.5).normalize();
      const tailDir = away.multiplyScalar(0.35).addScaledVector(vel, -0.65).normalize();
      const tl = Math.max(0.25, 3.4 - fx.comet.position.length() * 0.12); /* queue longue près du soleil */
      for (let i = 0; i < fx.tail.length; i++) {
        fx.tail[i].position.copy(fx.comet.position).addScaledVector(tailDir, (i + 1) * tl * 0.12);
        fx.tail[i].position.y += Math.sin(tt * 1.7 + i) * 0.02;
      }
      // étoile filante de temps en temps
      const sh = fx.shoot;
      if (sh.t0 < 0 && tt > fx.shootAt) {
        sh.t0 = tt;
        const u = Math.random() * 2 - 1, a3 = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        sh.from.set(q * Math.cos(a3), u * 0.5, q * Math.sin(a3)).multiplyScalar(65 + Math.random() * 25);
        sh.dir.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize().multiplyScalar(38);
      }
      if (sh.t0 >= 0) {
        const ph = (tt - sh.t0) / 0.9;
        if (ph >= 1) {
          sh.t0 = -1; fx.shootAt = tt + 7 + Math.random() * 12;
          sh.s.forEach((m2) => { m2.material.opacity = 0; });
        } else {
          const fade = Math.min(1, ph / 0.15) * Math.min(1, (1 - ph) / 0.3);
          for (let i = 0; i < sh.s.length; i++) {
            sh.s[i].position.copy(sh.from).addScaledVector(sh.dir, ph - i * 0.016);
            sh.s[i].material.opacity = fade * (1 - i / sh.s.length) * 0.9;
          }
        }
      }
    }

    // ── SOLEIL : plasma procédural (shader) + protubérances fines ────────
    // Surface = bruit simplex avec déformation de domaine (convection) +
    // filaments « ridged » ; teinte au niveau de pop, couples braise/chaud
    // échantillonnés sur les icônes sun0..sun8 du pack. Mise au point dans
    // l'artifact « Soleil Animé » avant portage ici.
    /* Niveau du système comme la vraie carte (icône sun<N> du jeu) :
       floor(somme des pops CONNUES / 3) — pas la pop max. Vérifié sur le
       mapData du jeu : Korneforos 1+1+2 → 1, Meboula 1 → 0, Alphirk 1 → 0. */
    /* Niveau OFFICIEL du jeu (populationLevel), persisté par la carte 3D à
       chaque visite de /Game/Map ; repli = floor(somme des pops connues / 3)
       si le système n'a pas encore été vu sur la carte. */
    const sumKnown = planets.reduce((a, p) => a + ((p.unknown || p.popUnknown) ? 0 : p.pop), 0);
    const storedLvl = sysLevels[String(SYSTEM_ID)];
    const maxPop = Math.min(8, storedLvl != null ? (storedLvl | 0) : Math.floor(sumKnown / 3));
    /* MÊMES couleurs que la carte 3D (STAR_COLORS de map3d) et même dérivation
       ember/hot/dark : l'étoile ici = le système là-bas, à l'identique */
    const STAR_COLORS = ["#cacace", "#b9b9c0", "#4e95a2", "#a1d631", "#d6c631",
                         "#d6a231", "#d65731", "#d631c6", "#7331d6"];
    /* 2,6 : l'étoile domine le système comme le vrai Soleil, la première
       orbite (6,5) reste bien dégagée */
    const SUN_R = 4.6;   /* orbites régulières jusqu'à ~66 : à 2,6 l'étoile n'était plus qu'un point au centre */
    const emberC = new T.Color(STAR_COLORS[Math.min(8, maxPop)]);
    const hotC = emberC.clone().lerp(new T.Color(1, 1, 1), 0.55);
    const darkC = emberC.clone().multiplyScalar(0.13);

    const NOISE_GLSL = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ f += a * snoise(p); p *= 2.02; a *= 0.5; }
  return f;
}
float ridged(vec3 p){
  float f = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){ f += a * abs(snoise(p)); p *= 2.13; a *= 0.5; }
  return f;
}
`;
    const sunUni = {
      time: { value: 0 },
      colDark: { value: darkC },
      colEmber: { value: emberC },
      colHot: { value: hotC },
    };
    const sunMat = new T.ShaderMaterial({
      uniforms: sunUni,
      vertexShader: `
        varying vec3 vPos;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main(){
          vPos = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewW = cameraPosition - wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: NOISE_GLSL + `
        uniform float time;
        uniform vec3 colDark;
        uniform vec3 colEmber;
        uniform vec3 colHot;
        varying vec3 vPos;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main(){
          vec3 p = normalize(vPos);
          float t = time * 0.045;
          vec3 warp = vec3(
            fbm(p * 2.4 + vec3(t, 0.0, -t)),
            fbm(p * 2.4 + vec3(13.7, t, 5.1)),
            fbm(p * 2.4 + vec3(-t, 7.3, t))
          );
          float cells = fbm(p * 3.2 + warp * 2.2 + vec3(0.0, 0.0, t));
          float v = cells * 0.5 + 0.5;
          float fil = 1.0 - ridged(p * 5.5 + warp * 1.2 + vec3(0.0, t * 1.6, 0.0));
          fil = pow(clamp(fil, 0.0, 1.0), 3.5);
          float fin = 1.0 - ridged(p * 12.0 + warp * 1.8 + vec3(t * 1.2, 0.0, -t));
          fin = pow(clamp(fin, 0.0, 1.0), 5.0);
          float hs = smoothstep(0.5, 0.85, fbm(p * 1.4 + vec3(2.7, -t * 0.4, 8.1)) * 0.5 + 0.5);
          vec3 col = mix(colDark, colEmber, smoothstep(0.10, 0.8, v));
          col = mix(col, colHot, fil * 0.95);
          col += colHot * fin * (0.22 + hs * 0.5);
          col += mix(colHot, vec3(1.0), 0.45) * hs * pow(fil, 1.5) * 0.45;
          float spot = fbm(p * 1.7 + vec3(t * 0.9, -t * 0.6, 4.2));
          spot = smoothstep(0.14, 0.55, spot);
          float spot2 = fbm(p * 3.6 + vec3(-t * 0.7, t * 0.5, 9.3));
          spot2 = smoothstep(0.25, 0.6, spot2);
          float sombre = clamp(spot * 0.7 + spot2 * 0.42, 0.0, 1.0);
          col = mix(col, colDark * 0.45, sombre * 0.72);
          float fres = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewW)), 0.0, 1.0), 2.2);
          col += mix(colEmber, colHot, 0.35) * fres * 0.4;
          gl_FragColor = vec4(col * 1.3, 1.0);
        }
      `,
    });
    const sunG = new T.Group();
    group.add(sunG);
    sunG.add(new T.Mesh(new T.SphereGeometry(SUN_R, 64, 64), sunMat));

    // Protubérances : fils de plasma qui poussent de A vers B puis se
    // résorbent depuis A (uniforms head/tail), le long d'arcs de Bézier.
    const flameProto = new T.ShaderMaterial({
      uniforms: {
        time: { value: 0 }, seed: { value: 0 }, opacity: { value: 1 },
        head: { value: 1 }, tail: { value: 0 },
        colA: { value: emberC }, colB: { value: hotC },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: NOISE_GLSL + `
        uniform float time;
        uniform float seed;
        uniform float opacity;
        uniform float head;
        uniform float tail;
        uniform vec3 colA;
        uniform vec3 colB;
        varying vec2 vUv;
        void main(){
          float n = fbm(vec3(vUv.x * 7.0 - time * 1.3, vUv.y * 3.0 + seed, seed * 3.1));
          float n2 = ridged(vec3(vUv.x * 12.0 - time * 2.1 + seed, vUv.y * 5.0, seed));
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          float grow = 1.0 - smoothstep(head - 0.08, head, vUv.x);
          float shrink = smoothstep(tail, tail + 0.08, vUv.x);
          float a = clamp(n * 0.6 + 0.55, 0.0, 1.0) * edge * grow * shrink * opacity;
          vec3 col = mix(colA * 1.2, colB, clamp(n2, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 1.4, a);
        }
      `,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    });
    function randSphereDir() {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      return new T.Vector3(s * Math.cos(th), s * Math.sin(th), u);
    }
    function promCurve() {
      const n = randSphereDir();
      const tg = new T.Vector3().crossVectors(n, randSphereDir()).normalize();
      const p0 = n.clone().multiplyScalar(SUN_R - 0.06);
      const span = 0.14 + Math.random() * 0.26;
      /* mêmes proportions que les protubérances de la carte */
      const h = SUN_R * (0.08 + Math.pow(Math.random(), 1.6) * 0.42);
      const p3 = n.clone().addScaledVector(tg, span).normalize().multiplyScalar(SUN_R - 0.06);
      const c1 = p0.clone().normalize().multiplyScalar(SUN_R + h).addScaledVector(tg, span * SUN_R * 0.25);
      const c2 = p3.clone().normalize().multiplyScalar(SUN_R + h).addScaledVector(tg, -span * SUN_R * 0.25);
      return new T.CubicBezierCurve3(p0, c1, c2, p3);
    }
    const proms = [];
    function spawnProm(pr, now) {
      if (pr.mesh) {
        sunG.remove(pr.mesh);
        pr.mesh.geometry.dispose();
        pr.mesh.material.dispose();
      }
      const geo = new T.TubeGeometry(promCurve(), 40, SUN_R * (0.02 + Math.random() * 0.032), 6, false);
      const mat = flameProto.clone();
      mat.uniforms.seed.value = Math.random() * 100;
      mat.uniforms.colA.value = emberC;
      mat.uniforms.colB.value = hotC;
      pr.mesh = new T.Mesh(geo, mat);
      pr.dur = 6 + Math.random() * 8;   /* même cadence que la carte */
      pr.t0 = now;
      sunG.add(pr.mesh);
    }
    for (let i = 0; i < 8; i++) {
      const pr = { mesh: null };
      spawnProm(pr, 0);
      pr.t0 -= Math.random() * pr.dur;   /* cycles désynchronisés au départ */
      proms.push(pr);
    }
    function sunUpdate(tt) {
      sunUni.time.value = tt;
      sunG.rotation.y = tt * 0.02;
      for (const pr of proms) {
        const phase = (tt - pr.t0) / pr.dur;
        if (phase >= 1) { spawnProm(pr, tt); continue; }
        const u = pr.mesh.material.uniforms;
        u.head.value = Math.min(1, phase / 0.35);
        u.tail.value = Math.max(0, (phase - 0.65) / 0.35);
        u.opacity.value = 0.85 * Math.min(1, phase / 0.08) * Math.min(1, (1 - phase) / 0.08);
        u.time.value = tt;
      }
    }

    // ── planètes TEXTURÉES (Solar System Scope, CC BY 4.0) ────────────────
    // Le rendu procédural (bruit fbm en GLSL) donnait des sphères granuleuses,
    // des faces surexposées et des calottes douteuses. On passe à de vraies
    // textures équirectangulaires (assets/planets/) sur des MeshPhongMaterial
    // éclairés par le soleil (PointLight à l'origine) : jour/nuit calculés par
    // le moteur, nuages et villes en couches, atmosphère en coque Fresnel,
    // anneaux pour une géante sur deux. L'ARCHÉTYPE d'un monde reste tiré de
    // sa graine avec les MÊMES seuils qu'avant : chaque planète garde son type
    // d'une visite à l'autre, seule la matière a changé.

    /* Éclairage — il ne concerne que les planètes : soleil, badges, orbites et
       sprites sont des matériaux non éclairés, ils n'y voient rien.
       decay = 0 : depuis r155 three applique la chute physique en 1/d², qui
       éteindrait les orbites lointaines (d ≈ 17 → 1/289). Source PONCTUELLE à
       l'origine, donc chaque planète a bien son côté jour tourné vers l'étoile.
       Intensité ≈ π : la BRDF de Lambert divise l'albédo par π, π ramène donc
       le plein soleil à la couleur de la texture, ni plus ni moins — c'est ce
       qui évite les faces cramées de l'ancien rendu. */
    const sunLight = new T.PointLight(0xfff2dc, 3.4, 0, 0);
    scene.add(sunLight);
    /* face nuit : « lumière des étoiles » bleutée, assez pour lire le relief
       sans écraser les lumières des villes ; l'hémisphérique adoucit le
       terminateur (le ciel éclaire un peu le dessus, rien le dessous).
       En mode « pop » l'ambiante est neutre et plus forte : les planètes
       entre la caméra et l'étoile montrent leur face nuit, et le bleu du ciel
       nocturne y délavait la couleur du niveau en gris — c'est pourtant la
       seule information que ce mode doit porter. */
    const byPop = colorMode !== "type";
    scene.add(new T.AmbientLight(byPop ? 0x8a8c98 : 0x4a5a8c, byPop ? 1.5 : 1.15));
    scene.add(new T.HemisphereLight(0x5a6a9c, 0x0c0c14, 0.45));

    /* Teintes hi des icônes planet0..8 du pack (mode « pop ») : la texture
       est désaturée d'abord, la teinte du niveau colore ensuite sa seule
       luminance (voir makePlanet). */
    const PLANET_PALETTE = ["#82848e", "#81828f", "#53a6ba", "#a3c34f", "#c6b84a",
                            "#c79d4d", "#c86f51", "#bd57b5", "#8a58c1"];
    /* Par archétype : couleur unie de REPLI (tant que la texture n'est pas là,
       ou si elle échoue — jamais de scène vide) et couleur d'atmosphère. */
    const ARCH_PALETTE = {
      /*            repli      atmosphère */
      continental: ["#3f7a46", "#7ec0ff"],
      ocean:       ["#2fa8b8", "#63d8ff"],
      lava:        ["#8a2f18", "#ff7a3a"],
      ice:         ["#a8cbe8", "#bfe4ff"],
      desert:      ["#b07a3c", "#f0c898"],
      gas:         ["#c08a4a", "#e8c89a"],
      dead:        ["#5a5a62", null],
    };
    /* Textures par famille, choisies par la graine. `earth` = monde tellurique
       complet (spéculaire, relief, nuages, villes) ; `veil` = voile nuageux
       opaque posé en légère transparence ; `atmo` = teinte de coque propre à
       la texture (une géante bleue n'a pas le ciel d'une géante ocre). */
    /* Mondes telluriques GÉNÉRÉS (scratchpad gen_worlds.py : bruit de Perlin
       sur la sphère, continents par déformation de domaine, biomes, villes,
       relief) : huit cartes différentes, aucune n'est la Terre — l'utilisateur
       reconnaissait l'Afrique sur une planète sur deux. Les mondes 2/3/4/7 ont
       le plus d'océan, 1/5/6/8 le plus de terres. */
    const WORLD = (n) => ({
      map: "world" + n + "_day.jpg", earth: true,
      spec: "world" + n + "_spec.jpg", normal: "world" + n + "_normal.jpg", night: "world" + n + "_night.jpg",
    });
    const TEX_FAMILY = {
      ocean:       [WORLD(2), WORLD(4), WORLD(7), WORLD(3)],
      continental: [WORLD(1), WORLD(5), WORLD(6), WORLD(8)],
      desert:      [{ map: "mars.jpg" }, { map: "venus_surface.jpg", veil: "venus_atmo.jpg" }],
      ice:         [{ map: "eris.jpg" }, { map: "haumea.jpg" }, { map: "moon.jpg" }],
      lava:        [{ map: "makemake.jpg" }, { map: "venus_surface.jpg", veil: "venus_atmo.jpg" }],
      gas:         [{ map: "jupiter.jpg", atmo: "#e8c090" }, { map: "saturn.jpg", atmo: "#f0d8a8" },
                    { map: "uranus.jpg", atmo: "#a0e0f0" }, { map: "neptune.jpg", atmo: "#5878ff" }],
      dead:        [{ map: "moon.jpg" }, { map: "mercury.jpg" }, { map: "ceres.jpg" }],
    };
    const PLANET_GEO = new T.SphereGeometry(1, 48, 32);
    /* Quatre variantes d'UV de la même sphère (u miroir, v miroir, les deux),
       partagées par toutes les planètes : près d'une planète sur deux tire la
       famille Terre, et sans ça un système entier montre la même carte. Le
       miroir se fait par la géométrie et non par la texture : les cinq maps
       de la Terre (jour, nuit, spéculaire, relief, nuages) restent alignées. */
    const PLANET_GEOS = [0, 1, 2, 3].map((k) => {
      const g = k ? new T.SphereGeometry(1, 48, 32) : PLANET_GEO;
      const uv = g.attributes.uv;
      for (let i = 0; k && i < uv.count; i++) {
        uv.setXY(i, (k & 1) ? 1 - uv.getX(i) : uv.getX(i), (k & 2) ? 1 - uv.getY(i) : uv.getY(i));
      }
      return g;
    });
    const planetMeshes = [];
    /* Deux mondes d'un même système ne doivent pas se ressembler : on retient
       les archétypes et les cartes déjà servis ici, et makePlanet préfère
       systématiquement ce qui n'a pas encore été pris. */
    const taken = { arch: Object.create(null), tex: Object.create(null) };
    const ZONE_ARCH = {
      hot:       ["lava", "desert", "dead"],
      temperate: ["ocean", "continental", "desert", "ice"],
      cold:      ["gas", "ice", "dead"],
    };
    /* hasard DÉTERMINISTE par graine : même planète = même monde à chaque visite */
    function prand(s) { const v = Math.sin(s * 127.1) * 43758.5453; return v - Math.floor(v); }

    /* Atmosphère : coque en BackSide légèrement plus grande que la planète,
       Fresnel additif. Seule la face ARRIÈRE de la coque est visible, dans le
       mince anneau qui déborde du disque opaque : là, dot(N,V) va de −0,33
       (contre le limbe) à 0 (bord de la coque), la lueur colle donc au limbe
       et s'éteint vers l'extérieur. Volontairement discrète : un halo additif
       fort noyait le relief et les villes de nuit. */
    const ATMO_VERT = `
      varying vec3 vN;
      varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;
    const ATMO_FRAG = `
      uniform vec3 col;
      uniform float amt;
      varying vec3 vN;
      varying vec3 vW;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float rim = smoothstep(0.0, 0.34, -dot(N, V));
        rim *= rim;
        /* le soleil est à l'origine : dense côté jour, presque rien côté nuit */
        float sun = 0.22 + 0.78 * smoothstep(-0.35, 0.45, dot(N, normalize(-vW)));
        float a = rim * sun * amt;
        gl_FragColor = vec4(col * a, a);
      }
    `;
    function makeAtmo(hex, amt) {
      const m = new T.Mesh(PLANET_GEO, new T.ShaderMaterial({
        uniforms: { col: { value: new T.Color(hex) }, amt: { value: amt } },
        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
        side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      }));
      m.scale.setScalar(1.07);
      m.renderOrder = 2;
      return m;
    }

    /* Villes la nuit : l'emissiveMap de Phong s'ajoute PARTOUT, jour compris,
       et sème des points jaunes sur les continents éclairés. On la masque par
       l'angle soleil/normale, calculé dans le shader depuis la première
       PointLight (le soleil, en espace vue ; vViewPosition = −position). */
    function nightMaskCompile(shader) {
      const key = "#include <emissivemap_fragment>";
      if (shader.fragmentShader.indexOf(key) < 0) return;
      shader.fragmentShader = shader.fragmentShader.replace(key, key + `
        #if NUM_POINT_LIGHTS > 0
          vec3 awL = normalize(pointLights[0].position + vViewPosition);
          totalEmissiveRadiance *= smoothstep(0.18, -0.12, dot(normalize(vNormal), awL));
        #endif
      `);
    }

    /* Anneaux : RingGeometry dont l'UV est réécrite en u = rayon, pour que la
       bande ring_alpha.png (1024×64, alpha inclus) se déroule du bord intérieur
       au bord extérieur et non autour de l'anneau. Le PNG porte sa propre
       transparence : en `map` seule, three lit l'alpha du texel — le doubler
       en alphaMap (canal vert) aurait aminci l'anneau deux fois. */
    function makeRings(tint) {
      /* serrés contre la planète : les orbites voisines ne sont qu'à ~3 unités,
         des anneaux à 2,25 rayons (Saturne) chevauchaient le monde d'à côté */
      const rIn = 1.28, rOut = 1.72;
      const geo = new T.RingGeometry(rIn, rOut, 96, 1);
      const pos = geo.attributes.position, v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        geo.attributes.uv.setXY(i, (v.length() - rIn) / (rOut - rIn), 0.5);
      }
      const mat = new T.MeshPhongMaterial({
        color: tint, transparent: true, side: T.DoubleSide, depthWrite: false,
        opacity: 0.75, shininess: 4, specular: 0x050505,
      });
      const m = new T.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      /* invisible tant que la texture manque : un disque plein serait pire
         qu'aucun anneau. Le soleil RASE le plan des anneaux (il est dans le
         plan des orbites) : la diffuse seule en faisait un pneu noir, d'où
         l'emissiveMap qui les auto-éclaire — la bande du PNG est sombre
         (≈ 0,08 en linéaire), il faut pousser au-delà de 1 pour un gris
         lisible et non un pneu. 1,25 et non plus 1,6 : le RGB arrive
         désormais non prémultiplié (voir loadTex), les zones translucides
         ont retrouvé leur vraie clarté. */
      m.visible = false;
      whenTex("ring_alpha.png", {}, (t) => {
        mat.map = t; mat.emissiveMap = t;
        mat.emissive.set(0xffffff); mat.emissiveIntensity = 1.25;
        mat.needsUpdate = true; m.visible = true;
      });
      return m;
    }

    function makePlanet(lvl, seed, opts) {
      opts = opts || {};
      const r1 = prand(seed), r2 = prand(seed + 1.7);
      const crater = opts.crater ? 1 : 0;

      /* Archétype tiré de la graine (MÊMES seuils que le rendu procédural),
         donc STABLE pour une planète donnée. */
      /* Comme dans le vrai système solaire, la distance à l'étoile décide du
         type de monde : près d'elle des mondes de feu et de sable, au milieu
         la zone tempérée (océans, continents), au loin les géantes gazeuses
         et les mondes de glace. La graine tranche à l'intérieur de la zone. */
      const arch = (function () {
        if (crater) return "dead";
        const list = ZONE_ARCH[opts.zone || "temperate"];
        /* on part où la graine tombe, puis on retient le type le MOINS servi
           dans ce système : la zone reste respectée, mais un système ne peut
           plus aligner quatre océans de suite. */
        const start = Math.floor(prand(seed + 11.3) * list.length) % list.length;
        let best = list[start], bestN = taken.arch[best] || 0;
        for (let k = 1; k < list.length && bestN > 0; k++) {
          const cand = list[(start + k) % list.length], n = taken.arch[cand] || 0;
          if (n < bestN) { best = cand; bestN = n; }
        }
        return best;
      })();
      taken.arch[arch] = (taken.arch[arch] || 0) + 1;
      const fam = TEX_FAMILY[arch];
      /* même principe pour la carte : on saute celles déjà posées dans ce
         système, sinon deux mondes océan y montraient le même continent. */
      const tex = (function () {
        const start = Math.min(fam.length - 1, Math.floor(r2 * fam.length));
        for (let k = 0; k < fam.length; k++) {
          const cand = fam[(start + k) % fam.length];
          if (!taken.tex[cand.map]) { taken.tex[cand.map] = 1; return cand; }
        }
        return fam[start];
      })();
      const earth = !!tex.earth;
      const pal = ARCH_PALETTE[arch];

      /* Deux façons de colorer, au choix (bouton « Couleur » de l'en-tête) :
         — « type » : couleurs naturelles de la texture, blanc à peine décalé
           par la graine, plus une nuance de famille (glace bleutée, feu
           orangé).
         — « pop »  : couleur du niveau, comme les icônes de la carte. Plus
           informatif, mais tous les mondes d'un niveau se ressemblent. Un
           voile multiplicatif sur une texture saturée ne recolore rien (un
           océan bleu ne devient jamais orange, 7 niveaux sur 9 restaient
           bleus) : la carte est donc DÉSATURÉE (saturate 0,25) et un peu
           éclaircie (le produit par une teinte moyenne assombrit), puis la
           teinte du niveau, à 90 %, colore sa luminance — le relief reste,
           la couleur est celle du niveau. */
      const byType = colorMode === "type";
      const tint = new T.Color(1, 1, 1);
      const mapOpts = {};
      if (byType) {
        tint.lerp(new T.Color().setHSL(r1, 0.5, 0.5), 0.08);
        /* même carte pour ocean et continental : la nuance fait la différence,
           monde d'eau bleuté, monde de terres plus chaud et plus vert */
        if (arch === "ocean") tint.lerp(new T.Color("#9cd0ff"), 0.22);
        if (arch === "continental") tint.lerp(new T.Color("#e0f0c0"), 0.16);
        if (arch === "ice") tint.lerp(new T.Color("#bcd6ff"), 0.4);
        if (arch === "lava") tint.lerp(new T.Color("#ff9a48"), 0.5);
      } else {
        mapOpts.filter = "saturate(0.25) brightness(1.25)";
        tint.lerp(new T.Color(PLANET_PALETTE[Math.max(0, Math.min(8, lvl))]), 0.9);
      }
      const atmoHex = byType ? (tex.atmo || pal[1])
                             : tint.clone().lerp(new T.Color(0.62, 0.78, 1.0), 0.4).getStyle();

      /* Repli uni couleur d'archétype : la planète existe dès maintenant, la
         texture arrive quand elle arrive (et la teinte avec elle — appliquée
         d'emblée, elle assombrirait le repli). Rocheux mat, Terre brillante
         là où la specularMap dit « océan ». */
      const mat = new T.MeshPhongMaterial({
        color: new T.Color(pal[0]),
        shininess: earth ? 26 : 6,
        specular: new T.Color(earth ? 0x66788a : 0x0c0c0c),
      });
      const pg = new T.Group();
      /* rayon de base par type : une géante gazeuse est bien plus grosse
         qu'un monde rocheux (Jupiter/Mercure), la pop module ensuite un peu */
      /* la géante était à 1,9 : avec le grossissement général elle mangeait
         trois orbites à elle seule. 1,3 la garde nettement plus grosse que les
         mondes rocheux sans écraser le reste du système. */
      pg.userData.baseR = ({ gas: 1.3, ice: 0.85, lava: 0.8, desert: 0.85,
                             ocean: 1.0, continental: 1.0, dead: 0.7 })[arch] || 1;
      pg.userData.arch = arch;
      const body = new T.Mesh(PLANET_GEOS[Math.floor(prand(seed + 23.9) * 4) & 3], mat);
      pg.add(body);
      /* Toutes les cartes du monde sont attendues ENSEMBLE, puis posées sur un
         matériau neuf compilé à part (swapWhenCompiled) : une seule compilation
         par planète au lieu de quatre (map, puis spéculaire, puis relief, puis
         villes), et aucune pendant le rendu. */
      const wants = [loadTex(tex.map, mapOpts)];
      const withNight = earth && opts.lights > 0;
      if (earth) {
        wants.push(loadTex(tex.spec, { linear: true }), loadTex(tex.normal, { linear: true }));
        if (withNight) wants.push(loadTex(tex.night, {}));
      }
      Promise.allSettled(wants).then((rs) => {
        const got = (i) => (rs[i] && rs[i].status === "fulfilled") ? rs[i].value : null;
        rs.forEach((r) => {
          if (r.status !== "rejected") return;
          const msg = (r.reason && r.reason.message) || String(r.reason);
          if (!texWarned[msg]) { texWarned[msg] = 1; console.warn("[AW-S3D] texture KO:", msg); }
        });
        if (!got(0)) {
          /* sans texture (WebView du mod) : en mode pop, le repli uni prend
             quand même la couleur du niveau, sinon le bouton n'a aucun effet */
          if (!byType) mat.color.copy(tint);
          return;
        }
        const m2 = new T.MeshPhongMaterial({
          map: got(0), color: tint.clone(),
          shininess: earth ? 26 : 6,
          specular: new T.Color(earth ? 0x66788a : 0x0c0c0c),
        });
        /* monde de feu : braise sourde qui reste visible côté nuit */
        if (arch === "lava") { m2.emissive.set("#4a1200"); m2.emissiveIntensity = 1.0; }
        if (earth) {
          if (got(1)) m2.specularMap = got(1);
          /* relief dérivé de la carte de hauteur générée : montagnes lisibles
             au terminateur, océans plats */
          if (got(2)) { m2.normalMap = got(2); m2.normalScale.set(0.85, 0.85); }
          /* villes : plus la pop est haute, plus la face nuit s'allume.
             L'emissive n'est posée qu'avec sa map, sinon Phong teinterait
             toute la sphère en ambre. */
          if (withNight && got(3)) {
            m2.emissiveMap = got(3);
            m2.emissive.set("#ffb45a");
            m2.emissiveIntensity = 0.3 + 1.1 * Math.min(1, opts.lights);
            m2.onBeforeCompile = nightMaskCompile;
          }
        }
        swapWhenCompiled(body, m2, () => mat.dispose());
      });

      /* nuages : seconde sphère à peine plus grande, alpha de earth_clouds
         (ou voile vénusien opaque en transparence), qui tourne un peu plus
         vite que le sol */
      let clouds = null;
      const cloudFile = earth ? "earth_clouds.jpg" : (tex.veil || null);
      if (cloudFile) {
        const cm = new T.MeshPhongMaterial({
          color: 0xffffff, transparent: true, depthWrite: false,
          opacity: earth ? 1.0 : 0.42, shininess: 3, specular: 0x000000,
        });
        clouds = new T.Mesh(PLANET_GEOS[Math.floor(prand(seed + 27.1) * 4) & 3], cm);
        clouds.scale.setScalar(1.018);
        clouds.renderOrder = 1;
        clouds.visible = false;      /* une sphère blanche opaque sinon */
        whenTex(cloudFile, {}, (t) => {
          if (earth) cm.alphaMap = t; else cm.map = t;
          cm.needsUpdate = true;
          swapWhenCompiled(clouds, cm, () => { clouds.visible = true; });
        });
        pg.add(clouds);
      }

      if (atmoHex && arch !== "dead") {
        pg.add(makeAtmo(atmoHex, arch === "gas" ? 0.5 : 0.65));
      }
      /* anneaux pour une géante sur deux, teintés comme leur atmosphère */
      const ringed = arch === "gas" && prand(seed + 21.7) < 0.5;
      if (ringed) {
        pg.add(makeRings(new T.Color(tex.atmo || pal[1]).lerp(new T.Color(1, 1, 1), 0.65)));
        pg.userData.ringed = true;   /* l'étiquette doit dégager l'anneau, pas la sphère */
      }

      /* variété par graine, DÉTERMINISTE : inclinaison d'axe (le groupe porte
         l'axe, la sphère tourne dedans, les anneaux suivent), phase et vitesse
         de rotation. Une géante à anneaux est franchement couchée (Saturne
         27°, Uranus 98°) : vue de haut, un anneau dans le plan des orbites
         n'est qu'un cercle autour du disque — c'est l'inclinaison qui le fait
         passer devant puis derrière la planète, et le rend lisible. */
      pg.rotation.z = (prand(seed + 9.1) - 0.5) * 0.6;
      pg.rotation.x = ringed
        ? (prand(seed + 9.7) < 0.5 ? -1 : 1) * (0.45 + prand(seed + 9.9) * 0.35)
        : (prand(seed + 9.7) - 0.5) * 0.3;
      planetMeshes.push({
        m: body, clouds: clouds,
        rot0: prand(seed + 17.3) * Math.PI * 2,
        sp: 0.06 + prand(seed + 13.7) * 0.16,
      });
      return pg;
    }

    // ── étiquettes ───────────────────────────────────────────────────────
    function lblTex(p, hex) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 150;
      const x = c.getContext("2d");
      x.textAlign = "center"; x.shadowColor = "rgba(2,3,10,.95)"; x.shadowBlur = 8;
      x.font = "700 52px 'Segoe UI',system-ui,sans-serif";
      x.fillStyle = p.free ? "rgba(160,175,210,.5)" : hex;
      const name = p.free ? "#" + p.idx : p.owner + (p.tag ? " [" + p.tag + "]" : "");
      x.fillText(name.length > 18 ? name.slice(0, 17) + "…" : name, 256, 56);
      if (!p.free) {
        x.font = "500 34px 'Segoe UI',system-ui,sans-serif";
        x.fillStyle = "#a7b2d6";
        const parts = ["#" + p.idx, "pop " + (p.popUnknown ? "?" : p.pop)];
        if (p.sb > 0) parts.push("SB " + p.sb);
        x.fillText(parts.join("  ·  "), 256, 112);
      }
      return new T.CanvasTexture(c);
    }
    // ── badges d'anneau (starbase, flotte en orbite) ─────────────────────
    // Un anneau à bords francs et à 48 segments donnait un liseré dur et
    // visiblement facetté ; on dégrade la bande vers ses deux bords et on
    // monte à 160 segments pour que le cercle reste rond même de près.
    /* Satellites : une STATION (starbase) et un VAISSEAU (flotte en orbite)
       qui tournent autour de la planète, comme des lunes — plutôt que des
       anneaux plats que l'utilisateur ne voulait plus. Sprites dessinés sur
       canvas, profondeur active : ils passent derrière la planète. */
    const satTexCache = {};
    function satTex(kind) {
      if (satTexCache[kind]) return satTexCache[kind];
      const c = document.createElement("canvas"); c.width = 64; c.height = 64;
      const x = c.getContext("2d");
      x.translate(32, 32);
      if (kind === "station") {
        /* panneaux solaires */
        x.fillStyle = "#3b5a8a";
        x.fillRect(-30, -5, 18, 10); x.fillRect(12, -5, 18, 10);
        x.strokeStyle = "#8fb4ff"; x.lineWidth = 1.5;
        x.strokeRect(-30, -5, 18, 10); x.strokeRect(12, -5, 18, 10);
        /* corps hexagonal */
        x.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          x[i ? "lineTo" : "moveTo"](Math.cos(a) * 11, Math.sin(a) * 11);
        }
        x.closePath(); x.fillStyle = "#d8dde6"; x.fill();
        x.strokeStyle = "#6c7480"; x.lineWidth = 2; x.stroke();
        /* feu de position rouge = starbase */
        x.fillStyle = "#ff5f6d"; x.beginPath(); x.arc(0, 0, 4, 0, Math.PI * 2); x.fill();
        x.fillStyle = "rgba(255,95,109,0.35)"; x.beginPath(); x.arc(0, 0, 8, 0, Math.PI * 2); x.fill();
      } else {
        /* chevron de vaisseau, réacteur ambre */
        x.fillStyle = "rgba(255,179,71,0.35)"; x.beginPath(); x.arc(-14, 0, 9, 0, Math.PI * 2); x.fill();
        x.fillStyle = "#ffb347"; x.beginPath(); x.arc(-14, 0, 4, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.moveTo(26, 0); x.lineTo(-12, -13); x.lineTo(-4, 0); x.lineTo(-12, 13); x.closePath();
        x.fillStyle = "#f2f4f8"; x.fill();
        x.strokeStyle = "#7a8290"; x.lineWidth = 1.5; x.stroke();
      }
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace;
      satTexCache[kind] = t;
      return t;
    }
    const sats = [];
    function addSatellite(node, pr, kind, seed) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: satTex(kind), transparent: true, depthWrite: false }));
      const sc = kind === "station" ? 0.62 : 0.58;
      sp.scale.set(sc, sc, 1);
      const r = pr * (kind === "station" ? 1.45 : 1.75);
      sats.push({ sp: sp, r: r, y: pr * (kind === "station" ? 0.22 : -0.18),
                  speed: kind === "station" ? 0.55 : 0.42, phase: prand(seed * 3.3 + 0.7) * Math.PI * 2 });
      node.add(sp);
    }

    function colorFor(p) {
      if (p.mine) return "#7ee787";
      if (p.free) return "#5d7a79";
      if (p.unknown) return "#8a8fa8";
      // couleur choisie (« Couleur par alliance », tags en majuscules) → couleur du jeu
      // mémorisée par la carte 3D → hachage
      if (p.tag) return colors[p.tag] || colors[String(p.tag).toUpperCase().replace(/[^A-Z0-9]/g, "")]
        || gameColors[p.tag] || cssToHex(tagColor(p.tag));
      return "#c9d3ee";
    }

    // ── orbites + planètes (horloge : slot n à n/12 de tour) ─────────────
    const pick = [];
    const labels = [];   /* étiquettes recalées « bas de l'écran » à chaque image */
    /* Espacement RÉGULIER (et non plus géométrique 1,19^n). La progression
       façon Titius-Bode ne laissait que 1,2 unité entre les orbites 1 et 2 —
       pour des mondes de rayon 1 à 2,3 : collés à l'étoile et les uns sur les
       autres — pendant que les orbites du bord s'écartaient de 7. Ici chaque
       orbite est à 3,0 de la suivante : de quoi loger la plus grosse géante
       (rayon ≈ 2,3) partout, du premier au dernier slot. */
    const ORBIT_0 = 11.5, ORBIT_STEP = 3.0;   /* 1re orbite bien dégagée de la couronne (étoile de rayon 4,6) */
    /* Les mondes sont grossis d'autant : à l'échelle « réaliste » (une planète
       fait 2 unités pour une orbite extérieure à 60) ils n'étaient plus que
       des têtes d'épingle et les étiquettes illisibles. L'angle d'or garantit
       que deux voisines ne se touchent pas, donc on peut grossir. */
    const BODY_K = 1.70;
    const orbitR = (i) => ORBIT_0 + ORBIT_STEP * (i - 1);
    /* Distances de caméra DÉDUITES du champ de vision et de l'étendue réelle,
       au lieu des constantes en dur (78 / 92 / 72 / 12 / 220) qui ne valaient
       que pour un système plein de 12 planètes : ailleurs on était soit collé
       dessus, soit si loin qu'il n'était plus qu'un point.
       FIT = distance à laquelle le système remplit tout juste la hauteur. */
    const R_OUT = orbitR(Math.max(3, planets.length ? Math.max.apply(null, planets.map((q) => q.idx)) : 12));
    const FIT = (R_OUT * 1.06) / Math.tan((camera.fov * Math.PI / 180) / 2);
    const ZMIN = SUN_R * 1.7;        /* juste au-dessus de la couronne */
    const ZMAX = FIT * 0.95;         /* le système remplit encore l'image */
    const zoneOf = (i) => (i <= 3 ? "hot" : (i <= 7 ? "temperate" : "cold"));
    const SPIRAL_0 = prand(SYSTEM_ID * 0.911 + 4.2) * Math.PI * 2;
    planets.forEach((p) => {
      const r = orbitR(p.idx) * (1 + (prand(p.idx * 3.7 + SYSTEM_ID * 0.61) - 0.5) * 0.06);
      const hex = colorFor(p);
      const ring = new T.Mesh(
        new T.RingGeometry(r - (p.free ? 0.015 : 0.03), r + (p.free ? 0.015 : 0.03), 160),
        new T.MeshBasicMaterial({
          color: p.free ? 0x33406b : new T.Color(hex),
          side: T.DoubleSide, transparent: true, opacity: p.free ? 0.16 : 0.5,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);

      /* Angle par ANGLE D'OR (137,5°), comme les graines d'un tournesol :
         les slots réguliers n/12 alignaient les planètes sur un même rayon et
         un simple bruit finissait par en superposer deux. Là, deux slots
         consécutifs sont TOUJOURS à 137,5° l'un de l'autre, la figure ne se
         referme jamais et paraît naturelle. L'origine dépend du système :
         deux systèmes ne se ressemblent pas. */
      const a = SPIRAL_0 + p.idx * 2.39996323;
      // la planète est POSÉE sur son orbite, comme sur un vrai schéma du
      // système solaire (plus de planète en lévitation ni de fil vertical)
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      const node = new T.Group();
      node.position.set(px, 0, pz);
      group.add(node);
      let pr = 0.35;                       /* rayon affiché, pour étiquette/cible */
      let ringed = false;                  /* anneaux : rayon visible = 1,95 × pr */

      if (p.free) {
        /* planète libre : petit monde mort cratérisé */
        const dot = makePlanet(0, p.idx * 7.3 + (SYSTEM_ID % 50), { crater: true, zone: zoneOf(p.idx) });
        dot.scale.setScalar(0.35 * BODY_K);
        node.add(dot);
      } else {
        const body = makePlanet(Math.min(8, p.pop), p.idx * 7.3 + (SYSTEM_ID % 50),
          { lights: p.popUnknown ? 0.4 : Math.min(1, p.pop / 6), zone: zoneOf(p.idx) });
        /* rayon réel : le type donne l'ordre de grandeur (géante ≫ rocheux),
           la pop le module ; satellites, étiquette et cible s'y adossent */
        pr = (body.userData.baseR || 1) * (0.85 + Math.min(8, p.pop) * 0.045) * BODY_K;
        body.scale.setScalar(pr);
        if (body.userData.ringed) ringed = true;
        node.add(body);
        // (pas de halo de propriétaire autour des planètes : une aura additive
        // forte noyait le relief et les villes de nuit — l'atmosphère de
        // makePlanet reste un fin liseré. Le propriétaire est lisible par la
        // couleur de l'orbite, du fil et de l'étiquette.)
        /* Starbase et flotte en orbite ne sont PLUS matérialisées par un
           satellite qui tourne autour de la planète (station hexagonale /
           chevron blanc) : à revoir autrement. satTex/addSatellite restent
           dans le fichier, simplement plus appelées. */
      }

      const lbl = new T.Sprite(new T.SpriteMaterial({ map: lblTex(p, hex), transparent: true, depthWrite: false }));
      let lblOff;
      if (p.free) { lbl.scale.set(4.5, 1.32, 1); lblOff = 0.75 * BODY_K; }
      else { lbl.scale.set(9.0, 2.65, 1); lblOff = pr * (ringed ? 1.72 : 1) + 1.5; }
      lbl.position.y = -lblOff;          /* placement de départ ; la boucle le recale */
      node.add(lbl);
      labels.push({ sp: lbl, off: lblOff });

      // ⚠ opacity:0 et PAS visible:false — three saute le raycast d'un
      // matériau invisible (survol/clic morts sinon).
      node.userData.pr = pr;
      const hit = new T.Mesh(new T.SphereGeometry(p.free ? 0.9 : Math.max(1.6, pr * 1.25), 8, 8),
        new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData.p = p;
      hit.userData.node = node;
      node.add(hit);
      pick.push(hit);
    });

    /* Ceinture d'astéroïdes entre la zone tempérée et les géantes, comme
       entre Mars et Jupiter : un tore plat de poussière, plus dense au milieu. */
    (function belt() {
      /* l'entre-deux des slots 7 et 8 : en pourcentage du rayon (1,07 / 0,93) la
         bande s'inversait dès que l'espacement est devenu régulier — a0 passait
         AU-DELÀ de a1 et la ceinture disparaissait. On la cale en unités. */
      const N = MOBILE ? 900 : 2400,
            a0 = orbitR(7) + ORBIT_STEP * 0.26, a1 = orbitR(8) - ORBIT_STEP * 0.26;
      const arr = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const u = 0.5 + 0.5 * (prand(i * 1.7 + 0.3) + prand(i * 2.3 + 0.7) - 1);   /* bombé au centre */
        const rr = a0 + (a1 - a0) * u, th = prand(i * 3.1 + 1.1) * Math.PI * 2;
        arr[i * 3] = Math.cos(th) * rr;
        arr[i * 3 + 1] = (prand(i * 4.7 + 2.9) - 0.5) * 0.6;
        arr[i * 3 + 2] = Math.sin(th) * rr;
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(arr, 3));
      group.add(new T.Points(g, new T.PointsMaterial({
        color: 0xb0a898, size: 0.13, map: dotTex(), transparent: true, opacity: 0.7, depthWrite: false,
      })));
    })();

    // ── « home » : ma planète, sinon la plus peuplée, sinon l'étoile ─────
    let homeNode = null;
    pick.forEach((h) => { if (h.userData.p.mine && !homeNode) homeNode = h.userData.node; });
    if (!homeNode) {
      let best = -1;
      pick.forEach((h) => {
        const p = h.userData.p;
        if (!p.free && p.pop > best) { best = p.pop; homeNode = h.userData.node; }
      });
    }
    const CENTER = new T.Vector3(0, 0, 0);
    const homePos = homeNode ? homeNode.position.clone() : CENTER.clone();
    /* repère vert autour de ma planète, allumé quand la veille la cadre */
    let homeRing = null;
    if (homeNode) {
      const hr = (homeNode.userData.pr || 1.2) * 1.5;
      homeRing = new T.Mesh(new T.RingGeometry(hr, hr + 0.16, 64),
        new T.MeshBasicMaterial({
          color: 0x7ee787, side: T.DoubleSide, transparent: true,
          opacity: 0, depthWrite: false, blending: T.AdditiveBlending,
        }));
      homeRing.rotation.x = -Math.PI / 2;
      homeRing.renderOrder = 3;      /* même raison que les badges d'anneau */
      homeNode.add(homeRing);
    }

    // ── caméra orbitale : le point regardé se déplace (veille cinématique) ─
    /* toutes les distances de caméra sont désormais relatives à l'étendue du
       système : un système de 5 planètes n'a pas à être cadré comme un de 12
       (78 / 92 / 72 en dur laissaient le petit perdu au fond de l'image). */
    const orbit = { theta: Math.atan2(homePos.z, homePos.x) + 2.2, phi: 1.08, dist: FIT * 0.85 };
    const goal = { theta: orbit.theta, phi: orbit.phi, dist: orbit.dist };
    const look = new T.Vector3(0, 0, 0);      /* point visé, lissé image par image */
    const lookGoal = new T.Vector3(0, 0, 0);
    let bob = 0;                              /* respiration verticale, en veille */
    function placeCam() {
      camera.position.set(
        look.x + Math.cos(orbit.theta) * Math.cos(orbit.phi) * orbit.dist,
        look.y + Math.sin(orbit.phi) * orbit.dist + bob,
        look.z + Math.sin(orbit.theta) * Math.cos(orbit.phi) * orbit.dist
      );
      camera.lookAt(look);
    }
    /* Veille = plan-séquence. On REVIENT D'ABORD sur ma planète, puis on
       enchaîne des plans (large, rasant, autour de l'étoile) avec des
       transitions douces — au lieu d'un balayage uniforme sans intention. */
    const SHOTS = [
      { name: "home",   focus: homePos, dist: 8.5,         phi: 0.50, drift: 0.10, hold: 14 },
      { name: "large",  focus: CENTER,  dist: FIT * 0.85,  phi: 1.10, drift: 0.05, hold: 16 },
      { name: "rasant", focus: CENTER,  dist: FIT * 0.66,  phi: 0.18, drift: 0.09, hold: 13 },
      { name: "etoile", focus: CENTER,  dist: SUN_R * 5.8, phi: 0.70, drift: 0.14, hold: 11 },
    ];
    let shotI = 0, shotAt = 0;
    function idleCam(tt) {
      if (!shotAt) { shotI = 0; shotAt = tt; goal.theta = orbit.theta; }
      const cur = SHOTS[shotI];
      if (tt - shotAt > cur.hold) { shotI = (shotI + 1) % SHOTS.length; shotAt = tt; }
      const sh = SHOTS[shotI];
      lookGoal.copy(sh.focus);
      goal.phi = sh.phi;
      goal.dist = sh.dist;
      goal.theta += sh.drift * 0.004;         /* dérive lente pendant le plan */
      bob = Math.sin(tt * 0.32) * sh.dist * 0.02;
      /* lissage exponentiel = démarrages et arrivées en douceur */
      orbit.theta += (goal.theta - orbit.theta) * 0.02;
      orbit.phi += (goal.phi - orbit.phi) * 0.02;
      orbit.dist += (goal.dist - orbit.dist) * 0.02;
      look.lerp(lookGoal, 0.03);
      if (homeRing) {
        const on = sh.name === "home" ? 0.75 + 0.25 * Math.sin(tt * 1.6) : 0;
        homeRing.material.opacity += (on - homeRing.material.opacity) * 0.05;
        homeRing.scale.setScalar(1 + 0.04 * Math.sin(tt * 1.6));
      }
    }
    function manualCam() {
      /* reprise en main : on revient au centre du système, sans à-coup */
      lookGoal.copy(CENTER);
      look.lerp(lookGoal, 0.06);
      bob += (0 - bob) * 0.08;
      goal.theta = orbit.theta; goal.phi = orbit.phi; goal.dist = orbit.dist;
      if (homeRing) homeRing.material.opacity += (0 - homeRing.material.opacity) * 0.08;
    }
    let drag = null, hovering = null, hovNode = null, spin = true, spinAt = 0;
    // Tactile (app Android) : un doigt = pivoter, deux doigts = pincer pour
    // zoomer. Indispensable — au doigt il n'y a pas de survol (donc pas de
    // cible pour le clic) et l'événement `wheel` n'existe pas.
    const pointers = new Map();
    let pinchSpan0 = 0, pinchDist0 = 0, isTouch = false, moved = 0, tapSel = null;
    function idleReset() { spin = false; spinAt = Date.now() + 4000; shotAt = 0; }
    function spanOf() {
      const it = Array.from(pointers.values());
      return it.length < 2 ? 0 : Math.hypot(it[0].x - it[1].x, it[0].y - it[1].y);
    }
    canvas.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      isTouch = e.pointerType !== "mouse";
      if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY };
        moved = 0;
        /* au doigt il n'y a pas de survol : on vise dès l'appui, sinon
           `hovering` reste nul et le clic ne fait jamais rien */
        hover(e);
      } else if (pointers.size === 2) {
        drag = null;                       /* on bascule en pincement */
        pinchSpan0 = spanOf(); pinchDist0 = orbit.dist;
      }
      idleReset();
      canvas.classList.add("drag");
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchSpan0 = 0;
      if (pointers.size === 0) { drag = null; canvas.classList.remove("drag"); }
      else {
        /* un doigt levé sur deux : on repart du restant, sans saut de caméra */
        const it = Array.from(pointers.values())[0];
        drag = { x: it.x, y: it.y };
      }
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2 && pinchSpan0 > 0) {
        const d = spanOf();
        if (d > 0) orbit.dist = Math.min(ZMAX, Math.max(ZMIN, pinchDist0 * (pinchSpan0 / d)));
        idleReset();
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        moved += Math.hypot(dx, dy);
        orbit.theta += dx * 0.006;
        orbit.phi = Math.min(1.45, Math.max(0.15, orbit.phi + dy * 0.005));
        drag = { x: e.clientX, y: e.clientY };
        spinAt = Date.now() + 4000; shotAt = 0;
      } else if (!isTouch) {
        hover(e);
      }
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      orbit.dist = Math.min(ZMAX, Math.max(ZMIN, orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      /* la molette coupe la veille, sinon le plan en cours reprend la main
         sur la distance et le zoom paraît sans effet */
      idleReset();
    }, { passive: false });

    const ray = new T.Raycaster(); const ndc = new T.Vector2();
    function hover(e) {
      const rct = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rct.left) / rct.width) * 2 - 1;
      ndc.y = -((e.clientY - rct.top) / rct.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(pick, false);
      const h = hits.length ? hits[0].object.userData.p : null;
      hovNode = hits.length ? hits[0].object.userData.node : null;
      hovering = h;
      canvas.style.cursor = h ? "pointer" : "grab";
      if (h) {
        tip.style.display = "";
        tip.style.left = (e.clientX - rct.left + 14) + "px";
        tip.style.top = (e.clientY - rct.top + 10) + "px";
        tip.innerHTML =
          "<b>" + title.replace(/</g, "&lt;").split(" [")[0] + " #" + h.idx + "</b><br>" +
          (h.free ? "Planète libre" :
            (h.owner.replace(/</g, "&lt;") + (h.tag ? " [" + h.tag + "]" : "") + "<br>" +
             "Population " + (h.popUnknown ? "?" : h.pop) +
             (h.sb ? " · Starbase " + h.sb : "") +
             (h.fleet ? " · 🚀 flotte en orbite" : "")));
      } else {
        tip.style.display = "none";
      }
    }
    /* Un script tiers de la page appelle preventDefault() sur touchstart :
       Android ne synthétise donc AUCUN click au doigt, et une sélection câblée
       sur "click" ne se déclenche jamais dans l'app. On traite l'appui depuis
       pointerup, et on ne garde "click" que pour la souris. */
    function activate() {
      if (!hovering) return;
      if (moved > 8) return;   /* c'était un glissé de caméra, pas une sélection */
      /* au doigt : le 1er appui sélectionne et montre la fiche, le 2e sur la
         MÊME planète ouvre la page — sinon on navigue par accident en pivotant */
      if (isTouch && tapSel !== hovering) { tapSel = hovering; return; }
      tapSel = null;
      if (hovering.mine && hovering.planetId) location.href = "/Game/Planets/Planet/" + hovering.planetId;
      else if (hovering.profileHref) location.href = hovering.profileHref;
    }
    let tapDone = 0;
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      if (pointers.size > 0) return;   /* un doigt restait posé : pas un appui */
      tapDone = Date.now();
      activate();
    });
    canvas.addEventListener("click", () => {
      if (Date.now() - tapDone < 700) return;   /* déjà traité au doigt */
      activate();
    });

    function resize() {
      const w = body.clientWidth, h = body.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();

    /* Libérer le contexte en quittant la page. La WebView enchaîne les
       navigations et un contexte non libéré reste vivant : au bout de quelques
       pages le navigateur refuse d'en créer un de plus — c'est l'erreur
       « creating WebGL context ». forceContextLoss le rend vraiment. */
    window.addEventListener("pagehide", function (e) {
      /* ⚠ e.persisted : mise en cache arrière/avant, la page peut revenir
         telle quelle — détruire le contexte ici la ferait revenir morte. */
      if (e && e.persisted) return;
      try {
        ctxLost = true;
        renderer.dispose();
        const ext = renderer.getContext().getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (e2) {}
    });

    const lblDown = new T.Vector3(), lblQ = new T.Quaternion();
    console.log("[AW-S3D] scène construite à " + since() + " (" + texStat.n + " textures demandées)");
    let firstFrame = false;
    (function loop(t) {
      requestAnimationFrame(loop);
      if (!firstFrame) { firstFrame = true; console.log("[AW-S3D] première image à " + since()); }
      if (ctxLost) return;           /* contexte mort : ne pas le marteler */
      if (body.style.display === "none") return;
      if (document.hidden) return;   /* écran éteint / onglet caché : rien à brûler */
      if (!spin && !drag && spinAt && Date.now() > spinAt) { spin = true; spinAt = 0; shotAt = 0; }
      const tt = (t || 0) * 0.001;
      /* veille = plan-séquence cadré sur ma planète ; sinon pilotage direct */
      if (spin && !drag) idleCam(tt); else manualCam();
      placeCam();
      // soleil vivant : plasma animé + protubérances qui naissent et meurent
      sunUpdate(tt);
      // ambiance : comète, étoile filante, scintillement
      fxUpdate(tt);
      // grossissement doux de la planète survolée
      pick.forEach((h) => {
        const n = h.userData.node, target = (n === hovNode) ? 1.3 : 1;
        n.scale.setScalar(n.scale.x + (target - n.scale.x) * 0.18);
      });
      // planètes : rotation propre autour de leur axe incliné ; les nuages
      // glissent un peu plus vite que le sol. L'éclairage (jour/nuit, villes)
      // est celui du moteur : plus aucun uniform à pousser.
      for (const s of sats) {
        const a = tt * s.speed + s.phase;
        s.sp.position.set(Math.cos(a) * s.r, s.y, Math.sin(a) * s.r);
      }
      /* Étiquettes : un décalage figé en -Y s'écrase à l'écran dès que la
         caméra plonge (le vecteur part dans l'axe de vue) et le texte finit
         SUR la planète. On projette « bas de l'écran » dans le repère du
         groupe, comme les étiquettes de la carte 3D. */
      lblDown.set(0, -1, 0).applyQuaternion(camera.quaternion)
        .applyQuaternion(group.getWorldQuaternion(lblQ).invert());
      for (const L of labels) L.sp.position.copy(lblDown).multiplyScalar(L.off);
      for (const pm of planetMeshes) {
        pm.m.rotation.y = pm.rot0 + tt * pm.sp;
        if (pm.clouds) pm.clouds.rotation.y = pm.rot0 + 0.4 + tt * pm.sp * 1.3;
      }
      renderer.render(scene, camera);
    })(0);
  }
})();
