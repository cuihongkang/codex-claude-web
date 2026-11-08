function normalize(value) {
  return (value || "").normalize("NFKC").toLowerCase();
}

function score(value, query) {
  const text = normalize(value);
  if (!text) return 0;
  if (text === query) return 10000;
  if (text.startsWith(query)) return 8000 - text.length / 100;
  const substring = text.indexOf(query);
  if (substring >= 0) return 6000 - substring - text.length / 100;
  const source = Array.from(text),
    target = Array.from(query);
  let best = 0;
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== target[0]) continue;
    let matched = 1,
      end = start;
    while (++end < source.length && matched < target.length)
      if (source[end] === target[matched]) matched++;
    if (matched !== target.length) continue;
    const gaps = end - start - target.length;
    best = Math.max(best, 1000 / (gaps + 1) ** 2 + (start === 0 ? 100 : 0));
  }
  return best;
}

export function matchingSkills(skills, query) {
  const q = normalize(query).trim();
  const enabled = skills.filter((skill) => skill.enabled !== false);
  if (!q) return enabled;
  return enabled
    .map((skill, index) => {
      const path = (skill.path || "").replaceAll("\\", "/");
      const marker = path.lastIndexOf("/skills/");
      const folder =
        marker < 0 ? "" : path.slice(marker + 8).replace(/\/SKILL\.md$/i, "");
      const fields = /[/\\]/.test(q)
        ? [skill.name, skill.interface?.displayName, path]
        : [skill.name, skill.interface?.displayName, folder];
      const rank = Math.max(
        ...fields.map((value) => score(value, q)),
        normalize(skill.description).includes(q) ||
          normalize(
            skill.interface?.shortDescription || skill.shortDescription,
          ).includes(q)
          ? 1
          : 0,
      );
      return { skill, rank, index };
    })
    .filter((entry) => entry.rank > 0)
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        (a.skill.interface?.displayName || a.skill.name).localeCompare(
          b.skill.interface?.displayName || b.skill.name,
        ) ||
        a.index - b.index,
    )
    .map((entry) => entry.skill);
}
