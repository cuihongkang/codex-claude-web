import { historyTurns } from "./messages.mjs";

export async function recoverAgents(parent, records, readSession) {
  const nativeId = parent.nativeSessionId || parent.id;
  const ids = await readSession("listSubagents", nativeId, {
    dir: parent.historySearchAll ? undefined : parent.cwd,
  });
  const agents = { ...parent.agents };
  for (const agentId of ids) {
    const id = `agent/${parent.id}/${agentId}`;
    const messages = await readSession(
      "getSubagentMessages",
      nativeId,
      agentId,
      { dir: parent.historySearchAll ? undefined : parent.cwd },
    );
    if (!messages.length) continue;
    const toolId = messages[0].parent_tool_use_id;
    const turn = records.find((record) =>
      record.items.some((item) => item.id === toolId),
    );
    const tool = turn?.items.find((item) => item.id === toolId);
    const input = tool?.arguments || {};
    const previous = agents[id] || {};
    agents[id] = {
      ...previous,
      agentId,
      parentNativeId: nativeId,
      name:
        previous.name ||
        input.name ||
        input.subagent_type ||
        input.description ||
        "子代理",
      prompt: previous.prompt || previous.initialTask || input.prompt,
      toolUseId: toolId,
    };
    const activity = turn?.items.find((item) => item.agentThreadId === id);
    if (activity) {
      activity.prompt = agents[id].prompt;
      activity.agentPath = agents[id].name;
    }
    if (turn && !activity) {
      turn.items.push({
        id: `agent-${agentId}`,
        turnId: turn.id,
        type: "subAgentActivity",
        kind:
          messages.at(-1)?.message?.stop_reason === "end_turn"
            ? "completed"
            : parent.running
              ? "started"
              : "interrupted",
        agentThreadId: id,
        agentPath: agents[id].name,
        prompt: agents[id].prompt,
      });
    }
  }
  return agents;
}

export function agentTurns(messages) {
  return historyTurns(messages).map((turn) => ({
    ...turn,
    items: turn.items.map((item) =>
      item.type === "userMessage" ? { ...item, authorLabel: "主代理" } : item,
    ),
  }));
}
