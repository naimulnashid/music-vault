package com.musicvault.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.LibraryMusic
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.musicvault.data.cloud.AuthState
import com.musicvault.domain.Albums
import com.musicvault.domain.SmartKey
import com.musicvault.ui.components.LocalTrackActions
import com.musicvault.ui.components.TrackActions
import com.musicvault.ui.player.MiniPlayerBar
import com.musicvault.ui.player.NowPlayingScreen
import com.musicvault.ui.player.PanelKey
import com.musicvault.ui.player.PanelSheets
import com.musicvault.ui.player.PlayerViewModel
import com.musicvault.ui.screens.AlbumScreen
import com.musicvault.ui.screens.ArtistScreen
import com.musicvault.ui.screens.CollectionsScreen
import com.musicvault.ui.screens.GroupScreen
import com.musicvault.ui.screens.SettingsScreen
import com.musicvault.ui.screens.DownloadsScreen
import com.musicvault.ui.screens.GroupedBrowseScreen
import com.musicvault.ui.screens.LibraryScreen
import com.musicvault.ui.screens.PlaylistScreen
import com.musicvault.ui.screens.SearchScreen
import com.musicvault.ui.screens.SmartPlaylistScreen
import com.musicvault.ui.screens.HeatmapScreen
import com.musicvault.ui.screens.StatsScreen
import com.musicvault.ui.theme.LocalVaultColors
import java.net.URLDecoder
import java.net.URLEncoder

object Routes {
    const val TRACKS = "tracks"
    const val COLLECTIONS = "collections"
    const val UPLOAD = "upload"
    const val STATS = "stats"
    const val HEATMAP = "heatmap"
    const val DOWNLOADS = "downloads"
    const val SEARCH = "search"
    const val SETTINGS = "settings"

    fun smart(key: SmartKey) = "smart/${key.name}"
    fun group(key: SmartKey, name: String) = "group/${key.name}/${URLEncoder.encode(name, "UTF-8")}"
    fun playlist(id: String) = "playlist/${URLEncoder.encode(id, "UTF-8")}"
    fun album(key: String) = "album/${URLEncoder.encode(key, "UTF-8")}"
    fun artist(name: String) = "artist/${URLEncoder.encode(name, "UTF-8")}"

    fun decode(value: String): String = URLDecoder.decode(value, "UTF-8")
}

private data class Tab(val route: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val TABS = listOf(
    Tab(Routes.TRACKS, "Library", Icons.Outlined.LibraryMusic, Icons.Rounded.LibraryMusic),
    Tab(Routes.COLLECTIONS, "Collections", Icons.Outlined.GridView, Icons.Rounded.GridView),
    Tab(Routes.DOWNLOADS, "Downloads", Icons.Outlined.Download, Icons.Rounded.Download),
    Tab(Routes.STATS, "Stats", Icons.Outlined.BarChart, Icons.Rounded.BarChart),
)

/**
 * App shell: top bar (search + account), the current tab or page, the
 * floating mini player and the bottom navigation; the full player rises
 * over everything.
 */
@Composable
fun AppRoot() {
    val colors = LocalVaultColors.current
    val navController = rememberNavController()

    val libraryViewModel: LibraryViewModel = hiltViewModel()
    val playerViewModel: PlayerViewModel = hiltViewModel()
    val mainViewModel: MainViewModel = hiltViewModel()
    val authViewModel: AuthViewModel = hiltViewModel()
    val vaultViewModel: com.musicvault.ui.vault.VaultViewModel = hiltViewModel()
    val allTracks by libraryViewModel.tracks.collectAsStateWithLifecycle()
    val playlists by libraryViewModel.playlists.collectAsStateWithLifecycle()
    val pinnedIds by libraryViewModel.pinnedIds.collectAsStateWithLifecycle()
    val downloadProgress by libraryViewModel.downloadProgress.collectAsStateWithLifecycle()
    val editorIds by vaultViewModel.editorIds.collectAsStateWithLifecycle()
    val signedIn by vaultViewModel.signedIn.collectAsStateWithLifecycle()
    val authState by authViewModel.authState.collectAsStateWithLifecycle()
    val playback by playerViewModel.uiState.collectAsStateWithLifecycle()
    var deleteIds by remember { mutableStateOf<List<String>?>(null) }
    var settingsOpen by remember { mutableStateOf(false) }

    // Files shared to MusicVault from another app open the upload screen.
    LaunchedEffect(Unit) {
        com.musicvault.ui.vault.IncomingShares.uris.collect { uris ->
            vaultViewModel.addUris(uris)
            navController.navigate(Routes.UPLOAD) { launchSingleTop = true }
        }
    }

    var activePanel by rememberSaveable { mutableStateOf<PanelKey?>(null) }
    var nowPlayingExpanded by rememberSaveable { mutableStateOf(false) }

    // Demo build only: the screenshot script picks the screen.
    if (com.musicvault.BuildConfig.DEMO) {
        LaunchedEffect(Unit) {
            com.musicvault.demo.DemoShots.screens.collect { screen ->
                nowPlayingExpanded = screen == "now-playing"
                val route = when (screen) {
                    "album" -> libraryViewModel.tracks.value.firstOrNull { it.album == "Saltwater Hours" }
                        ?.let { Routes.album(Albums.albumKey(it)) }
                    "statistics" -> Routes.STATS
                    "downloads" -> Routes.DOWNLOADS
                    else -> Routes.TRACKS
                } ?: Routes.TRACKS
                // The album shot shows it under Collections, where albums are browsed from.
                val path = if (screen == "album" && route != Routes.TRACKS) listOf(Routes.COLLECTIONS, route) else listOf(route)
                navController.navigate(path.first()) {
                    popUpTo(navController.graph.findStartDestination().id)
                    launchSingleTop = true
                }
                path.drop(1).forEach { navController.navigate(it) }
            }
        }
    }

    val context = LocalContext.current
    LaunchedEffect(Unit) {
        playerViewModel.playbackErrors.collect { message ->
            android.widget.Toast.makeText(context, message, android.widget.Toast.LENGTH_LONG).show()
        }
    }

    // Download progress notifications need POST_NOTIFICATIONS on Android 13+.
    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val isTopLevel = currentRoute == null || TABS.any { it.route == currentRoute }
    // From the back stack, not the current page: an album belongs to whichever tab it was opened in.
    val selectedTab = remember(backStackEntry) {
        selectedTabRoute(TABS.map { it.route }, Routes.TRACKS) { route ->
            runCatching { navController.getBackStackEntry(route) }.isSuccess
        }
    }

    val openTab: (String) -> Unit = { route ->
        if (route == selectedTab) {
            // Reselecting the active tab goes back to its root.
            navController.popBackStack(route, inclusive = false)
        } else {
            navController.navigate(route) {
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }
    val open: (String) -> Unit = { route ->
        nowPlayingExpanded = false
        navController.navigate(route) { launchSingleTop = true }
    }

    val trackActions = TrackActions(
        playNext = { playerViewModel.playNext(listOf(it)) },
        addToQueue = { playerViewModel.addToQueue(listOf(it)) },
        toggleFavorite = libraryViewModel::toggleFavorite,
        playlists = playlists.filter { !it.isSmart },
        addToPlaylist = libraryViewModel::addTrackToPlaylist,
        download = libraryViewModel::downloadTrack,
        removeDownload = libraryViewModel::removeDownload,
        cancelDownload = libraryViewModel::cancelDownload,
        openAlbum = { open(Routes.album(Albums.albumKey(it))) },
        openArtist = { open(Routes.artist(it)) },
        edit = if (signedIn) vaultViewModel::openEditor else null,
        deleteFromVault = if (signedIn) { ids -> deleteIds = ids } else null,
        pinnedIds = pinnedIds,
        downloads = downloadProgress,
    )

    deleteIds?.let { ids ->
        com.musicvault.ui.vault.ConfirmDeleteFromVault(
            tracks = allTracks.filter { it.id in ids },
            onConfirm = {
                deleteIds = null
                vaultViewModel.deleteFromVault(allTracks.filter { it.id in ids }) { err ->
                    if (err != null) android.widget.Toast.makeText(context, "Couldn't delete: $err", android.widget.Toast.LENGTH_LONG).show()
                }
            },
            onDismiss = { deleteIds = null },
        )
    }

    val pad = PaddingValues(bottom = 16.dp)

    val fieldOptions = remember(allTracks) { com.musicvault.ui.components.FieldOptions.of(allTracks) }

    CompositionLocalProvider(
        LocalTrackActions provides trackActions,
        com.musicvault.ui.components.LocalFieldOptions provides fieldOptions,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.bg),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                if (currentRoute != Routes.SEARCH) {
                    TopBar(
                        isTopLevel = isTopLevel,
                        email = (authState as? AuthState.SignedIn)?.email,
                        signedIn = authState is AuthState.SignedIn,
                        title = when (currentRoute) {
                            Routes.UPLOAD -> "Upload to your vault"
                            Routes.SETTINGS -> "Settings"
                            else -> null
                        },
                        onBack = { navController.popBackStack() },
                        onSearch = { open(Routes.SEARCH) },
                        onAccount = { settingsOpen = true },
                        accountMenu = {
                            AccountMenu(
                                expanded = settingsOpen,
                                mainViewModel = mainViewModel,
                                onUpload = if (signedIn) ({ open(Routes.UPLOAD) }) else null,
                                onSettings = { open(Routes.SETTINGS) },
                                onDismiss = { settingsOpen = false },
                            )
                        },
                    )
                } else {
                    Spacer(Modifier.statusBarsPadding())
                }

                Box(modifier = Modifier.weight(1f)) {
                    NavHost(navController = navController, startDestination = Routes.TRACKS) {
                        composable(Routes.TRACKS) {
                            LibraryScreen(
                                libraryViewModel,
                                playerViewModel,
                                onArtistClick = { artist -> open(Routes.artist(artist)) },
                                vaultViewModel = vaultViewModel,
                                onUpload = { open(Routes.UPLOAD) },
                                onDeleteFromVault = { ids -> deleteIds = ids },
                                contentPadding = pad,
                            )
                        }
                        composable(Routes.COLLECTIONS) {
                            CollectionsScreen(
                                libraryViewModel = libraryViewModel,
                                onPlaylistClick = { open(Routes.playlist(it)) },
                                onSmartClick = { open(Routes.smart(it)) },
                                onAlbumClick = { open(Routes.album(it)) },
                                contentPadding = pad,
                            )
                        }
                        composable(Routes.SEARCH) {
                            SearchScreen(
                                libraryViewModel = libraryViewModel,
                                playerViewModel = playerViewModel,
                                onBack = { navController.popBackStack() },
                                onArtistClick = { open(Routes.artist(it)) },
                                onAlbumClick = { open(Routes.album(it)) },
                                contentPadding = pad,
                            )
                        }
                        composable(Routes.SETTINGS) {
                            SettingsScreen(contentPadding = pad)
                        }
                        composable(Routes.UPLOAD) {
                            com.musicvault.ui.vault.UploadScreen(vaultViewModel)
                        }
                        composable(Routes.DOWNLOADS) {
                            DownloadsScreen(viewModel = hiltViewModel(), playerViewModel = playerViewModel)
                        }
                        composable(Routes.STATS) {
                            StatsScreen(
                                onArtistClick = { open(Routes.artist(it)) },
                                onGroupClick = { open(Routes.smart(it)) },
                                onHeatmapExpand = { open(Routes.HEATMAP) },
                            )
                        }
                        composable(Routes.HEATMAP) {
                            HeatmapScreen()
                        }
                        composable("album/{key}") { entry ->
                            val key = Routes.decode(entry.arguments?.getString("key") ?: "")
                            AlbumScreen(
                                albumKey = key,
                                libraryViewModel = libraryViewModel,
                                playerViewModel = playerViewModel,
                                onBack = { navController.popBackStack() },
                                onArtistClick = { open(Routes.artist(it)) },
                            )
                        }
                        composable("artist/{name}") { entry ->
                            val name = Routes.decode(entry.arguments?.getString("name") ?: "")
                            ArtistScreen(
                                artistName = name,
                                libraryViewModel = libraryViewModel,
                                playerViewModel = playerViewModel,
                                onBack = { navController.popBackStack() },
                                onAlbumClick = { open(Routes.album(it)) },
                            )
                        }
                        composable("playlist/{id}") { entry ->
                            val id = Routes.decode(entry.arguments?.getString("id") ?: "")
                            PlaylistScreen(
                                playlistId = id,
                                libraryViewModel = libraryViewModel,
                                playerViewModel = playerViewModel,
                                onDeleted = { navController.popBackStack() },
                                onArtistClick = { open(Routes.artist(it)) },
                            )
                        }
                        composable("group/{key}/{name}") { entry ->
                            val key = entry.arguments?.getString("key")
                                ?.let { name -> SmartKey.entries.firstOrNull { it.name == name } }
                                ?: SmartKey.GENRE
                            GroupScreen(
                                smartKey = key,
                                name = Routes.decode(entry.arguments?.getString("name").orEmpty()),
                                libraryViewModel = libraryViewModel,
                                playerViewModel = playerViewModel,
                                onArtistClick = { open(Routes.artist(it)) },
                                contentPadding = pad,
                            )
                        }
                        composable("smart/{key}") { entry ->
                            val key = entry.arguments?.getString("key")
                                ?.let { name -> SmartKey.entries.firstOrNull { it.name == name } }
                                ?: SmartKey.RECENTLY_ADDED
                            val def = com.musicvault.domain.SmartPlaylists.def(key)
                            if (def.kind == com.musicvault.domain.SmartKind.GROUP) {
                                GroupedBrowseScreen(
                                    smartKey = key,
                                    libraryViewModel = libraryViewModel,
                                    onGroupClick = { name -> open(Routes.group(key, name)) },
                                    onArtistClick = { artist -> open(Routes.artist(artist)) },
                                    contentPadding = pad,
                                )
                            } else {
                                SmartPlaylistScreen(key, libraryViewModel, playerViewModel) { artist ->
                                    open(Routes.artist(artist))
                                }
                            }
                        }
                    }
                }

                AnimatedVisibility(
                    visible = playback.currentTrack != null,
                    enter = slideInVertically { it } + fadeIn(),
                    exit = slideOutVertically { it } + fadeOut(),
                ) {
                    MiniPlayerBar(
                        playerViewModel = playerViewModel,
                        onExpand = { nowPlayingExpanded = true },
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }

                NavigationBar(
                    containerColor = colors.bg,
                    tonalElevation = 0.dp,
                ) {
                    TABS.forEach { tab ->
                        val selected = tab.route == selectedTab
                        NavigationBarItem(
                            selected = selected,
                            onClick = { openTab(tab.route) },
                            icon = { Icon(if (selected) tab.selectedIcon else tab.icon, tab.label) },
                            label = { Text(tab.label, fontSize = 12.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = colors.text,
                                selectedTextColor = colors.text,
                                indicatorColor = colors.accentSoft,
                                unselectedIconColor = colors.textMuted,
                                unselectedTextColor = colors.textMuted,
                            ),
                        )
                    }
                }
            }

            AnimatedVisibility(
                visible = nowPlayingExpanded && playback.currentTrack != null,
                enter = slideInVertically(tween(420, easing = androidx.compose.animation.core.FastOutSlowInEasing)) { it } + fadeIn(tween(200)),
                exit = slideOutVertically(tween(320)) { it } + fadeOut(tween(250)),
            ) {
                NowPlayingScreen(
                    playerViewModel = playerViewModel,
                    libraryViewModel = libraryViewModel,
                    onCollapse = { nowPlayingExpanded = false },
                    onOpenPanel = { activePanel = it },
                )
            }
        }

        PanelSheets(
            activePanel = activePanel,
            onDismiss = { activePanel = null },
            playerViewModel = playerViewModel,
            libraryViewModel = libraryViewModel,
        )

        // Drawn last so it sits above everything else.
        editorIds?.let { ids ->
            com.musicvault.ui.vault.TrackEditor(allTracks.filter { it.id in ids }, vaultViewModel)
        }
    }
}

@Composable
private fun TopBar(
    isTopLevel: Boolean,
    email: String?,
    signedIn: Boolean,
    /** Page title beside the back arrow (pages that have no header of their own). */
    title: String?,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    /** Drops down from the avatar; composed inside its box so it anchors there. */
    accountMenu: @Composable () -> Unit,
) {
    val colors = LocalVaultColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(56.dp)
            .padding(start = 4.dp, end = 12.dp),
    ) {
        if (isTopLevel) {
            Spacer(Modifier.width(12.dp))
            // The launcher icon's own layers: the foreground's visible part is its middle
            // 72 of 108dp, so it is drawn at 108/72 of the tile and clipped to it.
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(7.dp)),
            ) {
                androidx.compose.foundation.Image(
                    androidx.compose.ui.res.painterResource(com.musicvault.R.drawable.ic_launcher_background),
                    null,
                    modifier = Modifier.requiredSize(45.dp),
                )
                androidx.compose.foundation.Image(
                    androidx.compose.ui.res.painterResource(com.musicvault.R.drawable.ic_launcher_foreground),
                    null,
                    modifier = Modifier.requiredSize(45.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
            Text("Music Vault", color = colors.text, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
        } else {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = colors.text)
            }
            if (title != null) {
                Text(
                    title,
                    color = colors.text,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 4.dp).weight(1f),
                )
            }
        }
        if (isTopLevel || title == null) Spacer(Modifier.weight(1f))
        IconButton(onClick = onSearch) {
            Icon(Icons.Rounded.Search, "Search", tint = colors.text, modifier = Modifier.size(24.dp))
        }
        Box(
            modifier = Modifier
                .clip(CircleShape)
                .clickable(onClick = onAccount)
                .padding(4.dp),
        ) {
            Avatar(if (signedIn) email ?: "?" else null, size = 32)
            accountMenu()
        }
    }
}
