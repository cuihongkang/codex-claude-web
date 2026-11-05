export function prepareToolSearch(input) {
  const tools = [...(input.tools || [])];
  const items = (Array.isArray(input.input) ? input.input : []).flatMap(
    (item) => {
      if (item.type === "tool_search_call")
        return [
          {
            ...item,
            type: "function_call",
            name: "tool_search",
            arguments: JSON.stringify(item.arguments),
          },
        ];
      if (item.type === "tool_search_output") {
        tools.push(...item.tools);
        return [
          {
            type: "function_call_output",
            call_id: item.call_id || item.id,
            output: JSON.stringify({
              tools: item.tools.map(({ type, name, description }) => ({
                type,
                name,
                description,
              })),
            }),
          },
        ];
      }
      return [item];
    },
  );
  const unique = new Map(
    tools.map((tool) => [tool.type + ":" + (tool.name || "tool_search"), tool]),
  );
  return {
    ...input,
    input: Array.isArray(input.input) ? items : input.input,
    tools: [...unique.values()].map((tool) =>
      tool.type === "tool_search"
        ? { ...tool, type: "function", name: "tool_search" }
        : tool,
    ),
  };
}

export function restoreToolSearch(item) {
  if (item?.type !== "function_call" || item.name !== "tool_search") return;
  item.type = "tool_search_call";
  item.execution = "client";
  item.arguments = JSON.parse(item.arguments);
  delete item.name;
  delete item.namespace;
}
