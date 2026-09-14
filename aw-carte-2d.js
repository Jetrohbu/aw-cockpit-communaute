/* ════════════════════════════════════════════════════════════════════════
   AW3D — CALQUES SUR LA CARTE 2D DU JEU  (/Game/Map)
   ────────────────────────────────────────────────────────────────────────
   Deux calques posés PAR-DESSUS la carte que le jeu dessine déjà :
     • « Territoires AW » : un SVG, un contour par grappe de systèmes alliés.
     • « Portée AW »      : un canvas, qui atteint chaque point en premier.

   Ce fichier ne dépend NI de three NI du moteur 3D. Il fonctionne même si la
   vue 3D n'est jamais ouverte — c'est voulu : c'est la seule partie du projet
   qui doit rester utilisable quand WebGL est indisponible (vieux mobile,
   contexte perdu, GPU blacklisté).

   ── CONTRAT AVEC LES VOISINS ────────────────────────────────────────────
   Il ne parle qu'à deux voisins, et NE REDUPLIQUE RIEN :
     NS       (aw3d-core) — NS.active (garde d'URL), NS.onTap(el, fn)
     NS.data  (aw3d-data) — NS.data.snapshot({orbits, alliance}) → Promise
                            NS.data.pretes → Promise (mémoire des couleurs)
   Le pipeline de données (readMapData / mergeScans / couleurs d'alliance) vit
   dans aw3d-data et NULLE PART AILLEURS : chacune de ses fonctions encode une
   leçon payée cher, une deuxième copie serait une divergence garantie.

   ORDRE — après aw3d-core et aw3d-data. Concaténable tel quel pour le bundle
   du mod Android (IIFE autonome, n'écrit que dans window.AW3D).
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var NS = window.AW3D;
  /* Socle absent, mauvaise page, ou fichier déjà chargé : on ne fait rien.
     Le test sur NS.map2d protège du double chargement (manifeste + bundle mod
     concaténé, cas déjà vu). */
  if (!NS || !NS.active || NS.map2d) return;

  /* ── LES CONSTANTES, NOMMÉES ET EN TÊTE ───────────────────────────────
     Elles étaient jusqu'ici en dur au milieu des boucles, ce qui obligeait à
     relire l'algorithme pour retrouver le seuil qu'on voulait ajuster.
     Les valeurs sont celles validées, à la virgule près : ne pas les changer
     sans revalider à l'œil sur la carte. */
  var SEUIL_LIEN = 4.6;   /* cases : deux systèmes plus proches que ça sont
                             de la même grappe (liaison simple). Au-delà de 5
                             les grappes fusionnent d'un bout à l'autre de la
                             carte, en dessous de 4 elles se pulvérisent. */
  var MARGE      = 1.25;  /* cases : écartement de l'ancienne enveloppe convexe
                             (contour()), remplacée par territoire() — RAYON et
                             ZONE_TAMPON, plus bas, jouent ce rôle désormais. */
  var CANVAS_PX  = 320;   /* la portée est calculée en 320×320 puis étirée par
                             le navigateur sur toute la carte : c'est un
                             dégradé doux, le flou de l'agrandissement le sert
                             au lieu de le trahir, et ça coûte mille fois moins
                             qu'un calcul à la résolution de l'écran. */
  var C1 = -33, C2 = 33;  /* l'étendue de la galaxie en cases, coin à coin. */
  var K_SB       = 0.06;  /* la starbase raccourcit la distance : d/(1+0,06·niv) */
  var PORTEE_D   = 22;    /* cases : distance à laquelle la teinte s'éteint. */
  var SEUIL_FRONT = 0.055;/* écart relatif des deux meilleurs temps sous lequel
                             on creuse l'opacité : c'est la couture entre deux
                             zones (autrefois blanchie -- bande claire et
                             pointillés blancs, retirés le 2026-09-09). */
  var PERIODE    = 600;   /* ms entre deux contrôles d'échelle. */

  var T2D_ID = "awt2d", P2D_ID = "awp2d";

  var terrOn = false, porteeOn = false, timer = null, derniereEchelle = 0;
  var porteeCv = null;             /* le canvas mémorisé, cf. placerPortee() */
  var genTerr = 0, genPortee = 0;  /* garde anti-course, cf. plus bas */
  var repereRale = false;          /* pour ne râler qu'une fois en console */

  /* ── GÉOMÉTRIE DE POLYGONES ───────────────────────────────────────────
     Recopiées telles quelles. Elles vivaient jusqu'ici au milieu du pipeline
     de données, où elles n'avaient rien à faire : c'est ici leur vraie place,
     elles ne servent qu'aux territoires. La 3D avait sa propre copie de ce
     même algorithme (buildZones), morte depuis le retrait des nappes 3D : il
     n'en existe plus qu'UNE, et toute retouche de rendu se fait ici. */

  /* (Plus utilisée depuis territoire() ci-dessous — gardée pour référence.)
     enveloppe convexe (chaîne monotone d'Andrew) puis écartement radial.
     Un ou deux systèmes n'ont pas d'enveloppe : on leur fabrique un disque
     ou une gélule, sinon ils seraient les seuls à ne pas avoir de zone. */
  function contour(pts, marge) {
    if (pts.length === 1) return cercle(pts[0][0], pts[0][1], marge, 28);
    if (pts.length === 2) return gelule(pts[0], pts[1], marge, 14);
    var p = pts.slice().sort(function (u, v) { return u[0] - v[0] || u[1] - v[1]; });
    var cr = function (o, a, b) { return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]); };
    var bas = [], haut = [];
    for (var i = 0; i < p.length; i++) {
      while (bas.length >= 2 && cr(bas[bas.length-2], bas[bas.length-1], p[i]) <= 0) bas.pop();
      bas.push(p[i]);
    }
    for (var j = p.length - 1; j >= 0; j--) {
      while (haut.length >= 2 && cr(haut[haut.length-2], haut[haut.length-1], p[j]) <= 0) haut.pop();
      haut.push(p[j]);
    }
    bas.pop(); haut.pop();
    var h = bas.concat(haut);
    if (h.length < 3) return gelule(p[0], p[p.length-1], marge, 14);
    /* écartement : chaque sommet s'éloigne du centre de gravité */
    var cx = 0, cy = 0;
    h.forEach(function (q) { cx += q[0]; cy += q[1]; });
    cx /= h.length; cy /= h.length;
    return h.map(function (q) {
      var vx = q[0] - cx, vy = q[1] - cy, L = Math.sqrt(vx*vx + vy*vy) || 1;
      return [q[0] + vx / L * marge, q[1] + vy / L * marge];
    });
  }

  function cercle(x, y, r, n) {
    var o = [];
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; o.push([x + Math.cos(a)*r, y + Math.sin(a)*r]); }
    return o;
  }

  function gelule(A, B, r, n) {
    var dx = B[0]-A[0], dy = B[1]-A[1], L = Math.hypot(dx, dy) || 1;
    var ux = dx/L, uy = dy/L, o = [];
    for (var i = 0; i <= n; i++) { var a = Math.atan2(uy, ux) - Math.PI/2 + i/n*Math.PI;
      o.push([B[0] + Math.cos(a)*r, B[1] + Math.sin(a)*r]); }
    for (var j = 0; j <= n; j++) { var b = Math.atan2(uy, ux) + Math.PI/2 + j/n*Math.PI;
      o.push([A[0] + Math.cos(b)*r, A[1] + Math.sin(b)*r]); }
    return o;
  }

  /* Chaikin : chaque segment est remplacé par ses deux quarts. Deux passes
     suffisent à transformer un polygone anguleux en courbe douce. */
  function lisser(poly) {
    var o = [], n = poly.length;
    for (var i = 0; i < n; i++) {
      var A = poly[i], B = poly[(i+1) % n];
      o.push([A[0]*0.75 + B[0]*0.25, A[1]*0.75 + B[1]*0.25]);
      o.push([A[0]*0.25 + B[0]*0.75, A[1]*0.25 + B[1]*0.75]);
    }
    return o;
  }

  /* Regroupement par liaison simple (union-find). Extrait de dessine2d(), où
     il était mêlé au dessin : deux points reliés dès qu'ils sont à moins de
     `seuil` cases, et la relation se propage de proche en proche. */
  function grappes(P, seuil) {
    var n = P.length, par = [], i, j;
    for (i = 0; i < n; i++) par.push(i);
    function racine(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    var s2 = seuil * seuil;
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1];
        if (dx * dx + dy * dy <= s2) {
          var ra = racine(i), rb = racine(j);
          if (ra !== rb) par[ra] = rb;
        }
      }
    }
    var grp = {}, out = [];
    for (i = 0; i < n; i++) {
      var r = racine(i);
      (grp[r] || (grp[r] = [])).push(P[i]);
    }
    Object.keys(grp).forEach(function (k) { out.push(grp[k]); });
    return out;
  }

  /* ── TERRITOIRE CONCAVE ─────────────────────────────────────────────────
     L'enveloppe convexe englobait tout ce qui se trouvait ENTRE les systèmes
     d'une grappe : un système libre ou ennemi logé dans un creux se
     retrouvait « dans » le territoire. On calcule maintenant un champ scalaire
     sur une grille de MAILLE cases, négatif là où le point est à la fois
       · à moins de RAYON d'un système de la grappe (union de disques),
       · plus près d'un système de la grappe que de tout AUTRE système, avec
         une marge (ZONE_TAMPON) pour que le trait passe entre les deux ;
     puis on en extrait l'isoligne zéro (marching squares, interpolée, donc
     lisse) et on la ferme en boucles. Un système étranger creuse un trou ou
     une échancrure au lieu d'être avalé. */
  var MAILLE = 0.25;      /* cases : finesse de la grille du champ */
  var RAYON  = 2.3;       /* cases : portée du disque autour de chaque système
                             de la grappe ; ≥ SEUIL_LIEN/2 pour que deux
                             systèmes reliés se rejoignent sans pincement */
  var ZONE_TAMPON = 0.35; /* cases : le trait passe à mi-chemin, décalé de ça
                             vers nous — jamais sur le système étranger */

  function territoire(pts, autres) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i, j;
    for (i = 0; i < pts.length; i++) {
      x0 = Math.min(x0, pts[i][0]); x1 = Math.max(x1, pts[i][0]);
      y0 = Math.min(y0, pts[i][1]); y1 = Math.max(y1, pts[i][1]);
    }
    x0 -= RAYON + MAILLE; y0 -= RAYON + MAILLE; x1 += RAYON + MAILLE; y1 += RAYON + MAILLE;
    /* seuls les étrangers qui peuvent influencer la boîte comptent */
    var pr = [];
    for (i = 0; i < autres.length; i++) {
      var a = autres[i];
      if (a[0] >= x0 - RAYON && a[0] <= x1 + RAYON && a[1] >= y0 - RAYON && a[1] <= y1 + RAYON) pr.push(a);
    }
    var nx = Math.ceil((x1 - x0) / MAILLE) + 1, ny = Math.ceil((y1 - y0) / MAILLE) + 1;
    var f = new Float32Array(nx * ny);
    for (j = 0; j < ny; j++) {
      var y = y0 + j * MAILLE;
      for (i = 0; i < nx; i++) {
        var x = x0 + i * MAILLE, dn = Infinity, de = Infinity, k, dx, dy, d;
        for (k = 0; k < pts.length; k++) { dx = pts[k][0] - x; dy = pts[k][1] - y; d = dx*dx + dy*dy; if (d < dn) dn = d; }
        for (k = 0; k < pr.length; k++)  { dx = pr[k][0] - x;  dy = pr[k][1] - y;  d = dx*dx + dy*dy; if (d < de) de = d; }
        dn = Math.sqrt(dn); de = Math.sqrt(de);
        /* négatif = dedans. max() = intersection des deux conditions */
        f[j * nx + i] = Math.max(dn - RAYON, dn - de + ZONE_TAMPON);
      }
    }
    /* marching squares : un segment par arête coupée, puis chaînage */
    var segs = [];
    function P(ia, ja, ib, jb) {   /* point sur l'arête (ia,ja)-(ib,jb) */
      var fa = f[ja * nx + ia], fb = f[jb * nx + ib], t = fa / (fa - fb);
      return [x0 + (ia + (ib - ia) * t) * MAILLE, y0 + (ja + (jb - ja) * t) * MAILLE];
    }
    for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
      var c = (f[j*nx+i] < 0 ? 8 : 0) | (f[j*nx+i+1] < 0 ? 4 : 0) |
              (f[(j+1)*nx+i+1] < 0 ? 2 : 0) | (f[(j+1)*nx+i] < 0 ? 1 : 0);
      if (c === 0 || c === 15) continue;
      var T = [i, j, i+1, j], R = [i+1, j, i+1, j+1], B = [i, j+1, i+1, j+1], L = [i, j, i, j+1];
      var e = [];
      switch (c) {
        case 1: case 14: e = [L, B]; break;
        case 2: case 13: e = [B, R]; break;
        case 3: case 12: e = [L, R]; break;
        case 4: case 11: e = [T, R]; break;
        case 5:          e = [L, T, B, R]; break;
        case 6: case 9:  e = [T, B]; break;
        case 7: case 8:  e = [L, T]; break;
        case 10:         e = [L, B, T, R]; break;
      }
      for (var q = 0; q < e.length; q += 2)
        segs.push([P.apply(null, e[q]), P.apply(null, e[q + 1])]);
    }
    /* chaînage par extrémités (clé = position arrondie à 1/1000 de case) */
    var key = function (p) { return Math.round(p[0] * 1000) + "," + Math.round(p[1] * 1000); };
    var adj = {};
    for (i = 0; i < segs.length; i++) {
      var ka = key(segs[i][0]), kb = key(segs[i][1]);
      (adj[ka] || (adj[ka] = [])).push(i); (adj[kb] || (adj[kb] = [])).push(i);
    }
    var vu = new Uint8Array(segs.length), boucles = [];
    for (i = 0; i < segs.length; i++) {
      if (vu[i]) continue;
      var loop = [segs[i][0]], cur = i, pt = segs[i][1];
      vu[i] = 1;
      for (var n = 0; n < segs.length; n++) {
        loop.push(pt);
        var cands = adj[key(pt)] || [], nxt = -1;
        for (var m = 0; m < cands.length; m++) if (!vu[cands[m]]) { nxt = cands[m]; break; }
        if (nxt < 0) break;
        vu[nxt] = 1;
        pt = key(segs[nxt][0]) === key(pt) ? segs[nxt][1] : segs[nxt][0];
        cur = nxt;
      }
      if (loop.length >= 6) boucles.push(loop);
    }
    return boucles;
  }

  /* ── LE CONTENEUR ET LE REPÈRE ────────────────────────────────────────
     Un calque glissé DANS le conteneur où le jeu place ses systèmes en
     position absolue (#mapContent). En être l'enfant règle tout d'un coup : le
     calque suit le déplacement et le zoom de la carte sans qu'on ait rien à
     écouter, et le SVG reste net à n'importe quelle échelle — là où un canvas
     cranterait. */
  /* ⚠ Le jeu a changé sa carte (09/2026) : ses systèmes vivent maintenant dans
     #mapContent (> .map-layer-systems > .map-planet), un bloc déplacé par
     translate3d au glisser et dont les enfants sont en position absolue.
     #aw-map-inner, l'ancienne cible, est le conteneur de NOTRE visionneuse
     flottante (#aw-map-viewer, masquée sur /Game/Map) : y dessiner allumait
     le bouton et ne montrait rien. On vise donc la carte du jeu d'abord, et
     l'on garde l'ancienne cible en repli pour la visionneuse. */
  function mapInner() {
    return document.getElementById("mapContent") || document.getElementById("aw-map-inner");
  }

  /* La conversion case → pixel est relevée sur les systèmes EUX-MÊMES : le jeu
     écrit leurs coordonnées dans data-coords et leur position dans style.left.
     Aucune constante en dur, donc rien à retoucher quand le jeu change ses
     dimensions ou son zoom.
     ⚠ Limite connue : il faut deux systèmes qui diffèrent en x ET deux qui
     diffèrent en y. Une carte servie sur une seule ligne ou une seule colonne
     (ça arrive tout au bord de la galaxie) ne donne pas d'échelle et les deux
     calques disparaissent — d'où le message console, sinon c'est un « rien ne
     s'affiche » sans aucune piste.
     `muet` sert pendant l'attente au chargement : la carte n'est pas encore
     posée, échouer est alors NORMAL et ne mérite pas d'avertissement. */
  function repere2d(muet) {
    /* Carte du jeu : chaque .map-planet porte « Nom [id] (x/y) » en texte et sa
       position en style.left/top — coin HAUT-GAUCHE de l'icône, d'où le
       recentrage sur l'image. Repli : nos .aw-map-system[data-coords]. */
    var els = document.querySelectorAll("#mapContent .map-planet");
    var natif = els.length > 0;
    if (!natif) els = document.querySelectorAll(".aw-map-system[data-coords]");
    var pts = [];
    var re = /\(\s*(-?\d+)\s*\/\s*(-?\d+)\s*\)/;
    for (var i = 0; i < els.length && pts.length < 400; i++) {
      var el = els[i];
      var m = re.exec(natif ? (el.textContent || "") : (el.dataset.coords || ""));
      if (!m) continue;
      var px = parseFloat(el.style.left), py = parseFloat(el.style.top);
      if (!isFinite(px) || !isFinite(py)) continue;
      if (natif) {
        var img = el.querySelector("img") || el;
        px += (img.offsetWidth || 0) / 2;
        py += (img.offsetHeight || 0) / 2;
      }
      pts.push({ cx: +m[1], cy: +m[2], px: px, py: py });
    }
    if (pts.length < 2)
      return rate(muet, "moins de deux systèmes positionnés dans #mapContent / #aw-map-inner");
    var ax = null, ay = null;
    for (var a = 0; a < pts.length && (ax === null || ay === null); a++) {
      for (var b = a + 1; b < pts.length; b++) {
        if (ax === null && pts[b].cx !== pts[a].cx)
          ax = (pts[b].px - pts[a].px) / (pts[b].cx - pts[a].cx);
        if (ay === null && pts[b].cy !== pts[a].cy)
          ay = (pts[b].py - pts[a].py) / (pts[b].cy - pts[a].cy);
      }
    }
    if (!ax || !ay)
      return rate(muet, "tous les systèmes servis sont alignés (pas d'échelle en x ou en y)");
    repereRale = false;
    return { ax: ax, bx: pts[0].px - ax * pts[0].cx,
             ay: ay, by: pts[0].py - ay * pts[0].cy };
  }

  function rate(muet, pourquoi) {
    if (!muet && !repereRale) {
      repereRale = true;
      try { console.warn("[AW3D/2D] échelle case→pixel introuvable : " + pourquoi); } catch (e) {}
    }
    return null;
  }

  /* Les données viennent du pipeline partagé, jamais recalculées ici.
     snapshot() porte son propre mémo de quelques secondes : sans lui, chaque
     détection de changement d'échelle rejouait readMapData + storageGet +
     mergeScans, pour les deux calques, soit quatre pipelines complets par cran
     de zoom. On ne remet donc PAS un cache par-dessus le sien.
     alliance:false et orbits:false = zéro requête réseau : ces calques sont
     décoratifs, ils n'ont pas à faire travailler le serveur du jeu. */
  function donnees2d() {
    if (!NS.data || !NS.data.snapshot) return Promise.resolve(null);
    return NS.data.snapshot({ orbits: false, alliance: false });
  }

  /* ── TERRITOIRES (SVG) ────────────────────────────────────────────────── */

  function chemin2d(poly, R) {
    var d = "";
    for (var i = 0; i < poly.length; i++) {
      d += (i ? "L" : "M") + (R.ax * poly[i][0] + R.bx).toFixed(1) + " " +
           (R.ay * poly[i][1] + R.by).toFixed(1) + " ";
    }
    return d + "Z";
  }

  async function dessine2d() {
    /* Garde anti-course : deux redessins peuvent se chevaucher (un clic pendant
       que le timer travaille). Seul le dernier lancé a le droit d'écrire dans
       le DOM ; les autres se retirent après leur await. */
    var moi = ++genTerr;
    if (!terrOn) { retirer(T2D_ID); return; }
    var inner = mapInner(), R = repere2d();
    if (!inner || !R) { retirer(T2D_ID); return; }
    var data = await donnees2d();
    if (moi !== genTerr || !terrOn || !data) return;

    var parTag = {}, tous = [];
    data.systems.forEach(function (s) {
      tous.push([s.cx, s.cy, s.tag || ""]);
      if (!s.tag || !s.hex) return;
      (parTag[s.tag] || (parTag[s.tag] = { hex: s.hex, pts: [] })).pts.push([s.cx, s.cy]);
    });

    var SVGNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(SVGNS, "svg");
    svg.id = T2D_ID;
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    /* 1×1 + overflow:visible : le SVG n'a pas à connaître la taille de la carte,
       il dessine hors de sa boîte. Un viewBox obligerait à le retailler à chaque
       zoom, et à se tromper d'un pixel. */
    svg.setAttribute("style", "position:absolute;left:0;top:0;overflow:visible;" +
      "pointer-events:none;z-index:0");

    Object.keys(parTag).forEach(function (tag) {
      var e = parTag[tag];
      /* « autres » = tout système qui n'est pas de cette alliance, libres et
         inconnus compris : eux non plus ne sont pas « à nous » */
      var autres = tous.filter(function (t) { return t[2] !== tag; });
      grappes(e.pts, SEUIL_LIEN).forEach(function (g) {
        var boucles = territoire(g, autres);
        if (!boucles.length) return;
        var dd = "";
        boucles.forEach(function (b) { dd += chemin2d(lisser(b), R) + " "; });
        var path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", dd.trim());
        /* evenodd : un système étranger au milieu de la grappe fait un TROU
           (boucle intérieure), il ne doit pas être rempli */
        path.setAttribute("fill-rule", "evenodd");
        /* ⚠ e.hex est TOUJOURS de l'hexadécimal (cf. NS.tagColor dans aw3d-data) :
           une couleur hsl(h,s%,l%) contient des virgules et casse en silence tout
           ce qui joint/redécoupe des clés ailleurs dans le projet — le tag
           « TUGA » s'affichait « TUGA · 65 · 45% ». */
        path.setAttribute("fill", e.hex);
        path.setAttribute("fill-opacity", "0.09");
        path.setAttribute("stroke", e.hex);
        path.setAttribute("stroke-opacity", "0.85");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
      });
    });

    /* On ne retire l'ancien qu'ICI, une fois le nouveau prêt : retirer avant
       l'await faisait clignoter les territoires à chaque cran de zoom.
       Inséré EN PREMIER dans #aw-map-inner : les systèmes et leurs étiquettes,
       qui sont des frères suivants, restent au-dessus. */
    retirer(T2D_ID);
    /* ⚠ relire le conteneur APRÈS l'attente : le jeu a pu reconstruire
       #aw-map-inner pendant le await, et on insérerait dans un arbre détaché */
    var cible = mapInner();
    if (!cible) return;
    cible.insertBefore(svg, cible.firstChild);
    ordonner();
  }

  /* ── PORTÉE (canvas) ──────────────────────────────────────────────────
     Qui atteint chaque point en premier — ex-« Influence » de la 3D, dont la
     version 3D a été retirée à la demande : celle-ci est la seule vivante, et
     donc la seule formule d'atténuation encore en service. */

  async function dessinePortee2d() {
    var moi = ++genPortee;
    if (!porteeOn) { retirer(P2D_ID); porteeCv = null; return; }
    var inner = mapInner(), R = repere2d();
    if (!inner || !R) { retirer(P2D_ID); porteeCv = null; return; }
    var data = await donnees2d();
    if (moi !== genPortee || !porteeOn || !data) return;

    var src = [];
    data.systems.forEach(function (s) {
      if (s.tag && s.hex) src.push({ x: s.cx, y: s.cy, hex: s.hex, sb: s.sbMax || 0 });
    });
    if (src.length < 2) { retirer(P2D_ID); porteeCv = null; return; }

    var N = CANVAS_PX;
    var cv = document.createElement("canvas");
    cv.id = P2D_ID; cv.width = N; cv.height = N;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(N, N);
    var d = img.data, col = document.createElement("canvas").getContext("2d");

    /* couleurs résolues une seule fois : le passage par fillStyle normalise
       n'importe quelle écriture (#abc, nom CSS…) en #rrggbb. Le "#000" posé
       d'abord sert de valeur de repli si la couleur suivante est refusée. */
    var rgb = {};
    src.forEach(function (o) {
      if (rgb[o.hex]) return;
      col.fillStyle = "#000"; col.fillStyle = o.hex;
      var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(col.fillStyle);
      var c3 = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [150, 160, 180];
      /* Plafond de luminance : une alliance en blanc pur (ZOD) posait un
         voile blanc-gris sur tout son secteur, qui se lisait comme une
         « zone blanche » et non comme une couleur. On garde la teinte et on
         ramène la clarté sous 165/255 : le blanc devient un gris-bleu doux,
         les couleurs franches ne bougent pas. */
      var lum = 0.299 * c3[0] + 0.587 * c3[1] + 0.114 * c3[2];
      if (lum > 165) { var f = 165 / lum; c3 = [c3[0] * f, c3[1] * f, c3[2] * f]; }
      rgb[o.hex] = c3;
    });

    /* 320 × 320 × nb_systèmes ≈ 20 millions d'itérations sur le thread
       principal : c'est LE gel de la page. Il est acceptable parce qu'il
       n'arrive qu'à l'activation du calque — au zoom on se contente de
       replacer le canvas (cf. placerPortee), l'image étant calculée en
       coordonnées de CASES, donc indépendante de l'échelle. */
    for (var j = 0; j < N; j++) {
      var wy = C1 + (j + .5) / N * (C2 - C1);
      for (var i = 0; i < N; i++) {
        var wx = C1 + (i + .5) / N * (C2 - C1);
        var t1 = 1e9, h1 = null, t2 = 1e9, h2 = null;
        for (var q = 0; q < src.length; q++) {
          var o = src[q];
          var t = Math.sqrt((o.x - wx) * (o.x - wx) + (o.y - wy) * (o.y - wy)) / (1 + o.sb * K_SB);
          /* on ne garde que les deux MEILLEURES ALLIANCES, pas les deux
             meilleurs systèmes : deux systèmes de la même alliance côte à côte
             fabriqueraient sinon une fausse crête entre eux. */
          if (o.hex === h1) { if (t < t1) t1 = t; continue; }
          if (t < t1) { t2 = t1; h2 = h1; t1 = t; h1 = o.hex; }
          else if (t < t2 && o.hex !== h1) { t2 = t; h2 = o.hex; }
        }
        var k = (j * N + i) * 4;
        if (!h1) { d[k + 3] = 0; continue; }
        var c3 = rgb[h1];
        /* la teinte s'éteint progressivement avec la distance. À la frontière
           (deux alliances arrivent en même temps) on ne BLANCHIT plus : le
           mélange vers le blanc dessinait une bande claire entre les zones et,
           à 320 px étirés, des pointillés blancs partout où le critère
           basculait d'un pixel à l'autre. On creuse l'opacité à la place :
           l'espace transparaît, la couture est sombre et fine. */
        var por = Math.pow(Math.max(0, 1 - t1 / PORTEE_D), 1.5);
        var cr = h2 ? Math.max(0, 1 - (t2 / t1 - 1) / SEUIL_FRONT) : 0;
        d[k]     = c3[0];
        d[k + 1] = c3[1];
        d[k + 2] = c3[2];
        d[k + 3] = Math.min(255, por * 150 * (1 - 0.7 * cr));
      }
    }
    ctx.putImageData(img, 0, 0);

    retirer(P2D_ID);
    porteeCv = cv;
    placerPortee(R);
    var cible2 = mapInner();          /* même raison que pour les territoires */
    if (!cible2) { porteeCv = null; return; }
    cible2.insertBefore(cv, cible2.firstChild);
    ordonner();
  }

  /* L'image est calculée en cases : au zoom, il suffit de la réétirer.
     C'est ce qui évite de rejouer 20 M d'itérations à chaque cran de zoom —
     l'ancienne version recalculait tout, d'où le gel à la molette. */
  function placerPortee(R) {
    if (!porteeCv) return;
    var x1 = R.ax * C1 + R.bx, x2 = R.ax * C2 + R.bx;
    var y1 = R.ay * C1 + R.by, y2 = R.ay * C2 + R.by;
    var gx = Math.min(x1, x2), gy = Math.min(y1, y2);
    var gw = Math.abs(x2 - x1), gh = Math.abs(y2 - y1);
    /* filter:blur : l'image de 320 px est étirée sur toute la carte, chaque
       pixel devient un carreau de plusieurs px d'écran et les frontières
       faisaient des marches d'escalier. Un flou de 3 px ÉCRAN (le filtre est
       en px CSS, il ne grossit pas avec le zoom) les fond, pour zéro calcul
       côté JS. */
    porteeCv.setAttribute("style", "position:absolute;pointer-events:none;z-index:0;" +
      "left:" + gx + "px;top:" + gy + "px;width:" + gw + "px;height:" + gh + "px;" +
      "opacity:.5;filter:blur(3px)");
  }

  /* ORDRE DES CALQUES, imposé après chaque insertion.
     Les deux calques sont en z-index 0 : c'est donc l'ordre DOM qui décide, et
     le premier enfant est peint EN DESSOUS. Comme chacun se réinsère en
     premier enfant lorsqu'il se redessine, celui qui se redessinait en dernier
     passait dessous — au premier zoom, seuls les territoires étaient rejoués,
     et la nappe de portée leur passait par-dessus. On range donc explicitement :
     portée tout en bas, territoires juste au-dessus, systèmes du jeu ensuite. */
  function ordonner() {
    var inner = mapInner();
    if (!inner) return;
    var svg = document.getElementById(T2D_ID);
    if (svg && svg.parentNode === inner) inner.insertBefore(svg, inner.firstChild);
    var cv = document.getElementById(P2D_ID);
    if (cv && cv.parentNode === inner) inner.insertBefore(cv, inner.firstChild);
  }

  function retirer(id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ── LE TIMER, UNIQUE ─────────────────────────────────────────────────
     Le jeu repositionne ses systèmes au zoom sans prévenir : on redessine
     quand l'ÉCHELLE a changé, jamais à chaque image.
     ⚠ Il n'y avait autrefois qu'un seul point d'armement, dans le bouton
     Territoires : activer « Portée AW » SEULE laissait son canvas sans aucun
     rafraîchissement, il décrochait du zoom du jeu. Un seul timer pour les
     deux calques, armé dès que l'un d'eux est actif : le bug ne peut plus
     revenir par construction. */
  function armerTimer() {
    var besoin = terrOn || porteeOn;
    if (besoin && !timer) {
      derniereEchelle = 0;
      var essais = 0;   /* cf. le plafond de relance, plus bas */
      timer = setInterval(function () {
        var R = repere2d(true);   /* muet : la carte peut être en train de se refaire */
        if (!R) return;
        var bouge = Math.abs(R.ax - derniereEchelle) > 0.01;

        /* ── RATTRAPAGE ────────────────────────────────────────────────
           Le calque de portée pouvait mourir DÉFINITIVEMENT : le test de
           reprise exigeait `porteeCv && !porteeCv.parentNode`, donc si le tout
           premier dessin échouait (données pas encore là), porteeCv restait
           nul et la reprise ne se déclenchait jamais — bouton allumé, rien à
           l'écran, pour toujours. On teste maintenant l'ABSENCE dans le DOM,
           qui couvre les deux cas.
           Plafond de relance : sans lui, une carte qui ne rend jamais de
           données faisait rappeler snapshot() deux fois par seconde
           indéfiniment. Après huit essais on s'arrête ; un vrai changement
           d'échelle réarme le compteur, car c'est le signe que la carte vit. */
        var manqueP = porteeOn && !document.getElementById(P2D_ID);
        var manqueT = terrOn && !document.getElementById(T2D_ID);
        if (bouge) essais = 0;
        if ((manqueP || manqueT) && essais < 8) {
          essais++;
          if (manqueT) dessine2d();
          if (manqueP) dessinePortee2d();
          return;
        }
        if (!bouge) return;

        derniereEchelle = R.ax;
        if (terrOn) dessine2d();
        /* pas de recalcul de la portée : l'image est calculée en cases, on la
           réétire — c'est ce qui évite les 20 M d'itérations à chaque cran */
        if (porteeOn) { placerPortee(R); ordonner(); }
      }, PERIODE);
    } else if (!besoin && timer) {
      clearInterval(timer); timer = null;
    }
  }

  /* ── LES DEUX BOUTONS ─────────────────────────────────────────────────── */

  function peindre(id, on) {
    var b = document.getElementById(id);
    if (!b) return;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.style.color = on ? "#7ef7ff" : "#9fb0c8";
  }

  function memoriser(cle, on) {
    /* localStorage jette en navigation privée et dans certaines WebView : un
       calque qui ne se souvient pas est un désagrément, une exception ici
       coupait tout le basculement. */
    try { localStorage.setItem(cle, on ? "1" : "0"); } catch (e) {}
  }

  /* Allumer un calque 2D pendant que la vue 3D est ouverte donnait un bouton
     qui s'allume et rien à l'écran : la vue 3D masque la carte du jeu, et nos
     calques vivent DANS cette carte. On la referme donc — c'est ce que
     l'utilisateur demande implicitement en allumant un calque de la 2D. */
  function montrerLa2D() {
    var hote = document.getElementById("aw3d-host");
    if (!hote || !hote.classList.contains("on")) return;
    var b = document.getElementById("aw3d-btn");
    if (b) b.click();
  }

  function toggleTerr(on) {
    if (on) montrerLa2D();
    terrOn = !!on;
    memoriser("awt2d_on", terrOn);
    peindre("awt2d-btn", terrOn);
    dessine2d();
    armerTimer();
  }

  function togglePortee(on) {
    if (on) montrerLa2D();
    porteeOn = !!on;
    memoriser("awp2d_on", porteeOn);
    peindre("awp2d-btn", porteeOn);
    dessinePortee2d();
    armerTimer();
  }

  function groupeBouton(id, icone, titre, texte) {
    var g = document.createElement("div");
    g.className = "map-toolbar-group";
    g.innerHTML = '<span class="link" id="' + id + '" aria-pressed="false" ' +
      'title="' + titre + '" style="color:#9fb0c8;font-weight:600">' +
      '<i class="bi bi-' + icone + '"></i> ' +
      '<span class="d-none d-md-inline">' + texte + '</span></span>';
    return g;
  }

  /* ── RESTAURATION DE L'ÉTAT ───────────────────────────────────────────
     ⚠ Les deux setTimeout de 500 et 700 ms d'autrefois étaient un pari sur la
     vitesse de la machine, perdu une fois sur deux :
       · trop tôt côté DOM  → repere2d() ne trouve rien, le calque coché dans
         localStorage n'apparaissait tout simplement pas au chargement ;
       · trop tôt côté données → la mémoire des couleurs d'alliance n'était pas
         encore revenue de chrome.storage, et les alliances non déclarées dans
         le secteur servi repartaient sur une teinte de hachage : les couleurs
         changeaient d'un chargement à l'autre (piège n° 6).
     On attend donc les deux conditions au lieu de les espérer. */

  function pretDesDonnees() {
    var p = NS.data && NS.data.pretes;
    if (!p || typeof p.then !== "function") return Promise.resolve();
    /* Course de 2 s : si chrome.storage ne répond pas (extension rechargée
       sous nos pieds), mieux vaut un calque aux couleurs de repli que pas de
       calque du tout. */
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 2000); })]);
  }

  /* Attend que le jeu ait posé ses systèmes ET que l'échelle soit lisible.
     Environ 6 s de patience : au-delà, la carte ne viendra plus (secteur vide,
     page en erreur) et on laisse repere2d() dire pourquoi en console. */
  function quandCarteLevee(fn) {
    var essais = 0;
    (function tic() {
      if (mapInner() && repere2d(true)) { fn(); return; }
      if (++essais > 50) { repere2d(false); return; }
      setTimeout(tic, 120);
    })();
  }

  /* Les deux boutons sont posés dans la barre d'outils du jeu (#mapToolbar),
     à côté de « Vue 3D », pour qu'ils aient l'air d'en faire partie.
     mount() est IDEMPOTENT : il est appelé par l'amorçage de la vue 3D, par
     son MutationObserver quand la barre arrive en retard, et par notre propre
     filet ci-dessous. Le garde-fou est la présence du bouton. */
  function mount() {
    var bar = document.getElementById("mapToolbar");
    if (!bar || document.getElementById("awt2d-btn")) return;

    var gT = groupeBouton("awt2d-btn", "bounding-box",
      "Territoires des alliances sur la carte 2D", "Territoires AW");
    var sep = document.createElement("div");
    sep.className = "map-toolbar-divider";
    bar.insertBefore(sep, bar.firstChild);
    bar.insertBefore(gT, bar.firstChild);

    var gP = groupeBouton("awp2d-btn", "broadcast",
      "Portée : qui atteint chaque point en premier", "Portée AW");
    bar.insertBefore(gP, bar.firstChild);

    /* ⚠ NS.onTap et jamais addEventListener("click") : un script tiers de la
       page appelle preventDefault() sur touchstart, Android ne synthétise
       alors AUCUN click et le bouton reste définitivement inerte au doigt. */
    NS.onTap(gT.querySelector("#awt2d-btn"), function () { toggleTerr(!terrOn); });
    NS.onTap(gP.querySelector("#awp2d-btn"), function () { togglePortee(!porteeOn); });

    var mT = null, mP = null;
    try {
      mT = localStorage.getItem("awt2d_on");
      mP = localStorage.getItem("awp2d_on");
    } catch (e) {}
    if (mT !== "1" && mP !== "1") return;

    pretDesDonnees().then(function () {
      quandCarteLevee(function () {
        if (mT === "1") toggleTerr(true);
        /* les 200 ms qui séparent les deux ne servent qu'à ne pas enchaîner
           deux gros calculs dans la même image : la portée gèle la page une
           demi-seconde, autant laisser les territoires s'afficher d'abord. */
        if (mP === "1") setTimeout(function () { togglePortee(true); }, 200);
      });
    });
  }

  /* Redessin forcé, pour quand les données ont changé sous nos pieds
     (nouveau scan enregistré, changement de secteur). */
  function redraw() {
    if (terrOn) dessine2d();
    if (porteeOn) dessinePortee2d();
  }

  /* Filet : normalement c'est l'amorçage de la vue 3D qui appelle mount().
     Si ce fichier-là n'est pas chargé (bundle partiel du mod Android, erreur
     de manifeste), les calques 2D doivent quand même être accessibles — ils
     ne dépendent en rien de la 3D. mount() étant idempotent, être appelé deux
     fois ne coûte rien. */
  function filet() {
    mount();
    if (document.getElementById("awt2d-btn")) return;
    var obs = new MutationObserver(function () {
      mount();
      if (document.getElementById("awt2d-btn")) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 20000);
  }

  /* Publication EN DERNIER : tant que NS.map2d n'existe pas, le fichier est
     considéré comme non chargé, ce qui rend la garde de double chargement du
     haut fiable même si une erreur survient au milieu. */
  NS.map2d = {
    mount: mount,
    toggleTerr: toggleTerr,
    togglePortee: togglePortee,
    redraw: redraw,
    etat: function () { return { terr: terrOn, portee: porteeOn }; }
  };
  if (NS.loaded) NS.loaded.push("map2d");

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", filet);
  else filet();
})();
