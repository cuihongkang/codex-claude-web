import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsers } from "prettier/plugins/babel";

const sourceRoots = ["client/src", "server/src", "shared", "scripts", "bin"];
const sourceExtension = /\.(?:js|jsx|mjs|css)$/;
export const MAX_SOURCE_LINES = 500;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return (
    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => {
          const path = join(directory, entry.name);
          return entry.isDirectory()
            ? sourceFiles(path)
            : sourceExtension.test(path)
              ? [path]
              : [];
        }),
    )
  ).flat();
}

function importSources(source, path) {
  if (path.endsWith(".css"))
    return [...source.matchAll(/@import\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
  const imports = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
      ].includes(node.type) &&
      typeof node.source?.value === "string"
    )
      imports.push(node.source.value);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "extra", "comments", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(parsers.babel.parse(source));
  return imports;
}

async function resolveImport(path, specifier) {
  const base = resolve(dirname(path), specifier.split("?")[0]);
  for (const candidate of [base, base + ".js", base + ".jsx", base + ".mjs"]) {
    if (
      await stat(candidate).then(
        (entry) => entry.isFile(),
        () => false,
      )
    )
      return candidate;
  }
  return null;
}

function boundaryError(from, to) {
  const inClient = from.startsWith("client/src/");
  if (inClient && to.startsWith("server/"))
    return "浏览器代码只能通过 shared/ 复用跨端逻辑";
  if (from.startsWith("server/src/") && to.startsWith("client/src/"))
    return "服务端不能依赖浏览器实现";
  if (from.startsWith("shared/") && !to.startsWith("shared/"))
    return "共享模块只能依赖共享模块";
  for (const [layer, allowed] of [
    ["domain", ["domain"]],
    ["infrastructure", ["domain", "infrastructure"]],
    ["application", ["domain", "infrastructure", "application"]],
    ["ui", ["domain", "ui"]],
  ]) {
    if (
      from.startsWith(`client/src/${layer}/`) &&
      !to.startsWith("shared/") &&
      !allowed.some((name) => to.startsWith(`client/src/${name}/`))
    )
      return `${layer} 层的依赖方向违反架构约定`;
  }
  if (
    from.startsWith("server/src/http/") &&
    (to.startsWith("server/src/bridge/") ||
      to === "server/src/application.mjs" ||
      to === "server/src/server.mjs")
  )
    return "HTTP 处理器通过参数取得运行状态";
  if (
    from.startsWith("server/src/bridge/") &&
    (to.startsWith("server/src/http/") ||
      to === "server/src/application.mjs" ||
      to === "server/src/server.mjs")
  )
    return "桥接业务不能依赖 HTTP 或进程入口";
  return null;
}

export async function inspectArchitecture(root) {
  const files = (
    await Promise.all(
      sourceRoots.map((directory) => sourceFiles(join(root, directory))),
    )
  )
    .flat()
    .sort();
  const errors = [];
  const sizes = [];
  const graph = new Map();
  for (const path of files) {
    const name = relative(root, path);
    const source = await readFile(path, "utf8");
    const lines = source.split("\n").length - Number(source.endsWith("\n"));
    sizes.push({ path: name, lines });
    if (lines > MAX_SOURCE_LINES)
      errors.push(
        `${name}: ${lines} 行，超过 ${MAX_SOURCE_LINES} 行；请按职责拆分`,
      );
    const dependencies = [];
    for (const specifier of importSources(source, path)) {
      if (!specifier.startsWith(".")) {
        if (
          name.startsWith("shared/") ||
          (name.startsWith("client/src/") && specifier.startsWith("node:"))
        )
          errors.push(`${name}: 禁止平台依赖 ${specifier}`);
        if (
          /^client\/src\/(?:domain|application|infrastructure)\//.test(name) &&
          /^(?:react|react-dom)(?:\/|$)/.test(specifier)
        )
          errors.push(`${name}: 核心逻辑通过参数和订阅与 React 协作`);
        continue;
      }
      const target = await resolveImport(path, specifier);
      if (!target) {
        errors.push(`${name}: 找不到依赖 ${specifier}`);
        continue;
      }
      const dependency = relative(root, target);
      const violation = boundaryError(name, dependency);
      if (violation) errors.push(`${name} → ${dependency}: ${violation}`);
      dependencies.push(dependency);
    }
    graph.set(name, dependencies);
  }
  const visited = new Set(),
    visiting = new Set(),
    stack = [];
  function visit(path) {
    if (visiting.has(path)) {
      errors.push(
        `循环依赖: ${[...stack.slice(stack.indexOf(path)), path].join(" → ")}`,
      );
      return;
    }
    if (visited.has(path)) return;
    visiting.add(path);
    stack.push(path);
    for (const next of graph.get(path) || []) visit(next);
    stack.pop();
    visiting.delete(path);
    visited.add(path);
  }
  for (const path of graph.keys()) visit(path);
  return {
    errors,
    sizes: sizes.sort((a, b) => b.lines - a.lines),
    files: files.length,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await inspectArchitecture(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `架构检查通过：${result.files} 个源码文件，最大 ${result.sizes[0].lines} 行，依赖方向正确且无循环。`,
    );
}
