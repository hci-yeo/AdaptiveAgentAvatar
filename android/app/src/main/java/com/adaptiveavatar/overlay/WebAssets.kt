package com.adaptiveavatar.overlay

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Serves the app's own page files (assets/web) at https://appassets.androidplatform.net/web/, for her
 * page, her menu and the setup screen. Nothing else can load: every other address is refused (and the
 * app has no internet permission anyway).
 */
object WebAssets {
    const val HOST = "appassets.androidplatform.net"
    const val BASE = "https://$HOST/web/"

    private val headers = mapOf(
        // Cross-origin isolation, so the topic model can use several CPU threads.
        "Cross-Origin-Opener-Policy" to "same-origin",
        "Cross-Origin-Embedder-Policy" to "require-corp",
        "Cross-Origin-Resource-Policy" to "same-origin",
        "Cache-Control" to "no-cache",
    )

    private fun empty(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, headers, ByteArrayInputStream(ByteArray(0)))

    /** The answer to one of a page's requests (null: let the WebView handle it, for blob: and data:). */
    fun serve(c: Context, req: WebResourceRequest): WebResourceResponse? {
        val url = req.url
        if (url.scheme == "blob" || url.scheme == "data") return null
        if (url.host != HOST) return empty(403, "Forbidden")
        val path = url.path?.removePrefix("/") ?: return empty(404, "Not Found")
        if (!path.startsWith("web/") || path.contains("..")) return empty(404, "Not Found")
        return try {
            val mime = mimeOf(path)
            val text = mime.startsWith("text/") || mime == "application/json"
            WebResourceResponse(mime, if (text) "utf-8" else null, 200, "OK", headers, c.assets.open(path))
        } catch (_: IOException) { empty(404, "Not Found") }
    }

    private fun mimeOf(path: String) = when (path.substringAfterLast('.').lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "json" -> "application/json"
        "wasm" -> "application/wasm"
        "webm" -> "video/webm"
        "webp" -> "image/webp"
        "png" -> "image/png"
        "css" -> "text/css"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }
}
