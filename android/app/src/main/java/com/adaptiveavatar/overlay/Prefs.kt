package com.adaptiveavatar.overlay

import android.content.Context
import android.content.SharedPreferences

/** The few settings: on/off, her size, and where she stands. */
object Prefs {
    const val ENABLED = "enabled"        // show her in ChatGPT
    const val ALWAYS = "always"          // stay on screen after leaving the chat app (where she was)
    const val SIZE = "size"              // 0.6 .. 1.4 (1 = default)
    const val WHERE = "where"            // "docked" (above the chat box) or "free" (where you put her)
    const val FREE_X = "freeX"           // her window's spot when free, in pixels
    const val FREE_Y = "freeY"

    fun of(c: Context): SharedPreferences = c.getSharedPreferences("avatar", Context.MODE_PRIVATE)
}
