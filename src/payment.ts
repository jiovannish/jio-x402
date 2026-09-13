import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  ASSET,
  NETWORK,
  FACILITATOR,
  ensure,
  canonical,
  hash,
  Fault,
} from './contract.ts';
export const facilitator = new BatchFacilitatorClient({ url: FACILITATOR });
export function requirements(
  amount: string,
  seller: string,
): PaymentRequirements {
  ensure(/^0x[0-9a-fA-F]{40}$/.test(seller), 'SELLER_ADDRESS_REQUIRED', 503);
  const chain = CHAIN_CONFIGS.arcTestnet;
  ensure(
    chain.chain.id === 5042002 && chain.usdc.toLowerCase() === ASSET,
    'SDK_CHAIN_MISMATCH',
    503,
  );
  return {
    scheme: 'exact',
    network: NETWORK,
    asset: ASSET,
    amount,
    payTo: seller,
    maxTimeoutSeconds: 605100,
    extra: {
      name: 'GatewayWalletBatched',
      version: '1',
      verifyingContract: chain.gatewayWallet,
    },
  };
}
export function payment(
  header: string,
  expected: PaymentRequirements,
  url: string,
) {
  ensure(header.length <= 16384, 'PAYMENT_TOO_LARGE', 413);
  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    throw new Fault(402, 'INVALID_PAYMENT_ENCODING');
  }
  ensure(
    payload?.x402Version === 2 &&
      canonical(payload.accepted) === canonical(expected) &&
      payload.resource?.url === url,
    'PAYMENT_TERMS_CHANGED',
    402,
  );
  const a = payload.payload?.authorization as
    Record<string, unknown> | undefined;
  ensure(
    a &&
      typeof a.from === 'string' &&
      /^0x[0-9a-fA-F]{40}$/.test(a.from) &&
      typeof a.nonce === 'string' &&
      /^0x[0-9a-fA-F]{64}$/.test(a.nonce),
    'INVALID_AUTHORIZATION',
    402,
  );
  ensure(
    a.to &&
      String(a.to).toLowerCase() === expected.payTo.toLowerCase() &&
      a.value === expected.amount,
    'PAYMENT_AMOUNT_OR_PAYEE_CHANGED',
    402,
  );
  ensure(
    typeof a.validBefore === 'string' &&
      /^[0-9]{1,12}$/.test(a.validBefore) &&
      Number(a.validBefore) > Date.now() / 1000 + 604800,
    'AUTHORIZATION_TOO_SHORT',
    402,
  );
  const payer = a.from.toLowerCase(),
    nonce = a.nonce.toLowerCase();
  return {
    payload,
    payer,
    nonce,
    identity: hash(
      [
        NETWORK,
        ASSET,
        String(expected.extra?.verifyingContract).toLowerCase(),
        payer,
        nonce,
      ].join(':'),
    ),
  };
}
export async function lookup(payer: string, nonce: string, seller: string) {
  const query = new URLSearchParams({
    from: payer,
    to: seller,
    nonce,
    network: NETWORK,
    token: 'USDC',
    pageSize: '2',
  });
  const r = await fetch(`${FACILITATOR}/v1/x402/transfers?${query}`, {
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  ensure(r.ok, 'PAYMENT_RECONCILIATION_UNAVAILABLE', 503);
  const data = (await r.json()) as any;
  ensure(Array.isArray(data.transfers), 'INVALID_TRANSFER_RESPONSE', 503);
  return data.transfers;
}
