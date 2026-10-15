package com.musicvault.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.musicvault.domain.Format
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

/** Statistics 2.0 — charts, heatmap and streaks over the play-event stream. */
@Composable
fun StatsScreen(
    onArtistClick: (String) -> Unit,
    onGenreClick: () -> Unit,
    onHeatmapExpand: () -> Unit,
    statsViewModel: StatsViewModel = hiltViewModel(),
) {
    val colors = LocalVaultColors.current
    val data by statsViewModel.data.collectAsStateWithLifecycle()
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
    val topArtists = remember(ranged) { Stats.rankGroups(ranged, data.metaById, Stats.GroupField.ARTIST, Stats.RankBy.TIME, 6) }
    val topAlbums = remember(ranged) { Stats.rankGroups(ranged, data.metaById, Stats.GroupField.ALBUM, Stats.RankBy.TIME, 6) }
    val topGenres = remember(ranged) { Stats.rankGroups(ranged, data.metaById, Stats.GroupField.GENRE, Stats.RankBy.TIME, 6) }
    val hours = remember(ranged) { Stats.hourHistogram(ranged, zone) }

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

    Column(modifier = Modifier.fillMaxSize()) {
        ViewHeader("Statistics")
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
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

                item {
                    SectionTitle("Listening Activity")
                    ActivityChart(chartBuckets)
                }

                item {
                    SectionTitle("Last 6 Months")
                    Text(
                        "${streaks.activeDays} active days · current streak ${streaks.current}d · longest ${streaks.longest}d",
                        color = colors.textMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    SixMonthHeatmap(heatmapDays, onHeatmapExpand)
                }

                item {
                    SectionTitle("Listening Clock")
                    ListeningClock(hours)
                }

                item {
                    SectionTitle("Top Artists")
                    RankedBars(topArtists.map { RankedItem(it.name, null, it.listenSeconds, "${formatHours(it.listenSeconds)} · ${it.plays}×") }) {
                        onArtistClick(it)
                    }
                }
                item {
                    SectionTitle("Top Albums")
                    RankedBars(topAlbums.map { RankedItem(it.name, it.secondary, it.listenSeconds, "${formatHours(it.listenSeconds)} · ${it.plays}×") })
                }
                item {
                    SectionTitle("Top Genres")
                    RankedBars(topGenres.map { RankedItem(it.name, null, it.listenSeconds, "${formatHours(it.listenSeconds)} · ${it.plays}×") }) {
                        onGenreClick()
                    }
                }

                item {
                    SectionTitle("Top Tracks")
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

@Composable
private fun SectionTitle(text: String) {
    Text(
        text.uppercase(),
        color = LocalVaultColors.current.textMuted,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 1.sp,
        modifier = Modifier.padding(bottom = 10.dp),
    )
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

/** Vertical bar chart of listening time per bucket. */
@Composable
private fun ActivityChart(buckets: List<Stats.Bucket>) {
    val colors = LocalVaultColors.current
    if (buckets.all { it.listenSeconds <= 0 }) {
        Text("No listening in this range.", color = colors.textMuted, fontSize = 14.sp)
        return
    }
    val max = buckets.maxOf { it.listenSeconds }.coerceAtLeast(1.0)
    // As desktop/web: every month for month buckets ("YYYY-MM"), else every week or two of days.
    val monthly = buckets.firstOrNull()?.key?.length == 7
    val labelEvery = when {
        monthly -> 1
        buckets.size > 40 -> 14
        buckets.size > 10 -> 7
        else -> 1
    }
    Column {
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .height(120.dp),
        ) {
            buckets.forEach { b ->
                val fraction = (b.listenSeconds / max).toFloat()
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .height((120 * fraction).coerceAtLeast(if (b.listenSeconds > 0) 4f else 0f).dp)
                        .clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                        .background(colors.accent.copy(alpha = 0.85f)),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.fillMaxWidth()) {
            buckets.forEachIndexed { i, b ->
                Text(
                    if (i % labelEvery == 0) b.key.substring(5) else "",
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

/** Tiny 24-bar histogram: when in the day the listening happens. */
@Composable
private fun ListeningClock(hours: List<Stats.HourSlot>) {
    val colors = LocalVaultColors.current
    val max = hours.maxOf { it.listenSeconds }.coerceAtLeast(1.0)
    Column {
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp),
        ) {
            hours.forEach { h ->
                val fraction = (h.listenSeconds / max).toFloat()
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height((64 * fraction).coerceAtLeast(if (h.listenSeconds > 0) 4f else 0f).dp)
                        .clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                        .background(colors.accent.copy(alpha = 0.85f)),
                )
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("0h", "6h", "12h", "18h", "23h").forEach {
                Text(it, color = colors.textMuted, fontSize = 9.sp)
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
