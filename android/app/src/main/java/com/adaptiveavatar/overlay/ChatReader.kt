package com.adaptiveavatar.overlay

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads what the avatar needs from a chat app's screen (its accessibility tree): where the chat box
 * is, what's typed in it, whether the AI is answering, and your questions on screen. Nothing else.
 */
data class ChatInfo(
    val composer: Rect?,          // the chat box, on screen
    val composerText: String?,    // what's typed in it (null: empty / only its hint)
    val generating: Boolean,      // the AI is answering (a Stop button shows; ChatGPT)
    val textLength: Int,          // all text on screen: grows while the answer is written
    val userMessages: List<String>, // your questions on screen, oldest first (empty if not found)
    val title: String?,           // the conversation's name, where the app shows one (Doubao)
    val scrolledUp: Boolean,      // a "back to the bottom" button shows: you're reading older messages
    val composerNode: AccessibilityNodeInfo?, // the chat box itself (looked at again on its own: cheap)
    val standTop: Int?,           // where she stands, when not on the chat box's top edge: on a row of
                                  // shortcut buttons right above it (Doubao), so she doesn't cover them
)

object ChatReader {
    private val STOP = Regex("^(stop|停止|暂停)", RegexOption.IGNORE_CASE)
    private val TO_BOTTOM = Regex("(回到底部|滚动到底部|scroll to bottom|jump to bottom)", RegexOption.IGNORE_CASE)
    private const val MAX_NODES = 4000
    /** The chat bar's label when there's no text box yet (Qianwen: "send a message or hold to talk"). */
    private val HINT = Regex("(发消息|按住说话|输入你的问题|有问题.*问|Message|Ask anything|Type a message)", RegexOption.IGNORE_CASE)
    /** Apps with a rule of their own for your messages (the rest use bubbleText). */
    private val OWN_RULE = setOf(AvatarService.CHATGPT, "com.larus.nova", "com.larus.wolf")

    fun read(root: AccessibilityNodeInfo): ChatInfo {
        var composer: Rect? = null
        var composerNode: AccessibilityNodeInfo? = null
        var composerText: String? = null
        var generating = false
        var textLength = 0
        val user = mutableListOf<String>()
        var composerArea = 0
        var hintBox: Rect? = null
        val rows = mutableListOf<Rect>()    // short, wide, sideways-scrolling rows (shortcut buttons)
        var hintNode: AccessibilityNodeInfo? = null
        var title: String? = null
        var scrolledUp = false
        val screen = Rect().also { root.getBoundsInScreen(it) }
        walk(root) { node, _ ->
            val cls = node.className?.toString() ?: ""
            val desc = node.contentDescription?.toString() ?: ""
            val text = node.text?.toString() ?: ""
            if (node.isEditable || cls.endsWith("EditText")) {
                // The chat box: the biggest visible text box (Doubao also has a hidden, empty one).
                val r = Rect().also { node.getBoundsInScreen(it) }
                val area = r.width() * r.height()
                if (node.isVisibleToUser && area > composerArea) {
                    composerArea = area
                    composer = r
                    composerNode = node
                    val hint = node.isShowingHintText || text == node.hintText?.toString()
                    composerText = if (hint || text.isBlank()) null else text
                }
            } else {
                if (node.isVisibleToUser && TO_BOTTOM.containsMatchIn(desc)) scrolledUp = true
                if (node.isScrollable && node.isVisibleToUser) {
                    val r = Rect().also { node.getBoundsInScreen(it) }
                    if (r.width() >= screen.width() * 0.5 && r.height() <= screen.height() * 0.1) rows += r
                }
                if (hintBox == null && node.isVisibleToUser && HINT.containsMatchIn(text)) {
                    val r = Rect().also { node.getBoundsInScreen(it) }
                    if (r.top > screen.top + screen.height() * 0.6) { hintBox = r; hintNode = node }
                }
                if (node.isVisibleToUser && (STOP.containsMatchIn(desc) || (node.isClickable && STOP.containsMatchIn(text)))) generating = true
                textLength += text.length
                val id = node.viewIdResourceName ?: ""
                if (id.endsWith(":id/title") && node.isVisibleToUser && text.isNotBlank()) title = text
                userMessageOf(node, id, screen)?.let { user += it }
            }
        }
        // No text box (yet): the chat bar's label stands in for it.
        if (composer == null && hintBox != null) { composer = hintBox; composerNode = hintNode }
        // A row of buttons sitting right on top of the chat box: she stands on that row instead.
        val c = composer
        val standTop = if (c == null) null else rows
            .filter { it.bottom <= c.top + 10 && it.bottom >= c.top - screen.height() * 0.08 }
            .minOfOrNull { it.top }
        return ChatInfo(composer, composerText, generating, textLength, user, title, scrolledUp, composerNode, standTop)
    }

    /**
     * Your own message bubbles, which every supported app shows right-aligned:
     *  - Doubao: each message is a content_view; yours don't start at the left edge.
     *  - Claude, Yuanbao and the rest (no ids): bubbleText, the general rule.
     *  - ChatGPT (no ids): yours is a text inside a tappable bubble on the right (its answers start at
     *    the left edge).
     */
    private fun userMessageOf(node: AccessibilityNodeInfo, id: String, screen: Rect): String? {
        if (!node.isVisibleToUser) return null
        val pkg = node.packageName?.toString()
        if (id.endsWith(":id/content_view")) {
            val r = Rect().also { node.getBoundsInScreen(it) }
            if (r.left < screen.left + screen.width() * 0.15) return null
            val sb = StringBuilder()
            walk(node) { n, _ -> n.text?.let { if (it.isNotBlank()) sb.append(it).append(' ') } }
            return sb.toString().trim().takeIf { it.isNotEmpty() }
        }
        if (pkg !in OWN_RULE && node.className?.toString()?.endsWith("TextView") == true) {
            return bubbleText(node, screen)
        }
        if (pkg == AvatarService.CHATGPT && node.className?.toString()?.endsWith("TextView") == true) {
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isEmpty()) return null
            val r = Rect().also { node.getBoundsInScreen(it) }
            if (r.left < screen.left + screen.width() * 0.3) return null
            // Its bubble: a tappable box around it, a few levels up, on the right of the screen.
            var p = node.parent
            for (i in 0 until 6) {
                if (p == null) return null
                if (p.isClickable) {
                    val b = Rect().also { p.getBoundsInScreen(it) }
                    return if (b.left >= screen.left + screen.width() * 0.25 && b.right >= screen.right - screen.width() * 0.1) text else null
                }
                p = p.parent
            }
        }
        return null
    }

    /**
     * The general rule (Claude, Yuanbao, and the other apps without one of their own): your message is
     * a text right of a third of the screen, in a bubble that ends before the message column's right
     * edge and isn't tappable. (A table cell in an answer reaches the column's edge; suggested
     * follow-up chips are tappable.) The column: the first box around it at least 80% of the screen wide.
     */
    private fun bubbleText(node: AccessibilityNodeInfo, screen: Rect): String? {
        val text = node.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return null
        val r = Rect().also { node.getBoundsInScreen(it) }
        if (r.left < screen.left + screen.width() * 0.3) return null
        var bubble: AccessibilityNodeInfo = node
        var p = node.parent
        for (i in 0 until 6) {
            if (p == null) return null
            val b = Rect().also { p.getBoundsInScreen(it) }
            if (b.width() >= screen.width() * 0.8) {
                val bb = Rect().also { bubble.getBoundsInScreen(it) }
                if (bubble.isClickable || bb.right > b.right - screen.width() * 0.01) return null
                if (bb.right < b.right - screen.width() * 0.12) return null   // not against the right: a centred line
                return text
            }
            bubble = p
            p = p.parent
        }
        return null
    }

    /** A tapped button's name: its own, or (ChatGPT, Claude) the label on the icon inside it. */
    fun labelOf(node: AccessibilityNodeInfo?): String? {
        if (node == null) return null
        node.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
        node.text?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
        var found: String? = null
        walk(node) { n, depth ->
            if (found == null && depth <= 6) {
                found = n.contentDescription?.toString()?.takeIf { it.isNotBlank() }
                    ?: n.text?.toString()?.takeIf { it.isNotBlank() }
            }
        }
        return found
    }

    /** Every node, one per line (for working out ChatGPT's layout: adb broadcast, see AvatarService). */
    fun dump(root: AccessibilityNodeInfo): String {
        val sb = StringBuilder()
        val r = Rect()
        walk(root) { node, depth ->
            node.getBoundsInScreen(r)
            sb.append("  ".repeat(depth.coerceAtMost(40)))
                .append(node.className?.toString()?.substringAfterLast('.') ?: "?")
            node.viewIdResourceName?.let { sb.append(" id=").append(it.substringAfter(":id/")) }
            node.contentDescription?.let { sb.append(" desc=\"").append(it.toString().take(80).replace('\n', ' ')).append('"') }
            node.text?.let { sb.append(" text=\"").append(it.toString().take(80).replace('\n', ' ')).append('"') }
            sb.append(" [").append(r.left).append(',').append(r.top).append(',').append(r.right).append(',').append(r.bottom).append(']')
            if (node.isClickable) sb.append(" clickable")
            if (node.isEditable) sb.append(" editable")
            if (node.isScrollable) sb.append(" scrollable")
            if (!node.isVisibleToUser) sb.append(" hidden")
            sb.append('\n')
        }
        return sb.toString()
    }

    private fun walk(root: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo, Int) -> Unit) {
        val stack = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        stack.addLast(root to 0)
        var count = 0
        while (stack.isNotEmpty() && count < MAX_NODES) {
            val (node, depth) = stack.removeLast()
            count++
            visit(node, depth)
            for (i in node.childCount - 1 downTo 0) node.getChild(i)?.let { stack.addLast(it to depth + 1) }
        }
    }
}
