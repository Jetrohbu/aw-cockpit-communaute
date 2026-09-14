// AW Cockpit — Édition communauté : service worker minimal.
// 1) Après une mise à jour de l'extension : poser le drapeau qui fait apparaître
//    la notification « quoi de neuf » sur la prochaine page du jeu.
// 2) Nouvelle version disponible ? Au plus une lecture par jour de la dernière
//    Release publique sur GitHub (numéro de version, liens des ZIP, notes).
//    Rien n'est envoyé : requête anonyme, sans cookie ni identifiant.
const REPO = "Jetrohbu/aw-cockpit-communaute";
const CHECK_KEY = "aw_update_check";
const DAY = 24 * 3600 * 1000;
const RETRY = 3600 * 1000;                 // échec (hors ligne, quota GitHub) : nouvel essai dans 1 h

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // écran de bienvenue : langue, pseudo, apparence (même page que le menu de l'icône)
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?welcome=1") });
  }
  if (details.reason === "update") {
    chrome.storage.local.set({ aw_pending_update_toast: chrome.runtime.getManifest().version });
  }
  checkUpdate(true);
});
chrome.runtime.onStartup.addListener(() => { checkUpdate(false); });

let running = null;
function checkUpdate(force) {
  if (!running) running = doCheck(force).finally(() => { running = null; });
  return running;
}

async function doCheck(force) {
  const prev = (await chrome.storage.local.get(CHECK_KEY))[CHECK_KEY] || {};
  if (!force && prev.next && Date.now() < prev.next) return prev;
  try {
    const r = await fetch("https://api.github.com/repos/" + REPO + "/releases/latest",
      { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", credentials: "omit" });
    if (!r.ok) throw new Error("GitHub " + r.status);
    const rel = await r.json();
    const tag = String(rel.tag_name || "");
    const version = tag.replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("tag " + tag);
    const asset = (name) => ((rel.assets || []).find((a) => a.name === name) || {}).browser_download_url || null;
    let notes = null;
    try {
      // notes traduites : le version.json de la page, tel qu'au moment du tag
      const n = await fetch("https://raw.githubusercontent.com/" + REPO + "/" + encodeURIComponent(tag) + "/site/aw-cockpit-communaute/version.json",
        { cache: "no-store", credentials: "omit" });
      if (n.ok) notes = ((await n.json()).releases || []).find((x) => x.version === version) || null;
    } catch (e) { /* notes facultatives */ }
    const out = {
      at: Date.now(), next: Date.now() + DAY, error: null,
      latest: {
        version, page: rel.html_url || null, date: rel.published_at || null,
        zip: asset("aw-cockpit-communaute.zip"),
        zip_chrome: asset("aw-cockpit-communaute-chrome.zip"),
        zip_firefox: asset("aw-cockpit-communaute-firefox.zip"),
        notes,
      },
    };
    await chrome.storage.local.set({ [CHECK_KEY]: out });
    return out;
  } catch (e) {
    const out = Object.assign({}, prev, { at: Date.now(), next: Date.now() + RETRY, error: String(e && e.message || e) });
    await chrome.storage.local.set({ [CHECK_KEY]: out });
    return out;
  }
}

// Les pages du jeu demandent l'état (la vérification réelle reste limitée à 1 par jour,
// sauf clic sur « Vérifier maintenant » dans À propos).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "awcc_update_check") return false;
  checkUpdate(!!msg.force).then(sendResponse, () => sendResponse(null));
  return true;
});
