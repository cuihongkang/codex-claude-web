import { createServer } from "node:http";
import { once } from "node:events";

export async function chatProvider() {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push({ headers: request.headers, input });
    const content =
      JSON.stringify(input).match(/NATIVE-[a-z0-9]+/i)?.[0] || "323";
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const delta of [
      { reasoning_content: "Checking the result." },
      { content },
    ])
      response.write(
        "data: " +
          JSON.stringify({ id: "chat", choices: [{ index: 0, delta }] }) +
          "\n\n",
      );
    response.end(
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
