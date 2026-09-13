# Payment API

The gateway exposes an HTTP API. Retrieve its machine-readable contract at
`GET /openapi.json` on your configured gateway origin.

| Route                                   | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `POST /v1/compute/quotes`               | Validate a configuration, duration and price cap      |
| `POST /v1/compute/quotes/{id}/purchase` | Return an x402 challenge or accept a purchase         |
| `GET /v1/compute/orders/{id}`           | Recover an order and check current computer status    |
| `GET /v1/compute/orders/{id}/receipt`   | Retrieve terms, payment, settlement and refund status |

Except for OpenAPI, requests require a wallet signature. The provided buyer signs
requests automatically; see [the authentication format](recovery.md) for custom clients.

## Buy a rental

After [configuring the buyer](setup.md#configure-the-buyer), run:

```sh
bun run buyer 1800
```

The argument is the requested duration in seconds. Each invocation requests a new
quote; use the saved order reference to recover an earlier purchase.

For an agent script in the repository root:

```ts
import { buyer } from './examples/buyer.ts';

const quote = await buyer.quote({
  operation: 'create',
  configuration_id: 'small',
  duration_seconds: 1800,
  client_public_key: process.env.SSH_PUBLIC_KEY!,
  max_amount_atomic: '4275',
});

// Persist the quote and key before sending a purchase request.
const order = await buyer.purchase(quote, quote.quote_id);
console.log(order.order_id, order.operation_id, order.computer_id);
console.log(await buyer.orderStatus(order.order_id));
console.log(await buyer.receipt(order.order_id));
```

`Buyer` is exported from [src/buyer.ts](../src/buyer.ts); the
[Circle example](../examples/buyer.ts) supplies the managed wallet signer.
`extensionQuote(computerId, seconds)` is available to request an extension quote,
but the gateway currently responds with `EXTENSION_UNAVAILABLE` and takes no payment.

## Payment flow

An unpaid purchase returns HTTP 402 with an SDK-encoded `PAYMENT-REQUIRED` header.
The buyer checks the origin, seller, network, USDC asset, exact price, quote
expiration and spending budget. It signs the selected Circle Gateway option and
retries with `PAYMENT-SIGNATURE` and the same `Idempotency-Key`.

An accepted attempt returns HTTP 202 with `order_id`, `payment_status`,
`compute_status` and `status_url`. Operation and computer IDs may initially be
null while provisioning is pending. Poll the existing order; status and receipt
requests never charge.

`compute_status` records the provisioning outcome. `computer` contains the latest
available backend lifecycle observation and expiry. It is null when unavailable;
check `computer_status_available` instead of assuming a previously ready VM is
still running.

## Retry and recover

Reuse the same quote, request body, idempotency key and payment authorization.
The buyer stores the authorization in its private SQLite ledger for retries.
An `unknown` payment is not permission to sign another one. Retrieve the order
and allow reconciliation to finish. See [recovery](recovery.md).

| Response | Meaning                                                       |
| -------- | ------------------------------------------------------------- |
| `402`    | Payment required or rejected; inspect the error and challenge |
| `409`    | Capacity unavailable, conflicting retry, or replayed payment  |
| `410`    | Unpurchased quote expired                                     |
| `422`    | Unsupported duration/extension or price above the cap         |

An accepted payment and its later onchain settlement are reported separately.
A provider reference is not a transaction hash. A confirmed refund is a separate
transfer to the verified payer, not a reversal of the original x402 authorization.
