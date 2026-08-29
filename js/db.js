// IndexedDB — fonte local da verdade
const DB_NAME = 'magicaDB';
const DB_VERSION = 1;

const DB = (() => {
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('events')) {
          const s = db.createObjectStore('events', { keyPath: 'id' });
          s.createIndex('by_date', 'date', { unique: false });
          s.createIndex('by_user', 'userId', { unique: false });
          s.createIndex('by_type', 'type', { unique: false });
          s.createIndex('by_sync', 'syncStatus', { unique: false });
          s.createIndex('by_dateUser', ['date', 'userId'], { unique: false });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ---- events ----
  function putEvent(ev) {
    return tx('events', 'readwrite').then((s) => reqPromise(s.put(ev)));
  }
  function getEvent(id) {
    return tx('events').then((s) => reqPromise(s.get(id)));
  }
  function deleteEvent(id) {
    return tx('events', 'readwrite').then((s) => reqPromise(s.delete(id)));
  }
  function allEvents() {
    return tx('events').then((s) => reqPromise(s.getAll()));
  }
  function eventsByDate(dateStr, userId) {
    return tx('events').then((store) => new Promise((resolve, reject) => {
      const idx = store.index('by_dateUser');
      const range = IDBKeyRange.only([dateStr, userId]);
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }
  function eventsByDateRange(startISO, endISO, userId) {
    return tx('events').then((store) => new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return resolve(out);
        const v = cur.value;
        if (v.userId === userId && !v.deleted && v.date >= startISO && v.date <= endISO) {
          out.push(v);
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    }));
  }
  function pendingSyncEvents() {
    return tx('events').then((store) => new Promise((resolve, reject) => {
      const idx = store.index('by_sync');
      const req = idx.getAll(IDBKeyRange.only('pending'));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  // ---- syncQueue ----
  function enqueue(op) {
    return tx('syncQueue', 'readwrite').then((s) => reqPromise(s.add(op)));
  }
  function allQueue() {
    return tx('syncQueue').then((s) => reqPromise(s.getAll()));
  }
  function clearQueue() {
    return tx('syncQueue', 'readwrite').then((s) => reqPromise(s.clear()));
  }
  function dequeue(id) {
    return tx('syncQueue', 'readwrite').then((s) => reqPromise(s.delete(id)));
  }

  // ---- settings ----
  function setSetting(key, value) {
    return tx('settings', 'readwrite').then((s) => reqPromise(s.put({ key, value })));
  }
  function getSetting(key) {
    return tx('settings').then((s) => reqPromise(s.get(key))).then((r) => r ? r.value : null);
  }

  // ---- metadata ----
  function setMeta(key, value) {
    return tx('metadata', 'readwrite').then((s) => reqPromise(s.put({ key, value })));
  }
  function getMeta(key) {
    return tx('metadata').then((s) => reqPromise(s.get(key))).then((r) => r ? r.value : null);
  }

  return {
    open,
    putEvent, getEvent, deleteEvent, allEvents,
    eventsByDate, eventsByDateRange, pendingSyncEvents,
    enqueue, allQueue, clearQueue, dequeue,
    setSetting, getSetting,
    setMeta, getMeta
  };
})();