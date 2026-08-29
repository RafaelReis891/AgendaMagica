// Service Worker — Mágica
// Estratégia: cache-first para assets, network-first para dados (mas dados vão por IndexedDB).
const CACHE_NAME = 'magica-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/utils.js',
  './js/db.js',
  './js/firebase.js',
  './js/sync.js',
  './js/notifications.js',
  './js/search.js',
  './js/calendar.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Não intercepta chamadas ao Firebase
  if (request.url.includes('firebaseio.com') || request.url.includes('googleapis.com')) {
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (request.method === 'GET' && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached); // fallback
    })
  );
});

// Notificações em background (quando suportado)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const target = clients.find((c) => c.visibilityState === 'visible');
      if (target) {
        target.postMessage({ type: 'OPEN_EVENT', id });
        return target.focus();
      }
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

// Recebe mensagem do app principal para agendar notificação
self.addEventListener('message', (event) => {
  if (event.data.type === 'SCHEDULE_NOTIFICATION') {
    const { id, title, body, triggerAt } = event.data;
    const delay = triggerAt - Date.now();
    
    if (delay > 0) {
      setTimeout(() => {
        self.registration.showNotification('🔔 ' + title, {
          body: body || 'Compromisso agendado',
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          vibrate: [200, 100, 200, 100, 300],
          tag: id,
          requireInteraction: true, // não some automaticamente
          actions: [
            { action: 'done', title: '✓ Concluído' },
            { action: 'postpone', title: ' Adiar' }
          ]
        });
      }, delay);
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'done') {
    // Envia mensagem para o app marcar como concluído
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'MARK_DONE', id: event.notification.tag }));
    });
  } else if (event.action === 'postpone') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'POSTPONE', id: event.notification.tag }));
    });
  } else {
    // Clique normal - abre o app
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        const target = clients.find(c => c.visibilityState === 'visible');
        if (target) {
          target.postMessage({ type: 'OPEN_EVENT', id: event.notification.tag });
          return target.focus();
        }
        if (clients.length) return clients[0].focus();
        return self.clients.openWindow('./');
      })
    );
  }
});