import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";

test("latest failed turn restores its retry action after earlier successful turns", async () => {
  const temporary = await mkdtemp(join(process.cwd(), ".cache", "error-test-"));
  const patches = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.__executionErrorState = {
    current: { id: "thread" },
    turns: {
      thread: [
        {
          id: "failed",
          status: "failed",
          error: { message: "供应商请求失败" },
        },
        { id: "success", status: "completed" },
      ],
    },
    compactions: {},
    active: {},
    error: "",
    connected: true,
    items: [{ id: "input", turnId: "failed", type: "userMessage" }],
  };
  globalThis.__executionErrorSet = (patch) => patches.push(patch);
  let renderer;
  try {
    const output = join(temporary, "error.mjs");
    await build({
      entryPoints: ["client/src/features/conversation/execution-error.jsx"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: output,
      external: ["react"],
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      plugins: [
        {
          name: "error-state",
          setup(builder) {
            builder.onResolve({ filter: /\/store\.js$/ }, () => ({
              path: "state",
              namespace: "fixture",
            }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents:
                "export const useStore = () => globalThis.__executionErrorState; export const set = (patch) => globalThis.__executionErrorSet(patch);",
            }));
          },
        },
      ],
    });
    const { ExecutionError } = await import(pathToFileURL(output));
    await act(async () => {
      renderer = create(React.createElement(ExecutionError));
    });
    assert.match(JSON.stringify(renderer.toJSON()), /供应商请求失败/);
    const retry = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("编辑并重试"));
    assert.ok(retry);
    await act(async () => retry.props.onClick());
    assert.equal(patches[0].messageEditRequest.itemId, "input");
    await act(async () =>
      renderer.root.findByProps({ title: "关闭错误提示" }).props.onClick(),
    );
    assert.equal(renderer.toJSON(), null);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globalThis.__executionErrorState;
    delete globalThis.__executionErrorSet;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    await rm(temporary, { recursive: true, force: true });
  }
});
