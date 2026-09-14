/* AW Cockpit — app Android : les textes du cockpit qui parlent de l'extension (ZIP, dossier, navigateur).
   Inséré par build_apk.py juste après translations.js, dans la même portée (TRANSLATIONS). */
(function () {
  var O = {
    fr: {
      cockpit_privacy: "Pas de compte, rien n'est envoyé : l'app ne parle qu'au jeu, et lit une fois par jour le numéro de la dernière version sur GitHub. Tes réglages restent sur ton téléphone.",
      cockpit_updates_hint2: "Une fois par jour, l'app lit le numéro de la dernière version publiée sur GitHub (rien n'est envoyé). Pour mettre à jour : télécharger l'APK, l'ouvrir puis « Mettre à jour » ; tes réglages sont conservés.",
      cockpit_upd_how: "Télécharge l'APK, ouvre-la puis « Mettre à jour » : tes réglages et ta connexion sont conservés.",
    },
    en: {
      cockpit_privacy: "No account, nothing is sent: the app only talks to the game, and reads the latest version number on GitHub once a day. Your settings stay on your phone.",
      cockpit_updates_hint2: "Once a day, the app reads the number of the latest version published on GitHub (nothing is sent). To update: download the APK, open it, then tap “Update”; your settings are kept.",
      cockpit_upd_how: "Download the APK, open it, then tap “Update”: your settings and login are kept.",
    },
    es: {
      cockpit_privacy: "Sin cuenta, no se envía nada: la app solo habla con el juego y lee una vez al día el número de la última versión en GitHub. Tus ajustes se quedan en tu teléfono.",
      cockpit_updates_hint2: "Una vez al día, la app lee el número de la última versión publicada en GitHub (no se envía nada). Para actualizar: descarga el APK, ábrelo y pulsa «Actualizar»; tus ajustes se conservan.",
      cockpit_upd_how: "Descarga el APK, ábrelo y pulsa «Actualizar»: se conservan tus ajustes y tu sesión.",
    },
    de: {
      cockpit_privacy: "Kein Konto, nichts wird gesendet: Die App spricht nur mit dem Spiel und liest einmal am Tag die Nummer der neuesten Version auf GitHub. Deine Einstellungen bleiben auf deinem Handy.",
      cockpit_updates_hint2: "Einmal am Tag liest die App die Nummer der neuesten auf GitHub veröffentlichten Version (nichts wird gesendet). Zum Aktualisieren: APK herunterladen, öffnen und „Aktualisieren“ tippen; deine Einstellungen bleiben erhalten.",
      cockpit_upd_how: "APK herunterladen, öffnen und „Aktualisieren“ tippen: Einstellungen und Anmeldung bleiben erhalten.",
    },
  };
  Object.keys(O).forEach(function (l) { if (TRANSLATIONS[l]) Object.assign(TRANSLATIONS[l], O[l]); });
})();
