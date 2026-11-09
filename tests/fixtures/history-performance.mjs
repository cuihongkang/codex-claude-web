// 隔离的长历史与网络往返，用于比较首屏、完整恢复和读取期间切换。
export function historyPerformanceFixture() {
  localStorage.clear();
  localStorage.setItem("cx-projects", JSON.stringify(["/demo/history"]));
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  const threads = ["short", "long"].map((id) => ({
    id,
    name: id === "long" ? "超长对话性能验证" : "简短对话",
    cwd: "/demo/history",
    createdAt: 1,
    updatedAt: 1,
  }));
  const turns = Array.from({ length: 15 }, (_, index) => ({
    id: `turn-${index}`,
    status: "completed",
    startedAt: index + 2,
    completedAt: index + 3,
  }));
  const entries = turns.flatMap((turn, index) =>
    [
      {
        id: `user-${index}`,
        type: "userMessage",
        content: [
          { type: "text", text: `第 ${index + 1} 轮：检查历史与切换体验` },
        ],
      },
      ...Array.from({ length: 212 }, (_, i) => ({
        id: `command-${index}-${i}`,
        type: "commandExecution",
        command: "npm test",
        status: "completed",
        aggregatedOutput: "隔离的工具输出，用来模拟超长对话的数据规模。".repeat(
          50,
        ),
      })),
      {
        id: `answer-${index}`,
        type: "agentMessage",
        phase: "final_answer",
        text:
          `第 ${index + 1} 轮回答\n\n` +
          "保留 **完整历史**、输入草稿与连续翻阅。\n\n".repeat(20) +
          "```js\nconst value = 42;\n```\n\n\\(x_i^2 + y_i^2\\)",
      },
    ].map((item) => ({ turnId: turn.id, item })),
  );
  const data = (window.historyFixture = {
    requests: [],
    hold: false,
    pending: [],
    firstPaint: null,
    richTextRenders: 0,
    longTasks: [],
    release() {
      this.hold = false;
      this.pending.splice(0).forEach((respond) => respond());
    },
  });
  new PerformanceObserver((list) => {
    data.longTasks.push(...list.getEntries().map((entry) => entry.duration));
  }).observe({ type: "longtask" });
  new MutationObserver(() => {
    if (
      data.started &&
      !data.firstPaint &&
      [...document.querySelectorAll(".assistant-message")]
        .at(-1)
        ?.textContent.includes("第 15 轮回答")
    ) {
      requestAnimationFrame(() => {
        data.firstPaint ??= performance.now() - data.started;
      });
    }
  }).observe(document, { subtree: true, childList: true });
  const rendered = new WeakSet();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject: () => 1,
    onCommitFiberRoot(id, root) {
      function visit(fiber) {
        if (
          fiber.memoizedProps?.className === "markdown" &&
          !rendered.has(fiber.memoizedProps)
        ) {
          rendered.add(fiber.memoizedProps);
          data.richTextRenders++;
        }
        if (fiber.child) visit(fiber.child);
        if (fiber.sibling) visit(fiber.sibling);
      }
      visit(root.current);
    },
    onCommitFiberUnmount() {},
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      data.socket = this;
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              method: "lan/state",
              params: {
                ready: true,
                defaultCwd: threads[0].cwd,
                activeTurns: {},
                questions: [],
              },
            }),
          }),
        0,
      );
    }
    send(raw) {
      const request = JSON.parse(raw);
      data.requests.push(request);
      const { method, params } = request;
      const long = params.threadId === "long";
      let result = { data: [] };
      if (method === "thread/list")
        result = { data: threads, nextCursor: null };
      if (["thread/read", "thread/resume"].includes(method))
        result = { thread: threads[Number(long)] };
      if (method === "thread/turns/list") {
        const offset = Number(params.cursor || 0);
        const records = long ? turns.toReversed() : [];
        result = {
          data: records.slice(offset, offset + params.limit).map((turn) =>
            params.itemsView === "full"
              ? {
                  ...turn,
                  items: entries
                    .filter((entry) => entry.turnId === turn.id)
                    .map((entry) => entry.item),
                }
              : turn,
          ),
          nextCursor:
            offset + params.limit < records.length
              ? String(offset + params.limit)
              : null,
        };
      }
      if (method === "thread/items/list") {
        const offset = Number(params.cursor || 0);
        const records = long ? entries.toReversed() : [];
        result = {
          data: records.slice(offset, offset + params.limit),
          nextCursor:
            offset + params.limit < records.length
              ? String(offset + params.limit)
              : null,
        };
      }
      if (method === "config/read") result = { config: {} };
      if (method === "lan/projectless/read") result = { directories: {} };
      const respond = () =>
        this.onmessage({ data: JSON.stringify({ id: request.id, result }) });
      if (
        data.hold &&
        ((method === "thread/items/list" && params.cursor) ||
          (method === "thread/turns/list" && params.itemsView === "full"))
      )
        data.pending.push(respond);
      else
        setTimeout(
          respond,
          long &&
            (method === "thread/items/list" ||
              (method === "thread/turns/list" && params.itemsView === "full"))
            ? 50
            : 0,
        );
    }
  };
}
