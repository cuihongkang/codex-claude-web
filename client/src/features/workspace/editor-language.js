import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { java, csharp } from "@codemirror/legacy-modes/mode/clike";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { properties } from "@codemirror/legacy-modes/mode/properties";

export { codeHighlightStyle } from "../markdown/code-highlight-style.js";

export const isMarkdownFile = (path) =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

export function fileLanguage(path) {
  const name = path.split("/").at(-1).toLowerCase();
  if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(name))
    return javascript({
      jsx: /\.[jt]sx$/.test(name),
      typescript: /\.(?:[cm]?ts|tsx)$/.test(name),
    });
  if (/\.(py|pyi|pyw)$/.test(name)) return python();
  if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx|cu|cuh)$/.test(name)) return cpp();
  if (/\.(json|jsonc)$/.test(name)) return json();
  if (isMarkdownFile(name)) return markdown();
  if (/\.(html?|xml|xsl|xsd|svg)$/.test(name)) return html();
  if (/\.(css|scss|less)$/.test(name)) return css();
  if (/\.(sh|bash|zsh|bashrc|zshrc|profile|bash_profile)$/.test(name))
    return StreamLanguage.define(shell);
  if (/\.ya?ml$/.test(name)) return StreamLanguage.define(yaml);
  if (/\.toml$/.test(name)) return StreamLanguage.define(toml);
  if (/\.rs$/.test(name)) return StreamLanguage.define(rust);
  if (/\.go$/.test(name)) return StreamLanguage.define(go);
  if (/\.java$/.test(name)) return StreamLanguage.define(java);
  if (/\.cs$/.test(name)) return StreamLanguage.define(csharp);
  if (/\.sql$/.test(name)) return StreamLanguage.define(standardSQL);
  if (name === "cmakelists.txt" || /\.cmake$/.test(name))
    return StreamLanguage.define(cmake);
  if (/^(dockerfile|containerfile)(\.|$)/.test(name))
    return StreamLanguage.define(dockerFile);
  if (/\.lua$/.test(name)) return StreamLanguage.define(lua);
  if (/\.(ini|conf|cfg|properties|env)$/.test(name) || name.startsWith(".env."))
    return StreamLanguage.define(properties);
  return [];
}
