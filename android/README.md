# AW Cockpit — app Android (édition communauté)

Une app dédiée, installable à côté de l'app officielle : la WebView d'AstroWars avec **exactement
le contenu de l'extension communauté** (apparences Verre / HUD / Classique, carte 3D et plein écran,
Trade, alerte d'attaque via la page News). Pas de compte, pas de serveur tiers. Mises à jour : la
dernière Release GitHub de ce dépôt (lecture anonyme, au plus 1×/jour ou bouton « Vérifier maintenant »).

## Comment ça marche

| Extension Chrome | App Android |
|---|---|
| `content_scripts` `document_start` (CSS + `reskin-early.js`) | `early.js`, injecté par `WebViewCompat.addDocumentStartJavaScript` avant tout script de la page ; la feuille `app.css` bloque le premier rendu (`blocking="render"`) : pas de flash |
| `content_scripts` `document_idle` | `idle.js` : les scripts du manifeste, dans l'ordre, dans **une** fonction (pas de monde isolé dans une WebView : rien ne doit fuir dans la page) |
| `chrome-extension://…/fichier` | `https://astrowars.games/__awc/fichier`, servi depuis les assets de l'APK par `shouldInterceptRequest` (même origine : polices, textures WebGL, `import()` de three.js sans CORS) — ces URL ne partent jamais sur le réseau |
| `chrome.storage.local` + `onChanged` | `localStorage` (préfixe `awc:`) ; l'événement `storage` relaie les changements du menu (iframe) |
| `background.js` (Release GitHub) | même logique dans `app-shim.js`, requête faite par l'app (pont `AWCNative`, URL GitHub du dépôt uniquement) ; l'asset attendu est **`aw-cockpit-communaute.apk`** |
| menu de l'icône (`popup.html`) | bouton ⚙ dans le rail → `popup.html` dans une feuille ; bienvenue au premier lancement |

Fichiers propres à l'app : `web/app-shim.js` (API `chrome.*`, liens externes, clics au doigt,
bouton retour), `web/app-early.js` (modèle de `early.js`), `web/app-ui.js`, `web/app-i18n.js`
(textes « ZIP / navigateur » → « APK / téléphone »), `web/app-mobile.css` (rail fin, colonne en
feuille, onglets du jeu à la largeur d'un téléphone), `web/app-popup.*`, `app/java/…/MainActivity.java`.
Les fichiers de l'extension ne sont **jamais copiés à la main** : `build_apk.py` les lit dans `manifest.json`.

## Construire

Prérequis : SDK Android (build-tools ≥ 34, `platforms;android-35`), JDK 17+ (celui d'Android Studio
convient), Python 3 avec Pillow, Node (contrôle de syntaxe, facultatif).

```
python android/build_apk.py --init-signing   # UNE seule fois : crée android/signing/ (hors dépôt)
python android/build_apk.py                  # → android/dist/aw-cockpit-communaute.apk
python android/build_apk.py --debug --install   # WebView inspectable (chrome://inspect), adb install -r
```

⚠ **La clé de signature** (`android/signing/`, ignorée par git) doit être sauvegardée hors du PC.
Sans elle, une nouvelle version ne s'installe plus par-dessus : chaque joueur devrait désinstaller
(et perdre ses réglages). Ne jamais la commiter, ne jamais la régénérer.

Version : celle de `manifest.json` (`1.0.7` → versionCode `10007`).

## Publier une version

La Release d'un tag `vX.Y.Z` doit contenir `aw-cockpit-communaute.apk` pour que les apps installées
proposent la mise à jour (une Release sans APK n'est pas signalée dans l'app).

- **À la main** : `python android/build_apk.py` puis
  `gh release upload vX.Y.Z android/dist/aw-cockpit-communaute.apk`
- **Par l'Action** (`.github/workflows/release.yml`) : si les secrets `AWC_KEYSTORE_B64` (le `.jks`
  en base64) et `AWC_KEYSTORE_PASS` existent, l'APK est construite et jointe à la Release ;
  sinon l'étape est sautée.
