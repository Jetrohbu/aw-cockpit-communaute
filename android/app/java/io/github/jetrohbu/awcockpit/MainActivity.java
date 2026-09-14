package io.github.jetrohbu.awcockpit;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AW Cockpit — édition communauté pour Android.
 *
 * Une WebView sur https://astrowars.games dans laquelle on rejoue ce que fait l'extension :
 *  - document_start : web/early.js (pont chrome.*, CSS des apparences, reskin-early.js) injecté
 *    par WebViewCompat.addDocumentStartJavaScript, AVANT le premier rendu — pas de flash ;
 *  - document_idle  : early.js ajoute &lt;script src="/__awc/idle.js"&gt; (les scripts du manifeste).
 * Les fichiers de l'extension sont servis sous https://astrowars.games/__awc/… par
 * shouldInterceptRequest, depuis les assets de l'APK : même origine que la page, donc polices,
 * textures WebGL et import() de three.js marchent sans CORS ni CSP. Rien ne part vers le jeu
 * pour ces URL. Seules requêtes hors jeu : la dernière Release GitHub (bouton / 1×/jour).
 */
public class MainActivity extends Activity {
    private static final String TAG = "AWCockpit";
    private static final String HOST = "astrowars.games";
    private static final String ORIGIN = "https://" + HOST;
    private static final String AWC_PATH = "/__awc/";
    private static final String HOME = ORIGIN + "/Game/Planets";
    private static final int BG = 0xFF05070D;
    /** seules URL que le pont « http » accepte : l'API et les fichiers bruts du dépôt public */
    private static final String[] HTTP_ALLOWED = {
        "https://api.github.com/repos/Jetrohbu/aw-cockpit-communaute/",
        "https://raw.githubusercontent.com/Jetrohbu/aw-cockpit-communaute/",
    };

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private WebView web;
    private View errorView;
    private SharedPreferences prefs;
    private boolean docStart;
    private String earlyJs;
    private long lastExternal;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("awc", MODE_PRIVATE);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        edgeToEdge();

        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);          // window.open / target=_blank : même vue (routage plus bas)
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);                           // la mise en page du cockpit ne suit pas la taille de police système
        s.setUseWideViewPort(true);                   // respecte <meta viewport initial-scale=1> comme Chrome : pas de dézoom
        s.setLoadWithOverviewMode(false);             // automatique quand une ligne déborde
        CookieManager.getInstance().setAcceptCookie(true);

        earlyJs = readAsset("web/early.js");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(web, earlyJs, Collections.singleton(ORIGIN));
                docStart = true;
            } catch (RuntimeException e) {
                Log.w(TAG, "document start indisponible", e);
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "AWCNative", Collections.singleton(ORIGIN),
                (view, message, sourceOrigin, isMainFrame, reply) -> onNativeMessage(message.getData(), isMainFrame, reply));
        } else {
            web.addJavascriptInterface(new LegacyBridge(), "AWCNativeJ");
        }

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient());   // sans lui, alert()/confirm() du jeu ne s'affichent pas
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> openExternal(url));
        if (Build.VERSION.SDK_INT >= 24) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return serveAwc(request);
                }
            });
        }

        if (state == null || web.restoreState(state) == null) web.loadUrl(startUrl());
    }

    /* ───────────── bords de l'écran : la page ne passe ni sous la barre d'état ni sous le clavier ───────────── */
    @SuppressWarnings("deprecation")
    private void edgeToEdge() {
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
    }

    /* ───────────── navigation ───────────── */
    private String startUrl() {
        String last = prefs.getString("last", null);
        return last != null ? last : HOME;
    }

    private static boolean isGameHost(String host) {
        return HOST.equalsIgnoreCase(host) || ("www." + HOST).equalsIgnoreCase(host);
    }

    /** Page à rouvrir au prochain lancement : une page du jeu sans paramètres (jamais une action rejouée). */
    private void remember(String url) {
        Uri u = Uri.parse(url);
        String path = u.getPath() == null ? "" : u.getPath();
        if (isGameHost(u.getHost()) && path.startsWith("/Game/") && u.getQuery() == null) {
            prefs.edit().putString("last", ORIGIN + path).apply();
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri u = request.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (("https".equals(scheme) || "http".equals(scheme)) && isGameHost(u.getHost())) {
                if ("http".equals(scheme)) {
                    view.loadUrl(u.buildUpon().scheme("https").build().toString());
                    return true;
                }
                return false;
            }
            openExternal(u.toString());   // Discord, GitHub, page de téléchargement… : navigateur / app dédiée
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serveAwc(request);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            hideError();
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (!docStart && isGameHost(Uri.parse(url).getHost())) view.evaluateJavascript(earlyJs, null);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            /* WebView trop ancienne pour document_start : rattrapage (early.js ne s'exécute qu'une fois par page) */
            if (!docStart && isGameHost(Uri.parse(url).getHost())) view.evaluateJavascript(earlyJs, null);
            remember(url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            /* moteur de rendu tué (mémoire) : on repart sur une vue neuve plutôt que de planter l'app */
            if (view == web) {
                root.removeView(web);
                web.destroy();
                web = null;
                recreate();
            }
            return true;
        }
    }

    /* ───────────── fichiers de l'extension : https://astrowars.games/__awc/<chemin> → assets/web/<chemin> ───────────── */
    private WebResourceResponse serveAwc(WebResourceRequest request) {
        Uri u = request.getUrl();
        if (!"https".equalsIgnoreCase(u.getScheme()) || !HOST.equalsIgnoreCase(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || !path.startsWith(AWC_PATH)) return null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", ORIGIN);
        headers.put("X-Content-Type-Options", "nosniff");
        String rel = path.substring(AWC_PATH.length());
        if (rel.isEmpty() || rel.contains("..") || rel.contains("\\") || rel.startsWith("/")
                || !"GET".equalsIgnoreCase(request.getMethod())) {
            return notFound(headers);
        }
        try {
            InputStream in = getAssets().open("web/" + rel);
            String mime = mimeOf(rel);
            return new WebResourceResponse(mime, mime.startsWith("text/") || mime.endsWith("json") ? "utf-8" : null,
                200, "OK", headers, in);
        } catch (IOException e) {
            return notFound(headers);
        }
    }

    private static WebResourceResponse notFound(Map<String, String> headers) {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int dot = n.lastIndexOf('.');
        String ext = dot < 0 ? "" : n.substring(dot + 1);
        switch (ext) {
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "html": return "text/html";
            case "json": return "application/json";
            case "txt": return "text/plain";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "svg": return "image/svg+xml";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            default: return "application/octet-stream";
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.e(TAG, "asset manquant : " + name, e);
            return "";
        }
    }

    /* ───────────── pont JS ↔ app (window.AWCNative.postMessage, JSON) ───────────── */
    private void onNativeMessage(String data, boolean isMainFrame, JavaScriptReplyProxy reply) {
        JSONObject m;
        try {
            m = new JSONObject(data == null ? "" : data);
        } catch (Exception e) {
            return;
        }
        switch (m.optString("op")) {
            case "open":
                openExternal(m.optString("url"));
                break;
            case "http": {
                final String id = m.optString("id");
                final String url = m.optString("url");
                if (!httpAllowed(url)) {
                    reply(reply, id, 0, null);
                    break;
                }
                io.execute(() -> {
                    int[] status = {0};
                    String body = httpGet(url, status);
                    ui.post(() -> reply(reply, id, status[0], body));
                });
                break;
            }
            case "eval":
                /* repli si <script src="/__awc/idle.js"> ou la feuille de style n'ont pas pu se charger */
                if (isMainFrame && web != null) {
                    String what = m.optString("what");
                    if ("idle".equals(what)) {
                        web.evaluateJavascript(readAsset("web/idle.js"), null);
                    } else if ("css".equals(what)) {
                        web.evaluateJavascript("(function(c){if(document.getElementById('awc-app-style'))return;"
                            + "var s=document.createElement('style');s.id='awc-app-style';s.textContent=c;"
                            + "(document.head||document.documentElement).appendChild(s);})("
                            + JSONObject.quote(readAsset("web/app.css")) + ")", null);
                    }
                }
                break;
            default:
                break;
        }
    }

    private void reply(JavaScriptReplyProxy proxy, String id, int status, String body) {
        try {
            JSONObject r = new JSONObject();
            r.put("id", id);
            r.put("status", status);
            if (body != null) r.put("body", body);
            if (proxy != null) {
                proxy.postMessage(r.toString());
            } else if (web != null) {
                web.evaluateJavascript("window.__awcNativeMsg&&window.__awcNativeMsg(" + JSONObject.quote(r.toString()) + ")", null);
            }
        } catch (Exception e) {
            Log.w(TAG, "réponse au pont", e);
        }
    }

    /** WebView sans WEB_MESSAGE_LISTENER : même protocole, réponses par evaluateJavascript. */
    private class LegacyBridge {
        @JavascriptInterface
        public void postMessage(String data) {
            ui.post(() -> onNativeMessage(data, true, null));
        }
    }

    private static boolean httpAllowed(String url) {
        for (String p : HTTP_ALLOWED) if (url.startsWith(p)) return true;
        return false;
    }

    private static String httpGet(String url, int[] status) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", url.startsWith("https://api.github.com/") ? "application/vnd.github+json" : "*/*");
            c.setRequestProperty("User-Agent", "AW-Cockpit-Android");
            status[0] = c.getResponseCode();
            InputStream in = status[0] >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) return "";
            try (InputStream body = in) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n, total = 0;
                while ((n = body.read(buf)) > 0 && (total += n) <= 4_000_000) out.write(buf, 0, n);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } catch (Exception e) {
            status[0] = 0;
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void openExternal(String url) {
        long now = SystemClock.uptimeMillis();
        if (url == null || url.isEmpty() || now - lastExternal < 800) return;
        Uri u = Uri.parse(url);
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("mailto")) return;   // pas d'intent:// arbitraire
        lastExternal = now;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
    }

    /* ───────────── page d'erreur réseau ───────────── */
    private void showError() {
        if (errorView == null) {
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER);
            box.setBackgroundColor(BG);
            int pad = dp(32);
            box.setPadding(pad, pad, pad, pad);
            box.setClickable(true);
            TextView title = new TextView(this);
            title.setText(R.string.offline_title);
            title.setTextColor(0xFFE6F1FF);
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
            title.setGravity(Gravity.CENTER);
            TextView msg = new TextView(this);
            msg.setText(R.string.offline_msg);
            msg.setTextColor(0xFF8FA3BF);
            msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            msg.setGravity(Gravity.CENTER);
            msg.setPadding(0, dp(10), 0, dp(22));
            Button retry = new Button(this);
            retry.setText(R.string.retry);
            retry.setTextColor(Color.BLACK);
            retry.setBackgroundColor(0xFF2AD2D8);
            retry.setPadding(dp(28), dp(10), dp(28), dp(10));
            retry.setOnClickListener(v -> {
                hideError();
                if (web != null) web.reload();
            });
            box.addView(title);
            box.addView(msg);
            box.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            errorView = box;
        }
        errorView.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    /* ───────────── cycle de vie ───────────── */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        /* d'abord ce qui est ouvert dans la page (menu de l'app, historique, plein écran 3D, colonne du cockpit) */
        web.evaluateJavascript("(function(){try{return !!(window.__awcBack&&window.__awcBack());}catch(e){return false;}})()", v -> {
            if ("true".equals(v) || web == null) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
