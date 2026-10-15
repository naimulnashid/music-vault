package com.musicvault.di

import android.content.Context
import androidx.room.Room
import com.musicvault.data.db.HistoryDao
import com.musicvault.data.db.MusicVaultDatabase
import com.musicvault.data.db.DownloadDao
import com.musicvault.data.db.PlayEventDao
import com.musicvault.data.db.PlaylistDao
import com.musicvault.data.db.QueueDao
import com.musicvault.data.db.SyncDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): MusicVaultDatabase =
        Room.databaseBuilder(context, MusicVaultDatabase::class.java, "music-vault.db")
            .addMigrations(
                MusicVaultDatabase.MIGRATION_1_2,
                MusicVaultDatabase.MIGRATION_2_3,
                MusicVaultDatabase.MIGRATION_3_4,
                MusicVaultDatabase.MIGRATION_4_5,
                MusicVaultDatabase.MIGRATION_5_6,
                MusicVaultDatabase.MIGRATION_6_7,
            )
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun providePlaylistDao(db: MusicVaultDatabase): PlaylistDao = db.playlistDao()

    @Provides
    fun provideHistoryDao(db: MusicVaultDatabase): HistoryDao = db.historyDao()

    @Provides
    fun providePlayEventDao(db: MusicVaultDatabase): PlayEventDao = db.playEventDao()

    @Provides
    fun provideQueueDao(db: MusicVaultDatabase): QueueDao = db.queueDao()

    @Provides
    fun provideSyncDao(db: MusicVaultDatabase): SyncDao = db.syncDao()

    @Provides
    fun provideDownloadDao(db: MusicVaultDatabase): DownloadDao = db.downloadDao()
}
