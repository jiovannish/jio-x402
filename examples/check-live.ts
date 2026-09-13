// Read-only: exercises real Jio authentication and Circle capability discovery.
// It does not settle a payment, fund a wallet or create a VM.
import { readFileSync } from 'node:fs';
import { facilitator, lookup, requirements } from '../src/payment.ts';
import { ensure, ASSET, NETWORK } from '../src/contract.ts';
const key = readFileSync('.state/jio.key', 'utf8').trim();
const ca = readFileSync('../client/crates/jio-client/src/jio-ca.pem', 'utf8');
const headers = { authorization: `Bearer ${key}` };
const base = 'https://46.105.119.217';
const health = (await (
  await fetch(base + '/v0/health', {
    headers,
    tls: { ca },
    signal: AbortSignal.timeout(10000),
  })
).json()) as any;
const usage = (await (
  await fetch(base + '/v1/usage', {
    headers,
    tls: { ca },
    signal: AbortSignal.timeout(10000),
  })
).json()) as any;
ensure(
  health.sizes.includes('small') &&
    usage.limits.cpu === 1 &&
    usage.limits.memory_mib === 2048,
  'JIO_ACCOUNT_MISMATCH',
);
const supported = await facilitator.getSupported();
const arc = supported.kinds.find(
  (k) => k.network === NETWORK && k.x402Version === 2 && k.scheme === 'exact',
);
ensure(arc, 'ARC_UNAVAILABLE');
const sample = requirements(
  '4275',
  '0x1111111111111111111111111111111111111111',
);
ensure(
  arc?.extra?.verifyingContract?.toString().toLowerCase() ===
    sample.extra?.verifyingContract?.toString().toLowerCase(),
  'GATEWAY_CONFIG_MISMATCH',
);
const result = {
  checked_at: new Date().toISOString(),
  jio: {
    account: usage.account_id,
    cpu: usage.limits.cpu,
    memory_mib: usage.limits.memory_mib,
    ttl_seconds: usage.session_ttl_seconds,
    retained: usage.retained_sessions,
  },
  circle: {
    network: arc.network,
    asset: ASSET,
    gateway: sample.extra?.verifyingContract,
  },
  real_payment_executed: false,
};
console.log(JSON.stringify(result, null, 2));
await Bun.write(
  'docs/live-capabilities.json',
  JSON.stringify(result, null, 2) + '\n',
);
