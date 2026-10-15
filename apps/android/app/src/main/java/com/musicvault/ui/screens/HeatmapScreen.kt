package com.musicvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.OpenInFull
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Stats
import com.musicvault.domain.dayKeyOf
import com.musicvault.domain.systemStatsZone
import com.musicvault.ui.StatsViewModel
import com.musicvault.ui.components.ViewHeader
import com.musicvault.ui.theme.LocalVaultColors
import java.time.LocalDate

/*
 * Calendar heatmap of listening time — port of desktop/web Heatmap.tsx: the
 * last six months on Statistics, and every six-month block on the expanded
 * screen. Both draw blocks of WEEKS Saturday-first week columns, so the
 * expanded screen grows downward and its cells keep the overview's size.
 */

private const val WEEKS = 26
private val DAY_LABELS = listOf("Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private class HeatCell(val key: String, val seconds: Double, val hidden: Boolean, val row: Int)

private class HeatBlock(
    /** Column-major: cells[column * 7 + row]. */
    val cells: List<HeatCell>,
    val months: List<Pair<String, Int>>,
    val first: Long,
    val last: Long,
    val peak: Double,
    val total: Double,
    val activeDays: Int,
)

private fun keyOf(epochDay: Long): String {
    val d = LocalDate.ofEpochDay(epochDay)
    return dayKeyOf(d.year, d.monthValue, d.dayOfMonth)
}

/** DayOfWeek runs Mon=1..Sun=7, so +1 mod 7 puts Saturday on row 0. */
private fun rowOf(epochDay: Long): Int = (LocalDate.ofEpochDay(epochDay).dayOfWeek.value + 1) % 7
private fun weekStartOf(epochDay: Long): Long = epochDay - rowOf(epochDay)

private fun todayEpochDay(): Long {
    val p = systemStatsZone().parts(System.currentTimeMillis())
    return LocalDate.of(p.year, p.month, p.day).toEpochDay()
}

private fun buildBlock(byDay: Map<String, Double>, firstWeek: Long, today: Long, from: Long?): HeatBlock {
    val cells = ArrayList<HeatCell>(WEEKS * 7)
    val months = ArrayList<Pair<String, Int>>()
    var peak = 0.0
    var total = 0.0
    var activeDays = 0
    var lastMonth = -1
    for (column in 0 until WEEKS) {
        val weekStart = firstWeek + column * 7L
        // Label a column by the first day it draws, so a block clipped to 1 January opens on "Jan".
        val month = LocalDate.ofEpochDay(if (from != null && weekStart < from) from else weekStart).monthValue - 1
        if (month != lastMonth) {
            months += MONTHS[month] to column
            lastMonth = month
        }
        for (row in 0 until 7) {
            val day = weekStart + row
            val hidden = day > today || (from != null && day < from)
            val key = keyOf(day)
            val seconds = if (hidden) 0.0 else byDay[key] ?: 0.0
            if (seconds > 0) {
                peak = maxOf(peak, seconds)
                total += seconds
                activeDays++
            }
            cells += HeatCell(key, seconds, hidden, row)
        }
    }
    // A block opening on a month's last week labels it and the next month side by side; drop the stub.
    if (months.size > 1 && months[1].second - months[0].second < 3) months.removeAt(0)
    return HeatBlock(
        cells, months,
        first = if (from != null && firstWeek < from) from else firstWeek,
        last = minOf(today, firstWeek + WEEKS * 7L - 1),
        peak = peak, total = total, activeDays = activeDays,
    )
}

private fun recentBlock(byDay: Map<String, Double>, today: Long): HeatBlock =
    buildBlock(byDay, weekStartOf(today) - (WEEKS - 1) * 7L, today, null)

/** Every block from 1 January of the first year with listening to today, oldest first. */
private fun allBlocks(byDay: Map<String, Double>, today: Long): List<HeatBlock> {
    val firstKey = byDay.keys.minOrNull() ?: keyOf(today)
    val from = LocalDate.of(firstKey.substring(0, 4).toInt(), 1, 1).toEpochDay()
    val blocks = ArrayList<HeatBlock>()
    var week = weekStartOf(from)
    while (week <= today) {
        blocks += buildBlock(byDay, week, today, from)
        week += WEEKS * 7L
    }
    return blocks
}

/** Uneven steps: a few long days would otherwise wash every normal day into level 1. */
private fun level(seconds: Double, max: Double): Int {
    if (seconds <= 0 || max <= 0) return 0
    val r = seconds / max
    return when {
        r > 0.7 -> 4
        r > 0.35 -> 3
        r > 0.15 -> 2
        else -> 1
    }
}

private val LEVEL_MIX = listOf(0f, 0.3f, 0.5f, 0.75f, 1f)

@Composable
private fun levelColor(l: Int): Color {
    val colors = LocalVaultColors.current
    return lerp(colors.surface2, colors.accent, LEVEL_MIX[l])
}

private fun formatShort(seconds: Double): String {
    if (seconds < 60) return "${seconds.toInt()}s"
    val minutes = Math.round(seconds / 60).toInt()
    if (minutes < 60) return "${minutes}m"
    val h = minutes / 60
    val m = minutes % 60
    return if (m > 0) "${h}h ${m}m" else "${h}h"
}

private fun activeSummary(seconds: Double, days: Int, span: String) =
    "${formatShort(seconds)} across $days active ${if (days == 1) "day" else "days"} $span"

/**
 * Squares are too small to tap on a phone, so the plot is view-only; the
 * legend line carries the totals.
 */
@Composable
private fun HeatmapPlot(block: HeatBlock, max: Double) {
    val colors = LocalVaultColors.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val labelWidth = 26.dp
        val gap = 2.dp
        val cell = (maxWidth - labelWidth - gap * (WEEKS - 1)) / WEEKS
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            // Fixed line height and its own clipped row, so the labels can't spill onto the squares.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(16.dp)
                    .clipToBounds(),
            ) {
                block.months.forEach { (label, column) ->
                    Text(
                        label,
                        color = colors.textMuted,
                        style = TextStyle(
                            fontSize = 10.sp,
                            lineHeight = 12.sp,
                            platformStyle = PlatformTextStyle(includeFontPadding = false),
                        ),
                        maxLines = 1,
                        softWrap = false,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .offset(x = labelWidth + (cell + gap) * column),
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
            for (row in 0 until 7) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(gap),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (row % 2 == 0) DAY_LABELS[row] else "",
                        color = colors.textMuted,
                        style = TextStyle(
                            fontSize = 9.sp,
                            lineHeight = 9.sp,
                            platformStyle = PlatformTextStyle(includeFontPadding = false),
                        ),
                        modifier = Modifier.width(labelWidth - gap),
                    )
                    for (column in 0 until WEEKS) {
                        val c = block.cells[column * 7 + row]
                        if (c.hidden) {
                            Spacer(Modifier.size(cell))
                        } else {
                            Box(
                                Modifier
                                    .size(cell)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(levelColor(level(c.seconds, max))),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeatmapLegend(summary: String, onExpand: (() -> Unit)? = null) {
    val colors = LocalVaultColors.current
    Column(Modifier.padding(top = 10.dp)) {
        Text(summary, color = colors.textMuted, fontSize = 12.sp)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) {
            if (onExpand != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(colors.surface2)
                        .clickable(onClick = onExpand)
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                ) {
                    Icon(Icons.Rounded.OpenInFull, null, tint = colors.text, modifier = Modifier.size(14.dp))
                    Text("Expand", color = colors.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Spacer(Modifier.weight(1f))
            Text("Less", color = colors.textMuted, fontSize = 11.sp)
            LEVEL_MIX.indices.forEach { l ->
                Box(
                    Modifier
                        .padding(horizontal = 2.dp)
                        .size(11.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(levelColor(l)),
                )
            }
            Text("More", color = colors.textMuted, fontSize = 11.sp)
        }
    }
}

/** The Statistics card: the last six months. [secondsByDay] is keyed by dayKeyOf in the system zone. */
@Composable
fun SixMonthHeatmap(secondsByDay: Map<String, Double>, onExpand: () -> Unit) {
    val block = remember(secondsByDay) { recentBlock(secondsByDay, todayEpochDay()) }
    HeatmapPlot(block, block.peak)
    HeatmapLegend(activeSummary(block.total, block.activeDays, "in the last 6 months"), onExpand)
}

private fun blockLabel(block: HeatBlock): String {
    val a = LocalDate.ofEpochDay(block.first)
    val b = LocalDate.ofEpochDay(block.last)
    return if (a.year == b.year) {
        "${MONTHS[a.monthValue - 1]} – ${MONTHS[b.monthValue - 1]} ${b.year}"
    } else {
        "${MONTHS[a.monthValue - 1]} ${a.year} – ${MONTHS[b.monthValue - 1]} ${b.year}"
    }
}

/** All listening history, six months per block, on one shared colour scale. */
@Composable
fun HeatmapScreen(statsViewModel: StatsViewModel = hiltViewModel()) {
    val colors = LocalVaultColors.current
    val data by statsViewModel.data.collectAsStateWithLifecycle()
    val blocks = remember(data) {
        val byDay = Stats.bucketize(data.events, systemStatsZone(), Stats.BucketUnit.DAY).associate { it.key to it.listenSeconds }
        allBlocks(byDay, todayEpochDay())
    }
    val max = blocks.maxOfOrNull { it.peak } ?: 0.0

    Column(Modifier.fillMaxSize()) {
        ViewHeader("Listening History")
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(blocks, key = { it.first }) { block ->
                Column {
                    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
                        Text(blockLabel(block), color = colors.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text(formatShort(block.total), color = colors.textMuted, fontSize = 12.sp)
                    }
                    HeatmapPlot(block, max)
                }
            }
            item {
                HeatmapLegend(
                    activeSummary(
                        blocks.sumOf { it.total },
                        blocks.sumOf { it.activeDays },
                        blocks.firstOrNull()?.let { "since ${keyOf(it.first)}" } ?: "",
                    ),
                )
            }
        }
    }
}
