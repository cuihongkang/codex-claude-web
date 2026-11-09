export function composerReferenceFixture() {
  const original = WebSocket.prototype.send;
  const entries = [
    { fileName: "sample.js", isDirectory: false },
    { fileName: "分析.py", isDirectory: false },
    { fileName: "图片.png", isDirectory: false },
    { fileName: "资料", isDirectory: true },
  ];
  WebSocket.prototype.send = function (raw) {
    const request = JSON.parse(raw);
    const { method, params } = request;
    let result;
    if (method === "skills/list")
      result = {
        data: [
          {
            skills: [
              {
                name: "demo-skill",
                path: "/demo/SKILL.md",
                description: "演示技能",
              },
              { name: "native-skill", native: true, description: "原生技能" },
            ],
          },
        ],
      };
    if (method === "fs/readDirectory") result = { entries };
    if (method === "fuzzyFileSearch")
      result = {
        files: entries
          .filter((row) =>
            row.fileName.includes(params.query.split("/").at(-1)),
          )
          .map((row) => ({
            path: params.query.includes("/")
              ? params.query.slice(0, params.query.lastIndexOf("/") + 1) +
                row.fileName
              : row.fileName,
            root: "/demo/history",
            file_name: row.fileName,
            match_type: row.isDirectory ? "directory" : "file",
          })),
      };
    if (method === "fuzzyFileSearch" && params.query === "target")
      result = {
        files: ["target/a.js", "target/b.js", "z/target.js", "target"].map(
          (path) => ({
            root: "/demo/history",
            path,
            file_name: path.split("/").at(-1),
            match_type: path === "target" ? "directory" : "file",
          }),
        ),
      };
    if (method === "turn/start")
      result = { turn: { id: "reference-turn", status: "inProgress" } };
    if (!result) return original.call(this, raw);
    window.historyFixture.requests.push(request);
    setTimeout(
      () =>
        this.onmessage({ data: JSON.stringify({ id: request.id, result }) }),
      0,
    );
  };
}
