import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = root + ".cache/component-tests";
await mkdir(cache, { recursive: true });
try {
  await build({
    entryPoints: [root + "tests/components/entry.jsx"],
    banner: {
      js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);",
    },
    bundle: true,
    define: {
      __CODEX_WEB_BUILD__: JSON.stringify({
        version: "1.2.3",
        displayVersion: "1.2.3+dev.gabc1234.dirty",
        revision: "abc123456789",
        dirty: true,
        channel: "development",
        builtAt: "2026-10-26T00:00:00Z",
      }),
    },
    platform: "node",
    format: "esm",
    outfile: cache + "/client.mjs",
    external: ["react", "react-dom/client"],
    loader: { ".css": "empty", ".svg": "dataurl" },
    plugins: [
      {
        name: "editor-fixture",
        setup(builder) {
          builder.onResolve(
            { filter: /(?:^|\/)markdown-editor(?:\.jsx)?$/ },
            () => ({ path: "markdown-editor", namespace: "editor-fixture" }),
          );
          builder.onLoad(
            { filter: /^markdown-editor$/, namespace: "editor-fixture" },
            () => ({
              contents: `import React from 'react'; export function MarkdownEditor({inputRef,theme,expanded,activeId,...props}) {return React.createElement('textarea', {...props, 'aria-label': props['aria-label'] || '消息', 'aria-expanded': expanded, 'aria-activedescendant': activeId, ref: inputRef})}`,
            }),
          );
          builder.onResolve(
            { filter: /(?:^|\/)code-editor(?:\.jsx)?$/ },
            () => ({
              path: "code-editor",
              namespace: "editor-fixture",
            }),
          );
          builder.onLoad(
            { filter: /^code-editor$/, namespace: "editor-fixture" },
            () => ({
              contents: `import React from 'react'; export function CodeEditor({path,text,onChange,diff,patches}) {return React.createElement('textarea', {'aria-label': '文件源码', 'data-change-diff': diff, 'data-change-patches': patches, value: text, onChange: e => onChange(e.target.value)})}`,
            }),
          );
        },
      },
      {
        name: "portal-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^react-dom$/ }, () => ({
            path: "react-dom",
            namespace: "portal-fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "portal-fixture" }, () => ({
            contents: "export const createPortal = (children) => children;",
          }));
        },
      },
      {
        name: "mermaid-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^mermaid$/ }, () => ({
            path: "mermaid",
            namespace: "mermaid-fixture",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "mermaid-fixture" },
            () => ({
              contents: `let config; export default {initialize(options){config=options}, render(id, source){return new Promise((resolve,reject)=>globalThis.testMermaidCalls.push({id,source,config,resolve,reject}))}}`,
            }),
          );
        },
      },
      {
        name: "terminal-fixture",
        setup(builder) {
          builder.onResolve(
            { filter: /^@xterm\/(xterm|addon-fit)$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: args.path.endsWith("/xterm")
              ? `export class Terminal {constructor(options){this.options=options;this.cols=80;this.rows=24;globalThis.testTerminals.push(this)} loadAddon(){} open(){} write(){} reset(){} dispose(){} onData(fn){this.input=fn}}`
              : `export class FitAddon {fit(){}}`,
          }));
        },
      },
    ],
  });
  const result = spawnSync(
    process.execPath,
    [root + "tests/components/client.mjs"],
    {
      stdio: "inherit",
      env: { ...process.env, CODEX_COMPONENT_BUNDLE: cache + "/client.mjs" },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(cache, { recursive: true, force: true });
}
