package com.musicvault.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Format
import com.musicvault.domain.SmartKey
import com.musicvault.domain.Stats
import com.musicvault.domain.StatsZone
import com.musicvault.domain.dayKeyOf
import com.musicvault.domain.systemStatsZone
import com.musicvault.ui.StatsViewModel
import com.musicvault.ui.components.ViewHeader
import com.musicvault.ui.theme.LocalVaultColors
import java.time.LocalDate

/** "2h 5m" style compact duration for chart labels and list rows. */
private fun formatHours(seconds: Double): String {
    if (seconds < 60) return "${seconds.toInt()}s"
    val minutes = Math.round(seconds / 60).toInt()
    if (minutes < 60) return "${minutes}m"
    val h = minutes / 60
    val m = minutes % 60
    return if (m > 0) "${h}h ${m}m" else "${h}h"
}

/** Fill absent calendar days/months with zero buckets so charts show gaps. */
private fun fillBuckets(
    buckets: List<Stats.Bucket>,
    unit: Stats.BucketUnit,
    startMs: Long,
    nowMs: Long,
    zone: StatsZone,
): List<Stats.Bucket> {
    val byKey = buckets.associateBy { it.key }
    val out = ArrayList<Stats.Bucket>()
    val now = zone.parts(nowMs)
    val start = zone.parts(startMs)
    if (unit == Stats.BucketUnit.DAY) {
        val first = LocalDate.of(start.year, start.month, start.day).toEpochDay()
        val last = LocalDate.of(now.year, now.month, now.day).toEpochDay()
        for (d in first..last) {
            val date = LocalDate.ofEpochDay(d)
            val key = dayKeyOf(date.year, date.monthValue, date.dayOfMonth)
            out.add(byKey[key] ?: Stats.Bucket(key, 0, 0.0))
        }
    } else {
        var y = start.year
        var m = start.month
        while (y < now.year || (y == now.year && m <= now.month)) {
            val key = "%04d-%02d".format(y, m)
            out.add(byKey[key] ?: Stats.Bucket(key, 0, 0.0))
            if (m == 12) { y += 1; m = 1 } else m += 1
        }
    }
    return out
}

/** A y-axis scale for listening time: a round step giving at most four gridlines (web timeScale). */
private fun timeScale(maxSeconds: Double): Pair<Double, List<Double>> {
    val steps = listOf(60.0, 120.0, 300.0, 600.0, 900.0, 1800.0, 3600.0, 7200.0, 10800.0, 21600.0, 43200.0, 86400.0, 172800.0, 432000.0)
    val step = steps.firstOrNull { maxSeconds / it <= 4 } ?: (Math.ceil(maxSeconds / 4 / 86400) * 86400)
    val top = maxOf(step, Math.ceil(maxSeconds / step) * step)
    return top to generateSequence(0.0) { it + step }.takeWhile { it <= top + 0.5 }.toList()
}

/** Five slots checked with the dataviz palette validator (same hexes as web --color-series-*). */
private fun deviceColors(dark: Boolean): List<Color> = if (dark) {
    listOf(Color(0xFF9B78F8), Color(0xFFD95926), Color(0xFF199E70), Color(0xFFC98500), Color(0xFF3987E5))
} else {
    listOf(Color(0xFF8B5CF6), Color(0xFFEB6834), Color(0xFF1BAF7A), Color(0xFFEDA100), Color(0xFF2A78D6))
}

private data class DeviceSlice(val key: String, val name: String, val detail: String, val seconds: Double, val color: Color)

private const val TOP = 5

/** Statistics 2.0: charts, heatmap and streaks over the play-event stream. */
@Composable
fun StatsScreen(
    onArtistClick: (String) -> Unit,
    onGroupClick: (SmartKey) -> Unit,
    onHeatmapExpand: () -> Unit,
    statsViewModel: StatsViewModel = hiltViewModel(),
) {
    val colors = LocalVaultColors.current
    val data by statsViewModel.data.collectAsStateWithLifecycle()
    val deviceNames by statsViewModel.deviceNames.collectAsStateWithLifecycle()
    var preset by remember { mutableStateOf(Stats.RangePreset.LAST_30_DAYS) }

    val zone = remember { systemStatsZone() }
    val nowMs = remember(data) { System.currentTimeMillis() }

    val ranged = remember(data, preset, nowMs) {
        val range = Stats.rangeForPreset(preset, nowMs, zone)
        Stats.filterRange(data.events, range.start, range.end)
    }
    val summary = remember(ranged) { Stats.summarize(ranged, data.metaById) }
    val streaks = remember(data, nowMs) { Stats.computeStreaks(data.events, zone, nowMs) }
    val topTracks = remember(ranged) { Stats.rankTracks(ranged, data.metaById, Stats.RankBy.TIME, 10) }
    val top = remember(ranged) {
        Stats.GroupField.entries.associateWith { Stats.rankGroups(ranged, data.metaById, it, Stats.RankBy.TIME, TOP) }
    }
    val hours = remember(ranged) { Stats.hourHistogram(ranged, zone) }

    // Colors follow the device, not its rank: slots go by id over all events.
    val palette = deviceColors(colors.isDark)
    val thisDevice = statsViewModel.thisDeviceId
    val deviceSlices = remember(data, ranged, deviceNames, colors.isDark) {
        val order = data.events.map { it.deviceId }.distinct().sortedWith(nullsLast(naturalOrder()))
        val slot = order.withIndex().associate { (i, id) -> id to i }
        val slices = ArrayList<DeviceSlice>()
        var other = 0.0
        for (d in Stats.rankDevices(ranged, Stats.RankBy.TIME)) {
            val i = slot[d.deviceId] ?: palette.size
            if (i >= palette.size) {
                other += d.listenSeconds
                continue
            }
            val isThis = d.deviceId != null && d.deviceId == thisDevice
            val known = d.deviceId?.let { deviceNames[it] }
            val name = when {
                known != null && isThis -> "$known (this device)"
                known != null -> known
                isThis -> "This device"
                d.deviceId != null -> "Device"
                else -> "Unknown device"
            }
            slices += DeviceSlice(d.deviceId ?: "none", name, d.deviceId?.take(8) ?: "", d.listenSeconds, palette[i])
        }
        if (other > 0) slices += DeviceSlice("other", "Other devices", "", other, colors.subtle)
        slices
    }

    val chartBuckets = remember(ranged, preset, nowMs) {
        val range = Stats.rangeForPreset(preset, nowMs, zone)
        val unit = if (preset == Stats.RangePreset.THIS_YEAR || preset == Stats.RangePreset.ALL_TIME) {
            Stats.BucketUnit.MONTH
        } else {
            Stats.BucketUnit.DAY
        }
        val raw = Stats.bucketize(ranged, zone, unit)
        val startMs = range.start ?: (ranged.firstOrNull()?.playedAt ?: nowMs)
        fillBuckets(raw, unit, startMs, nowMs, zone)
    }

    val heatmapDays = remember(data, nowMs) {
        // 27 weeks covers the heatmap's 26 week columns plus the partial current week.
        val since = nowMs - 27L * 7 * 86_400_000L
        Stats.bucketize(Stats.filterRange(data.events, since), zone, Stats.BucketUnit.DAY)
            .associate { it.key to it.listenSeconds }
    }

    fun bars(field: Stats.GroupField) = top.getValue(field).map {
        RankedItem(it.name, it.secondary.ifEmpty { null }, it.listenSeconds, "${formatHours(it.listenSeconds)} · ${it.plays}×")
    }

    // Top lists, paired as on desktop and web; side by side once the screen is wide enough.
    val topPanels: List<Pair<String, @Composable () -> Unit>> = listOf(
        "Top Albums" to { RankedBars(bars(Stats.GroupField.ALBUM)) },
        "Top Artists" to { RankedBars(bars(Stats.GroupField.ARTIST)) { onArtistClick(it) } },
        "Top Genres" to { RankedBars(bars(Stats.GroupField.GENRE)) { onGroupClick(SmartKey.GENRE) } },
        "Top Years" to { RankedBars(bars(Stats.GroupField.YEAR)) { onGroupClick(SmartKey.YEAR) } },
        "Top Countries" to { RankedBars(bars(Stats.GroupField.COUNTRY)) { onGroupClick(SmartKey.COUNTRY) } },
        "Top Languages" to { RankedBars(bars(Stats.GroupField.LANGUAGE)) { onGroupClick(SmartKey.LANGUAGE) } },
    )

    Column(modifier = Modifier.fillMaxSize()) {
        ViewHeader("Statistics")
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val twoColumns = maxWidth >= 600.dp
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        Stats.RangePreset.entries.forEach { p ->
                            val selected = p == preset
                            Text(
                                p.label,
                                color = if (selected) colors.accentFg else colors.textMuted,
                                fontSize = 13.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) colors.accent else colors.surface2)
                                    .clickable { preset = p }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }

                if (data.loaded && data.events.isEmpty()) {
                    item {
                        Text(
                            "Statistics are built from play events recorded as you listen " +
                                "(on every device when signed in). Play some tracks to see " +
                                "charts, streaks and top lists here.",
                            color = colors.textMuted,
                            fontSize = 14.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(colors.surface)
                                .padding(16.dp),
                        )
                    }
                } else {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatCard(Icons.Rounded.Schedule, "Listening Time", Format.formatDurationLong(summary.listenSeconds.toLong()), Modifier.weight(1f))
                            StatCard(Icons.Rounded.MusicNote, "Plays", summary.plays.toString(), Modifier.weight(1f))
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatCard(Icons.Rounded.LocalFireDepartment, "Tracks", summary.uniqueTracks.toString(), Modifier.weight(1f))
                            StatCard(Icons.Rounded.People, "Artists", summary.uniqueArtists.toString(), Modifier.weight(1f))
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatCard(Icons.Rounded.Album, "Albums", summary.uniqueAlbums.toString(), Modifier.weight(1f))
                            StatCard(Icons.Rounded.CalendarMonth, "Streak", "${streaks.current}d", Modifier.weight(1f))
                        }
                    }

                    item { Panel("Listening Activity") { ActivityChart(chartBuckets) } }
                    item { Panel("Listening Clock") { ListeningClock(hours) } }
                    item {
                        Panel("Last 6 Months") {
                            Text(
                                "${streaks.activeDays} active days · current streak ${streaks.current}d · longest ${streaks.longest}d",
                                color = colors.textMuted,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(bottom = 8.dp),
                            )
                            SixMonthHeatmap(heatmapDays, onHeatmapExpand)
                        }
                    }

                    if (twoColumns) {
                        topPanels.chunked(2).forEach { pair ->
                            item {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    modifier = Modifier.height(IntrinsicSize.Max),
                                ) {
                                    pair.forEach { (title, content) ->
                                        Panel(title, Modifier.weight(1f).fillMaxHeight()) { content() }
                                    }
                                }
                            }
                        }
                    } else {
                        topPanels.forEach { (title, content) -> item { Panel(title) { content() } } }
                    }

                    item { Panel("Play Time by Device") { DeviceDonut(deviceSlices) } }

                    item {
                        Panel("Top Tracks") {
                            if (topTracks.isEmpty()) {
                                Text("Play some tracks to build this list.", color = colors.textMuted, fontSize = 14.sp)
                            } else {
                                TopTracksList(topTracks)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A titled card, so each chart reads as its own section. */
@Composable
private fun Panel(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val colors = LocalVaultColors.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surface)
            .border(1.dp, colors.border, RoundedCornerShape(16.dp))
            .padding(16.dp),
    ) {
        Text(
            title.uppercase(),
            color = colors.textMuted,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.sp,
            modifier = Modifier.padding(bottom = 12.dp),
        )
        content()
    }
}

@Composable
private fun StatCard(icon: ImageVector, label: String, value: String, modifier: Modifier = Modifier) {
    val colors = LocalVaultColors.current
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(colors.surface)
            .padding(14.dp),
    ) {
        Icon(icon, null, tint = colors.accent, modifier = Modifier.size(16.dp))
        Spacer(Modifier.size(8.dp))
        Text(value, color = colors.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(label, color = colors.textMuted, fontSize = 12.sp)
    }
}

/** Vertical bars of listening time with a y-axis in hours/minutes and dashed gridlines. */
@Composable
private fun TimeBars(values: List<Double>, labels: List<String>, height: Dp) {
    val colors = LocalVaultColors.current
    val (top, ticks) = timeScale(values.maxOrNull()?.coerceAtLeast(1.0) ?: 1.0)
    val gridColor = colors.border
    val labelStyle = TextStyle(color = colors.textMuted, fontSize = 9.sp)
    val measurer = rememberTextMeasurer()
    Column {
        Row {
            // Axis labels drawn at their tick heights; 44dp holds "12h 30m".
            Canvas(modifier = Modifier.width(44.dp).height(height)) {
                ticks.forEach { t ->
                    val layout = measurer.measure(if (t == 0.0) "0" else formatHours(t), labelStyle)
                    val y = size.height - (t / top).toFloat() * size.height - layout.size.height / 2f
                    drawText(
                        layout,
                        topLeft = Offset(
                            size.width - layout.size.width - 6.dp.toPx(),
                            y.coerceIn(0f, size.height - layout.size.height),
                        ),
                    )
                }
            }
            Box(modifier = Modifier.weight(1f).height(height)) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    ticks.forEach { t ->
                        val y = size.height - (t / top).toFloat() * size.height
                        drawLine(
                            gridColor,
                            Offset(0f, y),
                            Offset(size.width, y),
                            strokeWidth = 1.dp.toPx(),
                            pathEffect = if (t == 0.0) null else PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
                        )
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.Bottom,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    values.forEach { v ->
                        val fraction = (v / top).toFloat()
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight(if (v > 0) fraction.coerceAtLeast(0.015f) else 0f)
                                .clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                                .background(colors.accent.copy(alpha = 0.85f)),
                        )
                    }
                }
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.padding(start = 44.dp).fillMaxWidth(),
        ) {
            labels.forEach { label ->
                Text(
                    label,
                    color = colors.textMuted,
                    fontSize = 8.sp,
                    maxLines = 1,
                    // A label is wider than its bar: no wrapping (it broke "09-16" after the hyphen), just overflow.
                    softWrap = false,
                    overflow = TextOverflow.Visible,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** Listening time per day or month. */
@Composable
private fun ActivityChart(buckets: List<Stats.Bucket>) {
    val colors = LocalVaultColors.current
    if (buckets.all { it.listenSeconds <= 0 }) {
        Text("No listening in this range.", color = colors.textMuted, fontSize = 14.sp)
        return
    }
    // As desktop/web: every month for month buckets ("YYYY-MM"), else every week or two of days.
    val monthly = buckets.firstOrNull()?.key?.length == 7
    val labelEvery = when {
        monthly -> 1
        buckets.size > 40 -> 14
        buckets.size > 10 -> 7
        else -> 1
    }
    TimeBars(
        values = buckets.map { it.listenSeconds },
        labels = buckets.mapIndexed { i, b -> if (i % labelEvery == 0) b.key.substring(5) else "" },
        height = 140.dp,
    )
}

/** 24 bars: when in the day the listening happens. */
@Composable
private fun ListeningClock(hours: List<Stats.HourSlot>) {
    TimeBars(
        values = hours.map { it.listenSeconds },
        labels = hours.indices.map { if (it % 6 == 0) "${it}h" else "" },
        height = 110.dp,
    )
}

/** Ring of listening time per device with a legend naming each slice and its share. */
@Composable
private fun DeviceDonut(slices: List<DeviceSlice>) {
    val colors = LocalVaultColors.current
    val total = slices.sumOf { it.seconds }
    if (total <= 0) {
        Text("No listening in this range.", color = colors.textMuted, fontSize = 14.sp)
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(120.dp)) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val stroke = 16.dp.toPx()
                val inset = stroke / 2
                // A small gap between slices, unless one slice is the whole ring.
                val gapDeg = if (slices.size > 1) 1.5f else 0f
                var start = -90f
                slices.forEach { s ->
                    val sweep = (s.seconds / total * 360).toFloat()
                    drawArc(
                        color = s.color,
                        startAngle = start + gapDeg / 2,
                        sweepAngle = (sweep - gapDeg).coerceAtLeast(0.5f),
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = Size(size.width - stroke, size.height - stroke),
                        style = Stroke(width = stroke),
                    )
                    start += sweep
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(formatHours(total), color = colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text("total", color = colors.textMuted, fontSize = 10.sp)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
            slices.forEach { s ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(s.color))
                    Spacer(Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(s.name, color = colors.text, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOf(s.detail, "${formatHours(s.seconds)} · ${Math.round(s.seconds / total * 100)}%")
                                .filter { it.isNotEmpty() }
                                .joinToString(" · "),
                            color = colors.textMuted,
                            fontSize = 11.sp,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

private data class RankedItem(val name: String, val secondary: String?, val value: Double, val display: String)

@Composable
private fun RankedBars(items: List<RankedItem>, onSelect: ((String) -> Unit)? = null) {
    val colors = LocalVaultColors.current
    if (items.isEmpty()) {
        Text("Nothing played yet.", color = colors.textMuted, fontSize = 14.sp)
        return
    }
    val max = items.maxOf { it.value }.coerceAtLeast(1.0)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { item ->
            Column(
                modifier = if (onSelect != null) Modifier.clickable { onSelect(item.name) } else Modifier,
            ) {
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (item.secondary.isNullOrEmpty()) item.name else "${item.name} — ${item.secondary}",
                        color = colors.text,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(item.display, color = colors.textMuted, fontSize = 12.sp)
                }
                Spacer(Modifier.size(4.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colors.surface2),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth((item.value / max).toFloat())
                            .height(6.dp)
                            .clip(RoundedCornerShape(50))
                            .background(colors.accent),
                    )
                }
            }
        }
    }
}

@Composable
private fun TopTracksList(tracks: List<Stats.RankedTrack>) {
    val colors = LocalVaultColors.current
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(colors.surface),
    ) {
        tracks.forEachIndexed { index, t ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text(
                    "${index + 1}",
                    color = colors.textMuted,
                    fontSize = 13.sp,
                    modifier = Modifier.width(24.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(t.title, color = colors.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${t.artist} — ${t.album}", color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(
                    "${formatHours(t.listenSeconds)} · ${t.plays}×",
                    color = colors.textMuted,
                    fontSize = 12.sp,
                )
            }
        }
    }
}
