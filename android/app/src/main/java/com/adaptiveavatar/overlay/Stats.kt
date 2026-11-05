package com.adaptiveavatar.overlay

import android.content.Context
import android.os.Build
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * How fast the topic model is on this phone, for the setup screen's Performance section: the last few
 * model loads and the last 30 topic picks (each reported by her page: glue.js, model.mjs).
 */
object Stats {
    private const val KEY = "stats"
    private const val MAX_TOPICS = 30
    private const val MAX_LOADS = 5

    @Synchronized
    fun add(c: Context, json: String) {
        val e = try { JSONObject(json) } catch (_: Exception) { return }
        e.put("at", System.currentTimeMillis())
        val prefs = Prefs.of(c)
        val all = try { JSONObject(prefs.getString(KEY, "{}")!!) } catch (_: Exception) { JSONObject() }
        val list = if (e.optString("kind") == "topic") "topics" else "loads"
        val max = if (list == "topics") MAX_TOPICS else MAX_LOADS
        val arr = all.optJSONArray(list) ?: JSONArray()
        arr.put(e)
        while (arr.length() > max) arr.remove(0)
        all.put(list, arr)
        prefs.edit().putString(KEY, all.toString()).apply()
    }

    fun clear(c: Context) = Prefs.of(c).edit().remove(KEY).apply()

    private fun sec(ms: Int) = if (ms < 1000) "$ms ms" else "${"%.1f".format(ms / 1000f)} s"

    /** English or Chinese, by the phone's language (as the setup page does). */
    private fun tr(en: String, zh: String) = if (java.util.Locale.getDefault().language == "zh") zh else en

    /** A few lines for the setup screen, in the phone's language. */
    fun lines(c: Context): List<String> {
        val webView = if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName ?: "?" else "?"
        val out = mutableListOf<String>()
        out += tr("Phone", "手机") + ": ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · WebView $webView"
        out += tr("Processor cores", "处理器核心") + ": ${Runtime.getRuntime().availableProcessors()}"
        val all = try { JSONObject(Prefs.of(c).getString(KEY, "{}")!!) } catch (_: Exception) { JSONObject() }

        val loads = all.optJSONArray("loads")
        val lastLoad = loads?.let { if (it.length() > 0) it.getJSONObject(it.length() - 1) else null }
        val threads = lastLoad?.optInt("threads", 1) ?: 1
        out += when {
            lastLoad == null -> tr("Topic model: not loaded yet (open a chat app).", "话题模型：尚未加载（打开一个聊天应用）。")
            lastLoad.optString("kind") == "load-failed" -> tr(
                "Topic model failed to load: ${lastLoad.optString("error")} (she uses keywords).",
                "话题模型加载失败：${lastLoad.optString("error")}（改用关键词）。")
            else -> tr(
                "Topic model loaded in ${sec(lastLoad.optInt("ms"))} ($threads thread${if (threads > 1) "s" else ""}).",
                "话题模型加载用时 ${sec(lastLoad.optInt("ms"))}（$threads 个线程）。")
        }

        val topics = all.optJSONArray("topics") ?: JSONArray()
        val model = (0 until topics.length()).map { topics.getJSONObject(it) }.filter { it.optString("how") == "model" }
        val keywords = topics.length() - model.size
        if (model.isEmpty()) {
            out += tr("Topic picks by the model: none yet.", "模型判断话题：暂无记录。")
        } else {
            val ms = model.map { it.optInt("ms") }.sorted()
            val median = ms[ms.size / 2]
            val one = model.filter { it.optInt("runs") == 1 }.map { it.optInt("ms") }
            out += tr(
                "Topic picks by the model (last ${ms.size}): typical ${sec(median)}, fastest ${sec(ms.first())}, slowest ${sec(ms.last())}.",
                "模型判断话题（最近 ${ms.size} 次）：通常 ${sec(median)}，最快 ${sec(ms.first())}，最慢 ${sec(ms.last())}。")
            if (one.isNotEmpty()) out += tr(
                "One model run: about ${sec(one.average().roundToInt())} (a follow-up question can take two).",
                "模型运行一次：约 ${sec(one.average().roundToInt())}（追问可能要运行两次）。")
            val last = model.last()
            val runs = last.optInt("runs")
            out += tr("Latest: ${sec(last.optInt("ms"))} ($runs run${if (runs > 1) "s" else ""}).",
                "最近一次：${sec(last.optInt("ms"))}（运行 $runs 次）。")
        }
        if (keywords > 0) out += tr("Picked by keywords (model still loading): $keywords.", "用关键词判断（模型尚在加载）：$keywords 次。")
        return out
    }
}
