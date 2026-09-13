import { db, transaction } from './db.ts';
import { createComputer, getOperation, getComputer } from './compute.ts';
import { lookup } from './payment.ts';
import { Fault, NETWORK } from './contract.ts';
export async function refund(id: string, reason: string) {
  await transaction(async (c) => {
    await c.query(
      `INSERT INTO jio_payments.refunds (order_id, amount_atomic, recipient, reason)
       SELECT o.id, q.terms->>'total_amount_atomic', o.payer, $2
       FROM jio_payments.orders o
       JOIN jio_payments.quotes q ON q.id = o.quote_id
       WHERE o.id = $1 AND o.payment_status IN ('accepted', 'settled')
       ON CONFLICT DO NOTHING`,
      [id, reason],
    );
    await c.query(
      "UPDATE jio_payments.orders SET compute_status='failed' WHERE id=$1",
      [id],
    );
  });
}
export async function tick() {
  // ponytail: one worker per database; shard only after measured throughput need.
  const lock = await db.connect();
  try {
    if (
      !(await lock.query('SELECT pg_try_advisory_lock(4027085) AS locked'))
        .rows[0].locked
    )
      return;
    const rows = (
      await db.query(
        `SELECT o.*, q.terms, q.requirements
         FROM jio_payments.orders o
         JOIN jio_payments.quotes q ON q.id = o.quote_id
         WHERE retry_at <= now() AND (
           payment_status IN ('submitting', 'unknown', 'accepted')
           OR (payment_status = 'settled' AND settlement_transaction_hash IS NULL)
           OR compute_status IN ('waiting', 'pending')
         )
         ORDER BY retry_at
         LIMIT 16`,
      )
    ).rows;
    for (const order of rows) {
      await db.query(
        "UPDATE jio_payments.orders SET retry_at=now()+interval '10 seconds' WHERE id=$1",
        [order.id],
      );
      try {
        if (
          ['submitting', 'unknown', 'accepted', 'settled'].includes(
            order.payment_status,
          )
        ) {
          const records = await lookup(
            order.payer,
            order.nonce,
            order.requirements.payTo,
          ).catch(() => []);
          // Search is nonce-filtered. Validate every financial binding before delivery.
          // Live Circle transfers report integer micro-USDC, unlike /v1/balances.
          const record = records.find(
            (r: any) =>
              r.nonce?.toLowerCase() === order.nonce &&
              r.fromAddress?.toLowerCase() === order.payer &&
              r.toAddress?.toLowerCase() ===
                order.requirements.payTo.toLowerCase() &&
              r.sendingNetwork === NETWORK &&
              r.recipientNetwork === NETWORK &&
              r.token === 'USDC' &&
              r.amount === order.requirements.amount,
          );
          if (
            record &&
            ['received', 'batched', 'confirmed', 'completed'].includes(
              record.status,
            )
          ) {
            order.payment_status =
              order.payment_status === 'settled' ||
              ['confirmed', 'completed'].includes(record.status)
                ? 'settled'
                : 'accepted';
            const txHash =
              order.payment_status === 'settled' &&
              /^0x[0-9a-fA-F]{64}$/.test(record.txHash ?? '')
                ? record.txHash
                : null;
            await db.query(
              `UPDATE jio_payments.orders
               SET payment_status = $2, provider_reference = $3,
                   settlement_transaction_hash = COALESCE($4, settlement_transaction_hash)
               WHERE id = $1`,
              [order.id, order.payment_status, record.id, txHash],
            );
          }
        }
        if (!['accepted', 'settled'].includes(order.payment_status)) continue;
        if (order.compute_status === 'waiting') {
          let op;
          try {
            op = await createComputer(order.terms, order.id);
          } catch (e) {
            if (
              e instanceof Fault &&
              [400, 401, 403, 409, 422, 429].includes(e.status)
            ) {
              await refund(order.id, e.code);
              continue;
            }
            throw e;
          }
          order.operation_id = op.id;
          order.computer_id = op.session_id;
          order.compute_status = 'pending';
          await db.query(
            "UPDATE jio_payments.orders SET operation_id=$2,computer_id=$3,compute_status='pending' WHERE id=$1",
            [order.id, op.id, op.session_id],
          );
        }
        if (order.compute_status === 'pending') {
          const op = await getOperation(order.operation_id);
          if (op.state !== 'done') continue;
          if (op.result?.phase === 'rejected') {
            await refund(order.id, 'PROVISIONING_REJECTED');
            continue;
          }
          const computer = await getComputer(order.computer_id);
          if (computer.state === 'expired') {
            await refund(order.id, 'EXPIRED_BEFORE_DELIVERY');
            continue;
          }
          if (computer.state !== 'ready') continue;
          await db.query(
            "UPDATE jio_payments.orders SET compute_status='ready',compute_response=$2 WHERE id=$1",
            [order.id, computer],
          );
        }
      } catch {
        /* Durable state retained. Provider outages never authorize a new charge. */
      }
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(4027085)');
    lock.release();
  }
}
export async function runWorker() {
  while (true) {
    try {
      await tick();
    } catch {}
    await Bun.sleep(1000);
  }
}
