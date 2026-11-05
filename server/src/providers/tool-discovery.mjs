export const discoveryName = "codex_find_tools";

export function createToolDiscovery(input) {
  const tools = input.tools || [];
  const deferred = tools.filter((tool) =>
    tool.function?.name.includes("mcp__"),
  );
  if (
    !deferred.length ||
    tools.some((tool) => tool.function?.name === "tool_search")
  )
    return null;
  const selected = new Set();
  for (const message of input.messages)
    for (const call of message.tool_calls || [])
      selected.add(call.function?.name);
  if (input.tool_choice?.function?.name)
    selected.add(input.tool_choice.function.name);
  const search = {
    type: "function",
    function: {
      name: discoveryName,
      description:
        "Find optional external tools by task keywords before using them. Returns matching tool names and makes their full schemas available. Search again with different keywords when no match is found.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  };
  const messages = [...input.messages];
  return {
    request() {
      return {
        ...input,
        messages,
        parallel_tool_calls: false,
        tools: [
          ...tools.filter(
            (tool) =>
              !deferred.includes(tool) || selected.has(tool.function.name),
          ),
          search,
        ],
      };
    },
    complete(message) {
      const calls = message.tool_calls || [];
      const searches = calls.filter(
        (call) => call.function.name === discoveryName,
      );
      const actual = calls.filter(
        (call) => call.function.name !== discoveryName,
      );
      if (!searches.length || actual.length)
        return { done: true, calls: actual };
      messages.push(message);
      for (const call of searches) {
        let matches = [];
        try {
          const args = JSON.parse(call.function.arguments);
          const query = String(args.query || "").toLowerCase();
          const words =
            query.match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 1) ||
            [];
          matches = deferred
            .map((tool) => {
              const name = tool.function.name.toLowerCase();
              const text = (tool.function.description || "").toLowerCase();
              return {
                tool,
                score: words.reduce(
                  (sum, word) =>
                    sum +
                    (name.includes(word) ? 4 : 0) +
                    (text.includes(word) ? 1 : 0),
                  0,
                ),
              };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(1, Math.min(8, Number(args.limit) || 5)))
            .map(({ tool }) => tool);
        } catch {}
        for (const tool of matches) selected.add(tool.function.name);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            tools: matches.map(({ function: tool }) => ({
              name: tool.name,
              description: tool.description?.slice(0, 240),
            })),
            ...(matches.length
              ? {}
              : {
                  message:
                    "No matching tools. Search with different task keywords.",
                }),
          }),
        });
      }
      return { done: false };
    },
  };
}
