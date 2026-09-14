// AW Extension — Barres de progression du jeu rhabillées en JAUGES GRADUÉES.
//
// Reprise du système de l'UI 2026 (astrowars-2026, .a26-gauge) : un rail fin aux
// coins carrés, un remplissage à plat, et des graduations tous les 20 %. Le
// détail des graduations est ce qui fait basculer l'objet du côté « instrument »
// — on lit une valeur sur une échelle, plus une barre de chargement.
//
// Deux formes côté jeu :
//   .progress-bar        → rail + <div class="progress"> (Science, bâtiments)
//                          rien à faire en JS, tout se fait en CSS.
//   .progress-bar-timed  → rail + .progress + .progress-text DANS le rail
//                          (Planets, fiche planète). Un rail de 5 px ne peut
//                          plus contenir de texte : ce module sort le
//                          remplissage dans un rail dédié et laisse le texte à
//                          côté, la ligne devenant une flex-box (CSS).
//
// On ne touche JAMAIS au style="width:…" que le jeu réécrit sur .progress : c'est
// lui qui anime la barre en cours, et il reste prioritaire (style en ligne).
//
// Actif seulement quand le skin du jeu est activé (html.awc-gameskin), puisque
// tout l'habillage vit dans cockpit.css sous ce sélecteur.
(function () {
  "use strict";
  if (window.__AW_GAUGES__) return;
  window.__AW_GAUGES__ = true;

  const cls = () => document.documentElement.classList;
  const skinOn = () => cls().contains("awc-gameskin");
  // Marqueur posé sur <html> par reskin-early.js puis par les Réglages : absent
  // = « Barres d'origine », on ne touche à rien.
  const styleOn = () => cls().contains("awc-gauge-on");

  // Remet les barres telles que le jeu les écrit (choix « Barres d'origine »).
  function unGaugify() {
    document.querySelectorAll(".progress-bar-timed.aw-gauged").forEach(function (row) {
      const rail = row.querySelector(":scope > .aw-gauge");
      if (rail) {
        const fill = rail.querySelector(":scope > .progress");
        if (fill) row.insertBefore(fill, rail);
        rail.remove();
      }
      row.classList.remove("aw-gauged");
    });
  }

  function gaugify() {
    document.querySelectorAll(".progress-bar-timed").forEach(function (row) {
      let rail = row.querySelector(":scope > .aw-gauge");
      // Le jeu peut re-rendre la ligne en ajax et replacer un .progress à la
      // racine : on le récupère à chaque passage, pas seulement au premier.
      const fill = row.querySelector(":scope > .progress");
      if (!rail && !fill) return;
      if (!rail) {
        rail = document.createElement("div");
        rail.className = "aw-gauge";
        rail.setAttribute("data-aw-injected", "1");
        row.insertBefore(rail, fill);
      }
      if (fill) rail.appendChild(fill);
      row.classList.add("aw-gauged");
      markLive(rail, fill);
    });
    // Barres nues (Science, bâtiments) : rien à restructurer, juste le marquage
    // « en cours » qui pilote l'animation du style néon.
    document.querySelectorAll(".progress-bar > .progress").forEach(function (fill) {
      markLive(fill.parentElement, fill);
    });
  }

  // Une barre est « vivante » quand le jeu l'anime (data-ms-per-percent > 0) et
  // qu'elle n'est ni vide ni pleine : c'est celle-là, et elle seule, qui reçoit
  // le balayage lumineux — sinon toute la page clignote.
  function markLive(rail, fill) {
    if (!rail || !fill) return;
    const ms = parseFloat(fill.getAttribute("data-ms-per-percent") || "0");
    const v = parseFloat(fill.getAttribute("data-value") || "0");
    const live = ms > 0 && v > 0 && v < 100;
    if (live) rail.setAttribute("data-aw-live", "1");
    else rail.removeAttribute("data-aw-live");
  }

  // Portée de la page, pour que Planètes et Science puissent avoir chacune leur
  // couleur de jauge (cockpit.css lit data-awg-scope sur <html>). La fiche
  // planète et la liste des bâtiments comptent comme « planets ».
  function markScope() {
    const p = location.pathname || "";
    let scope = "";
    if (/^\/Game\/Science/i.test(p)) scope = "science";
    else if (/^\/Game\/Planets/i.test(p)) scope = "planets";
    if (scope) document.documentElement.setAttribute("data-awg-scope", scope);
    else document.documentElement.removeAttribute("data-awg-scope");
  }

  function run() {
    try {
      markScope();
      if (!skinOn() || !styleOn()) { unGaugify(); return; }
      gaugify();
    } catch (e) { /* jamais bloquer la page du jeu */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  let t = null;
  new MutationObserver(function () {
    if (t) return;
    t = setTimeout(function () { t = null; run(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // apply() : appelé par les Réglages quand on change de style de jauge.
  window.AWGauges = { gaugify: run, apply: run };
})();
