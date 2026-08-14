package com.linqa.app.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

fun formatClock(ts: Long): String =
    SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(ts))

fun formatRelative(ts: Long): String {
    val diffMs = System.currentTimeMillis() - ts
    val min = 60_000L
    val hour = 60 * min
    val day = 24 * hour
    return when {
        diffMs < min -> "now"
        diffMs < hour -> "${diffMs / min}m"
        diffMs < day -> "${diffMs / hour}h"
        else -> "${diffMs / day}d"
    }
}

fun hueFromId(id: String): Int {
    var hash = 0
    for (c in id) hash = (hash * 31 + c.code) % 360
    return hash
}
