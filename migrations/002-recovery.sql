ALTER TABLE jio_payments.refunds ADD COLUMN IF NOT EXISTS attempted_at timestamptz;
ALTER TABLE jio_payments.refunds ADD COLUMN IF NOT EXISTS transaction_hash text;
ALTER TABLE jio_payments.orders ADD COLUMN IF NOT EXISTS settlement_transaction_hash text;
