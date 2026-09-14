#!/usr/bin/env python3
"""AW Cockpit — édition communauté : construit l'app Android (APK), sans Gradle.

    python android/build_apk.py                 → android/dist/aw-cockpit-communaute.apk (signée)
    python android/build_apk.py --debug         → android/dist/aw-cockpit-communaute-debug.apk
                                                  (WebView inspectable : chrome://inspect)
    python android/build_apk.py --install       → + adb install -r
    python android/build_apk.py --init-signing  → crée la clé de signature, UNE seule fois

L'APK embarque les fichiers de l'extension tels que manifest.json les déclare (CSS et scripts des
content_scripts, web_accessible_resources, menu popup.html) : rien à recopier à la main.
Chaîne : aapt2 → javac → d8 → zipalign → apksigner (SDK Android ≥ 34 + JDK 17+), Pillow pour l'icône.

Signature : android/signing/signing.json + le .jks (HORS DÉPÔT, à sauvegarder : sans cette clé,
plus aucune mise à jour ne s'installe par-dessus), ou AWC_KEYSTORE + AWC_KEYSTORE_PASS (CI).
"""
import argparse
import glob
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent            # android/
ROOT = HERE.parent                                # racine de l'extension (manifest.json)
APP, WEB = HERE / "app", HERE / "web"
BUILD, DIST, LIBS, SIGN = HERE / "build", HERE / "dist", HERE / "libs", HERE / "signing"

MIN_SDK, TARGET_SDK = 26, 35
WEBKIT_VER = "1.14.0"
WEBKIT_SHA256 = "265604786ea1c9679e3f860f7f13072375c141f46db9092ed8ef5ecd599a516d"
WEBKIT_URL = f"https://dl.google.com/android/maven2/androidx/webkit/webkit/{WEBKIT_VER}/webkit-{WEBKIT_VER}.aar"
KEY_ALIAS = "awcockpit"
APK_NAME = "aw-cockpit-communaute"


def die(msg):
    sys.exit("✗ " + msg)


def step(msg):
    print("\n▸ " + msg, flush=True)


def run(cmd, env=None):
    cmd = [str(c) for c in cmd]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout + r.stderr).strip()
    if r.returncode:
        die("échec : " + " ".join(Path(cmd[0]).name if i == 0 else c for i, c in enumerate(cmd[:6])) + " …\n" + out)
    return out


def read(p):
    return Path(p).read_text(encoding="utf-8")


def write(p, s):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8", newline="\n")


# ───────────────────────── outils ─────────────────────────
def find_sdk():
    for v in (os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
              os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk"), os.path.expanduser("~/Android/Sdk")):
        if v and os.path.isdir(os.path.join(v, "build-tools")):
            return Path(v)
    die("SDK Android introuvable (définir ANDROID_HOME)")


def tool(folder, name):
    for ext in ("", ".exe", ".bat"):
        p = Path(folder) / (name + ext)
        if p.is_file():
            return p
    die(f"outil introuvable : {name} dans {folder}")


def toolchain():
    sdk = find_sdk()
    vers = [p for p in (sdk / "build-tools").iterdir() if p.is_dir() and re.match(r"^\d+\.\d+\.\d+$", p.name)]
    vers = sorted((p for p in vers if int(p.name.split(".")[0]) >= 34), key=lambda p: tuple(map(int, p.name.split("."))))
    if not vers:
        die("build-tools ≥ 34 requis")
    bt = vers[-1]
    plats = sorted((p for p in (sdk / "platforms").glob("android-*") if (p / "android.jar").is_file()),
                   key=lambda p: int(re.sub(r"\D", "", p.name) or 0))
    plat = next((p for p in plats if p.name == f"android-{TARGET_SDK}"), plats[-1] if plats else None)
    if not plat:
        die("aucune plateforme Android installée (sdkmanager \"platforms;android-35\")")
    jh = None
    for v in (os.environ.get("JAVA_HOME"), r"C:\Program Files\Android\Android Studio\jbr", "/opt/android-studio/jbr"):
        if v and (Path(v) / "bin").is_dir():
            jh = Path(v)
            break
    env = dict(os.environ)
    if jh:
        env["JAVA_HOME"] = str(jh)
        env["PATH"] = str(jh / "bin") + os.pathsep + env.get("PATH", "")
    javac = tool(jh / "bin", "javac") if jh else Path(shutil.which("javac") or die("javac introuvable (JAVA_HOME)"))
    keytool = tool(jh / "bin", "keytool") if jh else Path(shutil.which("keytool") or "keytool")
    return {
        "aapt2": tool(bt, "aapt2"), "d8": tool(bt, "d8"), "zipalign": tool(bt, "zipalign"),
        "apksigner": tool(bt, "apksigner"), "android_jar": plat / "android.jar",
        "javac": javac, "keytool": keytool, "env": env, "bt": bt.name, "platform": plat.name,
    }


# ───────────────────────── signature ─────────────────────────
def signing_config():
    ks, pw = os.environ.get("AWC_KEYSTORE"), os.environ.get("AWC_KEYSTORE_PASS")
    if ks and pw:
        return Path(ks), pw
    cfg = SIGN / "signing.json"
    if not cfg.is_file():
        die("pas de clé de signature : python android/build_apk.py --init-signing (une seule fois), "
            "ou AWC_KEYSTORE / AWC_KEYSTORE_PASS")
    c = json.loads(read(cfg))
    return SIGN / c["keystore"], c["password"]


def init_signing(tc):
    cfg, ks = SIGN / "signing.json", SIGN / f"{APK_NAME}.jks"
    if cfg.exists() or ks.exists():
        die(f"une clé existe déjà dans {SIGN} — ne JAMAIS la remplacer (les mises à jour ne s'installeraient plus)")
    SIGN.mkdir(parents=True, exist_ok=True)
    pw = secrets.token_urlsafe(24)
    env = dict(tc["env"], AWC_KS_PASS=pw)
    run([tc["keytool"], "-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-alias", KEY_ALIAS,
         "-keyalg", "RSA", "-keysize", "4096", "-validity", "36500",
         "-storepass:env", "AWC_KS_PASS", "-keypass:env", "AWC_KS_PASS",
         "-dname", "CN=AW Cockpit Communaute"], env=env)
    write(cfg, json.dumps({"keystore": ks.name, "password": pw, "alias": KEY_ALIAS}, indent=2) + "\n")
    print(f"✓ clé créée : {ks}\n  ⚠ SAUVEGARDE {SIGN} (clé + signing.json) hors de ce PC : sans elle, plus de mises à jour.")


# ───────────────────────── fichiers web ─────────────────────────
def build_web(manifest, version):
    out = BUILD / "assets" / "web"
    cs = manifest["content_scripts"]
    start = [c for c in cs if c.get("run_at") == "document_start"]
    idle = [c for c in cs if c.get("run_at", "document_idle") in ("document_idle", "document_end")]
    for c in cs:
        if c.get("matches") != ["https://astrowars.games/*"] or c.get("all_frames"):
            die("content_scripts inattendus (matches / all_frames) : adapter early.js avant de construire")
    css_files = [f for c in cs for f in c.get("css", [])]
    early_js = [f for c in start for f in c.get("js", [])]
    idle_js = [f for c in idle for f in c.get("js", [])]
    if "translations.js" not in idle_js:
        die("translations.js absent des scripts document_idle : app-i18n.js ne peut plus s'y greffer")

    # app.css : les CSS du manifeste, dans l'ordre, puis les ajouts de l'app
    parts = []
    for f in css_files:
        s = read(ROOT / f)
        if re.search(r"^\s*@(import|charset)", s, re.M):
            die(f"{f} contient @import/@charset : incompatible avec la concaténation")
        parts.append(f"/* ═════ {f} ═════ */\n{s}")
    parts.append("/* ═════ android/web/app-mobile.css ═════ */\n" + read(WEB / "app-mobile.css"))
    write(out / "app.css", "\n".join(parts))

    shim = read(WEB / "app-shim.js").replace("@@VERSION@@", version)
    write(out / "app-shim.js", shim)

    tpl = read(WEB / "app-early.js")
    assert tpl.count("/*@@SHIM@@*/") == 1 and tpl.count("/*@@RESKIN_EARLY@@*/") == 1
    reskin = "\n".join(f"/* ── {f} ── */\n{read(ROOT / f)}\n" for f in early_js)
    write(out / "early.js", tpl.replace("/*@@SHIM@@*/", shim).replace("/*@@RESKIN_EARLY@@*/", reskin)
          .replace("@@VERSION@@", version))

    # idle.js : un seul fichier, une seule portée (comme le monde isolé des content scripts, où
    # translations.js pose TRANSLATIONS / t pour les suivants) — rien ne fuit dans la page
    js = [f"/* AW Cockpit {version} — app Android : scripts document_idle de manifest.json, dans l'ordre */",
          "(function () {",
          'if (window.__awcIdle || location.pathname.indexOf("/__awc/") === 0 || window.top !== window) return;',
          "window.__awcIdle = true;",
          "var chrome = window.chrome;"]

    def guarded(name, src):
        return [f"/* ═════ {name} ═════ */", "try {", src, f"}} catch (e) {{ console.warn('[AWC] {name}', e); }}"]

    for f in idle_js:
        src = read(ROOT / f)
        if f == "translations.js":   # déclarations de premier niveau : hors bloc try
            js += [f"/* ═════ {f} ═════ */", src]
            js += guarded("android/web/app-i18n.js", read(WEB / "app-i18n.js"))
        else:
            js += guarded(f, src)
    js += guarded("android/web/app-ui.js", read(WEB / "app-ui.js"))
    js.append("})();")
    write(out / "idle.js", "\n".join(js) + "\n")

    # ressources lues par les scripts (web_accessible_resources) + menu de l'extension
    pats = [r for w in manifest.get("web_accessible_resources", []) for r in w["resources"]]
    pats += ["popup.css", "popup.js", "popup-i18n.js", "icons/icon128.png"]
    n = 0
    for pat in pats:
        hits = [p for p in glob.glob(str(ROOT / pat)) if os.path.isfile(p) and ".bak" not in os.path.basename(p)]
        if not hits:
            die(f"ressource introuvable : {pat}")
        for p in hits:
            rel = Path(p).relative_to(ROOT)
            dst = out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, dst)
            n += 1
    html = read(ROOT / "popup.html")
    a, b = '<link rel="stylesheet" href="popup.css" />', '<script src="popup-i18n.js"></script>'
    if html.count(a) != 1 or html.count(b) != 1:
        die("popup.html a changé : adapter l'insertion de app-popup.* dans build_apk.py")
    html = html.replace(a, a + '\n    <link rel="stylesheet" href="app-popup.css" />')
    html = html.replace(b, '<script src="app-shim.js"></script>\n    ' + b + '\n    <script src="app-popup.js"></script>')
    write(out / "popup.html", html)
    shutil.copyfile(WEB / "app-popup.css", out / "app-popup.css")
    shutil.copyfile(WEB / "app-popup.js", out / "app-popup.js")

    # contrôles : syntaxe, et fichiers demandés en dur à chrome.runtime.getURL présents
    if shutil.which("node"):
        for f in ("early.js", "idle.js", "app-shim.js", "app-popup.js"):
            r = subprocess.run(["node", "--check", str(out / f)], capture_output=True, text=True)
            if r.returncode:
                die(f"{f} : erreur de syntaxe\n{r.stderr}")
    missing = set()
    for f in early_js + idle_js + ["cockpit.js"]:
        for m in re.finditer(r"getURL\(\s*[\"']([^\"'?]+)[\"']\s*\)", read(ROOT / f)):
            if not (out / m.group(1)).is_file():
                missing.add(f"{f} → {m.group(1)}")
    if missing:
        die("fichiers référencés absents de l'APK :\n  " + "\n  ".join(sorted(missing)))
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"  {n} ressources, early.js {(out / 'early.js').stat().st_size // 1024} Ko, "
          f"idle.js {(out / 'idle.js').stat().st_size // 1024} Ko, app.css {(out / 'app.css').stat().st_size // 1024} Ko, "
          f"total {size / 1048576:.1f} Mo")


# ───────────────────────── icône (calques adaptatifs) ─────────────────────────
def build_icons():
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError:
        die("Pillow requis pour l'icône : pip install pillow")
    import random
    S = 432
    bg = Image.new("RGB", (S, S))
    c0, c1 = (24, 38, 72), (3, 5, 12)
    px = bg.load()
    for y in range(S):
        for x in range(S):
            t = min(1.0, (((x - S * .5) ** 2 + (y - S * .42) ** 2) ** .5) / (S * .72))
            px[x, y] = tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    stars = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(stars)
    rnd = random.Random(1307)
    for _ in range(110):
        x, y, r = rnd.uniform(0, S), rnd.uniform(0, S), rnd.choice((0.8, 1.0, 1.2, 1.6, 2.2))
        a = rnd.randint(90, 255)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(215, 235, 255, a))
    bg = Image.alpha_composite(bg.convert("RGBA"), stars)

    badge = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA")
    D = round(S * .64)                                   # dans la zone sûre (66 dp sur 108)
    badge = badge.resize((D, D), Image.LANCZOS)
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sh = Image.new("RGBA", (D, D), (0, 0, 0, 255))
    sh.putalpha(badge.getchannel("A").point(lambda v: v * 150 // 255))
    shadow.paste(sh, ((S - D) // 2, (S - D) // 2 + 6), sh)
    fg = Image.alpha_composite(fg, shadow.filter(ImageFilter.GaussianBlur(8)))
    fg.alpha_composite(badge, ((S - D) // 2, (S - D) // 2))

    gen = BUILD / "res-gen"
    for name, size in (("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)):
        dd = gen / f"mipmap-{name}"
        dd.mkdir(parents=True, exist_ok=True)
        bg.resize((size, size), Image.LANCZOS).convert("RGB").save(dd / "ic_launcher_bg.png", optimize=True)
        fg.resize((size, size), Image.LANCZOS).save(dd / "ic_launcher_fg.png", optimize=True)
    preview = Image.alpha_composite(bg, fg).resize((192, 192), Image.LANCZOS)
    mask = Image.new("L", (192, 192), 0)
    ImageDraw.Draw(mask).ellipse((24, 24, 168, 168), fill=255)
    out = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
    out.paste(preview, (0, 0), mask)
    out.save(BUILD / "icon-preview.png")
    return gen


# ───────────────────────── androidx.webkit ─────────────────────────
def webkit_jar():
    aar = LIBS / f"webkit-{WEBKIT_VER}.aar"
    if not aar.is_file():
        print(f"  téléchargement de androidx.webkit {WEBKIT_VER}…")
        LIBS.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(WEBKIT_URL, timeout=60) as r:
            data = r.read()
        if hashlib.sha256(data).hexdigest() != WEBKIT_SHA256:
            die("androidx.webkit : empreinte SHA-256 inattendue")
        aar.write_bytes(data)
    elif hashlib.sha256(aar.read_bytes()).hexdigest() != WEBKIT_SHA256:
        die(f"{aar} : empreinte SHA-256 inattendue (supprimer le fichier)")
    jar = BUILD / "webkit.jar"
    with zipfile.ZipFile(aar) as z, zipfile.ZipFile(z.open("classes.jar")) as cj, \
            zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as w:
        for info in cj.infolist():
            # WebViewAssetLoader dépend d'androidx.core, et l'app ne s'en sert pas
            if info.filename.endswith(".class") and not info.filename.startswith("androidx/webkit/WebViewAssetLoader"):
                w.writestr(info.filename, cj.read(info))
    return jar


# ───────────────────────── APK ─────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--debug", action="store_true", help="WebView inspectable (jamais publiée)")
    ap.add_argument("--install", action="store_true", help="adb install -r après la construction")
    ap.add_argument("--init-signing", action="store_true", help="créer la clé de signature (une fois)")
    args = ap.parse_args()

    tc = toolchain()
    if args.init_signing:
        init_signing(tc)
        return
    ks, ks_pass = signing_config()
    if not ks.is_file():
        die(f"keystore introuvable : {ks}")

    manifest = json.loads(read(ROOT / "manifest.json"))
    version = manifest["version"]
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        die(f"version inattendue : {version}")
    ma, mi, pa = map(int, version.split("."))
    code = ma * 10000 + mi * 100 + pa
    print(f"AW Cockpit {version} (code {code}) — build-tools {tc['bt']}, {tc['platform']}" + (" — DEBUG" if args.debug else ""))

    shutil.rmtree(BUILD, ignore_errors=True)
    BUILD.mkdir(parents=True)

    step("fichiers de l'extension")
    build_web(manifest, version)
    step("icône")
    gen = build_icons()
    step("androidx.webkit")
    wk = webkit_jar()

    step("ressources (aapt2)")
    run([tc["aapt2"], "compile", "--dir", APP / "res", "-o", BUILD / "res.zip"])
    run([tc["aapt2"], "compile", "--dir", gen, "-o", BUILD / "res-gen.zip"])
    link = [tc["aapt2"], "link", "-o", BUILD / "base.apk", "-I", tc["android_jar"],
            "--manifest", APP / "AndroidManifest.xml",
            "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
            "--version-code", code, "--version-name", version,
            "--java", BUILD / "gen", "-A", BUILD / "assets", "-0", ".woff2",
            BUILD / "res.zip", BUILD / "res-gen.zip"]
    if args.debug:
        link.append("--debug-mode")
    run(link)

    step("java (javac + d8)")
    srcs = sorted(str(p) for p in list((APP / "java").rglob("*.java")) + list((BUILD / "gen").rglob("*.java")))
    run([tc["javac"], "-source", "11", "-target", "11", "-encoding", "UTF-8", "-Xlint:-options", "-nowarn",
         "-cp", os.pathsep.join([str(tc["android_jar"]), str(wk)]), "-d", BUILD / "classes"] + srcs, env=tc["env"])
    app_jar = BUILD / "app-classes.jar"
    with zipfile.ZipFile(app_jar, "w", zipfile.ZIP_DEFLATED) as z:
        for p in (BUILD / "classes").rglob("*.class"):
            z.write(p, p.relative_to(BUILD / "classes").as_posix())
    (BUILD / "dex").mkdir()
    run([tc["d8"], "--debug" if args.debug else "--release", "--min-api", MIN_SDK, "--lib", tc["android_jar"],
         "--output", BUILD / "dex", app_jar, wk], env=tc["env"])

    step("assemblage, alignement, signature")
    shutil.copyfile(BUILD / "base.apk", BUILD / "unaligned.apk")
    with zipfile.ZipFile(BUILD / "unaligned.apk", "a", zipfile.ZIP_DEFLATED) as z:
        z.write(BUILD / "dex" / "classes.dex", "classes.dex")
    run([tc["zipalign"], "-f", "-p", "4", BUILD / "unaligned.apk", BUILD / "aligned.apk"])
    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / (APK_NAME + ("-debug" if args.debug else "") + ".apk")
    env = dict(tc["env"], AWC_KS_PASS=ks_pass)
    run([tc["apksigner"], "sign", "--ks", ks, "--ks-key-alias", KEY_ALIAS,
         "--ks-pass", "env:AWC_KS_PASS", "--key-pass", "env:AWC_KS_PASS",
         "--min-sdk-version", MIN_SDK, "--out", out, BUILD / "aligned.apk"], env=env)
    certs = run([tc["apksigner"], "verify", "--print-certs", out], env=tc["env"])
    sha_cert = re.search(r"SHA-256 digest: ([0-9a-f]+)", certs)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"\n✓ {out}  ({out.stat().st_size / 1048576:.1f} Mo)\n  sha256 {digest}\n  certificat {sha_cert.group(1) if sha_cert else '?'}")

    if args.install:
        step("adb install -r")
        print(run(["adb", "install", "-r", out]))


if __name__ == "__main__":
    main()
