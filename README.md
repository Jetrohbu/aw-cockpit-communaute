# AW Cockpit — Édition communauté

Extension de navigateur gratuite pour [AstroWars](https://astrowars.games) : apparences Verre, HUD et Classique pour l'interface et les pages du jeu, jauges graduées, fond spatial, carte de la galaxie et systèmes solaires en 3D, vue multi-planètes, aides sur la page Trade.

- **Pas de compte, rien n'est envoyé.** L'extension ne parle qu'au jeu (pages Fleets, Planets, News, historique des prix) et lit une fois par jour la dernière Release de ce dépôt pour te prévenir d'une nouvelle version.
- **Rien n'est automatisé** : aucune action de jeu n'est déclenchée à ta place.
- Une seule permission : `storage` (tes réglages, sur ton ordinateur). Active uniquement sur `astrowars.games`.

Extension non officielle, sans lien avec Mud Flat Games. Réalisée par la Team Holocron.

## Télécharger

**[Dernière version](https://github.com/Jetrohbu/aw-cockpit-communaute/releases/latest)** — `aw-cockpit-communaute.zip` contient un dossier par navigateur et un `LISEZ-MOI.txt`.

Guide pas à pas, FAQ et rapport de bug : https://holocron-gt.fr/static/aw-cockpit-communaute.html

### Chrome, Edge, Brave, Opera
1. Décompresse le ZIP dans un dossier que tu gardes.
2. `chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée** → dossier `AW-Cockpit-Chrome-Edge-Brave-Opera`.
3. Recharge AstroWars.

### Firefox 128+
`about:debugging` → Ce Firefox → **Charger un module complémentaire temporaire** → `manifest.json` du dossier `AW-Cockpit-Firefox` (à refaire à chaque redémarrage de Firefox).

### Mettre à jour
Une carte « Nouvelle version » apparaît dans le jeu. Télécharge le ZIP, remplace le contenu de ton dossier, clique ↻ sur l'extension puis Ctrl+Maj+R sur le jeu. Tes réglages sont conservés **si le dossier garde le même emplacement**.

## Signaler un bug

[Ouvrir un rapport](https://github.com/Jetrohbu/aw-cockpit-communaute/issues/new?template=bug.yml) — ou depuis l'extension : rail → À propos → **Signaler un bug**.

## Publier une version (mainteneurs)

1. `manifest.json` → `version`, `UPDATE_NOTES` dans `cockpit.js`, entrée `releases` (+ `i18n`) dans `site/aw-cockpit-communaute/version.json`.
2. Commit, puis `git tag vX.Y.Z && git push origin main --tags`.
3. L'Action **Release** construit les ZIP (`tools/build_zip.py`) et publie la Release. Les extensions installées la voient sous 24 h.

## Licences tierces

Textures de planètes : Solar System Scope (CC BY 4.0) · Polices Rajdhani, JetBrains Mono et Manrope : SIL OFL 1.1 · three.js : MIT. Détails dans `CREDITS.txt`.
