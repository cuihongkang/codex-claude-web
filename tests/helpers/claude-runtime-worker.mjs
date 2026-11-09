import { createClaudeWorkerAdapter } from "../../server/src/backends/claude/worker-client.mjs";

process.once("message", async ({ backend, config, cwd }) => {
  const adapter = createClaudeWorkerAdapter({
    backend,
    config,
    broadcast: (event) => process.send?.(event),
    send: (client, message) => client.deliver(message),
  });
  let sequence = 0;
  const call = (method, params) =>
    new Promise((resolve, reject) =>
      adapter.receive(
        {
          deliver(message) {
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
          },
        },
        { id: ++sequence, method, params },
      ),
    );
  await adapter.connect();
  const { thread } = await call("thread/start", {
    cwd,
    providerId: "fixture",
    model: "fixture-model",
  });
  process.send?.({
    control: "connected",
    pid: adapter.workerPid,
    threadId: thread.id,
  });
  await call("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "启动桥接重启验证用后台终端" }],
  });
});
