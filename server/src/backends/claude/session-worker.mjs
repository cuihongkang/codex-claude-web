import {
  enrichSessionMessages,
  readNativeGoalStatus,
} from "./native-records.mjs";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const { operation, args } = JSON.parse(input);
  if (
    ![
      "listSessions",
      "getSessionMessages",
      "forkSession",
      "renameSession",
      "deleteSession",
      "getSubagentMessages",
      "listSubagents",
      "getNativeGoalStatus",
    ].includes(operation)
  )
    throw new Error("未知会话操作");
  let result =
    operation === "getNativeGoalStatus"
      ? await readNativeGoalStatus(...args)
      : await sdk[operation](...args);
  if (["getSessionMessages", "getSubagentMessages"].includes(operation))
    result = await enrichSessionMessages(operation, args, result);
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message }));
}
