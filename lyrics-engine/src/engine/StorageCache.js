/**
 * StorageCache.js - Persistent Multi-Tier Lyrics Cache
 * High-speed caching in IndexedDB with LocalStorage and In-Memory fallback.
 */

export class StorageCache {
  constructor(dbName = 'AuroraLyricsCacheDB', storeName = 'lyrics_store') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.memoryMap = new Map();
    this.dbPromise = this.initDB();
  }

  async initDB() {
    if (typeof indexedDB === 'undefined') return null;

    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  generateKey(title, artist, durationSec = 0) {
    const t = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const a = (artist || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const d = durationSec ? Math.round(durationSec) : 0;
    return `lyric_${t}_${a}_${d}`;
  }

  async get(title, artist, durationSec = 0) {
    const key = this.generateKey(title, artist, durationSec);

    // 1. Memory check
    if (this.memoryMap.has(key)) {
      const entry = this.memoryMap.get(key);
      if (Date.now() < entry.expiresAt) return entry.data;
      this.memoryMap.delete(key);
    }

    // 2. IndexedDB check
    const db = await this.dbPromise;
    if (db) {
      try {
        const data = await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });

        if (data && Date.now() < data.expiresAt) {
          this.memoryMap.set(key, data);
          return data.data;
        }
      } catch (_) {}
    }

    // 3. LocalStorage fallback
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() < parsed.expiresAt) {
            this.memoryMap.set(key, parsed);
            return parsed.data;
          }
          localStorage.removeItem(key);
        }
      } catch (_) {}
    }

    return null;
  }

  async set(title, artist, durationSec = 0, data, ttlMs = 14 * 86400 * 1000) {
    const key = this.generateKey(title, artist, durationSec);
    const entry = {
      key,
      data,
      savedAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    };

    this.memoryMap.set(key, entry);

    const db = await this.dbPromise;
    if (db) {
      try {
        await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readwrite');
          const store = tx.objectStore(this.storeName);
          const req = store.put(entry);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        });
        return;
      } catch (_) {}
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(entry));
      } catch (_) {}
    }
  }
}
