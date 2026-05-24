/**
 * A lightweight, highly efficient IndexedDB cache wrapper for temporary binary file chunks.
 * Enables full transfer resumption across tab closes, browser crashes, or page refreshes.
 * Version 2 introduces metadata tracking and 48-hour garbage collection for zero-leak storage.
 */
export const chunkCache = {
  db: null as IDBDatabase | null,

  /**
   * Initializes the IndexedDB store (Version 2)
   */
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('skiima_chunks_v1', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks');
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata');
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Saves a single chunk binary buffer to the cache and records access timestamp
   */
  async putChunk(fileKey: string, chunkIndex: number, chunk: ArrayBuffer): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['chunks', 'metadata'], 'readwrite');
        const store = tx.objectStore('chunks');
        const req = store.put(chunk, `${fileKey}_${chunkIndex}`);
        
        // Save/Update timestamp metadata for garbage collection
        const metaStore = tx.objectStore('metadata');
        metaStore.put(Date.now(), fileKey);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Retrieves all consecutive cached chunks for a file and updates metadata timestamp
   */
  async getChunks(fileKey: string, totalChunksCount: number): Promise<ArrayBuffer[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['chunks', 'metadata'], 'readwrite');
        const store = tx.objectStore('chunks');
        const metaStore = tx.objectStore('metadata');
        
        // Update access timestamp
        metaStore.put(Date.now(), fileKey);

        const chunks: ArrayBuffer[] = [];
        let index = 0;
        
        const readNext = () => {
          if (index >= totalChunksCount) {
            resolve(chunks);
            return;
          }
          const req = store.get(`${fileKey}_${index}`);
          req.onsuccess = () => {
            if (req.result) {
              chunks.push(req.result as ArrayBuffer);
              index++;
              readNext();
            } else {
              // Stop reading when we encounter a missing chunk
              resolve(chunks);
            }
          };
          req.onerror = () => reject(req.error);
        };
        
        readNext();
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Cleans up all cached chunks associated with a file key and removes metadata entry
   */
  async clearChunks(fileKey: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['chunks', 'metadata'], 'readwrite');
        const store = tx.objectStore('chunks');
        const metaStore = tx.objectStore('metadata');

        // Delete metadata entry
        metaStore.delete(fileKey);
        
        // Open cursor to delete keys starting with fileKey
        const req = store.openKeyCursor();
        req.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const key = cursor.key as string;
            if (key.startsWith(fileKey)) {
              store.delete(key);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Background garbage collector to automatically purge stale chunks older than maxAgeMs (default: 48h)
   */
  async garbageCollect(maxAgeMs: number = 48 * 60 * 60 * 1000): Promise<void> {
    const db = await this.init();
    
    // 1. Scan metadata store to find expired fileKeys
    const keysToDelete = await new Promise<string[]>((resolve, reject) => {
      try {
        const tx = db.transaction('metadata', 'readonly');
        const store = tx.objectStore('metadata');
        const keys: string[] = [];
        const req = store.openCursor();
        const now = Date.now();
        
        req.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const fileKey = cursor.key as string;
            const timestamp = cursor.value as number;
            if (now - timestamp > maxAgeMs) {
              keys.push(fileKey);
            }
            cursor.continue();
          } else {
            resolve(keys);
          }
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });

    if (keysToDelete.length === 0) {
      console.log('[IndexedDB GC] No expired chunks found.');
      return;
    }

    console.log(`[IndexedDB GC] Evicting expired chunks for ${keysToDelete.length} files:`, keysToDelete);

    // 2. Perform batched deletions in a single transaction
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(['chunks', 'metadata'], 'readwrite');
        const chunksStore = tx.objectStore('chunks');
        const metaStore = tx.objectStore('metadata');

        for (const fileKey of keysToDelete) {
          metaStore.delete(fileKey);
        }

        const req = chunksStore.openKeyCursor();
        req.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const key = cursor.key as string;
            const matches = keysToDelete.some((fileKey) => key.startsWith(fileKey));
            if (matches) {
              chunksStore.delete(key);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
      } catch (err) {
        reject(err);
      }
    });

    console.log('[IndexedDB GC] Expired chunks eviction completed successfully.');
  }
};
