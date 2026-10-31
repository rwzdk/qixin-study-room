/**
 * 合成好的提醒语音按设备持久缓存。
 *
 * 到 Worker 的链路实测会整条连接被重置，光靠重试仍可能失败；
 * 只要成功合成过一次，就把音频留在浏览器里，之后（包括刷新、离线）
 * 都直接本地解码播放，不再依赖网络。
 */

const DB_NAME = 'qingyan-study-room';
const DB_VERSION = 1;
const STORE = 'focus-voice';
const MAX_ENTRIES = 12;

interface VoiceRecord {
  key: string;
  savedAt: number;
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readVoiceAudio(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => {
        const record = request.result as VoiceRecord | undefined;
        resolve(record?.data ?? null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function saveVoiceAudio(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, savedAt: Date.now(), data } satisfies VoiceRecord);
      // 只保留最近十几次，避免音频越攒越多。
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        if (countRequest.result <= MAX_ENTRIES) return;
        const excess = countRequest.result - MAX_ENTRIES;
        const cursorRequest = store.index('savedAt').openCursor();
        let removed = 0;
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || removed >= excess) return;
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // 存不进去只影响下次是否要重新合成。
  } finally {
    db.close();
  }
}
