# Setup

## Requirements

- Bun 1.3.12 or later; the lockfile pins dependencies.
- PostgreSQL and a database for the gateway's payment tables.
- A dedicated Jio account with capacity for one 1-vCPU / 2-GiB computer.
- A Circle Gateway seller address on Arc Testnet.

Ask your Jio operator for the API endpoint, dedicated account key, supported
rental duration and any private CA certificate. See [compute integration](compute-api.md)
for the required API behavior.

## Start the gateway

```sh
bun install --frozen-lockfile
cp .env.example .env
```

Create a database using your PostgreSQL administration tools. For a local
PostgreSQL installation with your current user configured:

```sh
createdb jio_payments
```

Edit `.env` with your deployment's values:

| Variable         | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string                                                 |
| `PUBLIC_ORIGIN`  | Exact externally visible gateway origin; use `http://127.0.0.1:4020` locally |
| `PORT`           | Local listener port; defaults to `4020`                                      |
| `SELLER_ADDRESS` | Trusted Arc Testnet EOA receiving payment                                    |
| `JIO_API_URL`    | Existing Jio compute API endpoint                                            |
| `JIO_API_KEY`    | Dedicated provisioning account key; keep server-only                         |

Then apply migrations and start the gateway:

```sh
bun run migrate
bun start
```

For a compute API using a private CA, set its certificate path before starting Bun:

```sh
NODE_EXTRA_CA_CERTS=/absolute/path/to/jio-ca.pem bun start
```

Use the certificate supplied by your operator; keep TLS verification enabled.
Inherited environment variables override `.env`. Confirm that the configured key
belongs to the intended dedicated account before testing.

The listener binds to `127.0.0.1`. To expose it, use an HTTPS reverse proxy that
preserves the configured public Host header. Arbitrary forwarded headers cannot
change the origin authenticated by wallet signatures. Use a database role limited
to the payment schema and keep migrations under operator control.

## Configure the buyer

The buyer signs through a Circle developer-controlled EOA on Arc Testnet.
Follow [Circle's buyer setup](https://developers.circle.com/gateway/nanopayments/quickstarts/buyer)
to register an entity secret, create a wallet, fund it with test USDC and deposit
USDC into Gateway. Smart contract accounts are unsupported for this integration.

Configure these values for the buyer process:

| Variable                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `CIRCLE_API_KEY`        | Circle Testnet key with Wallets access                  |
| `CIRCLE_ENTITY_SECRET`  | Registered entity secret                                |
| `CIRCLE_WALLET_ADDRESS` | Buyer's Arc Testnet EOA                                 |
| `SELLER_ADDRESS`        | Seller address the buyer trusts                         |
| `PUBLIC_ORIGIN`         | Gateway origin the buyer trusts                         |
| `SSH_PUBLIC_KEY`        | `ssh-ed25519` public key, without a trailing comment    |
| `BUDGET_ATOMIC`         | Total local spending cap in micro-USDC; default `10000` |

Keep signing credentials in the buyer process, separate from the public gateway
and rented computer. The buyer does not need the gateway's Jio provisioning key.

For a backend configured for 30-minute rentals:

```sh
bun run buyer 1800
```

This requests a quote, purchases it and prints the order and receipt. One USDC
is 1,000,000 micro-USDC; the default budget is 0.01 USDC. The private
`.state/buyer.sqlite` ledger counts accepted and unresolved spending. Preserve it
and recover uncertain orders through the [payment API](api.md).

### Optional fresh-wallet setup

For a new Circle Wallets setup, the repository includes a resumable helper:

1. Create a restricted Circle Testnet API key with Wallets read/write.
2. Save it privately in `.state/circle-api.key.txt` with file mode `0600`.
3. Run `bun examples/setup-testnet.ts`.

The helper registers a first-use entity secret, saves recovery material, creates
buyer and seller EOAs, and deposits **1 test USDC** from the buyer into Gateway.
It records state and idempotency keys under `.state` before external operations.
Use manual Circle setup for an account with an already registered entity secret;
the helper does not rotate it.

If Circle's Faucet API returns 403, fund the two wallet addresses shown in
`.state/circle-setup.json` using [the public faucet](https://faucet.circle.com),
then rerun the helper. No mainnet upgrade is needed for the public faucet.
Copy the resulting configuration into the appropriate buyer and treasury
processes. Back up the entity secret and recovery file securely. Do not delete
setup state to retry an ambiguous registration or deposit.

Funding and deposits are explicit setup operations. Purchases never replenish a
wallet or bridge funds automatically in response to HTTP 402.

## Process refunds

Definitive provisioning failures create a durable refund obligation. Run the
separate treasury command with `DATABASE_URL`, `SELLER_ADDRESS` and Circle
credentials authorized to sign for that seller:

```sh
bun src/refunds.ts <order-uuid>
```

It sends the recorded amount to the verified payer using the order UUID as
Circle's idempotency key. Run again to poll or recover the same transfer. Receipts
remain pending/submitted until confirmation. Ambiguous submissions older than
an hour, and failed transactions, require operator investigation. Do not reset
an attempt or change its recipient to work around uncertainty.

## Checks

Use a dedicated test database. Adjust the connection string for your environment:

```sh
createdb jio_payments_test
bun run check
DATABASE_URL=postgresql://localhost:5432/jio_payments_test bun test
```

These tests truncate their payment tables and mock provider calls. They do not
purchase compute or transfer funds.

`examples/test-live.ts` uses real testnet payments and Jio capacity. It saves the
quote before purchasing and reuses it on reruns. `examples/test-live-refund.ts`
requires the local gateway stopped; it runs real Circle payment/refund calls and
injects only a failed compute response. Use dedicated test resources and read
[the recorded results](evidence.md) before running either example.
