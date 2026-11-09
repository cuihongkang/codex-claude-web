import { createProjectModels } from "../project-models.mjs";
import { createFileOperations } from "./file-operations.mjs";
import { prepareProjectlessDirectory } from "../thread-projects.mjs";

// 网页操作在所属后端的执行边界内组合；运行状态与原生历史由调用方提供。
export function createProductMethods({
  config,
  projectModelsDirectory,
  legacyProjectModelsDirectory,
  call,
  activeTurns,
  activeThreads,
  checkCompaction,
  readAgentMessages,
  broadcast,
}) {
  const projectModels = createProjectModels(
    projectModelsDirectory,
    legacyProjectModelsDirectory,
  );
  const files = createFileOperations({
    call,
    activeTurns,
    activeThreads,
    broadcast,
  });
  const offline = new Map([
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
    ["lan/agents/messages", ({ threadId }) => readAgentMessages(threadId)],
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
  return { offline, online, files };
}
