function normalize(value) {
  return value.normalize("NFKC").toLowerCase().replaceAll("\\", "/");
}

function relevance(text, query) {
  if (text === query) return [5, 0, 0];
  if (text.startsWith(query)) return [4, 0, query.length - text.length];
  const offset = text.indexOf(query);
  if (offset >= 0) return [3, -offset, query.length - text.length];
  let best = null;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== query[0]) continue;
    let matched = 1;
    let end = start;
    while (++end < text.length && matched < query.length)
      if (text[end] === query[matched]) matched++;
    if (matched === query.length) {
      const rank = [2, -(end - start - query.length), -start];
      if (!best || compare(rank, best) < 0) best = rank;
    }
  }
  return best || [0, 0, 0];
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

// Rank the complete native result set before the menu applies its display limit.
export function rankFileSuggestions(files, query, cwd) {
  const q = normalize(query);
  if (!q || q.endsWith("/")) return files;
  const root = normalize(cwd).replace(/\/$/, "");
  return files
    .map((file, index) => {
      const full = normalize(file.path);
      const path = full.startsWith(root + "/")
        ? full.slice(root.length + 1)
        : full;
      const name = normalize(file.name);
      const rank = q.includes("/")
        ? relevance(q.startsWith("/") ? full : path, q)
        : [...relevance(name, q), ...relevance(path, q)];
      return { file, rank, index };
    })
    .sort((a, b) => compare(a.rank, b.rank) || a.index - b.index)
    .map(({ file }) => file);
}
