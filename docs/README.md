# Documentation

Jio x402 lets an agent pay for a computer rental through HTTP. The gateway
validates a quote, accepts USDC through Circle Gateway, and requests a computer
from an existing Jio deployment. The agent receives an operation and computer
reference, then polls for status.

## Get started

1. [Set up the gateway and wallets](setup.md).
2. Configure the buyer example and run `bun run buyer 1800` for a 30-minute rental.
3. Use the [payment API](api.md) to retrieve the order and receipt.
4. Read [recovery](recovery.md) before retrying an uncertain payment.

Purchased time starts at compute admission, before the computer becomes ready.
An accepted payment can precede its onchain batch settlement; the receipt reports
those states separately. Computer access still uses the existing Jio access path.

## Guides

- [Setup](setup.md): requirements, configuration, buyer example and refund command.
- [Payment API](api.md): quotes, purchases, status, receipts and TypeScript usage.
- [Compute integration](compute-api.md): backend requirements and duration support.
- [Recovery](recovery.md): authentication, retries, spending limits and refunds.
- [Limitations](limitations.md): what is supported today.
- [Test evidence](evidence.md): recorded payment, VM and refund checks.
- [Sources and reuse](reuse.md): dependencies and protocol references.
