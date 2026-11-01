import {
  prepareProjectlessDirectory,
  readProjectlessDirectories,
} from "../thread-projects.mjs";
import { readAgentMessages } from "../agent-messages.mjs";

// 不依赖后端连接的设置读取先执行，其余本地方法沿用后端就绪检查。
export function createLocalMethods({
  config,
  projectModels,
  call,
  checkCompaction,
  files,
  broadcast,
}) {
  const offline = new Map([
    [
      "lan/projectless/read",
      async () => ({
        directories: await readProjectlessDirectories(config.codexHome),
      }),
    ],
    [
      "lan/projectModels/read",
      async () => ({ projects: await projectModels.read() }),
    ],
    [
      "lan/projectModels/set",
      async (params) => {
        const projects = await projectModels.set(params);
        broadcast({
          method: "lan/projectModels/updated",
          params: { projects },
        });
        return { projects };
      },
    ],
  ]);
  const online = new Map([
    [
      "lan/agents/messages",
      ({ threadId }) => readAgentMessages(call, threadId),
    ],
    [
      "lan/compaction/check",
      async ({ threadId }) => ({ compaction: await checkCompaction(threadId) }),
    ],
    [
      "lan/projectless/prepare",
      async () => {
        try {
          return {
            cwd: await prepareProjectlessDirectory(config.projectlessRoot),
            root: config.projectlessRoot,
          };
        } catch (error) {
          throw new Error("创建对话工作目录失败：" + error.message);
        }
      },
    ],
    ["lan/files/undo", files.undo],
  ]);
  return { offline, online };
}
