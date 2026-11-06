import { createBackendConfiguration } from "../../server/src/backends/configuration.mjs";
import { createClaudeWorkerAdapter } from "../../server/src/backends/claude/worker-client.mjs";

export async function shutdownBrowserClaudeWorker(config, unblock = []) {
  for (const operation of unblock) await operation();
  const backend = (
    await createBackendConfiguration(config).read()
  ).backends.find((entry) => entry.id === "claude");
  const client = createClaudeWorkerAdapter({
    backend,
    config,
    send() {},
    broadcast() {},
  });
  try {
    await client.connect();
    const deadline = Date.now() + 30000;
    const busy = () => {
      const p = client.state().params;
      return (
        Object.keys(p.activeTurns || {}).length ||
        Object.keys(p.queuedInputs || {}).length ||
        Object.keys(p.backgroundTasks || {}).length ||
        p.internalCommands?.length ||
        p.questions?.length ||
        Object.values(p.compactions || {}).some((entry) =>
          ["starting", "running", "reconnecting"].includes(entry.status),
        )
      );
    };
    while (busy()) {
      if (Date.now() >= deadline)
        throw new Error(
          "隔离浏览器验证的Claude任务尚未结束，保留原生记录供排查",
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const pid = client.workerPid;
    await client.shutdown();
    while (pid) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") break;
        throw error;
      }
      if (Date.now() >= deadline)
        throw new Error("隔离浏览器验证的Claude worker尚未退出");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    client.close();
  }
}
