# Current limitations

- Payments support Circle Gateway USDC on Arc Testnet. Mainnet is not validated.
- Rentals use the `small` configuration: 1 vCPU and 2 GiB RAM. The gateway expects
  a dedicated Jio account with no existing retained computer before purchasing.
- The validated live configuration provides 30-minute rentals. Other durations
  require the compute API to advertise and enforce them. The gateway accepts
  durations from 30 seconds to one day only when the backend supports them.
- Paid extensions are unavailable and are rejected before payment.
- A purchase returns operation/computer references and binds the supplied guest
  SSH public key. Wallet-scoped hosted SSH credentials are not implemented;
  payment alone does not provide a working connection. Use established Jio access.
- Quotes expire after 60 seconds and do not reserve capacity. Provisioning can
  fail after payment, creating a full refund obligation.
- Refunds require the separate operator treasury command. Ambiguous old attempts
  and failed transactions require operator reconciliation.
- Unknown payments remain reserved against the buyer's budget. Do not discard
  the local ledger or sign a fresh authorization to work around an uncertain result.
- Deployment requires HTTPS, restricted database permissions and operational
  monitoring. The local listener is not a publicly hosted service.

Payment acceptance, later settlement and refund confirmation are distinct states.
See [recovery](recovery.md) and the [recorded test results](evidence.md).
