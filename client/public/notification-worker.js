// Notification delivery only: no offline caching or background push subscription.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data;
  event.notification.close();
  if (!data?.threadId || !["codex", "claude"].includes(data.provider)) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client = windows[0];
      if (client) {
        await client.focus();
        client.postMessage({ type: "codex-web:notification", event: data });
      } else
        await self.clients.openWindow(
          `/?notifyProvider=${encodeURIComponent(data.provider)}&notifyThread=${encodeURIComponent(data.threadId)}`,
        );
    })(),
  );
});
