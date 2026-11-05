import { readConfig } from "../server/src/config.mjs";
import { createPersistentAdapter } from "../server/src/providers/adapter.mjs";

const config = readConfig();
const adapter = await createPersistentAdapter({
  codexHome: config.codexHome,
  port: config.adapterPort,
});
console.log(`Chat 模型转换服务已启动，监听回环端口 ${adapter.port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await adapter.close();
    process.exitCode = 0;
  });
