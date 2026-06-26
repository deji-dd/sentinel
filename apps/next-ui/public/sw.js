// public/sw.js — Sentinel Service Worker
// Handles push events and notification clicks.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Sentinel", body: event.data.text() };
  }

  const { title = "Sentinel", body = "", icon = "/apple-touch-icon.png", url = "/" } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/apple-touch-icon.png",
      data: { url },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";

  // Check if url is external (absolute and different origin)
  const isExternal = (url.startsWith("http://") || url.startsWith("https://")) && !url.startsWith(self.location.origin);

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        if (isExternal) {
          if (clients.openWindow) return clients.openWindow(url);
          return;
        }

        // For relative or same-origin URLs: focus existing tab if already open and navigate
        for (const client of windowClients) {
          const absoluteUrl = new URL(url, self.location.origin).toString();
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(absoluteUrl);
            return client.focus();
          }
        }
        // Otherwise open new tab
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
