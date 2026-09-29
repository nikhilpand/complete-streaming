'use client';

import { resolveMedia } from '@/lib/api/songs';
import type { Song, Stream } from '@/lib/api/types';
import { artistNames, artUrl } from '@/lib/utils';
import { cacheAudio } from '@/lib/audioCache';

export interface DownloadTask {
  id: string;
  song: Song;
  status: 'pending' | 'resolving' | 'downloading' | 'complete' | 'error';
  progress: number; // 0..100
  bytesDownloaded: number;
  totalBytes: number;
  error?: string;
}

export type DownloadListener = (task: DownloadTask) => void;

/**
 * Sanitize filename characters forbidden in Windows and POSIX filesystems:
 * \ / : * ? " < > |
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Select the highest quality stream for permanent offline storage / download.
 */
function pickBestStream(streams: Stream[]): Stream {
  if (!streams.length) throw new Error('No audio streams available');
  return [...streams].sort((a, b) => (b.bitrate_kbps ?? 0) - (a.bitrate_kbps ?? 0))[0];
}

export class DownloadManager {
  private tasks = new Map<string, DownloadTask>();
  private listeners = new Set<DownloadListener>();

  public subscribe(cb: DownloadListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(task: DownloadTask) {
    this.listeners.forEach((cb) => cb(task));
  }

  public getTask(songId: string): DownloadTask | undefined {
    return this.tasks.get(songId);
  }

  public getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Downloads a song with progress tracking, saves it into the local audioCache for offline
   * playback, and triggers a browser save download.
   */
  public async downloadSong(song: Song): Promise<void> {
    if (!song) return;

    const task: DownloadTask = {
      id: song.id,
      song,
      status: 'resolving',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
    };
    this.tasks.set(song.id, task);
    this.emit(task);

    try {
      // 1. Resolve media stream
      const media = await resolveMedia(song.id, undefined, {
        title: song.title,
        artist: artistNames(song.artists, song.subtitle),
      });

      if (!media?.streams?.length) {
        throw new Error('No audio streams available for this track');
      }

      const stream = pickBestStream(media.streams);
      const isMp3 = stream.mime_type?.includes('mp3') || stream.url.includes('.mp3');
      const ext = isMp3 ? 'mp3' : 'm4a';
      const artist = sanitizeFilename(artistNames(song.artists, song.subtitle));
      const title = sanitizeFilename(song.title || 'track');
      const filename = `${artist} - ${title}.${ext}`;

      task.status = 'downloading';
      this.emit(task);

      // 2. Fetch stream via proxy with chunk-by-chunk progress tracking
      const downloadProxyUrl = `/api/download?url=${encodeURIComponent(stream.url)}&filename=${encodeURIComponent(filename)}`;
      const res = await fetch(downloadProxyUrl);

      if (!res.ok) {
        throw new Error(`Download HTTP error: ${res.status}`);
      }

      const contentLength = Number(res.headers.get('content-length')) || 0;
      task.totalBytes = contentLength;

      if (!res.body) {
        throw new Error('No response body');
      }

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;
          task.bytesDownloaded = receivedBytes;
          if (contentLength > 0) {
            task.progress = Math.min(100, Math.round((receivedBytes / contentLength) * 100));
          }
          this.emit(task);
        }
      }

      // Combine chunks into binary Blob
      const mime = isMp3 ? 'audio/mpeg' : 'audio/mp4';
      const blob = new Blob(chunks as BlobPart[], { type: mime });

      // 3. Cache audio blob for offline playback in IndexedDB
      await cacheAudio(song.id, blob, mime).catch(() => {});

      // 4. Trigger browser download save
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 3000);

      task.status = 'complete';
      task.progress = 100;
      this.emit(task);
    } catch (err: unknown) {
      task.status = 'error';
      task.error = (err as Error)?.message || 'Download failed';
      this.emit(task);
      throw err;
    }
  }
}

export const downloadManager =
  typeof window !== 'undefined' ? new DownloadManager() : (null as unknown as DownloadManager);
