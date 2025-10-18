/* service-worker.js (จะถูกส่งออกโดย Apps Script ผ่าน ?sw=1) */
const SW_VERSION = 'v1.0.0';
const CACHE_NAME = `gpstracker-${SW_VERSION}`;

const PRECACHE = [
  // CDN ที่ใช้ประจำ (ช่วยให้เปิดได้แม้เน็ตล่มภายหลัง)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg'
];

// ===== IndexedDB helpers (ซ้ำแบบย่อกับหน้าเว็บ เพื่อให้ SW เข้าถึง outbox ได้) =====
const DB_NAME = 'gpstracker_offline_v1';
const STORE_OUTBOX = 'outbox';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGetAll(store) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const req = st.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}
function idbDelete(store, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const st = tx.objectStore(store);
    const req = st.delete(key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

// ===== Install / Activate =====
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k === CACHE_NAME) ? null : caches.delete(k))))
  );
  self.clients.claim();
});

// ===== Fetch: network-first (GET) พร้อม fallback cache =====
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return; // ให้ POST ไปตามปกติ (คิวจัดที่หน้าเว็บ/Background Sync)
  evt.respondWith((async () => {
    try {
      const net = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      // เก็บเฉพาะ 200 OK
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      throw new Error('offline and not cached');
    }
  })());
});

// ===== Background Sync: ส่งงานค้าง =====
self.addEventListener('sync', (evt) => {
  if (evt.tag === 'sync-outbox') {
    evt.waitUntil(flushOutboxAndNotify());
  }
});

// ===== Message: manual flush =====
self.addEventListener('message', (evt) => {
  if (evt.data && evt.data.type === 'flush') {
    evt.waitUntil(flushOutboxAndNotify());
  }
});

async function flushOutboxAndNotify() {
  const items = await idbGetAll(STORE_OUTBOX);
  if (!items.length) return;
  let sent = 0;
  for (const it of items) {
    try {
      const res = await fetch(it.url, {
        method: it.method || 'POST',
        headers: it.headers || { 'Content-Type': 'application/json' },
        body: JSON.stringify(it.body || {})
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await idbDelete(STORE_OUTBOX, it.id);
      sent++;
    } catch {
      break; // ยังส่งไม่ได้
    }
  }
  if (sent) {
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clientsList.forEach(c => c.postMessage({ type: 'sync-complete', count: sent }));
  }
}
