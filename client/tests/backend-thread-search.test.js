import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("search retains failed backend rows, retries, and rejects late query results", async () => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const temporary = await mkdtemp(join(root, ".cache", "search-test-"));
  const requests = [];
  const old = {
    id: "backend:claude:old",
    name: "Matching Claude",
    createdAt: 1,
  };
  globalThis.__searchFixture = {
    state: { archived: false, threads: [old] },
    listThreads: (params, options) =>
      new Promise((resolve, reject) =>
        requests.push({ params, options, resolve, reject }),
      ),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  try {
    const output = join(temporary, "search.mjs");
    await build({
      entryPoints: [join(root, "client/src/app/thread-dialogs.jsx")],
      bundle: true,
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      platform: "node",
      format: "esm",
      outfile: output,
      external: ["react"],
      plugins: [
        {
          name: "search-state",
          setup(builder) {
            builder.onResolve({ filter: /\/store\.js$/ }, () => ({
              path: "state",
              namespace: "fixture",
            }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `export const useStore = () => globalThis.__searchFixture.state; export const listThreads = (...args) => globalThis.__searchFixture.listThreads(...args); export const set = () => {}; export const openThread = () => {}; export const rename = () => Promise.resolve(); export const deleteThread = () => Promise.resolve(); export const titleOf = (thread) => thread.name; export const report = (error) => { throw error; };`,
            }));
          },
        },
      ],
    });
    const { SearchDialog } = await import(pathToFileURL(output));
    await act(async () => {
      renderer = create(React.createElement(SearchDialog));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    const failure = { backendId: "claude", message: "disk unavailable" };
    await act(async () => {
      requests[0].options.onBackendErrors([failure]);
      requests[0].resolve([
        { id: "codex", name: "Matching Codex", createdAt: 2 },
      ]);
    });
    assert.match(JSON.stringify(renderer.toJSON()), /disk unavailable/);
    assert.match(JSON.stringify(renderer.toJSON()), /Matching Claude/);
    const retry = renderer.root
      .findAllByType("button")
      .find((button) => button.children.join("") === "重试");
    await act(async () => {
      retry.props.onClick();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    await act(async () => {
      requests[1].options.onBackendErrors([]);
      requests[1].resolve([old]);
    });
    assert.ok(!JSON.stringify(renderer.toJSON()).includes("disk unavailable"));
    const input = renderer.root.findByType("input");
    await act(async () => {
      input.props.onChange({ target: { value: "first" } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    await act(async () => {
      input.props.onChange({ target: { value: "second" } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    await act(async () => {
      requests[3].resolve([
        { id: "second", name: "Second result", createdAt: 3 },
      ]);
    });
    await act(async () => {
      requests[2].reject(new Error("obsolete first query"));
    });
    assert.match(JSON.stringify(renderer.toJSON()), /Second result/);
    assert.ok(
      !JSON.stringify(renderer.toJSON()).includes("obsolete first query"),
    );
    await act(async () => {
      renderer.unmount();
    });
    renderer = null;
  } finally {
    if (renderer)
      await act(async () => {
        renderer.unmount();
      });
    delete globalThis.__searchFixture;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    await rm(temporary, { recursive: true, force: true });
  }
});
