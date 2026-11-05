export function completionFixture() {
  const threads = [
    { id: "alpha", name: "构建检查", cwd: "/demo/project", createdAt: 1 },
    { id: "beta", name: "界面核对", cwd: "/demo/project", createdAt: 2 },
  ];
  const turns = JSON.parse(localStorage.getItem("fixture-turns") || "{}");
  const active = JSON.parse(localStorage.getItem("fixture-active") || "{}");
  const fixture = (window.completionFixture = {
    threads,
    turns,
    active,
    emit(method, params) {
      fixture.socket.onmessage({ data: JSON.stringify({ method, params }) });
    },
    snapshot() {
      fixture.emit("lan/state", {
        ready: true,
        defaultCwd: "/demo/project",
        activeTurns: { ...active },
        questions: [],
        terminals: {},
      });
    },
    start(threadId, id) {
      active[threadId] = id;
      turns[threadId] = [{ id, status: "inProgress", startedAt: 10 }];
      localStorage.setItem("fixture-active", JSON.stringify(active));
      localStorage.setItem("fixture-turns", JSON.stringify(turns));
      fixture.emit("turn/started", { threadId, turn: turns[threadId][0] });
    },
    finish(threadId, id, status = "completed") {
      delete active[threadId];
      turns[threadId] = [{ id, status, startedAt: 10, completedAt: 20 }];
      localStorage.setItem("fixture-active", JSON.stringify(active));
      localStorage.setItem("fixture-turns", JSON.stringify(turns));
      fixture.emit("turn/completed", { threadId, turn: turns[threadId][0] });
    },
  });
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      fixture.socket = this;
      setTimeout(() => fixture.snapshot(), 0);
    }
    close() {
      this.readyState = 3;
    }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      let result = { data: [] };
      if (method === "thread/list") result = { data: threads };
      if (method === "config/read") result = { config: {} };
      if (method === "account/read") result = { account: null };
      if (method === "lan/projectless/read") result = { directories: {} };
      if (["thread/read", "thread/resume"].includes(method))
        result = { thread: threads.find((t) => t.id === params.threadId) };
      if (method === "thread/turns/list")
        result = { data: turns[params.threadId] || [] };
      if (method === "thread/items/list") result = { data: [] };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id, result }) }),
        0,
      );
    }
  };
}
