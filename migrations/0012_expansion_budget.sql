-- A dated, bounded campaign reservation. Regular ingestion retains its 20k budget.
CREATE TABLE IF NOT EXISTS expansion_daily_budget (
 day TEXT PRIMARY KEY,
 reserved_units INTEGER NOT NULL CHECK(reserved_units>=0),
 rows_written INTEGER NOT NULL DEFAULT 0,
 rows_read INTEGER NOT NULL DEFAULT 0
);
-- No query filters by normalized_domain; canonical URL already has a unique index.
DROP INDEX IF EXISTS products_domain;
