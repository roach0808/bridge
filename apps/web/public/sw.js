/* Silver Horizon service worker: shows push notifications and opens the right page when one is clicked. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Silver Horizon', body: event.data ? event.data.text() : '', url: '/', tag: 'god', kind: 'notification' };
  }

  event.waitUntil(
    (async () => {
      const target = new URL(data.url || '/', self.location.origin);
      const open = await windows();
      const focused = open.filter((c) => c.focused && c.visibilityState === 'visible');
      // Don't interrupt someone who is already looking: a chat they have open,
      // or any page of the app for other notifications (the app shows those itself).
      const watching =
        data.kind === 'test'
          ? false
          : data.kind === 'chat' ? focused.some((c) => new URL(c.url).pathname === target.pathname) : focused.length > 0;
      if (watching) return;

      await self.registration.showNotification(data.title || 'Silver Horizon', {
        body: data.body || '',
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: { url: target.pathname + target.search },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const open = (await windows()).filter((c) => new URL(c.url).origin === self.location.origin);
      const client = open.find((c) => c.focused) || open[0];
      if (client) {
        // The app navigates in place (no reload) when it receives this message.
        client.postMessage({ type: 'god:navigate', url });
        await client.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
