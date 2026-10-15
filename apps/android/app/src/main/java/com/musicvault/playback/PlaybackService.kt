package com.musicvault.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.musicvault.MainActivity
import com.musicvault.R
import com.musicvault.data.repo.LibraryRepository
import com.musicvault.domain.Albums
import com.musicvault.domain.model.Track
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.File
import javax.inject.Inject

private const val ROOT_ID = "root"
private const val NODE_TRACKS = "node_tracks"
private const val NODE_ALBUMS = "node_albums"
private const val NODE_PLAYLISTS = "node_playlists"
private const val NODE_FAVORITES = "node_favorites"
private const val SEP = "\u001F"
private const val MAX_CHILDREN = 500
private const val ACTION_CLEAR_QUEUE = "com.musicvault.CLEAR_QUEUE"
private val CLEAR_QUEUE_COMMAND = SessionCommand(ACTION_CLEAR_QUEUE, Bundle.EMPTY)

/**
 * Media3 library service: persistent MediaStyle notification, lock screen and
 * Bluetooth/headset controls, plus a browse tree for Android Auto.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@AndroidEntryPoint
class PlaybackService : MediaLibraryService() {

    @Inject lateinit var playbackController: PlaybackController
    @Inject lateinit var libraryRepository: LibraryRepository

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var session: MediaLibrarySession? = null

    override fun onCreate() {
        super.onCreate()
        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val librarySession = MediaLibrarySession.Builder(this, playbackController.player, LibraryCallback())
            .setSessionActivity(sessionActivity)
            // Extra button in the notification / lock-screen controls.
            .setCustomLayout(
                ImmutableList.of(
                    CommandButton.Builder()
                        .setDisplayName("Clear queue")
                        .setIconResId(R.drawable.ic_clear_queue)
                        .setSessionCommand(CLEAR_QUEUE_COMMAND)
                        .build()
                )
            )
            .build()
        session = librarySession
        // The app's own UI drives the player directly (no MediaController), so
        // nothing would ever ask onGetSession for it. Register it now: that is
        // what makes Media3 post the media notification, run playback as a
        // foreground service (keeps playing on the lock screen, keeps network
        // for the next song) and show lock-screen / Bluetooth controls.
        addSession(librarySession)
        Timber.i("PlaybackService created")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Keep playing in the background when the task is swiped away; stop if paused.
        val player = playbackController.player
        if (!player.playWhenReady || player.currentTrack == null) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        session?.release()
        session = null
        serviceScope.cancel()
        Timber.i("PlaybackService destroyed")
        super.onDestroy()
    }

    private inner class LibraryCallback : MediaLibrarySession.Callback {

        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                .add(CLEAR_QUEUE_COMMAND)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction == ACTION_CLEAR_QUEUE) {
                playbackController.clearQueue()
                return com.google.common.util.concurrent.Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            return super.onCustomCommand(session, controller, customCommand, args)
        }

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val root = folderItem(ROOT_ID, "Music Vault")
            return com.google.common.util.concurrent.Futures.immediateFuture(LibraryResult.ofItem(root, params))
        }

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val future = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
            serviceScope.launch {
                try {
                    future.set(LibraryResult.ofItemList(childrenOf(parentId), params))
                } catch (e: Exception) {
                    Timber.e(e, "onGetChildren failed for %s", parentId)
                    future.set(LibraryResult.ofError(SessionError.ERROR_UNKNOWN))
                }
            }
            return future
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val future = SettableFuture.create<LibraryResult<MediaItem>>()
            serviceScope.launch {
                try {
                    val trackId = mediaId.substringAfterLast(SEP)
                    val track = libraryRepository.getTrack(trackId)
                    if (track != null) {
                        future.set(LibraryResult.ofItem(trackItem(track, mediaId), null))
                    } else {
                        future.set(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
                    }
                } catch (e: Exception) {
                    Timber.e(e, "onGetItem failed for %s", mediaId)
                    future.set(LibraryResult.ofError(SessionError.ERROR_UNKNOWN))
                }
            }
            return future
        }

        /**
         * A browse leaf carries its context ("tracks", "album|key", …) so tapping a
         * song queues its whole surrounding list starting at that song — the same
         * behavior as tapping a row in the app/web track lists.
         */
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val future = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            serviceScope.launch {
                try {
                    val single = mediaItems.singleOrNull()
                    val encodedId = single?.mediaId
                    if (encodedId != null && encodedId.contains(SEP)) {
                        val context = encodedId.substringBeforeLast(SEP)
                        val trackId = encodedId.substringAfterLast(SEP)
                        val tracks = tracksForContext(context)
                        val index = tracks.indexOfFirst { it.id == trackId }.coerceAtLeast(0)
                        future.set(
                            MediaSession.MediaItemsWithStartPosition(
                                tracks.map { plainTrackItem(it) },
                                index,
                                0L,
                            )
                        )
                    } else {
                        future.set(MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
                    }
                } catch (e: Exception) {
                    Timber.e(e, "onSetMediaItems failed")
                    future.set(MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
                }
            }
            return future
        }

        private suspend fun childrenOf(parentId: String): List<MediaItem> = when {
            parentId == ROOT_ID -> listOf(
                folderItem(NODE_TRACKS, "All Tracks"),
                folderItem(NODE_ALBUMS, "Albums"),
                folderItem(NODE_PLAYLISTS, "Playlists"),
                folderItem(NODE_FAVORITES, "Favorites"),
            )
            parentId == NODE_TRACKS ->
                sortedTracks().take(MAX_CHILDREN).map { trackItem(it, "$NODE_TRACKS$SEP${it.id}") }
            parentId == NODE_FAVORITES ->
                sortedTracks().filter { it.favorite }.take(MAX_CHILDREN)
                    .map { trackItem(it, "$NODE_FAVORITES$SEP${it.id}") }
            parentId == NODE_ALBUMS ->
                Albums.groupAlbums(sortedTracks()).map { album ->
                    folderItem("$NODE_ALBUMS$SEP${album.key}", album.album, album.artist, album.tracks.firstOrNull()?.artworkPath)
                }
            parentId == NODE_PLAYLISTS ->
                libraryRepository.playlists.first().map { folderItem("$NODE_PLAYLISTS$SEP${it.id}", it.name) }
            parentId.startsWith("$NODE_ALBUMS$SEP") -> {
                val key = parentId.substringAfter(SEP)
                Albums.groupAlbums(sortedTracks()).firstOrNull { it.key == key }?.tracks.orEmpty()
                    .map { trackItem(it, "$parentId$SEP${it.id}") }
            }
            parentId.startsWith("$NODE_PLAYLISTS$SEP") -> {
                val id = parentId.substringAfter(SEP)
                val playlist = libraryRepository.playlists.first().firstOrNull { it.id == id }
                libraryRepository.getTracksByIds(playlist?.trackIds.orEmpty())
                    .map { trackItem(it, "$parentId$SEP${it.id}") }
            }
            else -> emptyList()
        }

        private suspend fun tracksForContext(context: String): List<Track> = when {
            context == NODE_TRACKS -> sortedTracks()
            context == NODE_FAVORITES -> sortedTracks().filter { it.favorite }
            context.startsWith("$NODE_ALBUMS$SEP") -> {
                val key = context.substringAfter(SEP)
                Albums.groupAlbums(sortedTracks()).firstOrNull { it.key == key }?.tracks.orEmpty()
            }
            context.startsWith("$NODE_PLAYLISTS$SEP") -> {
                val id = context.substringAfter(SEP)
                val playlist = libraryRepository.playlists.first().firstOrNull { it.id == id }
                libraryRepository.getTracksByIds(playlist?.trackIds.orEmpty())
            }
            else -> sortedTracks()
        }

        private suspend fun sortedTracks(): List<Track> =
            libraryRepository.tracks.first().sortedWith(
                compareBy(String.CASE_INSENSITIVE_ORDER, Track::artist)
                    .thenBy(String.CASE_INSENSITIVE_ORDER, Track::title)
            )
    }

    private fun folderItem(id: String, title: String, subtitle: String? = null, artworkPath: String? = null): MediaItem =
        MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(subtitle)
                    .apply { artworkPath?.let { setArtworkUri(Uri.fromFile(File(it))) } }
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .build()
            )
            .build()

    private fun trackItem(track: Track, mediaId: String): MediaItem =
        MediaItem.Builder()
            .setMediaId(mediaId)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(track.title)
                    .setArtist(track.artist)
                    .setAlbumTitle(track.album)
                    .apply { track.artworkPath?.let { setArtworkUri(Uri.fromFile(File(it))) } }
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .build()
            )
            .build()

    private fun plainTrackItem(track: Track): MediaItem =
        MediaItem.Builder()
            .setMediaId(track.id)
            .setUri(track.uri)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(track.title)
                    .setArtist(track.artist)
                    .setAlbumTitle(track.album)
                    .apply { track.artworkPath?.let { setArtworkUri(Uri.fromFile(File(it))) } }
                    .setIsPlayable(true)
                    .build()
            )
            .build()
}
