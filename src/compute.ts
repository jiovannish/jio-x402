import { ensure, Fault, type Rental } from './contract.ts';
export async function jio(path: string, init: RequestInit = {}): Promise<any> {
  const url = process.env.JIO_API_URL;
  ensure(url && process.env.JIO_API_KEY, 'JIO_CONFIGURATION_REQUIRED', 503);
  const response = await fetch(new URL(path, url), {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.JIO_API_KEY}`,
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Fault(response.status, `JIO_HTTP_${response.status}`);
  return response.status === 204 ? null : response.json();
}
export async function quoteCompute(r: Rental) {
  const [health, usage] = await Promise.all([
    jio('/v0/health'),
    jio('/v1/usage'),
  ]);
  ensure(health.sizes?.includes('small'), 'SMALL_UNAVAILABLE', 409);
  // Existing workers enforce the account deadline. Never pretend a gateway timer
  // or an arbitrary request parameter changes that deadline.
  const perRequest =
    Number.isSafeInteger(usage.rental_max_seconds) &&
    r.duration_seconds >= 30 &&
    r.duration_seconds <= usage.rental_max_seconds;
  ensure(
    perRequest || usage.session_ttl_seconds === r.duration_seconds,
    'DURATION_UNAVAILABLE',
    422,
  );
  ensure(usage.retained_sessions === 0, 'CAPACITY_UNAVAILABLE', 409);
  return {
    vcpu: 1,
    memory_mib: 2048,
    billing_start: 'admission',
    capacity_reserved: false,
    duration_source: perRequest ? 'request' : 'account',
  };
}
export const createComputer = (
  terms: Rental & { duration_source?: string },
  orderId: string,
) =>
  jio('/v1/sessions', {
    method: 'POST',
    headers: { 'idempotency-key': orderId },
    body: JSON.stringify({
      profile: 'small',
      client_public_key: terms.client_public_key,
      ...(terms.duration_source === 'request'
        ? { duration_seconds: terms.duration_seconds }
        : {}),
    }),
  });
// A replay of this exact POST recovers the original operation after a lost
// response: Server looks up (account,idempotency_key) before admission.
export const getOperation = (id: string) => jio(`/v1/operations/${id}`);
export const getComputer = (id: string) => jio(`/v1/sessions/${id}`);
export const stopComputer = (id: string, key: string) =>
  jio(`/v1/sessions/${id}/stop`, {
    method: 'POST',
    headers: { 'idempotency-key': key },
  });
