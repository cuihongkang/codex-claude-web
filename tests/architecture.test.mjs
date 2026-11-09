import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  inspectArchitecture,
  MAX_SOURCE_LINES,
} from "../scripts/architecture.mjs";

test("架构检查识别文件膨胀、逆向依赖、跨端耦合和循环，包括动态导入", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "claudex-web-architecture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function file(path, source) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), source);
  }
  await file("client/src/domain/a.js", "export const a = 1;\n");
  await file(
    "client/src/application/a.js",
    "import {a} from '../domain/a.js';\n",
  );
  assert.deepEqual((await inspectArchitecture(root)).errors, []);
  await file("client/src/domain/a.js", "import('../application/a.js');\n");
  await file(
    "client/src/features/a.js",
    "import '../../../server/src/a.mjs';\n",
  );
  await file("server/src/a.mjs", "export const a = 1;\n");
  await file("shared/a.mjs", "import 'node:fs';\n");
  await file("client/src/styles/a.css", "\n".repeat(MAX_SOURCE_LINES + 1));
  await file("client/src/styles/b.css", '@import "./missing.css";\n');
  await file("client/src/application/react.js", "import 'react';\n");
  await file("server/src/http/router.mjs", "export const router = {};\n");
  await file("server/src/bridge/a.mjs", "import '../http/router.mjs';\n");
  await file(
    "server/src/backends/codex/adapter.mjs",
    "export const adapter = {};\n",
  );
  await file(
    "server/src/backends/claude/adapter.mjs",
    "import '../codex/adapter.mjs';\n",
  );
  await file(
    "server/src/bridge/product.mjs",
    "import '../backends/claude/adapter.mjs';\n",
  );
  await file(
    "server/src/http/backend.mjs",
    "import '../backends/codex/adapter.mjs';\n",
  );
  const { errors } = await inspectArchitecture(root);
  assert(errors.some((error) => error.includes("超过 500 行")));
  assert(errors.some((error) => error.includes("domain 层")));
  assert(errors.some((error) => error.includes("通过 shared/")));
  assert(errors.some((error) => error.includes("禁止平台依赖")));
  assert(errors.some((error) => error.includes("循环依赖")));
  assert(errors.some((error) => error.includes("找不到依赖 ./missing.css")));
  assert(errors.some((error) => error.includes("核心逻辑通过参数和订阅")));
  assert(errors.some((error) => error.includes("桥接业务不能依赖 HTTP")));
  assert(errors.some((error) => error.includes("公共桥接规则通过参数")));
  assert(errors.some((error) => error.includes("原生适配器只能依赖所属后端")));
  assert(errors.some((error) => error.includes("HTTP 处理器通过参数")));
});
