import assert from "node:assert/strict";

export async function testForkTitles(app, requests, setResponse) {
  const original = app.get();
  const root = {
    id: "fork-title-root",
    name: "训练进展",
    cwd: "/fixture/forks",
    createdAt: 1,
  };
  const archived = {
    ...root,
    id: "fork-title-archived",
    name: "训练进展 (9)",
    forkedFromId: root.id,
  };
  const records = [root];
  let number = 0;
  setResponse(({ method, params }) => {
    if (method === "thread/list") {
      if (params.archived) return { data: [archived], nextCursor: null };
      return params.cursor
        ? { data: records.slice(1), nextCursor: null }
        : { data: [root], nextCursor: "fork-page-2" };
    }
    if (method === "thread/fork") {
      const thread = {
        ...root,
        id: `fork-title-created-${++number}`,
        name: null,
        forkedFromId: params.threadId,
      };
      records.push(thread);
      return { thread };
    }
    if (method === "thread/name/set")
      records.find((thread) => thread.id === params.threadId).name =
        params.name;
    if (["thread/read", "thread/resume"].includes(method))
      return {
        thread: { ...records.find((thread) => thread.id === params.threadId) },
        cwd: root.cwd,
      };
    if (method === "lan/projectless/read") return { directories: {} };
    return { data: [], nextCursor: null };
  });
  try {
    app.set({
      connected: true,
      threads: [root],
      current: root,
      archived: false,
      search: "筛选结果",
      active: {},
      projects: [root.cwd],
    });
    const start = requests.length;
    await app.fork(root, "selected-turn");
    assert.equal(app.get().current.name, "训练进展 (10)");
    await app.fork();
    assert.equal(app.get().current.name, "训练进展 (11)");
    const sent = requests.slice(start);
    const forks = sent.filter((request) => request.method === "thread/fork");
    assert.equal(forks[0].params.lastTurnId, "selected-turn");
    assert.equal(forks[1].params.threadId, records[1].id);
    assert(
      sent.some(
        (request) =>
          request.method === "thread/list" &&
          request.params.cursor === "fork-page-2" &&
          !request.params.searchTerm,
      ),
    );
    await app.openThread(records[1].id);
    assert.equal(app.get().current.name, "训练进展 (10)");
    await app.rename(app.get().current, "手动标题 (2026)");
    await app.fork();
    assert.equal(app.get().current.name, "手动标题 (2026) (2)");
  } finally {
    app.newChat();
    app.set(original);
  }
}
