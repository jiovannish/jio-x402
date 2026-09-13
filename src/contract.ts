import { createHash } from 'node:crypto';
import { verifyMessage } from 'viem';
export const NETWORK = 'eip155:5042002';
export const ASSET = '0x3600000000000000000000000000000000000000';
export const FACILITATOR = 'https://gateway-api-testnet.circle.com';
export const HOURLY_ATOMIC = 8550n;
export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function ensure(ok: unknown, code: string, status = 400): asserts ok {
  if (!ok) throw new Fault(status, code);
}
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v !== null && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
export function amount(seconds: number): string {
  ensure(
    Number.isSafeInteger(seconds) && seconds >= 30 && seconds <= 86400,
    'DURATION_RANGE_30_TO_86400',
  );
  return ((BigInt(seconds) * HOURLY_ATOMIC + 3599n) / 3600n).toString();
}
export function atomic(v: unknown): bigint {
  ensure(
    typeof v === 'string' && /^[0-9]{1,20}$/.test(v),
    'INVALID_ATOMIC_AMOUNT',
  );
  return BigInt(v);
}
export type Rental = {
  operation: 'create';
  configuration_id: 'small';
  duration_seconds: number;
  client_public_key: string;
  max_amount_atomic: string;
};
export function rental(v: any): Rental {
  ensure(v && typeof v === 'object' && !Array.isArray(v), 'INVALID_REQUEST');
  ensure(v.operation !== 'extend', 'EXTENSION_UNAVAILABLE', 422);
  ensure(
    Object.keys(v).every((k) =>
      [
        'operation',
        'configuration_id',
        'duration_seconds',
        'client_public_key',
        'max_amount_atomic',
      ].includes(k),
    ),
    'UNKNOWN_FIELD',
  );
  ensure(
    v.operation === 'create' && v.configuration_id === 'small',
    'ONLY_SMALL_CREATE_SUPPORTED',
  );
  ensure(typeof v.client_public_key === 'string', 'SSH_ED25519_KEY_REQUIRED');
  const m = /^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})$/.exec(v.client_public_key);
  ensure(m, 'SSH_ED25519_KEY_REQUIRED');
  const bytes = Buffer.from(m[1]!, 'base64');
  ensure(
    bytes.length === 51 &&
      bytes
        .subarray(0, 19)
        .equals(Buffer.from('0000000b7373682d6564323535313900000020', 'hex')),
    'INVALID_SSH_KEY',
  );
  ensure(
    atomic(v.max_amount_atomic) >= BigInt(amount(v.duration_seconds)),
    'PRICE_EXCEEDS_CAP',
    422,
  );
  return v;
}
export function signingText(
  req: Request,
  body: string,
  timestamp: string,
): string {
  return [
    'jio-control-v1',
    timestamp,
    req.method,
    req.url,
    hash(body),
    req.headers.get('idempotency-key') ?? '',
    hash(req.headers.get('payment-signature') ?? ''),
  ].join('\n');
}
// The paying EOA also controls quote/order access. An intercepted payment alone
// cannot authenticate as that owner or fund an attacker-owned quote.
export async function owner(req: Request, body: string): Promise<string> {
  const parts = req.headers
    .get('authorization')
    ?.match(
      /^Jio-Wallet (0x[0-9a-fA-F]{40})\.([0-9]{10})\.(0x[0-9a-fA-F]{130})$/,
    );
  ensure(parts, 'OWNER_SIGNATURE_REQUIRED', 401);
  const [, address, stamp, signature] = parts;
  ensure(
    Math.abs(Date.now() / 1000 - Number(stamp)) <= 60,
    'OWNER_SIGNATURE_EXPIRED',
    401,
  );
  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message: signingText(req, body, stamp!),
      signature: signature as `0x${string}`,
    });
  } catch {}
  ensure(valid, 'OWNER_SIGNATURE_INVALID', 401);
  return address!.toLowerCase();
}
