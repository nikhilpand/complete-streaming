'use client';

/**
 * AudioCache — Sprint 6
 *
 * Client-side audio binary caching using IndexedDB.
 * Caches actual audio blobs (never ephemeral URLs which expire).
 * Bounded by strict 250MB limit with LRU eviction and byte-level accounting.
 */

const DB_NAME = 'sway_audio_cache_v1';
const STORE_NAME = 'audio_blobs';
const DB_VERSION = 1;

export const MAX_CACHE_BYTES = 250 * 1024 * 1024; // 250 MB

export interface CachedAudioMeta {
  trackId: string;
  byteLength: number;
  mimeType: string;
  cachedAt: number;
  lastAccessedAt: number;
}

interface StoredAudioRecord extends CachedAudioMeta {
  blob: Blob;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'trackId' });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        store.createIndex('byteLength', 'byteLength', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open audio cache DB'));
  });
}

/** Check if a track is cached in IndexedDB */
export async function isAudioCached(trackId: string): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getKey(trackId);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Retrieve cached audio Blob and create an object URL for playback.
 * Updates lastAccessedAt for LRU accounting.
 */
export async function getCachedAudio(
  trackId: string
): Promise<{ blob: Blob; objectUrl: string; mimeType: string } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(trackId);

      req.onsuccess = () => {
        const record = req.result as StoredAudioRecord | undefined;
        if (!record || !record.blob) {
          resolve(null);
          return;
        }

        // Update LRU access timestamp
        record.lastAccessedAt = Date.now();
        store.put(record);

        const objectUrl = URL.createObjectURL(record.blob);
        resolve({
          blob: record.blob,
          objectUrl,
          mimeType: record.mimeType || 'audio/mp4',
        });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Store an audio Blob into IndexedDB with LRU eviction if size exceeds 250MB.
 */
export async function cacheAudio(
  trackId: string,
  blob: Blob,
  mimeType = 'audio/mp4'
): Promise<boolean> {
  if (blob.size > MAX_CACHE_BYTES) {
    return false; // Single file exceeds entire cache capacity
  }

  try {
    const db = await openDB();

    // 1. Calculate current size and prepare eviction if needed
    const stats = await getCacheStats();
    if (stats.totalBytes + blob.size > MAX_CACHE_BYTES) {
      await evictLRU(db, blob.size);
    }

    // 2. Put record
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const now = Date.now();

      const record: StoredAudioRecord = {
        trackId,
        blob,
        mimeType: mimeType || blob.type || 'audio/mp4',
        byteLength: blob.size,
        cachedAt: now,
        lastAccessedAt: now,
      };

      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/** Evict oldest entries until targetFreeBytes are freed */
async function evictLRU(db: IDBDatabase, targetFreeBytes: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('lastAccessedAt');

    let freed = 0;
    const cursorReq = index.openCursor(); // Ascending order = oldest first

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor && freed < targetFreeBytes) {
        const record = cursor.value as StoredAudioRecord;
        freed += record.byteLength || 0;
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => resolve();
  });
}

/** Get cache usage statistics */
export async function getCacheStats(): Promise<{
  totalBytes: number;
  entryCount: number;
  maxBytes: number;
  usagePercent: number;
}> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let totalBytes = 0;
      let entryCount = 0;

      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const rec = cursor.value as StoredAudioRecord;
          totalBytes += rec.byteLength || 0;
          entryCount++;
          cursor.continue();
        } else {
          resolve({
            totalBytes,
            entryCount,
            maxBytes: MAX_CACHE_BYTES,
            usagePercent: Math.min(100, Math.round((totalBytes / MAX_CACHE_BYTES) * 100)),
          });
        }
      };
      cursorReq.onerror = () =>
        resolve({ totalBytes: 0, entryCount: 0, maxBytes: MAX_CACHE_BYTES, usagePercent: 0 });
    });
  } catch {
    return { totalBytes: 0, entryCount: 0, maxBytes: MAX_CACHE_BYTES, usagePercent: 0 };
  }
}

/** Clear entire audio cache */
export async function clearAudioCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}
