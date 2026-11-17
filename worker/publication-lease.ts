export async function acquirePublication(db: D1Database, revision?: number) {
  const token = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000);
  const sql = `INSERT INTO publication_lease(id,token,expires_at)
    SELECT 'static',?,? WHERE (? IS NULL OR (SELECT value FROM catalog_counters WHERE key='revision')=?)
    ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE publication_lease.expires_at<? RETURNING token`;
  const row = await db
    .prepare(sql)
    .bind(token, now + 300, revision ?? null, revision ?? null, now)
    .first<{ token: string }>();
  return row?.token ?? null;
}
export async function releasePublication(db: D1Database, token: string) {
  await db
    .prepare("DELETE FROM publication_lease WHERE id='static' AND token=?")
    .bind(token)
    .run();
}
