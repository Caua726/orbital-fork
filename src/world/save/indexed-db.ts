const DB_NAME = 'orbital_db';
const DB_VERSION = 1;

export const STORES = {
  mundos: 'mundos',
  sistemas: 'sistemas',
  sois: 'sois',
  planetas: 'planetas',
  naves: 'naves',
} as const;

export type StoreName = keyof typeof STORES;

let _dbPromise: Promise<IDBDatabase> | null = null;

export function abrirDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.mundos)) {
        db.createObjectStore(STORES.mundos, { keyPath: 'nome' });
      }
      for (const s of ['sistemas', 'sois', 'planetas', 'naves'] as const) {
        if (!db.objectStoreNames.contains(STORES[s])) {
          db.createObjectStore(STORES[s], { keyPath: ['mundoNome', 'id'] });
        }
      }
    };
  }).catch((err) => {
    _dbPromise = null; // allow retry on transient failures
    throw err;
  });
  return _dbPromise;
}

export async function put(store: StoreName, value: any): Promise<void> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES[store], 'readwrite');
    tx.objectStore(STORES[store]).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllByMundo<T = any>(store: StoreName, mundoNome: string): Promise<T[]> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES[store], 'readonly');
    const s = tx.objectStore(STORES[store]);
    const range = IDBKeyRange.bound([mundoNome, ''], [mundoNome, '\uffff']);
    const req = s.getAll(range);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function putMany(
  writes: Array<{ store: StoreName; value: any }>,
): Promise<void> {
  if (writes.length === 0) return;
  const db = await abrirDb();
  const uniqueStores = Array.from(new Set(writes.map((w) => STORES[w.store])));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(uniqueStores, 'readwrite');
    for (const w of writes) {
      tx.objectStore(STORES[w.store]).put(w.value);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Atomically replace one world's header and entity records. IndexedDB
 * rolls the whole transaction back when any delete/put fails, so the last
 * valid save remains available after quota, shutdown, or serialization
 * errors. */
export async function replaceMundoAtomically(
  mundoNome: string,
  writes: Array<{ store: StoreName; value: any }>,
): Promise<void> {
  const db = await abrirDb();
  const stores = [STORES.mundos, STORES.sistemas, STORES.sois, STORES.planetas, STORES.naves];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(STORES.mundos).delete(mundoNome);
    for (const s of ['sistemas', 'sois', 'planetas', 'naves'] as const) {
      const range = IDBKeyRange.bound([mundoNome, ''], [mundoNome, '\uffff']);
      tx.objectStore(STORES[s]).delete(range);
    }
    for (const write of writes) tx.objectStore(STORES[write.store]).put(write.value);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transação IndexedDB abortada'));
    tx.onerror = () => reject(tx.error ?? new Error('Falha na transação IndexedDB'));
  });
}

/** Apply an entity diff and header update in one transaction. Deletions use
 * compound [world,id] keys, so records from other worlds are never touched. */
export async function patchMundoAtomically(
  writes: Array<{ store: StoreName; value: any }>,
  deletes: Array<{ store: Exclude<StoreName, 'mundos'>; mundoNome: string; id: string }>,
): Promise<void> {
  if (writes.length === 0 && deletes.length === 0) return;
  const db = await abrirDb();
  const stores = Array.from(new Set([
    ...writes.map((w) => STORES[w.store]),
    ...deletes.map((d) => STORES[d.store]),
  ]));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const deletion of deletes) {
      tx.objectStore(STORES[deletion.store]).delete([deletion.mundoNome, deletion.id]);
    }
    for (const write of writes) tx.objectStore(STORES[write.store]).put(write.value);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Patch IndexedDB abortado'));
    tx.onerror = () => reject(tx.error ?? new Error('Falha no patch IndexedDB'));
  });
}

export async function deleteByMundo(mundoNome: string): Promise<void> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.mundos, STORES.sistemas, STORES.sois, STORES.planetas, STORES.naves],
      'readwrite',
    );
    tx.objectStore(STORES.mundos).delete(mundoNome);
    for (const s of ['sistemas', 'sois', 'planetas', 'naves'] as const) {
      const range = IDBKeyRange.bound([mundoNome, ''], [mundoNome, '\uffff']);
      tx.objectStore(STORES[s]).delete(range);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listMundos(): Promise<any[]> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.mundos, 'readonly');
    const req = tx.objectStore(STORES.mundos).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}
