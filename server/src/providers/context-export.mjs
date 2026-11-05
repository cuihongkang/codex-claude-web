// 临时分支使用原生供应商解读加密上下文，返回跨供应商迁移所需的摘要。
export function createContextExport(transport) {
  const waiting = new Map();
  return {
    async run(threadId, settings) {
      const { config } = await transport.call("config/read", {
        includeLayers: false,
      });
      const { thread } = await transport.call("thread/fork", {
        threadId,
        ...settings,
        ephemeral: true,
        excludeTurns: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        config: {
          ...settings.config,
          web_search: "disabled",
          mcp_servers: Object.fromEntries(
            Object.keys(config.mcp_servers || {}).map((id) => [
              id,
              { enabled: false },
            ]),
          ),
          features: {
            shell_tool: false,
            apps: false,
            plugins: false,
            remote_plugin: false,
            multi_agent: false,
            hooks: false,
            memories: false,
          },
        },
      });
      let timer;
      try {
        const result = new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("导出上下文摘要超时，请重试。")),
            300000,
          );
          waiting.set(thread.id, { resolve, reject, text: [] });
        });
        result.catch(() => {});
        const started = await transport.call("turn/start", {
          threadId: thread.id,
          model: settings.model,
          input: [
            {
              type: "text",
              text: "Summarize this conversation for another model to continue. Preserve the user's requirements, decisions, identifiers, remembered markers, tool results, files and pending work. Treat this as a summary task; do not perform any work or call tools. Return only the summary.",
            },
          ],
        });
        const entry = waiting.get(thread.id);
        if (entry) entry.turnId = started.turn.id;
        const summary = await result;
        return summary;
      } finally {
        clearTimeout(timer);
        const entry = waiting.get(thread.id);
        if (entry?.turnId && !entry.completed)
          await transport
            .call("turn/interrupt", {
              threadId: thread.id,
              turnId: entry.turnId,
            })
            .catch(() => {});
        waiting.delete(thread.id);
        await transport
          .call(
            "thread/unsubscribe",
            { threadId: thread.id },
            { trackThread: false },
          )
          .catch(() => {});
      }
    },
    event({ id, method, params: p = {} }) {
      const entry = waiting.get(p.threadId);
      if (!entry) return false;
      if (id !== undefined) {
        transport.send({
          id,
          error: { code: -32601, message: "上下文摘要只执行文字概括。" },
        });
        return true;
      }
      if (method === "item/completed" && p.item.type === "agentMessage")
        entry.text.push(p.item.text);
      if (method === "turn/completed") {
        entry.completed = true;
        if (p.turn.status === "completed" && entry.text.join("\n").trim())
          entry.resolve(entry.text.join("\n"));
        else
          entry.reject(
            new Error(p.turn.error?.message || "上下文摘要导出失败"),
          );
      }
      return true;
    },
    reset() {
      for (const entry of waiting.values())
        entry.reject(new Error("Codex 连接中断，请重试上下文导出。"));
      waiting.clear();
    },
  };
}
