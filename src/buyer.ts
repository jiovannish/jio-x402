import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';
import { BatchEvmScheme } from '@circle-fin/x402-batching/client';
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import type { PaymentPayload } from '@x402/core/types';
import {
  ensure,
  signingText,
  canonical,
  atomic,
  amount,
  NETWORK,
  type Rental,
} from './contract.ts';
import { requirements } from './payment.ts';
export class Buyer {
  readonly ledger: Database;
  constructor(
    readonly origin: string,
    readonly seller: string,
    readonly address: `0x${string}`,
    readonly sign: (message: string) => Promise<`0x${string}`>,
    readonly scheme: BatchEvmScheme,
    path: string,
    readonly budget: string,
  ) {
    const u = new URL(origin);
    ensure(
      u.origin === origin &&
        (u.protocol === 'https:' || u.hostname === '127.0.0.1'),
      'UNTRUSTED_ORIGIN',
    );
    atomic(budget);
    this.ledger = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.ledger.exec(
      `PRAGMA journal_mode=DELETE;
       PRAGMA busy_timeout=5000;
       CREATE TABLE IF NOT EXISTS spending (
         quote_id TEXT PRIMARY KEY,
         binding TEXT NOT NULL,
         amount TEXT NOT NULL,
         payment TEXT,
         state TEXT NOT NULL
       )`,
    );
  }
  async request(
    path: string,
    method = 'GET',
    body = '',
    headers: Record<string, string> = {},
  ) {
    const url = new URL(path, this.origin);
    ensure(url.origin === this.origin, 'UNTRUSTED_ORIGIN');
    const stamp = Math.floor(Date.now() / 1000).toString();
    const req = new Request(url.toString(), {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(method === 'GET' ? {} : { body }),
    });
    const signature = await this.sign(signingText(req, body, stamp));
    req.headers.set(
      'authorization',
      `Jio-Wallet ${this.address}.${stamp}.${signature}`,
    );
    return fetch(req, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  }
  async quote(request: Rental) {
    const r = await this.request(
      '/v1/compute/quotes',
      'POST',
      JSON.stringify(request),
    );
    ensure(r.ok, `QUOTE_HTTP_${r.status}`);
    const q = (await r.json()) as any;
    ensure(
      q.configuration_id === request.configuration_id &&
        q.duration_seconds === request.duration_seconds &&
        q.client_public_key === request.client_public_key &&
        q.operation === 'create' &&
        q.vcpu === 1 &&
        q.memory_mib === 2048 &&
        q.billing_start === 'admission',
      'QUOTE_TERMS_CHANGED',
    );
    ensure(
      q.total_amount_atomic === amount(request.duration_seconds) &&
        atomic(q.total_amount_atomic) <= atomic(request.max_amount_atomic),
      'PRICE_EXCEEDS_CAP',
    );
    return q;
  }
  async extensionQuote(computerId: string, seconds: number) {
    return this.request(
      '/v1/compute/quotes',
      'POST',
      JSON.stringify({
        operation: 'extend',
        computer_id: computerId,
        duration_seconds: seconds,
      }),
    );
  }
  async purchase(q: any, key: string) {
    ensure(
      q.operation === 'create' &&
        q.configuration_id === 'small' &&
        q.vcpu === 1 &&
        q.memory_mib === 2048 &&
        q.billing_start === 'admission' &&
        q.currency === 'USDC' &&
        q.network === NETWORK,
      'UNTRUSTED_QUOTE_TERMS',
    );
    ensure(
      q.total_amount_atomic === amount(q.duration_seconds) &&
        atomic(q.total_amount_atomic) <= atomic(q.max_amount_atomic),
      'PRICE_EXCEEDS_CAP',
    );
    ensure(
      q.purchase_url ===
        `${this.origin}/v1/compute/quotes/${q.quote_id}/purchase`,
      'UNTRUSTED_PURCHASE_URL',
    );
    const binding = canonical({
      origin: this.origin,
      seller: this.seller,
      owner: this.address.toLowerCase(),
      q,
      key,
    });
    let row = this.ledger
      .query('SELECT * FROM spending WHERE quote_id=?')
      .get(q.quote_id) as any;
    if (row) ensure(row.binding === binding, 'BUDGET_BINDING_CHANGED');
    if (row && !row.payment)
      throw new Error(
        'SIGNING_OUTCOME_UNKNOWN: recover this order; do not sign again',
      );
    if (!row) {
      ensure(new Date(q.expires_at).getTime() > Date.now(), 'QUOTE_EXPIRED');
      const response = await this.request(q.purchase_url, 'POST', '', {
        'idempotency-key': key,
      });
      ensure(response.status === 402, 'EXPECTED_UNPAID_402');
      const challenge = decodePaymentRequiredHeader(
        response.headers.get('PAYMENT-REQUIRED') ?? '',
      );
      const expected = requirements(q.total_amount_atomic, this.seller);
      ensure(
        challenge.x402Version === 2 &&
          challenge.resource.url === q.purchase_url &&
          challenge.accepts.length === 1 &&
          canonical(challenge.accepts[0]) === canonical(expected),
        'UNTRUSTED_PAYMENT_REQUIREMENTS',
      );
      this.ledger
        .transaction(() => {
          const spent = (
            this.ledger.query('SELECT amount FROM spending').all() as {
              amount: string;
            }[]
          ).reduce((s, r) => s + atomic(r.amount), 0n);
          ensure(
            spent + atomic(q.total_amount_atomic) <= atomic(this.budget),
            'BUDGET_EXCEEDED',
          );
          this.ledger
            .query("INSERT INTO spending VALUES(?,?,?,NULL,'unresolved')")
            .run(q.quote_id, binding, q.total_amount_atomic);
        })
        .immediate();
      const generated = await this.scheme.createPaymentPayload(2, expected);
      const payload: PaymentPayload = {
        ...generated,
        payload: { ...generated.payload },
        accepted: expected,
        resource: challenge.resource,
      };
      const header = encodePaymentSignatureHeader(payload);
      this.ledger
        .query('UPDATE spending SET payment=? WHERE quote_id=?')
        .run(header, q.quote_id);
      row = { payment: header };
    }
    // A new authentication signature can retry the identical payment authorization.
    const result = await this.request(q.purchase_url, 'POST', '', {
      'idempotency-key': key,
      'PAYMENT-SIGNATURE': row.payment,
    });
    ensure(
      result.status === 202,
      `PURCHASE_HTTP_${result.status}: recover quote/order ${q.quote_id}`,
    );
    const status = (await result.json()) as any;
    ensure(status.order_id === q.quote_id, 'ORDER_CHANGED');
    if (['accepted', 'settled'].includes(status.payment_status))
      this.ledger
        .query("UPDATE spending SET state='accepted' WHERE quote_id=?")
        .run(q.quote_id);
    return status;
  }
  async orderStatus(id: string) {
    const r = await this.request(`/v1/compute/orders/${id}`);
    ensure(r.ok, `ORDER_HTTP_${r.status}`);
    return r.json();
  }
  async receipt(id: string) {
    const r = await this.request(`/v1/compute/orders/${id}/receipt`);
    ensure(r.ok, `RECEIPT_HTTP_${r.status}`);
    return r.json();
  }
}
