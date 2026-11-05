// 只接收在线页面的完成事件并展示通知；网页资源继续由网络加载。
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (event.data?.type !== "completion-notification") return;
  const { title, options } = event.data;
  event.waitUntil(
    self.registration
      .showNotification(title, {
        ...options,
        data: { ...options.data, clientId: event.source.id },
      })
      .then(
        () => event.ports[0]?.postMessage({ ok: true }),
        (error) => event.ports[0]?.postMessage({ error: error.message }),
      ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { threadId, username, clientId } = event.notification.data;
  event.waitUntil(
    (async () => {
      const client = await self.clients.get(clientId);
      if (client) {
        await client.focus();
        client.postMessage({
          type: "open-notification-thread",
          threadId,
          username,
        });
      } else {
        const params = new URLSearchParams({
          notificationThread: threadId,
          notificationUser: username,
        });
        await self.clients.openWindow("/#" + params);
      }
    })(),
  );
});
