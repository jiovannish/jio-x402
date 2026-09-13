# Compute integration

Configure `JIO_API_URL` and a dedicated `JIO_API_KEY` for an existing Jio deployment.
The payment gateway calls its authenticated API; it does not provision workers,
manage templates, or replace the compute service.

Use a dedicated account that can allocate one `small` computer: 1 vCPU, 2048 MiB
RAM and sufficient disk quota for the deployment's template. Ask the operator for
the account lifetime policy and any required CA certificate.

## Required endpoints

| Existing route | Gateway use |
| --- | --- |
| `GET /v0/health` | Advertised size catalog including `small` |
| `GET /v1/usage` | Account reservations, enforced TTL and optional rental maximum |
| `POST /v1/sessions` | Create with `profile`, `client_public_key` and an idempotency key |
| `GET /v1/operations/{id}` | Recover the durable operation status |
| `GET /v1/sessions/{id}` | Current lifecycle and expiry |
| `POST /v1/sessions/{id}/stop` | Existing stop operation, where account policy permits |
| `DELETE /v1/sessions/{id}` | Existing destruction with an idempotency key |

The adapter lives in [src/compute.ts](../src/compute.ts). The API key is sent as a
Bearer token and remains server-only. Buyer-supplied payment-status headers are
not forwarded to the compute API.

The backend must deduplicate create requests by account and `Idempotency-Key`.
An identical POST must return the original operation before checking new capacity;
a changed request must fail with 409. The gateway replays that same request to
recover from response loss. An uncertain or blocked operation is not treated as
a definitive provisioning failure.

## Duration and expiry

Time starts at admission, before readiness. The compute service remains responsible
for enforcing expiry independently of the payment gateway.

If `/v1/usage` only reports `session_ttl_seconds`, a quote must match that lifetime.
If it advertises `rental_max_seconds`, the gateway can quote a duration from 30
seconds through that maximum, capped at one day. It includes the selected
`duration_seconds` in the immutable create request. Operators must enable this
capability only when their deployment supports it end to end.

Unsupported durations return `DURATION_UNAVAILABLE` before payment. Extensions
return `EXTENSION_UNAVAILABLE`; there is no implemented extension adapter.

## Access

The gateway binds the buyer's supplied SSH public key during creation. It returns
operation and computer references, without releasing its provisioning API key.
Connecting still requires the deployment's existing Jio access mechanism.
Wallet-scoped hosted access is not implemented. See [limitations](limitations.md).

## Pricing

The implementation uses 8550 micro-USDC per hour for 1 vCPU / 2 GiB. This was derived
proportionally from the [Jio pricing FAQ](https://jiovanni.sh/pricing), checked
2026-09-13, which listed $0.0171/hour for 2 vCPU / 4 GB. It is a derived rate,
not a separately published plan, and does not implement subscription credits.

Total micro-USDC = `ceil(duration_seconds × 8550 / 3600)`:

| Duration | Amount |
| --- | --- |
| 30 seconds | 0.000072 USDC |
| 30 minutes | 0.004275 USDC |
| 1 day | 0.205200 USDC |

These are price calculations, not guarantees that the backend offers each duration.
No capacity is reserved by a quote.
