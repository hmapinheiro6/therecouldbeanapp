/** Counts only provider-reported rows. Never logs SQL values or private parameters. */
export interface QueryUsage {
  rows_read: number;
  rows_written: number;
  queries: number;
}
export function observedDatabase(
  db: D1Database,
  job: string,
  usage: QueryUsage,
): D1Database {
  let ordinal = 0;
  const report = (value: D1Result<unknown>, label: number) => {
    const { rows_read, rows_written } = value.meta;
    if (!Number.isSafeInteger(rows_read) || !Number.isSafeInteger(rows_written))
      throw new Error("D1 accounting missing");
    usage.rows_read += rows_read;
    usage.rows_written += rows_written;
    usage.queries++;
    console.log(
      JSON.stringify({
        event: "d1_query",
        job,
        query: label,
        rows_read,
        rows_written,
      }),
    );
    return value;
  };
  const originals = new WeakMap<object, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const label = ++ordinal;
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => wrap(target.bind(...args));
        if (key === "first")
          return async (column?: string) => {
            const value = report(await target.all(), label);
            const row = value.results[0] as Record<string, unknown> | undefined;
            return column ? (row?.[column] ?? null) : (row ?? null);
          };
        if (key === "all" || key === "run")
          return async () => report(await target[key](), label);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  return new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(
            statements.map((s) => originals.get(s) ?? s),
          );
          return result.map((r) => report(r, ++ordinal));
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
