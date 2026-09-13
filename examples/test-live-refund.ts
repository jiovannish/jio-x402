// Real Circle payment/reconciliation/refund; ONLY provisioning failure is injected.
// Run with the local gateway stopped. Never points the failure injector at Core.
import { buyer } from './buyer.ts';
import { handle } from '../src/server.ts';
import { tick } from '../src/worker.ts';
import { processRefund } from '../src/refunds.ts';
import { db } from '../src/db.ts';
import { ensure } from '../src/contract.ts';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
ensure(
  process.env.PUBLIC_ORIGIN === 'http://127.0.0.1:4020',
  'LOCAL_TEST_ONLY',
);
ensure(process.env.CIRCLE_API_KEY?.startsWith('TEST_API_KEY:'), 'TESTNET_ONLY');
const original = globalThis.fetch;
let attempts = 0;
globalThis.fetch = (async (input: any, init: any) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.origin === new URL(process.env.JIO_API_URL!).origin &&
    url.pathname === '/v1/sessions' &&
    init?.method === 'POST'
  ) {
    attempts++;
    return Response.json(
      { error: 'injected capacity failure' },
      { status: 409 },
    );
  }
  return original(input, init);
}) as typeof fetch;
const server = Bun.serve({ hostname: '127.0.0.1', port: 4020, fetch: handle });
try {
  const path = '.state/live-failure-quote.json';
  const q = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : await buyer.quote({
        operation: 'create',
        configuration_id: 'small',
        duration_seconds: 1800,
        client_public_key: process.env.SSH_PUBLIC_KEY!,
        max_amount_atomic: '4275',
      });
  writeFileSync(path, JSON.stringify(q), { mode: 0o600 });
  const paid = (await buyer.purchase(q, q.quote_id)) as any;
  ensure(
    ['accepted', 'settled'].includes(paid.payment_status),
    'PAYMENT_PENDING_RERUN',
  );
  // Simulate the local acceptance write being lost. Recovery must query Circle;
  // it must not submit a second authorization or payment.
  await db.query(
    "UPDATE jio_payments.orders SET payment_status='unknown',retry_at=now() WHERE id=$1 AND compute_status='waiting'",
    [q.quote_id],
  );
  await tick();
  const pending = (await buyer.receipt(q.quote_id)) as any;
  ensure(
    pending.refund_status === 'pending' ||
      pending.refund_status === 'submitted' ||
      pending.refund_status === 'confirmed',
    'REFUND_NOT_RECORDED',
  );
  const treasury = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY!,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  });
  let status = 'pending';
  for (let i = 0; i < 40; i++) {
    status = await processRefund(q.quote_id, treasury);
    if (status === 'confirmed') break;
    await Bun.sleep(3000);
  }
  const receipt = (await buyer.receipt(q.quote_id)) as any;
  writeFileSync(
    'docs/live-refund.json',
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        ...receipt,
        provisioning_failure_injected: true,
        local_acceptance_loss_injected: true,
        create_attempts_this_run: attempts,
        real_computers_created: 0,
      },
      null,
      2,
    ) + '\n',
  );
  ensure(status === 'confirmed', 'REFUND_PENDING_RERUN');
  const duplicate = await processRefund(q.quote_id, treasury);
  ensure(duplicate === 'confirmed', 'REFUND_RETRY_CHANGED');
  console.log({
    order: q.quote_id,
    refund: status,
    transaction_hash: receipt.refund_transaction_hash,
    provisioning_failure_injected: true,
  });
} catch (e: any) {
  console.error({
    error: e.code ?? 'LIVE_REFUND_TEST_FAILED',
    message: e.response ? 'Circle API error' : e.message,
  });
  process.exitCode = 1;
} finally {
  server.stop(true);
  globalThis.fetch = original;
  await db.end();
}
