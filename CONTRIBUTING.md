# Contributing

Open an issue for bugs or proposed changes, or send a focused pull request.
Include reproduction steps, the commit, and `bun --version` for bugs. Keep API
keys, entity secrets, payment signatures, and private computer data out of reports.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using
[SECURITY.md](SECURITY.md).

## Development

Install Bun and PostgreSQL, then install the pinned dependencies:

```sh
bun install --frozen-lockfile
bun run check
createdb jio_payments_test
DATABASE_URL=postgresql://localhost:5432/jio_payments_test bun test
```

Adjust the database connection for your environment. Tests require a dedicated
`jio_payments_test` database and truncate its payment tables. They use mocked
provider responses and do not buy compute or send payments.

Keep changes focused on payments and the existing compute adapter. Add a
regression test for money, authentication, or recovery behavior. Documentation
changes only need command and link checks. Keep user documentation in [docs/](docs/README.md).

Live examples send testnet payments and may allocate real compute. Use dedicated
test wallets and a dedicated Jio account; see [setup](docs/setup.md#checks).
