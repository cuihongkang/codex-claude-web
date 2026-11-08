import { titleOf } from "../domain/format.js";
import { createBrowserNotifications } from "../infrastructure/notifications.js";

export function createNotifications({
  get,
  set,
  subscribe,
  navigation,
  rpc,
  browser = createBrowserNotifications(),
}) {
  let revision = 0;
  let preferenceRevision = 0;
  let pendingTarget;
  function refresh() {
    const status = browser.status();
    const previous = get().notifications;
    if (Object.keys(status).some((key) => previous?.[key] !== status[key])) {
      revision++;
      set({ notifications: { ...status, error: "" } });
    }
  }
  async function setEnabled(enabled) {
    const request = ++preferenceRevision;
    revision++;
    try {
      if (enabled) await browser.enable();
      else browser.disable();
      if (request === preferenceRevision) {
        refresh();
        set({ notifications: { ...browser.status(), error: "" } });
      }
    } catch (error) {
      if (request === preferenceRevision)
        set({ notifications: { ...browser.status(), error: error.message } });
    }
  }
  async function completed(threadId, turn) {
    refresh();
    const state = get();
    const status = state.notifications;
    const username = state.auth?.username;
    if (
      !state.auth?.authenticated ||
      !status.enabled ||
      status.permission !== "granted" ||
      turn.status !== "completed" ||
      !threadId ||
      !turn.id
    )
      return;
    const request = revision;
    const current = () =>
      request === revision &&
      get().auth?.authenticated &&
      get().auth.username === username &&
      browser.status().enabled &&
      browser.status().permission === "granted";
    let thread =
      state.threads.find((entry) => entry.id === threadId) ||
      (state.current?.id === threadId ? state.current : null);
    try {
      if (!thread)
        thread = (await rpc("thread/read", { threadId, includeTurns: false }))
          .thread;
      if (!current() || thread?.source?.subAgent) return;
      await browser.show({
        key: JSON.stringify([username, threadId, turn.id]),
        title: titleOf(thread),
        threadId,
        username,
        current,
      });
    } catch (error) {
      if (current())
        set({
          notifications: { ...get().notifications, error: error.message },
        });
    }
  }
  function openPending() {
    if (!pendingTarget || !get().auth?.authenticated) return;
    if (get().auth.username !== pendingTarget.username) {
      pendingTarget = null;
      return;
    }
    if (!get().connected || get().booting) return;
    const { threadId } = pendingTarget;
    pendingTarget = null;
    set({ modal: null });
    navigation.openThread(threadId);
  }
  function start() {
    let active = true;
    let scheduled = false;
    const scheduleOpen = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (active) openPending();
      });
    };
    refresh();
    const unsubscribe = subscribe(scheduleOpen);
    const unlisten = browser.listen({
      refresh,
      open: (target) => {
        pendingTarget = target;
        scheduleOpen();
      },
    });
    return () => {
      active = false;
      revision++;
      preferenceRevision++;
      pendingTarget = null;
      unsubscribe();
      unlisten();
    };
  }
  return { completed, setEnabled, start };
}
