import { test, expect, beforeAll, afterAll } from 'bun:test';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { BatchEvmScheme } from '@circle-fin/x402-batching/client';
import {
  encodePaymentSignatureHeader,
  decodePaymentRequiredHeader,
} from '@x402/core/http';
import { randomUUID } from 'node:crypto';
import { amount, signingText, NETWORK, canonical } from '../src/contract.ts';
import { handle } from '../src/server.ts';
import { db } from '../src/db.ts';
import { tick } from '../src/worker.ts';
import { requirements } from '../src/payment.ts';
import { Buyer } from '../src/buyer.ts';
import { processRefund } from '../src/refunds.ts';
import { quoteCompute, createComputer } from '../src/compute.ts';
const a = privateKeyToAccount(generatePrivateKey()),
  other = privateKeyToAccount(generatePrivateKey());
const seller = privateKeyToAccount(generatePrivateKey()).address;
const originalFetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4020';
const pub =
  'ssh-ed25519 ' +
  Buffer.concat([
    Buffer.from('0000000b7373682d6564323535313900000020', 'hex'),
    Buffer.alloc(32, 7),
  ]).toString('base64');
const terms = {
  operation: 'create',
  configuration_id: 'small',
  duration_seconds: 1800,
  client_public_key: pub,
  max_amount_atomic: '4275',
};
let charges = 0,
  creates = 0,
  attempts = 0,
  mode = 'ok',
  search: any[] = [],
  ops = new Map<string, any>();
async function request(
  path: string,
  method = 'GET',
  body = '',
  headers: Record<string, string> = {},
  who = a,
) {
  const r = new Request(origin + path, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body }),
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = await who.signMessage({
    message: signingText(r, body, timestamp),
  });
  r.headers.set(
    'authorization',
    `Jio-Wallet ${who.address}.${timestamp}.${sig}`,
  );
  return handle(r);
}
async function quote() {
  const r = await request('/v1/compute/quotes', 'POST', JSON.stringify(terms));
  expect(r.status).toBe(201);
  return r.json() as Promise<any>;
}
async function payload(q: any) {
  const req = requirements(q.total_amount_atomic, seller);
  const scheme = new BatchEvmScheme(a);
  const generated = await scheme.createPaymentPayload(2, req);
  return {
    ...generated,
    payload: { ...generated.payload },
    accepted: req,
    resource: {
      url: q.purchase_url,
      description: 'One Jio small computer rental',
      mimeType: 'application/json',
    },
  };
}
const buy = (q: any, p: any, key = q.quote_id) =>
  request(`/v1/compute/quotes/${q.quote_id}/purchase`, 'POST', '', {
    'idempotency-key': key,
    'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(p),
  });
async function reset() {
  await db.query(
    'TRUNCATE jio_payments.refunds,jio_payments.orders,jio_payments.quotes CASCADE',
  );
  charges = 0;
  creates = 0;
  attempts = 0;
  mode = 'ok';
  search = [];
  ops.clear();
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('/jio_payments_test'))
    throw new Error('Use the dedicated local jio_payments_test database');
  process.env.PUBLIC_ORIGIN = origin;
  process.env.SELLER_ADDRESS = seller;
  process.env.JIO_API_KEY = 'test-only';
  process.env.JIO_API_URL = 'http://jio.test';
  await db.query(
    await Bun.file(
      new URL('../migrations/001-payments.sql', import.meta.url),
    ).text(),
  );
  await db.query(
    await Bun.file(
      new URL('../migrations/002-recovery.sql', import.meta.url),
    ).text(),
  );
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href,
    );
    if (url.origin === origin)
      return handle(
        input instanceof Request ? input : new Request(url.toString(), init),
      );
    if (url.hostname === 'jio.test') {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer test-only',
      );
      if (url.pathname === '/v0/health')
        return Response.json({ sizes: ['small'] });
      if (url.pathname === '/v1/usage')
        return Response.json({
          session_ttl_seconds: 1800,
          retained_sessions: 0,
          ...(mode === 'rental-policy' ? { rental_max_seconds: 86400 } : {}),
        });
      if (url.pathname === '/v1/sessions') {
        if (mode === 'rental-policy')
          expect(JSON.parse(init.body).duration_seconds).toBe(86400);
        attempts++;
        const key = new Headers(init.headers).get('idempotency-key')!;
        if (mode === 'capacity') return Response.json({}, { status: 409 });
        if (!ops.has(key)) {
          creates++;
          ops.set(key, {
            id: randomUUID().replaceAll('-', ''),
            session_id: randomUUID().replaceAll('-', ''),
            state: 'done',
            result: { phase: 'done' },
          });
        }
        if (mode === 'lost-create') {
          mode = 'ok';
          throw new Error('response lost after create');
        }
        return Response.json(ops.get(key));
      }
      if (url.pathname.startsWith('/v1/operations/'))
        return Response.json(
          [...ops.values()].find((o) => url.pathname.endsWith(o.id)),
        );
      if (url.pathname.startsWith('/v1/sessions/'))
        return Response.json({
          state: 'ready',
          expires_at_unix_seconds: Math.floor(Date.now() / 1000) + 1800,
        });
    }
    if (url.hostname === 'gateway-api-testnet.circle.com') {
      if (url.pathname === '/v1/x402/verify')
        return Response.json(
          mode === 'reject'
            ? { isValid: false, invalidReason: 'invalid_signature' }
            : { isValid: true, payer: a.address },
        );
      if (url.pathname === '/v1/x402/settle') {
        charges++;
        if (mode === 'lost-payment')
          throw new Error('response lost after acceptance');
        return Response.json({
          success: true,
          payer: a.address,
          network: NETWORK,
          transaction: '',
        });
      }
      if (url.pathname === '/v1/x402/transfers')
        return Response.json({ transfers: search });
    }
    throw new Error(
      'Unexpected network destination ' + url.origin + url.pathname,
    );
  }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await db.end();
});
test('pricing uses integer micro-USDC and exact duration bounds', () => {
  expect([amount(30), amount(1800), amount(86400)]).toEqual([
    '72',
    '4275',
    '205200',
  ]);
  expect(() => amount(29)).toThrow();
  expect(() => amount(86401)).toThrow();
  expect(() => amount(NaN)).toThrow();
});
test('per-request lifetime requires advertised Server support and is sent unchanged', async () => {
  await reset();
  const r = {
    ...terms,
    duration_seconds: 86400,
    max_amount_atomic: '205200',
  } as any;
  await expect(quoteCompute(r)).rejects.toThrow('DURATION_UNAVAILABLE');
  mode = 'rental-policy';
  const capability = await quoteCompute(r);
  expect(capability.duration_source).toBe('request');
  await createComputer({ ...r, ...capability }, randomUUID());
  expect(creates).toBe(1);
});
test('TLS edge uses configured public host and rejects forged forwarding authority', async () => {
  process.env.PUBLIC_ORIGIN = 'https://payments.example';
  try {
    const body = JSON.stringify(terms),
      stamp = Math.floor(Date.now() / 1000).toString();
    const publicReq = new Request(
      'https://payments.example/v1/compute/quotes',
      { method: 'POST', body },
    );
    const signature = await a.signMessage({
      message: signingText(publicReq, body, stamp),
    });
    const headers = {
      authorization: `Jio-Wallet ${a.address}.${stamp}.${signature}`,
    };
    const proxied = new Request('http://payments.example/v1/compute/quotes', {
      method: 'POST',
      body,
      headers,
    });
    expect((await handle(proxied)).status).toBe(201);
    expect(
      (
        await handle(
          new Request('http://attacker.example/v1/compute/quotes', {
            method: 'POST',
            body,
            headers: { ...headers, 'x-forwarded-host': 'payments.example' },
          }),
        )
      ).status,
    ).toBe(400);
  } finally {
    process.env.PUBLIC_ORIGIN = origin;
  }
});
test('unpaid 402, concurrent retries, receipt and cross-owner isolation', async () => {
  await reset();
  const q = await quote();
  const unpaid = await request(
    `/v1/compute/quotes/${q.quote_id}/purchase`,
    'POST',
    '',
    { 'idempotency-key': q.quote_id },
  );
  expect(unpaid.status).toBe(402);
  expect(
    decodePaymentRequiredHeader(unpaid.headers.get('PAYMENT-REQUIRED')!)
      .accepts[0]?.amount,
  ).toBe('4275');
  await tick();
  expect(creates).toBe(0);
  expect(charges).toBe(0);
  const p = await payload(q);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => buy(q, p)),
  );
  expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202));
  expect(charges).toBe(1);
  await tick();
  expect(creates).toBe(1);
  const status = (await (
    await request(`/v1/compute/orders/${q.quote_id}/receipt`)
  ).json()) as any;
  expect(status.compute_status).toBe('ready');
  expect(status.settlement_status).toBe('unconfirmed');
  expect(
    (await request(`/v1/compute/orders/${q.quote_id}`, 'GET', '', {}, other))
      .status,
  ).toBe(404);
  const second = await quote();
  const replay = {
    ...p,
    resource: { ...p.resource, url: second.purchase_url },
  };
  expect((await buy(second, replay)).status).toBe(409);
  expect(charges).toBe(1);
  expect((await buy(second, await payload(second), q.quote_id)).status).toBe(
    409,
  );
});
test('wrong amount, asset, network, payee, expiry, extension and altered owner cannot charge', async () => {
  await reset();
  const q = await quote(),
    p = await payload(q);
  for (const field of ['amount', 'asset', 'network', 'payTo']) {
    const bad = structuredClone(p);
    (bad.accepted as any)[field] = 'wrong';
    expect((await buy(q, bad)).status).toBe(402);
  }
  expect(
    (
      await request(
        `/v1/compute/quotes/${q.quote_id}/purchase`,
        'POST',
        '',
        {
          'idempotency-key': q.quote_id,
          'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(p),
        },
        other,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        '/v1/compute/quotes',
        'POST',
        JSON.stringify({ ...terms, operation: 'extend' }),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await request(
        '/v1/compute/quotes',
        'POST',
        JSON.stringify({
          ...terms,
          duration_seconds: 86400,
          max_amount_atomic: '205200',
        }),
      )
    ).status,
  ).toBe(422);
  await db.query(
    "UPDATE jio_payments.quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
    [q.quote_id],
  );
  expect((await buy(q, p)).status).toBe(410);
  expect(charges).toBe(0);
  expect(creates).toBe(0);
});
test('invalid signature never settles or creates', async () => {
  await reset();
  const q = await quote();
  mode = 'reject';
  expect((await buy(q, await payload(q))).status).toBe(402);
  await tick();
  expect(charges).toBe(0);
  expect(creates).toBe(0);
});
test('lost payment response reconciles nonce; lost create response replays original key', async () => {
  await reset();
  const q = await quote(),
    p = await payload(q);
  mode = 'lost-payment';
  await buy(q, p);
  let state = (await (
    await request(`/v1/compute/orders/${q.quote_id}`)
  ).json()) as any;
  expect(state.payment_status).toBe('unknown');
  await buy(q, p);
  expect(charges).toBe(1);
  expect(creates).toBe(0);
  search = [
    {
      id: randomUUID(),
      nonce: p.payload.authorization.nonce,
      fromAddress: a.address,
      toAddress: seller,
      sendingNetwork: NETWORK,
      recipientNetwork: NETWORK,
      token: 'USDC',
      amount: '0.004275',
      status: 'confirmed',
    },
  ];
  await db.query('UPDATE jio_payments.orders SET retry_at=now()');
  await tick();
  expect(creates).toBe(0);
  search[0].amount = '4275';
  await db.query('UPDATE jio_payments.orders SET retry_at=now()');
  mode = 'lost-create';
  await tick();
  expect(creates).toBe(1);
  await db.query('UPDATE jio_payments.orders SET retry_at=now()');
  await tick();
  expect(creates).toBe(1);
  expect(attempts).toBe(2);
  expect(charges).toBe(1);
  state = (await (
    await request(`/v1/compute/orders/${q.quote_id}`)
  ).json()) as any;
  expect(state.compute_status).toBe('ready');
  expect(state.settlement_status).toBe('settled');
});
test('failed capacity leaves exactly one honest pending refund obligation', async () => {
  await reset();
  const q = await quote();
  await buy(q, await payload(q));
  mode = 'capacity';
  await tick();
  await tick();
  const r = (await (
    await request(`/v1/compute/orders/${q.quote_id}/receipt`)
  ).json()) as any;
  expect(r.refund_status).toBe('pending');
  expect(r.refund_amount_atomic).toBe('4275');
  expect(r.refund_transfer_id).toBeNull();
  expect(creates).toBe(0);
  expect(
    (await db.query('SELECT count(*) FROM jio_payments.refunds')).rows[0].count,
  ).toBe('1');
});
test('refund recovers lost submission with the same key and pays only the verified payer', async () => {
  await reset();
  const q = await quote();
  await buy(q, await payload(q));
  mode = 'capacity';
  await tick();
  let effect = 0,
    attempt = 0;
  const ids = new Map<string, string>();
  const treasury: any = {
    createContractExecutionTransaction: async (p: any) => {
      expect(p.abiParameters).toEqual([a.address.toLowerCase(), '4275']);
      expect(p.walletAddress).toBe(seller);
      expect(p.idempotencyKey).toBe(q.quote_id);
      attempt++;
      if (!ids.has(p.idempotencyKey)) {
        ids.set(p.idempotencyKey, randomUUID());
        effect++;
      }
      if (attempt === 1) throw new Error('Lost refund response');
      return { data: { id: ids.get(p.idempotencyKey) } };
    },
    getTransaction: async () => ({
      data: {
        transaction: { state: 'COMPLETE', txHash: '0x' + 'a'.repeat(64) },
      },
    }),
  };
  await expect(processRefund(q.quote_id, treasury)).rejects.toThrow(
    'Lost refund response',
  );
  expect(await processRefund(q.quote_id, treasury)).toBe('confirmed');
  expect(await processRefund(q.quote_id, treasury)).toBe('confirmed');
  expect(effect).toBe(1);
  expect(attempt).toBe(2);
});
test('buyer unresolved budget survives retries and concurrent attempts', async () => {
  await reset();
  const buyer = new Buyer(
    origin,
    seller,
    a.address,
    (message) => a.signMessage({ message }),
    new BatchEvmScheme(a),
    '/private/tmp/jio-buyer-' + randomUUID() + '.sqlite',
    '5000',
  );
  const q = await buyer.quote(terms as any),
    q2 = await buyer.quote(terms as any);
  const results = await Promise.allSettled([
    buyer.purchase(q, q.quote_id),
    buyer.purchase(q2, q2.quote_id),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(charges).toBe(1);
  expect(
    (buyer.ledger.query('SELECT count(*) AS n FROM spending').get() as any).n,
  ).toBe(1);
  buyer.ledger.close();
});
