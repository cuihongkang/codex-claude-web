import test from "node:test";
import assert from "node:assert/strict";
import {
  createThreadOrdering,
  preserveFailedBackendThreads,
} from "../src/domain/thread-order.js";
import { createThreadCatalog } from "../src/application/thread-catalog.js";

const codex = {
  id: "codex-thread",
  name: "Matching Codex",
  createdAt: 1,
  cwd: "/workspace",
};
const claude = {
  id: "backend:claude:native-thread",
  name: "Matching Claude",
  createdAt: 2,
  cwd: "/workspace",
};
const failure = {
  backendId: "claude",
  message: "native transcript unreadable",
};

test("complete pagination collects backend errors without discarding healthy records", async () => {
  const calls = [];
  const ordering = createThreadOrdering(async (method, params) => {
    if (method === "thread/turns/list") return { data: [] };
    calls.push(params.cursor);
    return params.cursor
      ? { data: [], backendErrors: [failure], nextCursor: null }
      : { data: [codex], backendErrors: [], nextCursor: "next-backend" };
  });
  let errors;
  const result = await ordering.list(
    {},
    {
      onBackendErrors: (value) => {
        errors = value;
      },
    },
  );
  assert.deepEqual(
    result.map((thread) => thread.id),
    [codex.id],
  );
  assert.deepEqual(calls, [undefined, "next-backend"]);
  assert.deepEqual(errors, [failure]);
});

test("failed backend preservation respects archive, search, deletion and refreshed records", () => {
  const archived = {
    ...claude,
    id: "backend:claude:archived",
    path: "/archived_sessions/",
  };
  const unrelated = {
    ...claude,
    id: "backend:claude:other",
    name: "Other task",
  };
  assert.deepEqual(
    preserveFailedBackendThreads(
      [codex],
      [claude, archived, unrelated],
      [failure],
      { searchTerm: "Matching", archived: false },
    ).map((thread) => thread.id),
    [claude.id, codex.id],
  );
  assert.deepEqual(
    preserveFailedBackendThreads([], [claude, archived], [failure], {
      archived: true,
    }).map((thread) => thread.id),
    [archived.id],
  );
  assert.deepEqual(
    preserveFailedBackendThreads([codex], [claude], [], {}).map(
      (thread) => thread.id,
    ),
    [codex.id],
  );
});

test("retry preserves prior content search matches while a changed query filters cached titles", () => {
  const contentMatch = { ...claude, name: "Short title" };
  const params = { archived: false, searchTerm: "body-only phrase" };
  assert.equal(
    preserveFailedBackendThreads([], [contentMatch], [failure], params, params)
      .length,
    1,
  );
  assert.equal(
    preserveFailedBackendThreads(
      [],
      [contentMatch],
      [failure],
      { ...params, searchTerm: "another phrase" },
      params,
    ).length,
    0,
  );
});

test("catalogue retains only the failed backend, exposes retry state, and isolates late failures", async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  let state = {
    threads: [codex, claude],
    current: null,
    archived: false,
    search: "",
    projects: [],
    pins: [],
    projectOrder: [],
    projectlessRoot: "",
  };
  let partial = true,
    held;
  const requests = [];
  const ordering = createThreadOrdering(async (method, params) => {
    if (method === "thread/turns/list") {
      requests.push(params.threadId);
      return { data: [] };
    }
    if (held) {
      const task = held;
      held = null;
      return new Promise(task);
    }
    return {
      data: partial ? [codex] : [codex, claude],
      backendErrors: partial ? [failure] : [],
    };
  });
  const catalog = createThreadCatalog({
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
    rpc: async () => ({ directories: {} }),
    records: {
      threadOrdering: ordering,
      nameRevision: 0,
      deletedThreads: new Set(),
      preserveThreadName: (thread) => thread,
    },
    navigation: {},
    report() {},
    notice() {},
  });
  await catalog.loadThreads();
  assert.deepEqual(
    new Set(state.threads.map((thread) => thread.id)),
    new Set([codex.id, claude.id]),
  );
  assert.deepEqual(state.threadListErrors, [failure]);
  assert.ok(
    !requests.includes(claude.id),
    "failed backends are not read again while retaining their snapshot",
  );
  let release;
  held = (resolve) => {
    release = resolve;
  };
  const old = catalog.loadThreads();
  await Promise.resolve();
  partial = false;
  await catalog.loadThreads();
  release({ data: [], backendErrors: [failure] });
  await old;
  assert.deepEqual(state.threadListErrors, []);
  assert.equal(state.threads.length, 2);
  delete globalThis.localStorage;
});
