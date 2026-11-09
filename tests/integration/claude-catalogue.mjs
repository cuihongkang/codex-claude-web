import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClaudeCatalogue } from "../../server/src/backends/claude/catalogue.mjs";

const executable = process.env.CLAUDE_EXECUTABLE || "claude";
const root = await mkdtemp(join(tmpdir(), "claude-catalogue-"));
const cwd = join(root, "workspace"),
  dataDir = join(root, "config"),
  plugin = join(root, "plugin");
await Promise.all([
  mkdir(cwd),
  mkdir(join(dataDir, "plugins"), { recursive: true }),
  mkdir(join(plugin, ".claude-plugin"), { recursive: true }),
]);
await writeFile(
  join(plugin, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "fixture", version: "1.0.0" }),
);
await writeFile(
  join(dataDir, "plugins", "installed_plugins.json"),
  JSON.stringify({
    version: 2,
    plugins: {
      "fixture@isolated": [
        {
          scope: "user",
          installPath: plugin,
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
      ],
    },
  }),
);
await writeFile(
  join(dataDir, "settings.json"),
  JSON.stringify({ enabledPlugins: { "fixture@isolated": true } }),
);
const mcp = join(root, "mcp.mjs");
await writeFile(
  mcp,
  `import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);if(!('id' in request))return;
  const result=request.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'isolated-mcp',version:'1'}}:request.method==='tools/list'?{tools:[{name:'read_fixture',description:'Actual test tool',inputSchema:{type:'object',properties:{}}}]}:{};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`,
);
await promisify(execFile)(
  executable,
  ["mcp", "add", "--scope", "user", "isolated", process.execPath, mcp],
  { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: dataDir } },
);
const catalogue = createClaudeCatalogue({
  backend: { id: "claude", executable, dataDir },
  providers: {
    get: async () => ({
      id: "catalogue-fixture",
      protocol: "anthropic",
      models: ["fixture-model"],
      baseUrl: "http://127.0.0.1:1",
      apiKey: "fixture-token",
    }),
  },
});
try {
  let result = await catalogue.read({ cwd });
  const deadline = Date.now() + 15000;
  while (
    result.mcp.some((server) => server.status === "pending") &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = await catalogue.read({ cwd });
  }
  assert(result.models.length > 0);
  assert(result.commands.length > 0);
  assert(result.agents.length > 0);
  assert.equal(
    result.plugins.find((p) => p.id === "fixture@isolated").enabled,
    true,
  );
  const server = result.mcp.find((server) => server.name === "isolated");
  assert.equal(server.status, "connected", JSON.stringify(server));
  assert.equal(
    server.tools.read_fixture.name,
    "read_fixture",
    JSON.stringify(server),
  );
  console.log(
    JSON.stringify({
      models: result.models.length,
      commands: result.commands.length,
      agents: result.agents.length,
      plugin: result.plugins[0].id,
      mcp: server.status,
      tools: Object.keys(server.tools),
    }),
  );
} finally {
  catalogue.close();
  await rm(root, { recursive: true, force: true });
}
