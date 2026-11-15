export function splitSql(sql: string) {
  const out: string[] = [];
  let current = "",
    quoted = false;
  const clean = sql.replace(/^\s*--.*$/gm, "");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    current += ch;
    if (ch === "'") {
      if (quoted && clean[i + 1] === "'") {
        current += clean[++i];
        continue;
      }
      quoted = !quoted;
    }
    if (ch === ";" && !quoted) {
      const trigger = /^\s*CREATE TRIGGER/i.test(current);
      if (!trigger || /END;\s*$/i.test(current)) {
        out.push(current.trim());
        current = "";
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
