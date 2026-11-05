package com.adaptiveavatar.overlay

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The avatar over the ChatGPT app.
 *
 * Her picture is a see-through WebView running the same avatar as the desktop pet window
 * (assets/web: mods/30-avatar.js in pet mode, built by android/build-assets.mjs). This service:
 *  - reads ChatGPT's screen (ChatReader): your questions, whether it's answering, where the chat box is
 *  - tells her page (glue.js: __host.questions / __host.update); the page picks the topic itself
 *  - shows her only while ChatGPT is on screen, above its chat box or where you dragged her
 *
 * Her windows are accessibility overlays: they need no "draw over other apps" permission, and
 * Android lets touches pass through the see-through one to ChatGPT. Only a small touch area over her
 * body takes touches (tap: her menu, drag: move her).
 */
class AvatarService : AccessibilityService(), SharedPreferences.OnSharedPreferenceChangeListener {

    companion object {
        const val CHATGPT = "com.openai.chatgpt"
        /** The running service, for the setup screen's "Turn off completely" (same process). */
        @Volatile var running: AvatarService? = null
        /** The apps she appears in (package -> name). Every other app is never read. */
        val APPS = linkedMapOf(
            CHATGPT to "ChatGPT",
            "com.larus.nova" to "Doubao",      // 豆包
            "com.larus.wolf" to "Cici",        // Doubao's international version
            "com.anthropic.claude" to "Claude",
            "com.tencent.hunyuan.app.chat" to "Yuanbao",   // 元宝
            "com.aliyun.tongyi" to "Qianwen",              // 千问
            "com.deepseek.chat" to "DeepSeek",
            "com.moonshot.kimichat" to "Kimi",
        )
        const val TAG = "AIAvatar"
        const val DUMP_ACTION = "com.adaptiveavatar.overlay.DUMP"
        private const val HOST = WebAssets.HOST
        // One page for every app (switching apps keeps it, and the topic model, loaded). The label is
        // her name tag; menu.js rewrites the desktop pet's per-app menu lines.
        private val PAGE = "https://$HOST/web/index.html?label=${Uri.encode("AI Avatar")}&docked=1"
        private const val MENU_PAGE = "https://$HOST/web/menu.html"

        // Her page is the desktop pet's window, 320 x 340; she stands at its bottom centre, 170 x 239
        // (mods/30-avatar.js place(): SIZE, ASPECT, 6 px from the bottom).
        private const val PAGE_W = 320f
        private const val PAGE_H = 340f
        private const val BODY_L = 75f
        private const val BODY_T = 95f
        private const val BODY_W = 170f
        private const val BODY_H = 239f
        private const val BASE_WIDTH_DP = 176f      // her window's width at size 1

        private val SEND = Regex("^(send|发送)", RegexOption.IGNORE_CASE)
        private val NEW_CHAT = Regex("(new chat|新聊天|新对话|新建对话|新建聊天|新会话)", RegexOption.IGNORE_CASE)
    }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var wm: WindowManager
    private lateinit var prefs: SharedPreferences

    private var pet: WebView? = null
    private var touch: View? = null
    private var menu: WebView? = null
    private val petLp = overlayParams(touchable = false)
    private val touchLp = overlayParams(touchable = true)
    private val menuLp = overlayParams(touchable = true).apply { flags = flags or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH }
    private var menuLoaded = false
    private var menuCall: String? = null

    private var pageReady = false
    private val queued = mutableListOf<String>()
    private var visible = false
    private var app: String? = null            // the supported app in front now (null: none)
    private var lastApp: String? = null        // the last one that was
    private var freshApp = false               // just switched to this app: its questions aren't read yet

    // What we know about the chat.
    private val questions = mutableListOf<String>()
    private var typed: String? = null           // what's in the chat box now
    private var candidate: String? = null       // what was in it just before it emptied
    private var candidateAt = 0L
    private var phase = "idle"
    private var wasGenerating = false
    private var genStart = 0L
    private var lastLen = 0
    private var sentAt = 0L
    private var seenBox: Rect? = null           // the chat box at the last look (see followBox)
    private var chatTitle: String? = null       // the open conversation's name (Doubao)
    private val seen = mutableSetOf<String>()   // your messages already seen on screen in this conversation
    private fun norm(s: String) = s.filterNot { it.isWhitespace() }
    private var screenLen = 0                   // the chat's text length at the last look
    private var candidateLen = 0                // ... when the chat box emptied
    private var answerBase = 0                  // ... when the question was sent
    private var lastSeenLen = 0
    private var lastGrowAt = 0L
    private var composer: Rect? = null
    private var dragging = false
    private var placed = false                 // she has been put somewhere on screen at least once

    // ---------------------------------------------------------------------------------------------
    // Service life
    // ---------------------------------------------------------------------------------------------

    override fun onServiceConnected() {
        wm = getSystemService(WindowManager::class.java)
        prefs = Prefs.of(this)
        prefs.registerOnSharedPreferenceChangeListener(this)
        // Test builds: her page can be inspected from the computer (chrome://inspect).
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        if (prefs.getBoolean(Prefs.ENABLED, true)) createPet()
        running = this
        val filter = IntentFilter(DUMP_ACTION)
        // Only the computer's adb shell may ask (it holds the DUMP permission).
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(dumpReceiver, filter, "android.permission.DUMP", null, Context.RECEIVER_EXPORTED)
        else registerReceiver(dumpReceiver, filter, "android.permission.DUMP", null)
        scheduleScan(0)
        log("service on")
    }

    override fun onDestroy() {
        if (running === this) running = null
        try { unregisterReceiver(dumpReceiver) } catch (_: Exception) {}
        prefs.unregisterOnSharedPreferenceChangeListener(this)
        tearDown()
        super.onDestroy()
    }

    /** "Turn off completely": the service stops itself (Android then shows it as off in Accessibility). */
    fun turnOff() {
        log("turned off completely")
        tearDown()
        disableSelf()
    }

    /** Hidden ("Show her" off) or stopping: free her page, the topic model and her windows. */
    private fun tearDown() {
        closeMenu()
        main.removeCallbacks(scanRun); scanPending = false
        main.removeCallbacks(quickRun); quickPending = false
        for (v in listOfNotNull(touch, pet)) try { wm.removeView(v) } catch (_: Exception) {}
        pet?.destroy()
        pet = null; touch = null
        pageReady = false; queued.clear(); visible = false; placed = false
        boxNode = null; seenBox = null; composer = null
    }

    override fun onInterrupt() {}

    override fun onSharedPreferenceChanged(p: SharedPreferences, key: String?) {
        when (key) {
            Prefs.ENABLED -> {
                if (!prefs.getBoolean(Prefs.ENABLED, true)) { tearDown(); log("hidden") }
                else { if (pet == null) createPet(); scheduleScan(0) }
            }
            Prefs.ALWAYS -> scheduleScan(0)
            Prefs.SIZE -> { resize(); pageReady = false; pet?.loadUrl(PAGE) }   // her page is laid out for one size
            Prefs.WHERE -> {                    // e.g. the setup screen's "Put her back above the chat box"
                val w = prefs.getString(Prefs.WHERE, "docked")
                js("__host.update({where:${JSONObject.quote(w)},free:${w == "free"}})")
                place()
            }
        }
    }

    override fun onConfigurationChanged(c: Configuration) {
        super.onConfigurationChanged(c)
        js("__host.update({dark:${isDark()}})")
        resize()
        scheduleScan(100)
    }

    // ---------------------------------------------------------------------------------------------
    // Reading ChatGPT
    // ---------------------------------------------------------------------------------------------

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (pet == null) return                                 // hidden: nothing to do
        when (e.eventType) {
            AccessibilityEvent.TYPE_WINDOWS_CHANGED, AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                scheduleQuick(20)               // includes the keyboard opening or closing
                scheduleScan(100)
            }
        }
        if (e.packageName?.toString() != app) return          // other apps (and a supported app not in front): not read
        when (e.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                val text = e.text.joinToString("").trim()
                val src = e.source
                val hint = src?.isShowingHintText == true || (src?.hintText != null && text == src.hintText.toString().trim())
                if (text.isNotEmpty() && !hint) typed = text else emptied()
            }
            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                val label = (e.contentDescription?.toString()?.takeIf { it.isNotBlank() }
                    ?: e.text.joinToString(" ").takeIf { it.isNotBlank() }
                    ?: ChatReader.labelOf(e.source) ?: "").trim()
                log("click: \"${label.take(30)}\" (${e.source?.viewIdResourceName?.substringAfter(":id/") ?: "no id"})")
                when {
                    SEND.containsMatchIn(label) -> (typed ?: candidate)?.let { sent(it) }
                    NEW_CHAT.containsMatchIn(label) -> newChat()
                }
            }
        }
        scheduleQuick(30)       // where the chat box is: cheap, so often
        scheduleScan(150)       // the whole screen (questions, answer): costly while the app animates
    }

    /** The chat box went empty: what was in it may have just been sent (confirmed when ChatGPT answers). */
    private fun emptied() {
        typed?.let {
            candidate = it; candidateAt = SystemClock.uptimeMillis(); candidateLen = screenLen
            log("chat box emptied (${it.length} chars typed)")
            // Test builds: snapshots of the screen while the AI answers (files/tree-1.txt ...).
            if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
                for (n in 1..28) main.postDelayed({ dumpTree("tree-$n.txt") }, n * 700L)
        }
        typed = null
    }

    private fun sent(question: String) {
        candidate = null
        typed = null
        questions += question
        while (questions.size > 6) questions.removeAt(0)
        sentAt = SystemClock.uptimeMillis()
        answerBase = screenLen
        log("question sent (${question.length} chars)")
        js("__host.questions(${JSONArray(questions)})")
        setPhase("thinking")
    }

    private fun newChat() {
        questions.clear()
        seen.clear()
        candidate = null
        js("__host.questions([])")
        setPhase("idle")
    }

    private var scanPending = false
    private var scanAt = 0L
    private val scanRun = Runnable { scanPending = false; scan() }
    /** Look at the screen after [delay] ms (an earlier request wins over a later one already waiting). */
    private fun scheduleScan(delay: Long) {
        val at = SystemClock.uptimeMillis() + delay
        if (scanPending && at >= scanAt) return
        main.removeCallbacks(scanRun)
        scanPending = true
        scanAt = at
        main.postAtTime(scanRun, at)
    }

    private fun scan() {
        if (pet == null) return
        if (!prefs.getBoolean(Prefs.ENABLED, true)) return setVisible(false)
        val wins = try { windows } catch (_: Exception) { emptyList<AccessibilityWindowInfo>() }
        val front = wins.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive }
            ?: wins.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isFocused }
        val root = front?.root
        val pkg = root?.packageName?.toString()
        if (pkg == null || pkg !in APPS) {
            // Another app (never read: only its name is checked, to know it isn't a chat app).
            app = null
            if (prefs.getBoolean(Prefs.ALWAYS, false)) {
                // She stays where she was, with the last topic's expert. If the AI was still answering, she
                // keeps waiting: back in the app, she carries on, or nods if it finished meanwhile.
                composer = null                 // no chat box here
                if (!placed) place()
                return setVisible(true)
            }
            closeMenu()
            return setVisible(false)
        }
        if (pkg != lastApp) switchApp(pkg)
        app = pkg

        val info = ChatReader.read(root)
        val now = SystemClock.uptimeMillis()
        if (info.composer != null) { boxNode = info.composerNode; boxSeenAt = now }
        // Where she stands: the chat box's top edge, or the row of buttons right above it.
        shelfLift = info.composer?.let { c -> info.standTop?.let { c.top - it } } ?: 0
        followBox(info.composer?.let { lifted(it) }, now)
        // Another conversation opened (its title changed): start again from its questions on screen.
        if (info.title != null && info.title != chatTitle) {
            if (chatTitle != null) {
                log("conversation changed")
                questions.clear()
                seen.clear()
                if (info.userMessages.isEmpty()) js("__host.questions([])")
            }
            chatTitle = info.title
        }
        // An old chat reopened: its questions on screen.
        if (questions.isEmpty() && info.userMessages.isNotEmpty()) {
            questions += info.userMessages.takeLast(6)
            seen += info.userMessages.map(::norm)
            log("questions from screen: ${questions.size}")
            js("__host.questions(${JSONArray(questions)})")
        }
        // Switched here from another chat app and nothing of yours is on screen: the everyday look.
        if (freshApp) {
            freshApp = false
            if (questions.isEmpty()) js("__host.questions([])")
        }
        if (info.composerText != null) typed = info.composerText else if (typed != null) emptied()
        screenLen = info.textLength
        if (info.textLength > lastSeenLen) lastGrowAt = now
        lastSeenLen = info.textLength
        // Sent, as seen on screen: the box emptied and your message appeared (the chat's text grew).
        // For apps whose Send button has no name.
        candidate?.let { c -> if (now - candidateAt < 6000 && info.textLength >= candidateLen + minOf(c.length, 2)) sent(c) }
        // A question that was never typed (voice input): a new bubble of yours at the bottom of the
        // chat. Not while you're scrolled up reading older messages (they'd look new).
        val newest = info.userMessages.lastOrNull()
        if (newest != null && !info.scrolledUp && norm(newest) !in seen && questions.none { norm(it) == norm(newest) }) {
            log("question on screen (not typed)")
            sent(newest)
        }
        seen += info.userMessages.map(::norm)

        if (info.generating) {
            if (!wasGenerating) {
                genStart = now
                lastLen = info.textLength
                val c = candidate
                if (c != null && now - candidateAt < 6000) sent(c)
                setPhase("thinking")
            } else if (phase == "thinking" && info.textLength > lastLen + 20 && now - genStart > 800) {
                setPhase("writing")
            }
        } else if (wasGenerating) {
            setPhase("idle")                 // done: she nods
        } else if (phase == "thinking" && info.textLength > answerBase + 20) {
            setPhase("writing")              // no Stop button seen (Doubao): the answer's text is growing
        } else if (phase == "writing" && now - lastGrowAt > 3000) {
            setPhase("idle")                 // ... and has stopped growing
        } else if (phase != "idle" && now - sentAt > 20000) {
            setPhase("idle")                 // no answer came
        }
        wasGenerating = info.generating
        if (candidate != null && now - candidateAt > 6000) candidate = null

        setVisible(true)
        if (!placed) place()
        // While ChatGPT is answering, look again now and then (its text changes don't always say so).
        if (info.generating || phase != "idle" || candidate != null) scheduleScan(700)
    }

    /** Another supported app came to the front: a different conversation, and her name tag says whose she is. */
    private fun switchApp(pkg: String) {
        val first = lastApp == null
        lastApp = pkg
        questions.clear(); seen.clear(); typed = null; candidate = null; wasGenerating = false; chatTitle = null
        boxNode = null; seenBox = null; composer = null            // its own chat box, found on this look
        setPhase("idle")
        // Its questions come from its screen on this same look (scan); only if it shows none does she
        // go back to her everyday look. Her page and the topic model stay loaded.
        freshApp = !first
        log("app: ${APPS[pkg]}")
    }

    // ---- Following the chat box ----------------------------------------------------------------
    // Reading the whole screen takes 80-280 ms while the app animates (the keyboard sliding), so between
    // full reads only the chat box itself is looked at again (one node: a few ms). It moves in steps
    // as the keyboard slides: she follows it once it's in the same place on two looks in a row (one
    // move, not two). While the keyboard closes, some apps (Claude, ChatGPT) drop the chat box for a
    // moment: she stays put until it's back.
    private var boxNode: AccessibilityNodeInfo? = null
    private var shelfLift = 0                   // how far above the chat box she stands (a button row)
    private fun lifted(r: Rect) = if (shelfLift > 0) Rect(r).apply { top -= shelfLift } else r
    private var boxSeenAt = 0L
    private var quickPending = false
    private val quickRun = Runnable { quickPending = false; quick() }
    private fun scheduleQuick(delay: Long) {
        if (quickPending) return
        quickPending = true
        main.postDelayed(quickRun, delay)
    }

    private fun quick() {
        if (app == null || pet == null) return
        val n = boxNode ?: return scheduleScan(0)
        val now = SystemClock.uptimeMillis()
        val alive = try { n.refresh() && n.isVisibleToUser } catch (_: Exception) { false }
        if (!alive) { boxNode = null; scheduleScan(30); return followBox(null, now) }   // replaced: find it again
        val r = Rect().also { n.getBoundsInScreen(it) }
        if (r.isEmpty) return followBox(null, now)
        boxSeenAt = now
        followBox(lifted(r), now)
    }

    private fun followBox(box: Rect?, now: Long) {
        if (box == null && now - boxSeenAt < 1500) { scheduleScan(1600); return }   // gone for a moment
        if (box == seenBox) {
            if (box != composer) {
                log("she follows the chat box: top ${composer?.top} -> ${box?.top}")
                composer = box?.let { Rect(it) }
                if (visible) place()
            }
            return
        }
        seenBox = box?.let { Rect(it) }
        if (composer == null && box != null) { composer = Rect(box); if (visible) place() }   // first sight: at once
        scheduleQuick(40)
    }

    private fun setPhase(p: String) {
        if (p == phase) return
        phase = p
        log("phase: $p")
        js("__host.update({phase:${JSONObject.quote(p)}})")
    }

    // ---------------------------------------------------------------------------------------------
    // Her windows
    // ---------------------------------------------------------------------------------------------

    private fun overlayParams(touchable: Boolean) = WindowManager.LayoutParams(
        1, 1, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE),
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }

    /** English or Chinese, by the phone's language (as her page and menu do). */
    private fun tr(en: String, zh: String) = if (java.util.Locale.getDefault().language == "zh") zh else en

    private fun dp(v: Float) = (v * resources.displayMetrics.density).roundToInt()
    private fun isDark() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private fun size() = prefs.getFloat(Prefs.SIZE, 1f).coerceIn(0.6f, 1.4f)
    /** Fits her to the phone: 1 on a typical 400 dp-wide phone, a little smaller or bigger on others. */
    private fun fit(): Float {
        val m = resources.displayMetrics
        val shortDp = minOf(m.widthPixels, m.heightPixels) / m.density
        return (shortDp / 400f).coerceIn(0.8f, 1.2f)
    }
    private fun petW() = dp(BASE_WIDTH_DP * size() * fit())
    private fun petH() = (petW() * PAGE_H / PAGE_W).roundToInt()
    private fun scale() = petW() / PAGE_W                  // page px -> screen px
    private fun screen(): Rect =
        if (Build.VERSION.SDK_INT >= 30) wm.currentWindowMetrics.bounds
        else resources.displayMetrics.let { Rect(0, 0, it.widthPixels, it.heightPixels) }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun createPet() {
        val wv = webView()
        wv.addJavascriptInterface(PetJs(), "AndroidPet")
        wv.visibility = View.INVISIBLE
        resizeParams()
        wm.addView(wv, petLp)
        pet = wv
        wv.loadUrl(PAGE)
        val t = View(this)
        t.setOnTouchListener { _, e -> onTouchHer(e) }
        t.visibility = View.GONE
        wm.addView(t, touchLp)
        touch = t
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun webView() = WebView(this).apply {
        setBackgroundColor(Color.TRANSPARENT)
        settings.javaScriptEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        webViewClient = AssetClient()
        webChromeClient = object : WebChromeClient() {
            // Android's WebView shows a grey "play" picture while a video has no frame yet (between
            // one walk clip and the next). Hers is see-through instead.
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                log("console: ${m.message()} (${m.sourceId().substringAfterLast('/')}:${m.lineNumber()})")
                return true
            }
        }
    }

    private fun resizeParams() {
        petLp.width = petW(); petLp.height = petH()
        pet?.setInitialScale((scale() * 100).roundToInt())
    }

    private fun resize() {
        resizeParams()
        pet?.setInitialScale((scale() * 100).roundToInt())
        place(force = true)
    }

    private fun setVisible(on: Boolean) {
        if (on == visible) return
        visible = on
        pet?.visibility = if (on) View.VISIBLE else View.INVISIBLE
        touch?.visibility = if (on) View.VISIBLE else View.GONE
        if (on) pet?.onResume() else pet?.onPause()
        if (!on) closeMenu()
    }

    /** Above the left end of ChatGPT's chat box ("docked", the default), or where you dragged her. */
    private fun place(force: Boolean = false) {
        if (dragging) return
        val s = scale()
        val bodyL = (BODY_L * s).roundToInt()
        val bodyT = (BODY_T * s).roundToInt()
        val bodyW = (BODY_W * s).roundToInt()
        val bodyH = (BODY_H * s).roundToInt()
        val c = composer
        val scr = screen()
        var x: Int
        var y: Int
        if (prefs.getString(Prefs.WHERE, "docked") == "docked" && c != null && !c.isEmpty) {
            x = c.left + dp(2f) - bodyL
            y = c.top + dp(4f) - (bodyT + bodyH)            // her feet just on the chat box's top edge
        } else {
            x = prefs.getInt(Prefs.FREE_X, scr.right - dp(8f) - (bodyL + bodyW))
            y = prefs.getInt(Prefs.FREE_Y, scr.bottom - dp(140f) - (bodyT + bodyH))
        }
        // Keep her body on the screen (the see-through space around her may hang off it).
        x = x.coerceIn(scr.left - bodyL, scr.right - bodyL - bodyW)
        y = y.coerceIn(scr.top - bodyT, scr.bottom - bodyT - bodyH)
        moveTo(x, y, force)
    }

    private fun moveTo(x: Int, y: Int, force: Boolean = false) {
        placed = true
        val s = scale()
        if (force || x != petLp.x || y != petLp.y) {
            if (placed && !dragging) log("she moves to y=$y")
            petLp.x = x; petLp.y = y
            pet?.let { try { wm.updateViewLayout(it, petLp) } catch (_: Exception) {} }
        }
        val tx = x + (BODY_L * s).roundToInt()
        val ty = y + (BODY_T * s).roundToInt()
        val tw = (BODY_W * s).roundToInt()
        val th = (BODY_H * s).roundToInt()
        if (force || tx != touchLp.x || ty != touchLp.y || tw != touchLp.width || th != touchLp.height) {
            touchLp.x = tx; touchLp.y = ty; touchLp.width = tw; touchLp.height = th
            touch?.let { try { wm.updateViewLayout(it, touchLp) } catch (_: Exception) {} }
        }
    }

    // Press and hold her: her menu (with a little buzz, as soon as it's held long enough).
    // Drag her: she stays where you put her ("free"). Tap her: onTap().
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var held = false                   // the long press already opened the menu
    private val longPress = Runnable {
        if (dragging) return@Runnable
        held = true
        touch?.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
        js("__host.openMenu()")
    }
    private fun onTouchHer(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.rawX; downY = e.rawY; startX = petLp.x; startY = petLp.y
                dragging = false; held = false
                main.postDelayed(longPress, android.view.ViewConfiguration.getLongPressTimeout().toLong())
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = e.rawX - downX
                val dy = e.rawY - downY
                if (!dragging && !held && abs(dx) + abs(dy) > dp(10f)) {
                    dragging = true
                    main.removeCallbacks(longPress)
                    closeMenu()
                }
                if (dragging) moveTo(startX + dx.roundToInt(), startY + dy.roundToInt())
            }
            MotionEvent.ACTION_UP -> {
                main.removeCallbacks(longPress)
                when {
                    dragging -> {
                        dragging = false
                        prefs.edit().putString(Prefs.WHERE, "free").putInt(Prefs.FREE_X, petLp.x).putInt(Prefs.FREE_Y, petLp.y).apply()
                        js("__host.update({where:'free',free:true})")
                        place()
                    }
                    !held -> onTap()
                }
            }
            MotionEvent.ACTION_CANCEL -> {
                main.removeCallbacks(longPress)
                if (dragging) { dragging = false; place() }
            }
        }
        return true
    }

    /** A short tap on her. Free for a future feature; does nothing yet. */
    private fun onTap() {
        log("tap")
    }

    // ---------------------------------------------------------------------------------------------
    // Her menu (built by her page, shown in its own window)
    // ---------------------------------------------------------------------------------------------

    @SuppressLint("ClickableViewAccessibility")
    private fun showMenu(html: String, css: String) {
        closeMenu()
        val docked = prefs.getString(Prefs.WHERE, "docked") == "docked"
        val scr = screen()
        val s = scale()
        val here = JSONObject()
            .put("x", (petLp.x + (BODY_L + BODY_W / 2) * s - scr.left) / scr.width())
            .put("y", (petLp.y + (BODY_T + BODY_H / 2) * s - scr.top) / scr.height())
        val data = JSONObject().put("html", html).put("css", css)
            .put("corner", if (docked) "bottom-left" else JSONObject.NULL).put("here", here)
            .put("always", prefs.getBoolean(Prefs.ALWAYS, false))
        menuCall = "window.__menuShow($data)"
        val wv = webView()
        wv.addJavascriptInterface(MenuJs(), "AndroidMenu")
        wv.setOnTouchListener { _, e -> if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) closeMenu(); false }
        wv.visibility = View.INVISIBLE
        menuLp.width = dp(320f); menuLp.height = dp(200f)
        menuLp.x = 0; menuLp.y = 0
        wm.addView(wv, menuLp)
        menu = wv
        menuLoaded = false
        wv.loadUrl(MENU_PAGE)
    }

    private fun sizeMenu(wDp: Int, hDp: Int) {
        val m = menu ?: return
        val scr = screen()
        val w = dp(wDp.toFloat()).coerceAtMost(scr.width() - dp(8f))
        val h = dp(hDp.toFloat()).coerceAtMost(scr.height() - dp(80f))
        val s = scale()
        // Beside her if there's room, else over her; always on the screen.
        val bodyL = petLp.x + (BODY_L * s).roundToInt()
        val bodyR = bodyL + (BODY_W * s).roundToInt()
        val midY = petLp.y + ((BODY_T + BODY_H / 2) * s).roundToInt()
        var x = if (bodyR + w <= scr.right) bodyR else bodyL - w
        x = x.coerceIn(scr.left + dp(4f), scr.right - w - dp(4f))
        val y = (midY - h / 2).coerceIn(scr.top + dp(40f), scr.bottom - h - dp(40f))
        menuLp.width = w; menuLp.height = h; menuLp.x = x; menuLp.y = y
        try { wm.updateViewLayout(m, menuLp) } catch (_: Exception) {}
        m.visibility = View.VISIBLE
    }

    private fun closeMenu() {
        val m = menu ?: return
        menu = null
        try { wm.removeView(m) } catch (_: Exception) {}
        m.destroy()
    }

    private fun onAct(type: String, value: Any?) {
        when (type) {
            "where" -> setWhere(if (value == "free") "free" else "docked")
            "corner" -> {
                // Bottom left = beside the chat box, in a chat app. Elsewhere it's just that corner.
                if (value == "bottom-left" && app != null) return setWhere("docked")
                val scr = screen()
                val s = scale()
                val bodyL = (BODY_L * s).roundToInt(); val bodyT = (BODY_T * s).roundToInt()
                val bodyW = (BODY_W * s).roundToInt(); val bodyH = (BODY_H * s).roundToInt()
                val m = dp(8f)
                val x = if (value.toString().endsWith("left")) scr.left + m - bodyL else scr.right - m - bodyL - bodyW
                val bottom = composer?.top?.takeIf { it > 0 } ?: (scr.bottom - dp(120f))
                val y = if (value.toString().startsWith("top")) scr.top + dp(56f) - bodyT else bottom - bodyT - bodyH
                prefs.edit().putString(Prefs.WHERE, "free").putInt(Prefs.FREE_X, x).putInt(Prefs.FREE_Y, y).apply()
                js("__host.update({where:'free',free:true})")
                place()
            }
            "back" -> {
                prefs.edit().putBoolean(Prefs.ENABLED, false).apply()
                Toast.makeText(this, tr("Avatar hidden. Turn her back on in the AI Avatar app.", "头像已隐藏。可在 AI Avatar 应用里重新显示。"), Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun setWhere(where: String) {
        prefs.edit().putString(Prefs.WHERE, where).apply()
        js("__host.update({where:${JSONObject.quote(where)},free:${where == "free"}})")
        place()
    }

    // ---------------------------------------------------------------------------------------------
    // Talking to her page
    // ---------------------------------------------------------------------------------------------

    private fun js(code: String) {
        val wv = pet ?: return
        if (!pageReady) { queued += code; if (queued.size > 50) queued.removeAt(0); return }
        wv.evaluateJavascript(code, null)
    }

    inner class PetJs {
        @JavascriptInterface fun ready() = main.post {
            pageReady = true
            val where = prefs.getString(Prefs.WHERE, "docked")
            pet?.evaluateJavascript("__host.update({dark:${isDark()},phase:${JSONObject.quote(phase)},where:${JSONObject.quote(where)},free:${where == "free"}})", null)
            pet?.evaluateJavascript("__host.questions(${JSONArray(questions)})", null)
            queued.clear()
            log("page ready")
        }
        @JavascriptInterface fun log(s: String) { this@AvatarService.log("page: $s") }
        @JavascriptInterface fun menu(html: String, css: String) { main.post { showMenu(html, css) } }
        @JavascriptInterface fun timing(json: String) { Stats.add(this@AvatarService, json) }
        @JavascriptInterface fun act(type: String, value: String) {
            val v = try { JSONArray("[$value]").get(0) } catch (_: Exception) { null }
            main.post { onAct(type, v) }
        }
    }

    inner class MenuJs {
        /** The phone's own menu rows (menu.js): "always" = stay on screen in other apps. */
        @JavascriptInterface fun act(what: String) {
            main.post {
                closeMenu()
                if (what == "always") {
                    val on = !prefs.getBoolean(Prefs.ALWAYS, false)
                    prefs.edit().putBoolean(Prefs.ALWAYS, on).apply()
                    Toast.makeText(this@AvatarService, if (on) tr("She'll stay on screen in other apps.", "她会在其他应用中继续显示。") else tr("She'll show only in the chat apps.", "她只会在聊天应用中显示。"), Toast.LENGTH_SHORT).show()
                }
            }
        }
        @JavascriptInterface fun size(w: Int, h: Int) { main.post { sizeMenu(w, h) } }
        @JavascriptInterface fun pick(k: Int) { main.post { closeMenu(); js("__host.command({type:'menu',k:$k})") } }
        @JavascriptInterface fun close() { main.post { closeMenu() } }
    }

    /** Serves the app's own page files (assets/web) at https://appassets.androidplatform.net/web/. */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest) = WebAssets.serve(this@AvatarService, req)

        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest) = true   // never leave our page

        override fun onPageFinished(view: WebView, url: String) {
            if (view === menu && !menuLoaded) { menuLoaded = true; menuCall?.let { view.evaluateJavascript(it, null) } }
        }

    }

    // ---------------------------------------------------------------------------------------------
    // Working out an app's layout from the computer (debug builds: read with `adb shell run-as`):
    //   adb shell am broadcast -a com.adaptiveavatar.overlay.DUMP [--ei repeat 30]
    // writes the supported app's accessibility tree to files/tree.txt (with repeat: files/tree-1.txt
    // .. tree-N.txt, one every 0.7 s, to catch it while the AI answers). files/avatar-log.txt is the
    // log (some phones, e.g. Huawei, hide apps' own logcat lines).
    // ---------------------------------------------------------------------------------------------

    private val logFile by lazy { File(filesDir, "avatar-log.txt") }
    private val stamp = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US)
    private fun log(s: String) {
        Log.i(TAG, s)
        try {
            if (logFile.length() > 300_000) logFile.writeText("")
            logFile.appendText("${stamp.format(java.util.Date())} $s\n")
        } catch (_: Exception) {}
    }

    private val dumpReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val repeat = i.getIntExtra("repeat", 0).coerceIn(0, 60)
            if (repeat == 0) { main.post { dumpTree("tree.txt") }; return }
            for (n in 1..repeat) main.postDelayed({ dumpTree("tree-$n.txt") }, (n - 1) * 700L)
        }
    }

    private fun dumpTree(name: String) {
        val wins = try { windows } catch (_: Exception) { emptyList<AccessibilityWindowInfo>() }
        val roots = wins.mapNotNull { it.root }.filter { it.packageName?.toString() in APPS }
        val text = if (roots.isEmpty()) "No supported app is on screen\n"
            else roots.joinToString("\n===== window =====\n") { ChatReader.dump(it) }
        File(filesDir, name).writeText("${stamp.format(java.util.Date())}\n$text")
        log("tree written: $name")
    }
}
