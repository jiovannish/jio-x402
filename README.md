# Jio x402

Buy Jio computer time with USDC through an x402 HTTP payment gateway.

[Documentation](docs/README.md) · [Examples](examples/) · [Contributing](CONTRIBUTING.md)

## Getting started

Clone the repository and install dependencies with Bun:

```sh
git clone https://github.com/jiovannish/jio-x402.git
cd jio-x402
bun install --frozen-lockfile
cp .env.example .env
```

Follow [setup](docs/setup.md) to configure PostgreSQL, a dedicated Jio account,
and a Circle Gateway seller address. Then start the gateway:

```sh
bun run migrate
bun start
```

Requires Bun, PostgreSQL, and access to an existing Jio compute API.
Payments currently use Arc Testnet.

## Documentation

Read the [usage guide](docs/README.md) for wallet setup, purchases, receipts,
and refunds. The [TypeScript buyer example](examples/buyer.ts) shows the payment flow.

Jio x402 is experimental. See [current limitations](docs/limitations.md).

## Contributing

Bug reports and pull requests are welcome. Read [Contributing](CONTRIBUTING.md)
and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately using our [security policy](SECURITY.md).

## License

[Apache-2.0](LICENSE).
