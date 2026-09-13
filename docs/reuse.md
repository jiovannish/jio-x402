# Reuse and sources

Existing Jio compute, templates and Client predate this integration.
`protocolwhisper/tempVPN` was inspected at
`a193cefae14ce137293f8ae64d68c43836c65028`: aggregator routing/OpenAPI,
coordinator `store.rs`/`types.rs`, and authenticated coordinator-client calls.
It uses Tempo MPP. No license file was found and **no source was copied**.
WireGuard, VPN provisioning, mppx and Tempo channels are excluded.

Bun locks Circle batching 3.4.0, developer-controlled wallets 10.8.0, and x402
core/EVM 2.25.0. SDKs construct x402 headers/EIP-3009 authorizations and verify
standard EIP-191 request signatures; no custom payment cryptography is used.

- [Circle seller](https://developers.circle.com/gateway/nanopayments/quickstarts/seller)
- [Circle EOA buyer](https://developers.circle.com/gateway/nanopayments/quickstarts/buyer)
- [SDK reference](https://developers.circle.com/gateway/nanopayments/references/sdk)
- [Arc connection details](https://docs.arc.io/integrate/connect-to-arc)

Arc Testnet: `eip155:5042002`; USDC ERC-20 interface
`0x3600000000000000000000000000000000000000` (6 decimals); native gas has 18.
Current official RPC is `https://rpc.testnet.arc.network`, rather than the `.io`
address in the handoff. SDK Gateway addresses were checked against the live
facilitator. Authorization validity of seven days plus buffer is independent
of quote expiry and VM lifetime.

## Event eligibility

The [ETHOnline 2026 Arc listing](https://ethglobal.com/events/ethonline2026/prizes/arc)
lists $3500 for the Agentic Economy award ($2500 conditional on mainnet deployment
by September 30), and a separate $3000 Continuity award ($2000 conditional).
Disclose existing Jio work and verify track registration with organizers; new
payment code alone does not establish fresh-track eligibility. Submission also
requires functional frontend/backend, diagram, video/presentation and repository.
Those assets are outside this payment-only implementation.
