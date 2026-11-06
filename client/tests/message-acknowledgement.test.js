import test from "node:test";
import assert from "node:assert/strict";
import { createMessages } from "../src/application/messages.js";

for (const acknowledgedStatus of ["queued", "inProgress"]) {
  for (const finishedBeforeAck of [false, true]) {
    test(`${acknowledgedStatus}确认${finishedBeforeAck ? "保留已结束结果" : "立即占用对话"}`, async (t) => {
      const oldStorage = globalThis.localStorage,
        storage = new Map();
      globalThis.localStorage = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      };
      t.after(() => {
        globalThis.localStorage = oldStorage;
      });
      let state = {
        current: { id: "thread" },
        draft: "request",
        attachments: [],
        active: {},
        compactions: {},
        turnTimings: {},
        turns: {},
        items: [],
        model: "model",
        providerId: "",
        models: [],
        mode: "default",
        connected: true,
      };
      const get = () => state,
        set = (patch) => {
          state = { ...state, ...patch };
        };
      let acknowledge, received;
      const requested = new Promise((resolve) => {
        received = resolve;
      });
      const controller = createMessages({
        get,
        set,
        setThreadMode() {},
        transport: {},
        navigation: {
          opening: 1,
          ensureThread: async () => state.current,
          getAttachmentDraft: () => [],
          updateAttachmentDraft() {},
        },
        catalog: { loadThreads: async () => {} },
        models: { rememberModelSelection() {} },
        records: {
          recordThreadActivity() {},
          recordTurnTimings: (threadId, turns) => {
            for (const turn of turns)
              set({
                turnTimings: {
                  ...state.turnTimings,
                  [threadId]: {
                    ...state.turnTimings[threadId],
                    [turn.id]: turn,
                  },
                },
              });
          },
        },
        report: (e) => {
          throw e;
        },
        rpc: async (method, params) => {
          assert.equal(method, "turn/start");
          assert.equal(params.providerId, "");
          received();
          return new Promise((resolve) => {
            acknowledge = resolve;
          });
        },
      });
      const send = controller.sendMessage();
      await requested;
      if (finishedBeforeAck)
        set({
          turnTimings: {
            thread: {
              turn: { status: "completed", startedAt: 10, completedAt: 11 },
            },
          },
        });
      acknowledge({ turn: { id: "turn", status: acknowledgedStatus } });
      assert.equal(await send, true);
      assert.equal(state.active.thread, finishedBeforeAck ? undefined : "turn");
      assert.equal(
        state.turnTimings.thread.turn.status,
        finishedBeforeAck ? "completed" : acknowledgedStatus,
      );
      assert.equal(state.busy, false);
    });
  }
}
