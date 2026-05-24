/**
 * A lightweight, highly efficient IndexedDB cache wrapper for temporary binary file chunks.
 * Enables full transfer resumption across tab closes, browser crashes, or page refreshes.
 */
export const chunkCache = {
  db: null as IDBDatabase | null,

  /**
   * Initializes the IndexedDB store
   */
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('skiima_chunks_v1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks');
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
   * Saves a single chunk binary buffer to the cache
   */
  async putChunk(fileKey: string, chunkIndex: number, chunk: ArrayBuffer): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('chunks', 'readwrite');
        const store = tx.objectStore('chunks');
        const req = store.put(chunk, `${fileKey}_${chunkIndex}`);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Retrieves all consecutive cached chunks for a file
   */
  async getChunks(fileKey: string, totalChunksCount: number): Promise<ArrayBuffer[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('chunks', 'readonly');
        const store = tx.objectStore('chunks');
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
   * Cleans up all cached chunks associated with a file key
   */
  async clearChunks(fileKey: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('chunks', 'readwrite');
        const store = tx.objectStore('chunks');
        
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
  }
};
