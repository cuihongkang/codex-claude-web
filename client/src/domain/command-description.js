import { operationDescription } from "./commands/operations.js";

// 只识别含义明确的 shell 语法；原始命令始终由活动详情保留。
function tokenize(command) {
  const tokens = [];
  let value = "",
    start = -1,
    quote = "",
    dynamic = false;
  const flush = (end) => {
    if (start < 0) return;
    tokens.push({ value, start, end, dynamic });
    value = "";
    start = -1;
    dynamic = false;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") quote = "";
      else value += char;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      const next = command[++i];
      if (next === undefined) return null;
      if (next === "\n") continue;
      if (start < 0) start = i - 1;
      if (quote && !'$`"\\'.includes(next)) value += "\\";
      value += next;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = "";
      else {
        if (char === "`" || (char === "$" && command[i + 1] === "("))
          return null;
        if (char === "$") dynamic = true;
        value += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      if (start < 0) start = i;
      quote = char;
    } else if (char === "#" && start < 0) {
      while (i < command.length && command[i] !== "\n") i++;
      i--;
    } else if (char === "\n" || ";|&".includes(char)) {
      flush(i);
      if (char === "\n" && (!tokens.length || tokens.at(-1).operator)) continue;
      let operator = char === "\n" ? ";" : char;
      if (char === command[i + 1] && "|&".includes(char))
        operator += command[++i];
      if (operator === "&" || (operator === ";" && command[i + 1] === ";"))
        return null;
      tokens.push({ operator });
    } else if (/\s/.test(char)) {
      flush(i);
    } else {
      // 重定向、子 shell、命令替换及分组交回原文，避免掩盖写入或执行行为。
      if ("<>(){}`".includes(char)) return null;
      if (start < 0) start = i;
      if (char === "$") dynamic = true;
      value += char;
    }
  }
  if (quote) return null;
  flush(command.length);
  return tokens;
}

function filename(path) {
  return path.split("/").filter(Boolean).at(-1) || path;
}

function skillLabel(path) {
  if (filename(path) !== "SKILL.md") return null;
  const parent = path.split("/").filter(Boolean).at(-2);
  const name = parent && parent !== "." && parent !== ".." ? parent : "";
  return `技能${name ? " " + name : ""}`;
}

function readFiles(files, verb = "读取", range = "") {
  return files
    .map((path) => {
      const skill = skillLabel(path);
      if (skill) {
        return `阅读${skill}${range ? (skill === "技能" ? "" : " ") + range : ""}`;
      }
      return `${verb} ${path}${range ? " " + range : ""}`;
    })
    .join("；");
}

function fileArguments(args, flags) {
  const files = [];
  let literal = false;
  for (const arg of args) {
    if (!literal && arg === "--") literal = true;
    else if (!literal && arg.startsWith("-")) {
      if (!flags.test(arg)) return null;
    } else files.push(arg);
  }
  return files;
}

function lineSlice(name, args) {
  let count = "10",
    literal = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!literal && arg === "--") literal = true;
    else if (!literal && ["-n", "--lines"].includes(arg)) {
      count = args[++i];
      if (!count) return null;
    } else if (!literal && /^(-n|--lines=)/.test(arg)) {
      count = arg.replace(/^(-n|--lines=)/, "");
    } else if (!literal && /^-\d+$/.test(arg)) count = arg.slice(1);
    else if (!literal && /^-[qv]+$/.test(arg)) continue;
    else if (!literal && arg.startsWith("-")) return null;
    else files.push(arg);
  }
  if (!/^\+?\d+$/.test(count) || files.includes("-")) return null;
  if (name === "tail" && count.startsWith("+") && +count < 1) return null;
  const range =
    name === "tail" && count.startsWith("+")
      ? `第 ${Number(count)} 行至末尾`
      : `${name === "head" ? "前" : "最后"} ${Number(count)} 行`;
  return files.length ? readFiles(files, "读取", `的${range}`) : `显示${range}`;
}

function sedDescription(args) {
  let quiet = false,
    expression;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["-n", "--quiet", "--silent"].includes(arg)) quiet = true;
    else if (arg === "-e" && !expression) expression = args[++i];
    else if (arg === "--") {
      files.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("-")) return null;
    else if (!expression) expression = arg;
    else files.push(arg);
  }
  const match = expression?.match(/^(\d+)(?:,(\d+|\$))?p$/);
  if (!quiet || !match || files.includes("-")) return null;
  const [, first, last] = match;
  if (Number(first) < 1 || (last && last !== "$" && +last < +first))
    return null;
  const range = !last
    ? `第 ${first} 行`
    : last === "$"
      ? `第 ${first} 行至末尾`
      : `第 ${first}–${last} 行`;
  if (files.length > 1)
    return `读取 ${files.map((path) => skillLabel(path) || path).join("、")} 合并内容的${range}`;
  return files.length ? readFiles(files, "读取", `的${range}`) : `显示${range}`;
}

function searchDescription(name, args) {
  const patterns = [],
    paths = [],
    globs = [];
  let files = false,
    filenames = false,
    literal = false;
  const valueOptions = new Set([
    "-A",
    "-B",
    "-C",
    "-m",
    "--after-context",
    "--before-context",
    "--context",
    "--max-count",
    "--max-depth",
    "--encoding",
    "--color",
    "--colors",
    "-t",
    "-T",
    "--type",
    "--type-not",
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!literal && arg === "--") literal = true;
    else if (!literal && arg === "--files" && name === "rg") files = true;
    else if (!literal && ["-e", "--regexp"].includes(arg)) {
      if (args[i + 1] === undefined) return null;
      patterns.push(args[++i]);
    } else if (!literal && /^--regexp=/.test(arg))
      patterns.push(arg.slice("--regexp=".length));
    else if (!literal && ["-g", "--glob", "--iglob"].includes(arg)) {
      if (name !== "rg" || args[i + 1] === undefined) return null;
      globs.push(args[++i]);
    } else if (!literal && /^--(?:i?glob)=/.test(arg) && name === "rg")
      globs.push(arg.slice(arg.indexOf("=") + 1));
    else if (!literal && valueOptions.has(arg.split("=")[0])) {
      if (!arg.includes("=") && args[++i] === undefined) return null;
    } else if (!literal && /^-[ABCm]\d+$/.test(arg)) continue;
    else if (!literal && /^-[nHiIsSvVwWxEFPrRohuUlL]+$/.test(arg)) {
      if (arg.includes("l")) filenames = true;
      // 反向匹配、版本与只显示未匹配文件的含义交由原文表达。
      if (/[vVL]/.test(arg)) return null;
    } else if (
      !literal &&
      [
        "--hidden",
        "--no-ignore",
        "--no-ignore-vcs",
        "--no-heading",
        "--heading",
        "--line-number",
        "--ignore-case",
        "--smart-case",
        "--fixed-strings",
        "--multiline",
        "--pcre2",
        "--word-regexp",
        "--line-regexp",
        "--follow",
        "--text",
      ].includes(arg)
    )
      continue;
    else if (!literal && arg === "--files-with-matches") filenames = true;
    else if (!literal && arg.startsWith("-")) return null;
    else if (!files && !patterns.length) patterns.push(arg);
    else paths.push(arg);
  }
  if (paths.includes("-") || (files && patterns.length)) return null;
  const scope = paths.length ? `（范围：${paths.join("、")}）` : "";
  const filter = globs.length ? `（筛选：${globs.join("、")}）` : "";
  if (files) return `列出文件${scope}${filter}`;
  if (!patterns.length) return null;
  return `${filenames ? "查找内容匹配的文件" : "搜索内容"} ${patterns.map((p) => `“${p}”`).join("、")}${scope}${filter}`;
}

function describe(words, depth = 0) {
  if (depth > 3) return null;
  if (words.some((word) => word.dynamic)) return null;
  const [executable, ...args] = words.map((word) => word.value);
  const name = filename(executable);
  // 自定义脚本与同名项目程序保留其执行语义。
  if (executable.includes("/") && !/^\/(?:usr\/)?bin\/[^/]+$/.test(executable))
    return null;
  if (name === "env") {
    const removed = [],
      assigned = [];
    let index = 1,
      empty = false;
    while (index < words.length) {
      const arg = words[index].value;
      if (["-u", "--unset"].includes(arg)) {
        const key = words[++index]?.value;
        if (!/^[A-Za-z_]\w*$/.test(key || "")) return null;
        removed.push(key);
        index++;
      } else if (/^--unset=[A-Za-z_]\w*$/.test(arg)) {
        removed.push(arg.slice("--unset=".length));
        index++;
      } else if (["-i", "--ignore-environment"].includes(arg)) {
        empty = true;
        index++;
      } else if (arg === "--") {
        index++;
        break;
      } else if (/^[A-Za-z_]\w*=/.test(arg)) {
        assigned.push(arg.slice(0, arg.indexOf("=")));
        index++;
      } else if (arg.startsWith("-")) return null;
      else break;
    }
    const changes = [
      empty ? "清空环境变量" : "",
      removed.length ? "移除环境变量 " + removed.join("、") : "",
      assigned.length ? "设置环境变量 " + assigned.join("、") : "",
    ]
      .filter(Boolean)
      .join("、");
    if (index === words.length)
      return "查看环境变量" + (changes ? `（${changes}）` : "");
    const nested = describe(words.slice(index), depth + 1);
    return nested
      ? `${changes ? changes + "后" : "在指定环境中"}${nested}`
      : null;
  }
  if (name === "cat") {
    const files = fileArguments(args, /^-[benstuvAET]+$/);
    return files?.length && files.every((file) => file && file !== "-")
      ? readFiles(files)
      : null;
  }
  if (name === "sed") return sedDescription(args);
  if (name === "head" || name === "tail") return lineSlice(name, args);
  if (name === "rg" || name === "grep") return searchDescription(name, args);
  if (name === "ls") {
    const paths = fileArguments(
      args,
      /^-[aAbBcCdDfFghHiklLmnopqQrRsStuUvwxX1]+$/,
    );
    return paths ? `列出目录 ${paths.join("、") || "."}` : null;
  }
  if (name === "find") {
    const paths = [],
      filters = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (["-name", "-iname", "-path", "-ipath"].includes(arg)) {
        if (args[i + 1] === undefined) return null;
        filters.push(
          `${arg.includes("name") ? "名称" : "路径"}匹配 ${args[++i]}`,
        );
      } else if (arg === "-type") {
        const type = { f: "文件", d: "目录", l: "符号链接" }[args[++i]];
        if (!type) return null;
        filters.push(type);
      } else if (["-maxdepth", "-mindepth"].includes(arg)) {
        const depth = args[++i];
        if (!/^\d+$/.test(depth)) return null;
        filters.push(`${arg === "-maxdepth" ? "最大" : "最小"}深度 ${depth}`);
      } else if (arg === "-print") continue;
      else if (arg.startsWith("-") || filters.length) return null;
      else paths.push(arg);
    }
    return `查找文件（范围：${paths.join("、") || "."}${filters.length ? "；" + filters.join("；") : ""}）`;
  }
  if (name === "pwd" && args.every((arg) => /^-[LP]$/.test(arg)))
    return "查看当前工作目录";
  if (name === "cd" && args.length === 1 && !args[0].startsWith("-"))
    return `切换到目录 ${args[0]}`;
  if (name === "wc") {
    const files = fileArguments(args, /^-l$/);
    if (args.includes("-l") && files && !files.includes("-"))
      return `统计行数${files.length ? " " + files.join("、") : ""}`;
  }
  if (name === "nl") {
    const files = fileArguments(args, /^-ba$/);
    if (files && !files.includes("-"))
      return files.length ? readFiles(files, "读取并显示行号") : "显示行号";
  }
  return operationDescription(name, args);
}

const connectors = {
  ";": "；",
  "&&": "，成功后",
  "||": "，失败后",
  "|": " → ",
};

export function commandDescription(command) {
  if (!command?.trim()) return "执行命令";
  let source = command.trim();
  // app-server 的命令可能带 shell 包装；仅拆解静态的 -c 参数。
  for (let depth = 0; depth < 3; depth++) {
    const words = tokenize(source);
    if (
      words?.length !== 3 ||
      words.some((word) => word.operator || word.dynamic) ||
      (words[0].value.includes("/") &&
        !/^\/(?:usr\/)?bin\/[^/]+$/.test(words[0].value)) ||
      !["sh", "bash", "zsh", "dash", "ksh"].includes(
        filename(words[0].value),
      ) ||
      !/^-[il]*c[il]*$/.test(words[1].value)
    )
      break;
    source = words[2].value;
  }
  if (!source.trim()) return "执行命令";
  const tokens = tokenize(source);
  if (!tokens?.length) return source;
  const shellKeywords = new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "function",
    "select",
    "!",
    "coproc",
  ]);
  if (
    tokens.some(
      (token, index) =>
        !token.operator &&
        (index === 0 || tokens[index - 1].operator) &&
        shellKeywords.has(token.value),
    )
  )
    return source;
  let words = [],
    result = "",
    connector = "",
    recognized = false;
  const append = () => {
    if (!words.length) return false;
    const description = describe(words);
    recognized ||= !!description;
    const raw = source.slice(words[0].start, words.at(-1).end);
    result += connector + (description || `执行命令 ${raw}`);
    words = [];
    return true;
  };
  for (const token of tokens) {
    if (token.operator) {
      if (!append()) return source;
      connector = connectors[token.operator];
    } else words.push(token);
  }
  if (words.length) append();
  else if (connector !== connectors[";"]) return source;
  return recognized ? result : source;
}
