# Payment and recovery

A signed request creates a 60-second immutable quote. Unpaid purchase returns
SDK-encoded x402 v2 `PAYMENT-REQUIRED`. The buyer checks origin, seller, network,
asset, amount, operation, SSH key, duration and expiration before signing.

The paying EOA authenticates each request through EIP-191. Authorization is
`Jio-Wallet ADDRESS.TIMESTAMP.SIGNATURE`, with a hex signature and Unix timestamp
within 60 seconds. The exact UTF-8 signed message is seven newline-separated lines:

```text
jio-control-v1
TIMESTAMP
HTTP_METHOD
ABSOLUTE_PUBLIC_URL
SHA256_RAW_BODY
IDEMPOTENCY_KEY_OR_EMPTY
SHA256_PAYMENT_SIGNATURE_HEADER_OR_EMPTY
```

Payment payer must equal authenticated owner. A receipt ID or intercepted payment
header alone grants no access. Status polling never incurs payment.

PostgreSQL uniqueness binds one quote, one owner/idempotency key, and one
network/USDC/Gateway/payer/nonce to an order. The order row is also its durable
work item. The claim commits before external verification/settlement; no database
transaction spans a network call. Invalid signatures never settle or create.

Gateway acceptance permits delivery before the later onchain batch. Unknown
outcomes reconcile the original nonce against Circle with full financial-binding
checks. Empty results never authorize another charge. A crash before submission
may remain unresolved until operator investigation. The bounded worker processes
16 orders per batch under a database advisory lock. Jio retries keep their
original idempotency key. `confirmed`/`completed` transfer status records settled;
an opaque provider ID never becomes an invented explorer transaction link.

Definitive provisioning failure creates one full refund obligation to the verified
payer. The separate `bun src/refunds.ts <order-id>` treasury worker uses Circle
EOA contract execution with a durable idempotency key. Receipts remain pending
or submitted until confirmed. A real 4275-micro-USDC refund was confirmed and
its ERC-20 Transfer log independently checked on Arc Testnet. Ambiguous attempts
older than one hour require operator lookup, not a new transfer. Failed
transactions also require operator review; no alternate transfer is invented.

The buyer's private SQLite ledger reserves accepted and unresolved spending
atomically before signing. Concurrent purchases cannot overspend. It retains the
exact authorization for retries. Never erase it to resolve uncertainty. Budget
release after definitive rejection is operator-managed for now. Wallet funding
and Gateway deposits are separate setup steps, never responses to a 402.

Run the private listener behind the existing HTTPS edge with rate/body limits.
Preserve the configured public host exactly; don't trust arbitrary forwarded
headers. Use a PostgreSQL role restricted to `jio_payments`, run migrations
explicitly, and back up with the existing compute database. This repository does
not replace infrastructure. It is not a production-ready public rental service.

`compute_status` records provisioning outcome. `computer` is a fresh lookup
through the existing API, including its lifecycle and expiry; it is null and
`computer_status_available` is false when current data is unavailable. A past
provisioning success does not promise the computer is still running.
