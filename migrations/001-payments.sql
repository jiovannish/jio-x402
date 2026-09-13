-- Isolated tables in the existing PostgreSQL database; no fleet table changes.
CREATE SCHEMA IF NOT EXISTS jio_payments;
CREATE TABLE IF NOT EXISTS jio_payments.quotes (
 id uuid PRIMARY KEY, owner text NOT NULL, terms jsonb NOT NULL,
 requirements jsonb NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jio_payments.orders (
 id uuid PRIMARY KEY, quote_id uuid NOT NULL UNIQUE REFERENCES jio_payments.quotes,
 owner text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
 authorization_id text NOT NULL UNIQUE, payer text NOT NULL, nonce text NOT NULL,
 payment_status text NOT NULL CHECK(payment_status IN ('submitting','unknown','rejected','accepted','settled')),
 payment_response jsonb, provider_reference text,
 compute_status text NOT NULL DEFAULT 'waiting' CHECK(compute_status IN ('waiting','pending','ready','failed','expired','stopped')),
 operation_id text, computer_id text, compute_response jsonb,
 retry_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner,idempotency_key)
);
CREATE TABLE IF NOT EXISTS jio_payments.refunds (
 order_id uuid PRIMARY KEY REFERENCES jio_payments.orders,
 amount_atomic text NOT NULL, recipient text NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','confirmed')),
 provider_transfer_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
