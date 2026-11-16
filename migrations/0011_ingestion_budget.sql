-- Project-local reservations, not Cloudflare's account-wide billing counters.
CREATE TABLE IF NOT EXISTS ingestion_daily_budget (
  day TEXT PRIMARY KEY,
  reserved_units INTEGER NOT NULL CHECK (reserved_units >= 0)
);
