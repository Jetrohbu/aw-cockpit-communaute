// AW Cockpit — Édition communauté : menu de l'icône + écran de bienvenue au premier lancement.
// Langue, pseudo AstroWars, apparence et options. Aucune requête réseau : tout vit dans
// chrome.storage.local, et les pages du jeu suivent en direct (storage.onChanged).

const GAME_URL = "https://astrowars.games/Game/Planets";
const UPDATE_PAGE = "https://holocron-gt.fr/static/aw-cockpit-communaute.html";   // ouverte au clic seulement
const DICT = window.AW_POPUP_I18N || {};
const LANGS = ["fr", "en", "es", "de"];
const ACCENTS = ["#2ad2d8", "#ff8c00", "#a855f7", "#ef4444", "#10b981", "#3b82f6"];
const K = {
  lang: "aw_language", skin: "aw_cockpit_skin", theme: "aw_theme", bg: "aw_cockpit_bg",
  inc: "aw_incoming_alert", incMine: "aw_incoming_mine", pseudo: "aw_game_player_name", welcomed: "aw_welcome_done",
};
let lang = "fr";
let st = {};

const $ = (id) => document.getElementById(id);
const set = (obj) => new Promise((res) => chrome.storage.local.set(obj, res));

function t(key, vars) {
  let s = (DICT[lang] && DICT[lang][key]) || (DICT.fr && DICT.fr[key]) || key;
  if (vars) Object.keys(vars).forEach((k) => { s = s.replace("{" + k + "}", vars[k]); });
  return s;
}
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  document.querySelectorAll(".langs [data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  try { $("ver").textContent = "v" + chrome.runtime.getManifest().version; } catch (e) { /* aperçu */ }
  paint();
}
function setMsg(el, text, kind) { el.textContent = text || ""; el.className = "msg" + (kind ? " " + kind : ""); }

function skinOf() { return ["glass", "hud", "classic"].includes(st[K.skin]) ? st[K.skin] : "glass"; }
function accentOf() { const a = st[K.theme] && st[K.theme].primary; return /^#[0-9a-f]{6}$/i.test(a || "") ? a.toLowerCase() : ACCENTS[0]; }

function paint() {
  const root = document.documentElement;
  root.classList.remove("sk-glass", "sk-hud", "sk-classic");
  root.classList.add("sk-" + skinOf());
  const acc = accentOf(), custom = acc !== ACCENTS[0];
  root.classList.toggle("custom-accent", custom);
  if (custom) root.style.setProperty("--acc", acc); else root.style.removeProperty("--acc");
  document.querySelectorAll("[data-skins] .skin").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.skin === skinOf())));
  document.querySelectorAll("#m-sw .swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === acc)));
  const name = String(st[K.pseudo] || "").trim();
  $("m-ini").textContent = (name.charAt(0) || "★").toUpperCase();
  $("m-hi").textContent = name ? t("hello", { name }) : t("hello_anon");
  $("m-bg").setAttribute("aria-pressed", String(st[K.bg] !== false));
  $("m-inc").setAttribute("aria-pressed", String(st[K.inc] !== false));
  $("m-inc-mine").setAttribute("aria-pressed", String(st[K.incMine] === true));
  $("m-inc-mine").disabled = st[K.inc] === false || !name;
}

function validPseudo(v) { return v.length >= 2 && v.length <= 30; }

function showWelcome() {
  $("welcome").hidden = false; $("menu").hidden = true;
  $("w-pseudo").value = st[K.pseudo] || "";
  setTimeout(() => $("w-pseudo").focus(), 60);
}
function showMenu() {
  $("welcome").hidden = true; $("menu").hidden = false;
  $("m-pseudo").value = st[K.pseudo] || "";
}

// ── événements ──
document.querySelectorAll(".langs [data-lang]").forEach((b) => b.addEventListener("click", async () => {
  lang = b.dataset.lang; st[K.lang] = lang;
  await set({ [K.lang]: lang });
  applyI18n();
}));
document.querySelectorAll("[data-skins] .skin").forEach((b) => b.addEventListener("click", async () => {
  st[K.skin] = b.dataset.skin;
  await set({ [K.skin]: b.dataset.skin });
  paint();
}));
ACCENTS.forEach((c) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "swatch"; b.dataset.c = c; b.style.background = c; b.title = c;
  b.addEventListener("click", async () => {
    if (c === ACCENTS[0]) { delete st[K.theme]; await new Promise((r) => chrome.storage.local.remove(K.theme, r)); }
    else { st[K.theme] = { primary: c }; await set({ [K.theme]: { primary: c } }); }
    paint();
  });
  $("m-sw").appendChild(b);
});
const toggle = (id, key, onVal) => $(id).addEventListener("click", async () => {
  const on = $(id).getAttribute("aria-pressed") !== "true";
  st[key] = onVal(on);
  await set({ [key]: st[key] });
  paint();
});
toggle("m-bg", K.bg, (on) => on);
toggle("m-inc", K.inc, (on) => on);
toggle("m-inc-mine", K.incMine, (on) => on);

$("w-go").addEventListener("click", async () => {
  const v = $("w-pseudo").value.trim();
  if (v && !validPseudo(v)) { setMsg($("w-msg"), t("pseudo_bad"), "bad"); return; }
  st[K.pseudo] = v; st[K.welcomed] = true;
  await set({ [K.pseudo]: v, [K.welcomed]: true, [K.lang]: lang, [K.skin]: skinOf() });
  if (document.documentElement.classList.contains("is-tab")) { chrome.tabs.create({ url: GAME_URL }); window.close(); return; }
  showMenu(); paint();
});
$("w-pseudo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("w-go").click(); });
$("m-save").addEventListener("click", async () => {
  const v = $("m-pseudo").value.trim();
  if (v && !validPseudo(v)) { setMsg($("m-msg"), t("pseudo_bad"), "bad"); return; }
  st[K.pseudo] = v;
  await set({ [K.pseudo]: v });
  setMsg($("m-msg"), t("saved"), "ok");
  paint();
});
$("m-pseudo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("m-save").click(); });
$("m-open").addEventListener("click", () => chrome.tabs.create({ url: GAME_URL }));
$("m-updates").addEventListener("click", () => chrome.tabs.create({ url: UPDATE_PAGE }));
$("m-welcome").addEventListener("click", showWelcome);

// ── démarrage ──
if (new URLSearchParams(location.search).get("welcome") === "1") document.documentElement.classList.add("is-tab");
chrome.storage.local.get(Object.values(K), (r) => {
  st = r || {};
  const nav = String(navigator.language || "fr").slice(0, 2).toLowerCase();
  lang = LANGS.includes(st[K.lang]) ? st[K.lang] : (LANGS.includes(nav) ? nav : "fr");
  applyI18n();
  if (!st[K.welcomed] || document.documentElement.classList.contains("is-tab")) showWelcome(); else showMenu();
  paint();
});
