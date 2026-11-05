package com.adaptiveavatar.overlay

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject

/**
 * The setup screen: a page of our own (assets/web/settings.html) with the steps to switch her on, the
 * chat apps to open, her settings and how fast the topic model is on this phone. This activity only
 * shows the page and carries out its buttons (window.App).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    /** Chinese names, for the app list. */
    private val zhNames = mapOf(
        "com.larus.nova" to "豆包", "com.tencent.hunyuan.app.chat" to "元宝", "com.aliyun.tongyi" to "千问",
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val bg = if (dark) Color.parseColor("#141318") else Color.parseColor("#f5f4f1")
        @Suppress("DEPRECATION")
        window.statusBarColor = bg
        @Suppress("DEPRECATION")
        window.navigationBarColor = bg
        if (!dark) {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        web = WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest) = WebAssets.serve(this@MainActivity, req)
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest) = true
            }
            addJavascriptInterface(Bridge(), "App")
            loadUrl(WebAssets.BASE + "settings.html")
        }
        // Android 15+ draws apps under the status and navigation bars: keep the page between them.
        val frame = android.widget.FrameLayout(this).apply {
            setBackgroundColor(bg)
            addView(web)
            setOnApplyWindowInsetsListener { v, insets ->
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                }
                insets
            }
        }
        setContentView(frame)
    }

    override fun onResume() {
        super.onResume()
        web.evaluateJavascript("window.render && render()", null)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private fun serviceOn(): Boolean {
        val me = ComponentName(this, AvatarService::class.java)
        val list = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return TextUtils.SimpleStringSplitter(':').apply { setString(list) }.any { ComponentName.unflattenFromString(it) == me }
    }

    /**
     * Straight to AI Avatar's own on/off page in Accessibility settings (Android 11+), so there's nothing
     * to look for. Where a phone doesn't allow that: the Accessibility list, with AI Avatar highlighted
     * (the extras Settings uses for search results), and failing that the plain list.
     */
    private fun openOwnSwitch() {
        val me = ComponentName(this, AvatarService::class.java).flattenToString()
        val direct = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").putExtra(Intent.EXTRA_COMPONENT_NAME, me)
        val highlighted = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            .putExtra(":settings:fragment_args_key", me)
            .putExtra(":settings:show_fragment_args", Bundle().apply { putString(":settings:fragment_args_key", me) })
        for (intent in listOf(direct, highlighted, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))) {
            if (intent === direct && android.os.Build.VERSION.SDK_INT < 30) continue
            try { startActivity(intent); return } catch (_: Exception) {}
        }
    }

    private fun refreshSoon() = web.postDelayed({ web.evaluateJavascript("render()", null) }, 600)

    /** What the page may ask (window.App). Calls arrive on a background thread. */
    inner class Bridge {
        private val prefs get() = Prefs.of(this@MainActivity)

        @JavascriptInterface fun state(): String {
            val apps = JSONArray()
            for ((pkg, name) in AvatarService.APPS) {
                if (packageManager.getLaunchIntentForPackage(pkg) == null) continue
                apps.put(JSONObject().put("pkg", pkg).put("name", name).put("zh", zhNames[pkg] ?: ""))
            }
            return JSONObject()
                .put("on", serviceOn())
                .put("enabled", prefs.getBoolean(Prefs.ENABLED, true))
                .put("always", prefs.getBoolean(Prefs.ALWAYS, false))
                .put("size", prefs.getFloat(Prefs.SIZE, 1f).toDouble())
                .put("docked", prefs.getString(Prefs.WHERE, "docked") == "docked")
                .put("apps", apps)
                .put("perf", JSONArray(Stats.lines(this@MainActivity)))
                .toString()
        }

        @JavascriptInterface fun openAccessibility() = runOnUiThread { openOwnSwitch() }
        @JavascriptInterface fun appInfo() = runOnUiThread {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        @JavascriptInterface fun turnOff() = runOnUiThread { AvatarService.running?.turnOff(); refreshSoon() }
        @JavascriptInterface fun openApp(pkg: String) = runOnUiThread {
            if (pkg in AvatarService.APPS) packageManager.getLaunchIntentForPackage(pkg)?.let { startActivity(it) }
        }
        @JavascriptInterface fun setEnabled(on: Boolean) { prefs.edit().putBoolean(Prefs.ENABLED, on).apply() }
        @JavascriptInterface fun setAlways(on: Boolean) { prefs.edit().putBoolean(Prefs.ALWAYS, on).apply() }
        @JavascriptInterface fun setSize(size: Double) { prefs.edit().putFloat(Prefs.SIZE, size.toFloat().coerceIn(0.6f, 1.4f)).apply() }
        @JavascriptInterface fun dock() { prefs.edit().putString(Prefs.WHERE, "docked").apply() }
        @JavascriptInterface fun clearStats() { Stats.clear(this@MainActivity) }
    }
}
