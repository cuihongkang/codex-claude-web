export function fixture() {
  if (!sessionStorage.getItem("commands-fixture-started")) localStorage.clear();
  sessionStorage.setItem("commands-fixture-started", "true");
  const thread = {
    id: "browser-command-fixture",
    cwd: "/fixture/project",
    name: "核对快捷命令",
    createdAt: 1,
    completedAt: 2,
  };
  const initial = [
    {
      id: "fixture-user",
      type: "userMessage",
      content: [{ type: "text", text: "检查项目并整理下一步工作。" }],
    },
    {
      id: "fixture-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "已读取项目结构。可以初始化项目指令、管理目标，或清理后台终端。",
    },
  ];
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  const requests = [],
    files = new Map([
      ["/fixture/project/AGENTS.md", "# 项目指南\n\n保留已有项目约定。"],
    ]);
  let goal = null,
    terminals = [
      {
        processId: "dev-server",
        osPid: 1234,
        cwd: thread.cwd,
        command: "npm run dev",
      },
    ];
  let fail = false,
    socket;
  let compaction = JSON.parse(
      sessionStorage.getItem("compact-fixture") || "null",
    ),
    compactRequest;
  let holdCompact = false,
    compactNumber = 0,
    legacy = sessionStorage.getItem("compact-legacy") === "true";
  const completedOnReload = sessionStorage.getItem("compact-on-reload");
  if (compaction && completedOnReload) {
    compaction = {
      ...compaction,
      status: completedOnReload,
      completedAt: Date.now() / 1000,
    };
    sessionStorage.setItem("compact-fixture", JSON.stringify(compaction));
  }
  sessionStorage.removeItem("compact-on-reload");
  const compactState = (entry) => {
    compaction = entry;
    sessionStorage.setItem("compact-fixture", JSON.stringify(entry));
    if (!legacy)
      socket.emit("lan/compaction", { threadId: thread.id, compaction: entry });
  };
  window.commandFixture = {
    requests,
    files,
    setFail(value) {
      fail = value;
    },
    holdCompact(value) {
      holdCompact = value;
    },
    useLegacy(value) {
      legacy = value;
      sessionStorage.setItem("compact-legacy", String(value));
    },
    compaction() {
      return compaction;
    },
    finishOnReload(status) {
      sessionStorage.setItem("compact-on-reload", status);
    },
    disconnect() {
      legacy = true;
      socket.readyState = 3;
      socket.onclose();
    },
    acknowledgeCompact() {
      socket.onmessage({
        data: JSON.stringify({ id: compactRequest.id, result: {} }),
      });
    },
    startCompact() {
      const turnId = "compact-browser-" + ++compactNumber;
      socket.emit("turn/started", {
        threadId: thread.id,
        turn: {
          id: turnId,
          status: "inProgress",
          startedAt: compaction.startedAt,
        },
      });
      compactState({ ...compaction, status: "running", turnId });
      socket.emit("item/started", {
        threadId: thread.id,
        turnId,
        item: {
          id: "compact-item-" + compactNumber,
          type: "contextCompaction",
        },
      });
    },
    finishCompact(status = "completed") {
      const { turnId } = compaction;
      if (status === "completed")
        socket.emit("item/completed", {
          threadId: thread.id,
          turnId,
          item: {
            id: "compact-item-" + compactNumber,
            type: "contextCompaction",
          },
        });
      const error = status === "failed" ? { message: "模拟整理失败" } : null;
      socket.emit("turn/completed", {
        threadId: thread.id,
        turn: { id: turnId, status, error, completedAt: Date.now() / 1000 },
      });
      compactState({
        ...compaction,
        status,
        error: error?.message,
        completedAt: Date.now() / 1000,
      });
      if (status === "completed")
        socket.emit("thread/tokenUsage/updated", {
          threadId: thread.id,
          tokenUsage: {
            last: { totalTokens: 2000 },
            modelContextWindow: 100000,
          },
        });
    },
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      socket = this;
      setTimeout(
        () =>
          this.emit("lan/state", {
            ready: true,
            defaultCwd: thread.cwd,
            activeTurns:
              compaction?.status === "running"
                ? { [thread.id]: compaction.turnId }
                : {},
            ...(!legacy && {
              compactions: compaction ? { [thread.id]: compaction } : {},
            }),
            questions: [],
          }),
        0,
      );
    }
    emit(method, params) {
      if (this.readyState !== 1) return;
      this.onmessage({ data: JSON.stringify({ method, params }) });
    }
    send(raw) {
      const request = JSON.parse(raw),
        { method, params } = request;
      requests.push(request);
      let result = {},
        error;
      if (method === "lan/compaction/check") {
        if (legacy) error = { code: -32601, message: "Unknown method" };
        else result = { compaction };
      }
      if (method === "model/list")
        result = {
          data: [
            {
              id: "fixture-model",
              model: "fixture-model",
              displayName: "测试模型",
              isDefault: true,
              serviceTiers: [{ id: "priority", name: "Fast" }],
              supportedReasoningEfforts: [
                { reasoningEffort: "high", description: "高" },
              ],
            },
          ],
        };
      if (method === "config/read")
        result = {
          config: {
            model: "fixture-model",
            model_reasoning_effort: "high",
          },
          layers: [],
        };
      if (method === "account/read")
        result = {
          account: { email: "fixture@example.test", planType: "测试账户" },
        };
      if (method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (["thread/read", "thread/resume", "thread/start"].includes(method))
        result = { thread };
      if (method === "thread/turns/list")
        result = {
          data: [
            ...(compaction?.turnId
              ? [
                  {
                    id: compaction.turnId,
                    status:
                      compaction.status === "running"
                        ? "inProgress"
                        : compaction.status,
                    startedAt: compaction.startedAt,
                    completedAt: compaction.completedAt,
                    items: [
                      { type: "contextCompaction", id: "compact-history" },
                    ],
                  },
                ]
              : []),
            {
              id: "history",
              status: "completed",
              startedAt: 1,
              completedAt: 2,
            },
          ],
          nextCursor: null,
        };
      if (method === "thread/items/list")
        result = {
          data: (params.cursor ? initial.slice(1) : initial.slice(0, 1)).map(
            (item) => ({ turnId: "history", item }),
          ),
          nextCursor: params.cursor ? null : "second-page",
        };
      if (method === "skills/list") result = { data: [] };
      if (method === "lan/projectless/read") result = { directories: {} };
      if (method === "fs/readDirectory")
        result = {
          entries: [...files.keys()]
            .filter((path) => path.startsWith(params.path + "/"))
            .map((path) => ({
              fileName: path.split("/").at(-1),
              isFile: true,
              isDirectory: false,
            })),
        };
      if (method === "fs/readFile")
        result = {
          dataBase64: btoa(
            unescape(encodeURIComponent(files.get(params.path) || "")),
          ),
        };
      if (method === "thread/goal/get") result = { goal };
      if (method === "thread/goal/set") {
        goal = {
          tokensUsed: 1200,
          timeUsedSeconds: 30,
          tokenBudget: null,
          ...goal,
          ...params,
        };
        result = { goal };
      }
      if (method === "thread/goal/clear") {
        goal = null;
        result = { cleared: true };
      }
      if (method === "thread/backgroundTerminals/list")
        result = { data: terminals, nextCursor: null };
      if (method === "thread/backgroundTerminals/clean") terminals = [];
      if (method === "thread/compact/start") {
        compactRequest = request;
        compactState({
          id: "request-" + request.id,
          status: "starting",
          startedAt: Date.now() / 1000,
        });
        if (holdCompact) return;
      }
      if (method === "turn/start") {
        if (fail) error = { message: "模拟提交失败，请重试。" };
        else {
          result = {
            turn: {
              id: "fixture-turn-" + requests.length,
              status: "completed",
            },
          };
          files.set(
            thread.cwd + "/AGENTS.md",
            "# 项目指南\n\n构建：npm run build\n\n验证：npm test\n",
          );
          setTimeout(() => {
            socket.emit("item/completed", {
              threadId: params.threadId,
              turnId: result.turn.id,
              item: {
                id: "command-answer-" + requests.length,
                type: "agentMessage",
                phase: "final_answer",
                text: "已生成 AGENTS.md，包含项目结构、构建命令和测试要求。",
              },
            });
            socket.emit("turn/completed", {
              threadId: params.threadId,
              turn: result.turn,
            });
          }, 30);
        }
      }
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              id: request.id,
              ...(error ? { error } : { result }),
            }),
          }),
        0,
      );
    }
  };
}
