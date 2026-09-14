"""Construit le ZIP distribuable de l'édition communauté.

  python tools/build_zip.py          → dist/aw-cockpit-communaute-<version>.zip

Contrôles avant d'écrire :
  - toutes les ressources déclarées au manifest (scripts, styles, icônes,
    motifs web_accessible_resources) sont présentes ;
  - AUCUNE trace d'Holocron dans le code livré : ni appel réseau vers un autre
    domaine que le jeu, ni jeton, ni ingestion de scans. Seule exception : la
    constante de la page des mises à jour dans cockpit.js (ouverte à la main).
  - réseau hors du jeu : seul background.js peut lire la dernière Release publique
    GitHub du dépôt (api.github.com/repos/… et raw.githubusercontent.com/…), sans rien envoyer.
"""
import fnmatch, hashlib, json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCL_DIRS = {"site", "tools", "dist", "backups_site", "android", ".git", ".github", ".claude", "__pycache__", "node_modules"}
EXCL_FILES = re.compile(r"(\.bak|\.zip$|\.py$|\.log$|\.md$|^\.git)", re.I)

manifest = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))
ver = manifest["version"]

files = []
for base, dirs, names in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in EXCL_DIRS]
    for n in names:
        rel = os.path.relpath(os.path.join(base, n), ROOT).replace("\\", "/")
        if not EXCL_FILES.search(n):
            files.append(rel)
files.sort()
fileset = set(files)

declared = set()
for cs in manifest.get("content_scripts", []):
    declared.update(cs.get("js", [])); declared.update(cs.get("css", []))
declared.add(manifest["background"]["service_worker"])
declared.update(manifest.get("icons", {}).values())
declared.update(manifest.get("action", {}).get("default_icon", {}).values())
patterns = [p for w in manifest.get("web_accessible_resources", []) for p in w.get("resources", [])]
missing = sorted(d for d in declared if d not in fileset)
missing_pat = sorted(p for p in patterns if not any(fnmatch.fnmatch(f, p) for f in files))

# garde-fou « rien vers Holocron »
bad = []
for f in files:
    if not f.endswith(".js"):
        continue
    txt = open(os.path.join(ROOT, f), encoding="utf-8", errors="replace").read()
    code = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
    code = re.sub(r"(^|[^:])//.*", r"\1", code)
    for m in re.finditer(r"holocron-gt\.fr|aw_jwt_token|AndroidBridge|AW_CONFIG|AW_solarIngest|/api/(?!v1/Map/)", code):
        line = code.count("\n", 0, m.start()) + 1
        snippet = code[max(0, m.start() - 40):m.start() + 60].replace("\n", " ")
        if f in ("cockpit.js", "popup.js") and "UPDATE_PAGE" in snippet:
            continue
        bad.append(f"{f}:{line}: {snippet.strip()}")
    for m in re.finditer(r"(fetch|open)\(\s*[\"'`](https?:)?//", code):
        line = code.count("\n", 0, m.start()) + 1
        if f == "background.js" and re.match(r'fetch\(\s*"https://(api\.github\.com/repos/|raw\.githubusercontent\.com/)"', code[m.start():]):
            continue
        bad.append(f"{f}:{line}: requête vers une URL absolue")

if missing or missing_pat or bad:
    print("ÉCHEC :")
    for x in missing: print("  manquant :", x)
    for x in missing_pat: print("  motif sans fichier :", x)
    for x in bad: print("  interdit :", x)
    sys.exit(1)

os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", f"aw-cockpit-communaute-{ver}.zip")
if os.path.exists(out):
    os.remove(out)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        z.write(os.path.join(ROOT, f), f)
sha = hashlib.sha256(open(out, "rb").read()).hexdigest()
print(f"{out}\n  {len(files)} fichiers · {os.path.getsize(out)} octets · sha256 {sha}")

# Variante Firefox : Firefox ne gère pas background.service_worker (il lui faut background.scripts),
# et Chrome affiche « 'background.scripts' requires manifest version of 2 or lower » si les deux
# clés sont présentes → deux ZIP : celui-ci ne diffère que par le manifest. Les réglages propres à
# Firefox (browser_specific_settings) ne vivent QUE ici : Chrome les signale en clé inconnue.
fx_manifest = dict(manifest)
fx_manifest["background"] = {"scripts": [manifest["background"]["service_worker"]]}
fx_manifest["browser_specific_settings"] = {
    "gecko": {
        "id": "aw-cockpit-communaute@holocron-gt.fr",
        "strict_min_version": "128.0",          # :has() et lch(from …) dans les skins
        "data_collection_permissions": {"required": ["none"]},
    }
}
out_fx = os.path.join(ROOT, "dist", f"aw-cockpit-communaute-{ver}-firefox.zip")
if os.path.exists(out_fx):
    os.remove(out_fx)
with zipfile.ZipFile(out_fx, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        if f == "manifest.json":
            z.writestr("manifest.json", json.dumps(fx_manifest, ensure_ascii=False, indent=2) + "\n")
        else:
            z.write(os.path.join(ROOT, f), f)
sha_fx = hashlib.sha256(open(out_fx, "rb").read()).hexdigest()
print(f"{out_fx}\n  {len(files)} fichiers · {os.path.getsize(out_fx)} octets · sha256 {sha_fx}")

# Paquet « tous navigateurs » : les deux versions côte à côte + mode d'emploi. C'est le ZIP des liens
# partagés (bouton principal de la page, lien fixe) : le joueur prend le dossier de son navigateur.
DIR_CH, DIR_FX = "AW-Cockpit-Chrome-Edge-Brave-Opera", "AW-Cockpit-Firefox"
LISEZ_MOI = f"""AW Cockpit - Édition communauté v{ver} (Team Holocron)

Ce ZIP contient deux versions de l'extension : prends le dossier de ton navigateur.

> Chrome, Edge, Brave, Opera : dossier « {DIR_CH} »
  1. Décompresse le ZIP dans un dossier que tu gardes (ne le supprime pas ensuite).
  2. Ouvre chrome://extensions (Edge : edge://extensions) et active le Mode développeur.
  3. Clique « Charger l'extension non empaquetée » et choisis le dossier {DIR_CH}.
  4. Si tu as déjà l'extension AW complète, désactive-la pendant le test.
  5. Recharge ta page AstroWars (F5).

> Firefox (128 ou plus récent) : dossier « {DIR_FX} »
  1. Décompresse le ZIP.
  2. Ouvre about:debugging, puis « Ce Firefox », puis « Charger un module complémentaire temporaire ».
  3. Choisis le fichier manifest.json du dossier {DIR_FX}.
  Firefox retire les modules temporaires à sa fermeture : à refaire à chaque redémarrage.

L'extension te prévient quand une nouvelle version sort (carte « Nouvelle version » dans le jeu).
Nouveautés, aide, FAQ et rapport de bug : https://holocron-gt.fr/static/aw-cockpit-communaute.html
Code source et versions : https://github.com/Jetrohbu/aw-cockpit-communaute/releases
""".replace("\n", "\r\n")
out_all = os.path.join(ROOT, "dist", f"aw-cockpit-communaute-{ver}-tous-navigateurs.zip")
if os.path.exists(out_all):
    os.remove(out_all)
with zipfile.ZipFile(out_all, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("LISEZ-MOI.txt", LISEZ_MOI)
    for f in files:
        z.write(os.path.join(ROOT, f), DIR_CH + "/" + f)
        if f == "manifest.json":
            z.writestr(DIR_FX + "/manifest.json", json.dumps(fx_manifest, ensure_ascii=False, indent=2) + "\n")
        else:
            z.write(os.path.join(ROOT, f), DIR_FX + "/" + f)
sha_all = hashlib.sha256(open(out_all, "rb").read()).hexdigest()
print(f"{out_all}\n  2 × {len(files)} fichiers + LISEZ-MOI.txt · {os.path.getsize(out_all)} octets · sha256 {sha_all}")
