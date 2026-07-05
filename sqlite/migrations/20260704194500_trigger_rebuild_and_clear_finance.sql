-- Re-sync trigger: wipe existing logs and snapshots to trigger chronological rebuild
DELETE FROM sentinel_financial_logs;
DELETE FROM sentinel_daily_finance_snapshots;
DELETE FROM sentinel_stock_benefit_payouts;
DELETE FROM sentinel_processed_benefit_logs;

-- Reschedule workers to run immediately and clear their cached metadata
UPDATE sentinel_worker_schedules
SET force_run = 1,
    next_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_run_at = NULL,
    metadata = NULL
WHERE worker_id IN (
  SELECT id FROM sentinel_workers WHERE name IN ('torn_finance_logs_worker', 'torn_portfolio_worker')
);
