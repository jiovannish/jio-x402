# Security policy

## Reporting a vulnerability

Email [saul@saugar.dev](mailto:saul@saugar.dev) with the affected commit,
a description of the issue, its impact, and steps to reproduce it.

Do not open a public issue or include live API keys, entity secrets, private
keys, payment signatures, or other people's data. We will coordinate investigation
and disclosure privately.

## Supported versions

This project is experimental. Security fixes target the latest maintained code;
there is no long-term support commitment for older versions.

Keep buyer signing credentials and treasury credentials separate from the public
gateway and rented computers. Never return the gateway's provisioning key to a
buyer. See [current limitations](docs/limitations.md) and [recovery](docs/recovery.md).
