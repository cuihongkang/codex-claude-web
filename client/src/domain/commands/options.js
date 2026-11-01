export function options(args, flags, valueFlags = []) {
  const enabled = new Set(),
    values = [],
    targets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      targets.push(...args.slice(i + 1));
      break;
    }
    if (flags.includes(arg)) enabled.add(arg);
    else if (valueFlags.includes(arg)) {
      if (args[i + 1] === undefined) return null;
      values.push([arg, args[++i]]);
    } else if (arg.startsWith("--") && arg.includes("=")) {
      const index = arg.indexOf("=");
      if (!valueFlags.includes(arg.slice(0, index))) return null;
      values.push([arg.slice(0, index), arg.slice(index + 1)]);
    } else if (/^-[^-].+/.test(arg)) {
      for (let part = 1; part < arg.length; part++) {
        const flag = "-" + arg[part];
        if (valueFlags.includes(flag)) {
          const value = arg.slice(part + 1) || args[++i];
          if (value === undefined) return null;
          values.push([flag, value]);
          break;
        }
        if (!flags.includes(flag)) return null;
        enabled.add(flag);
      }
    } else if (arg.startsWith("-")) return null;
    else targets.push(arg);
  }
  return {
    targets,
    has: (...names) => names.some((name) => enabled.has(name)),
    allValues: (...names) =>
      values.filter(([name]) => names.includes(name)).map(([, value]) => value),
    value: (...names) => values.findLast(([name]) => names.includes(name))?.[1],
  };
}
export function scope(targets, label = "范围") {
  return targets.length ? `（${label}：${targets.join("、")}）` : "";
}
