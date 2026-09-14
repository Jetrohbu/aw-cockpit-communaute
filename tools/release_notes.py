"""Notes de la Release GitHub, tirées de site/aw-cockpit-communaute/version.json.

  python tools/release_notes.py 1.0.6            → Markdown (FR, EN, ES, DE + installation)
  python tools/release_notes.py 1.0.6 --title    → titre français seul
  python tools/release_notes.py 1.0.6 --apk      → + installation de l'app Android (APK jointe)
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ver = sys.argv[1]
vj = json.load(open(os.path.join(ROOT, "site", "aw-cockpit-communaute", "version.json"), encoding="utf-8"))
rel = next((r for r in vj.get("releases", []) if r.get("version") == ver), None)
if rel is None:
    sys.exit(f"version.json : aucune entrée pour {ver} — ajoute-la avant de pousser le tag")

sys.stdout.reconfigure(encoding="utf-8")
if "--title" in sys.argv:
    print(rel["title"])
    sys.exit(0)

tr = rel.get("i18n", {})
out = []
for code, label, r in [("fr", "Français", rel), ("en", "English", tr.get("en")), ("es", "Español", tr.get("es")), ("de", "Deutsch", tr.get("de"))]:
    if not r:
        continue
    out.append(f"### {label} — {r['title']}")
    out += [f"- {p}" for p in r["points"]]
    out.append("")
out += [
    "---",
    "**Installer / mettre à jour** : télécharge `aw-cockpit-communaute.zip`, décompresse-le à la place de ton dossier "
    "(il contient un dossier par navigateur), recharge l'extension puis Ctrl+Maj+R sur le jeu.",
    "",
    "**Install / update**: download `aw-cockpit-communaute.zip`, unzip it in place of your folder "
    "(one folder per browser inside), reload the extension, then Ctrl+Shift+R on the game.",
    "",
    "Aide, FAQ, rapport de bug : https://holocron-gt.fr/static/aw-cockpit-communaute.html",
]
if "--apk" in sys.argv:
    out[-1:-1] = [
        "**App Android** : télécharge `aw-cockpit-communaute.apk` sur ton téléphone et ouvre-la ; pour une mise à jour, "
        "installe-la par-dessus l'app (réglages et connexion conservés). L'app te prévient d'elle-même des nouvelles versions.",
        "",
        "**Android app**: download `aw-cockpit-communaute.apk` on your phone and open it; to update, install it over the app "
        "(settings and login are kept). The app tells you about new versions by itself.",
        "",
    ]
print("\n".join(out))
