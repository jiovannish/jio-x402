# Test evidence — 2026-09-13

Recorded integration results. Exact source hashes are in
[source-digests.json](source-digests.json).
Bun 1.3.12; Circle batching 3.4.0; Circle Wallets 10.8.0; x402 core/EVM 2.25.0.
These are correctness checks, not performance benchmarks or a production claim.

## Real services

Circle Console setup created a restricted Testnet key, registered an entity
secret, saved recovery material privately, and created two developer-controlled
Arc EOAs. The public faucet funded each with 20 test USDC; the Faucet API returned
403 because this account has not upgraded to mainnet. Setup deposited 1 test USDC
from the buyer into Gateway. No mainnet funds or account upgrade were used.

Buyer: `0x525cb74cd52407bf58ddbaefd9bb6d2d102e5834`.
Seller: `0x4a3083da6af7b7786a85be850149a65a23e95cef`.

**Real purchase:** `f80f8bc0-1a78-4d5a-9373-3a446b6f7728`.
Circle accepted 4275 micro-USDC. Existing Jio operation
`a97e465c086faa5dbc1b9bde5ae6d84d` created VM
`e497814fc68d990251143868ffa2ec55`; the existing API reported ready, 1 vCPU,
2048 MiB and an enforced admission deadline. Repeating the purchase returned
the same order and computer. Circle's nonce search returned exactly one transfer,
`eb246194-8e58-4730-967d-5ec8715add8a`.

Gateway later reported completed. The actual
[batch transaction](https://testnet.arcscan.app/tx/0x51572198f17574b741330122b2abd0d4bf5d13dc63037a61b8c545c80b334c65)
was independently checked through Arc RPC and succeeded. The opaque acceptance
ID was never treated as a transaction hash. The test VM was destroyed afterward
through the existing API; the dedicated account returned to zero reservations.
No other VM was touched. [Purchase record](live-payment.json).

**Real refund, injected provisioning failure:** order
`d9ac86b5-3a4a-433b-9615-1c48c07024e0` used a second genuine Circle payment.
The harness erased the local accepted state to simulate a lost acceptance write;
the worker recovered through Circle's nonce lookup without another charge.
Only the create response was injected as HTTP 409. This was not a real production
capacity failure, and no second computer was created.

The durable obligation passed through pending/submitted to confirmed. The
[refund transaction](https://testnet.arcscan.app/tx/0x4ac3543fbe28b98469897cd02c0f7ff48e0fe8ecabdc6ce186aeb1f640bcbd8d)
succeeded in Arc block 61862944. Its USDC ERC-20 Transfer log independently
confirmed exactly 4275 micro-USDC from the seller to the verified payer.
Repeating the refund command returned the same confirmed result.
[Refund record](live-refund.json), [nonce queries](live-settlement.json).

The second payment was still Gateway-accepted, awaiting batch settlement at the
last recorded check. Its separate refund was already confirmed onchain.

## Executable checks

`bun run check`: passed. Dedicated local PostgreSQL suite: **10 passed, 0 failed**.

- Official unpaid x402 402; zero settlement/create calls.
- Wrong amount, asset, network, seller, signature, owner and changed request fail.
- Quote expiration and unsupported durations/extensions fail before charging.
- Eight concurrent retries produce one payment submission and one create effect.
- Cross-quote nonce replay and cross-owner receipt access fail.
- Lost payment/create responses recover with original identifiers.
- Live-discovered micro-USDC transfer units have a regression check.
- Refund submission response loss retries the same key; one transfer effect.
- Concurrent buyer calls cannot exceed the budget, including unresolved spending.
- Optional per-request lifetime propagation and HTTPS edge origin binding pass.

Provider faults in these tests are mocks around real PostgreSQL transactions.
They are distinct from the real payment/refund evidence above.

## Still unavailable

- Durations other than the validated 30-minute rental require a compute backend
  that advertises and enforces them.
- Paid extensions: rejected before payment; existing infrastructure has no safe
  idempotent extension API.
- Wallet-scoped hosted SSH credentials. The guest key is bound, but the shared
  provisioning API key is never handed to buyers. Current users still need their
  established Jio access path.
- Public HTTPS gateway deployment and production operating guarantees.
- Fully automatic treasury operation: an operator invokes the refund worker;
  uncertain old attempts require explicit reconciliation.
