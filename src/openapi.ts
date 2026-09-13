const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const content = (name: string) => ({
  'application/json': { schema: ref(name) },
});
const id = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const atomic = {
  type: 'string',
  pattern: '^[0-9]{1,20}$',
  description: 'Integer micro-USDC, six decimal places',
};
const quoteProperties = {
  quote_id: { type: 'string', format: 'uuid' },
  operation: { const: 'create' },
  configuration_id: { const: 'small' },
  client_public_key: {
    type: 'string',
    description: 'Canonical ssh-ed25519 public key, without comment',
  },
  duration_seconds: { type: 'integer', minimum: 30, maximum: 86400 },
  max_amount_atomic: atomic,
  total_amount_atomic: atomic,
  currency: { const: 'USDC' },
  network: { const: 'eip155:5042002' },
  vcpu: { const: 1 },
  memory_mib: { const: 2048 },
  billing_start: { const: 'admission' },
  capacity_reserved: { const: false },
  duration_source: { enum: ['account', 'request'] },
  price_basis: { type: 'string' },
  expires_at: { type: 'string', format: 'date-time' },
  purchase_url: { type: 'string', format: 'uri' },
};
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Jio x402 compute rentals',
    version: '0.1.0',
    description:
      'Arc Testnet. One 1-vCPU / 2048-MiB VM. Only infrastructure-enforced lifetimes are quoted. Extensions are unavailable. Refund execution uses the separate operator treasury command.',
  },
  security: [{ wallet: [] }],
  components: {
    securitySchemes: {
      wallet: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description:
          'Jio-Wallet ADDRESS.UNIX_SECONDS.EIP191_SIGNATURE_HEX. Sign UTF-8: jio-control-v1, timestamp, HTTP method, absolute public URL, SHA256(raw body), Idempotency-Key or empty, SHA256(PAYMENT-SIGNATURE or empty), separated by newlines. Timestamp tolerance: 60 seconds. Payer must equal signer.',
      },
    },
    schemas: {
      QuoteRequest: {
        type: 'object',
        additionalProperties: false,
        required: [
          'operation',
          'configuration_id',
          'duration_seconds',
          'client_public_key',
          'max_amount_atomic',
        ],
        properties: Object.fromEntries(
          [
            'operation',
            'configuration_id',
            'duration_seconds',
            'client_public_key',
            'max_amount_atomic',
          ].map((k) => [k, quoteProperties[k as keyof typeof quoteProperties]]),
        ),
        example: {
          operation: 'create',
          configuration_id: 'small',
          duration_seconds: 1800,
          client_public_key: 'ssh-ed25519 <base64-ed25519-key>',
          max_amount_atomic: '4275',
        },
      },
      Quote: {
        type: 'object',
        required: Object.keys(quoteProperties),
        properties: quoteProperties,
      },
      Order: {
        type: 'object',
        required: [
          'order_id',
          'payment_status',
          'compute_status',
          'status_url',
          'settlement_status',
        ],
        properties: {
          order_id: { type: 'string', format: 'uuid' },
          payment_status: {
            enum: ['submitting', 'unknown', 'rejected', 'accepted', 'settled'],
          },
          compute_status: {
            enum: [
              'waiting',
              'pending',
              'ready',
              'failed',
              'expired',
              'stopped',
            ],
            description:
              'Provisioning outcome; consult computer for current lifecycle state',
          },
          operation_id: { type: ['string', 'null'] },
          computer_id: { type: ['string', 'null'] },
          status_url: { type: 'string', format: 'uri' },
          computer: {
            type: ['object', 'null'],
            description:
              'Current existing-API observation; null when unavailable or not allocated',
            properties: {
              state: { type: 'string' },
              expires_at_unix_seconds: { type: ['integer', 'null'] },
              last_checked_at_unix_seconds: { type: ['integer', 'null'] },
            },
          },
          computer_status_available: { type: 'boolean' },
          provider_reference: {
            type: ['string', 'null'],
            description: 'Opaque Gateway transfer ID; not an onchain hash',
          },
          payment_response: {
            type: ['object', 'null'],
            description:
              'Official facilitator response; transaction may be an opaque transfer ID',
          },
          settlement_status: { enum: ['unconfirmed', 'settled'] },
          settlement_transaction_hash: {
            type: ['string', 'null'],
            description:
              'Actual batch transaction hash, only when Circle reports one',
          },
          quote_expires_at: { type: 'string', format: 'date-time' },
          terms: {
            type: 'object',
            description:
              'Immutable quoted request and price; expiration is not the computer deadline',
            properties: quoteProperties,
          },
          requirements: ref('PaymentRequirements'),
          refund_status: {
            type: ['string', 'null'],
            enum: [null, 'pending', 'submitted', 'confirmed'],
          },
          refund_amount_atomic: { type: ['string', 'null'] },
          refund_transfer_id: { type: ['string', 'null'] },
          refund_transaction_hash: { type: ['string', 'null'] },
        },
      },
      PaymentRequirements: {
        type: 'object',
        description: 'SDK-compatible x402 v2 Arc Gateway exact option',
        required: [
          'scheme',
          'network',
          'asset',
          'amount',
          'payTo',
          'maxTimeoutSeconds',
          'extra',
        ],
        properties: {
          scheme: { const: 'exact' },
          network: { const: 'eip155:5042002' },
          asset: { const: '0x3600000000000000000000000000000000000000' },
          amount: atomic,
          payTo: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
          maxTimeoutSeconds: { const: 605100 },
          extra: {
            type: 'object',
            properties: {
              name: { const: 'GatewayWalletBatched' },
              version: { const: '1' },
              verifyingContract: { type: 'string' },
            },
          },
        },
      },
      PaymentRequired: {
        type: 'object',
        required: ['x402Version', 'resource', 'accepts'],
        properties: {
          x402Version: { const: 2 },
          resource: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              description: { type: 'string' },
              mimeType: { type: 'string' },
            },
          },
          accepts: { type: 'array', items: ref('PaymentRequirements') },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } },
      },
    },
  },
  paths: {
    '/v1/compute/quotes': {
      post: {
        summary: 'Validate and quote; no charge or capacity reservation',
        requestBody: { required: true, content: content('QuoteRequest') },
        responses: {
          '201': {
            description: 'Immutable 60-second quote',
            content: content('Quote'),
          },
          '422': {
            description:
              'DURATION_UNAVAILABLE, EXTENSION_UNAVAILABLE, or PRICE_EXCEEDS_CAP',
            content: content('Error'),
          },
        },
      },
    },
    '/v1/compute/quotes/{id}/purchase': {
      post: {
        summary: 'Purchase once; body must be empty or {}',
        parameters: [
          id,
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          },
          {
            name: 'PAYMENT-SIGNATURE',
            in: 'header',
            schema: { type: 'string' },
            description:
              'SDK base64 encoded x402 v2 payment; reuse exact authorization on retries',
          },
        ],
        responses: {
          '402': {
            description:
              'Unpaid: SDK PAYMENT-REQUIRED. Invalid payment: actionable error with order reference.',
            headers: { 'PAYMENT-REQUIRED': { schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: { oneOf: [ref('PaymentRequired'), ref('Error')] },
              },
            },
          },
          '202': {
            description: 'Durable order; unknown never authorizes a new charge',
            headers: { 'PAYMENT-RESPONSE': { schema: { type: 'string' } } },
            content: content('Order'),
          },
          '409': {
            description:
              'Changed request, already claimed quote, or authorization replay',
            content: content('Error'),
          },
          '410': {
            description: 'Expired unpaid quote',
            content: content('Error'),
          },
        },
      },
    },
    '/v1/compute/orders/{id}': {
      get: {
        summary: 'Owner-authenticated recovery and status; never charges',
        parameters: [id],
        responses: {
          '200': {
            description:
              'Payment, provisioning, current computer and refund status',
            content: content('Order'),
          },
          '404': {
            description: 'No order owned by caller',
            content: content('Error'),
          },
        },
      },
    },
    '/v1/compute/orders/{id}/receipt': {
      get: {
        summary: 'Immutable terms and payment/refund receipt; never charges',
        parameters: [id],
        responses: {
          '200': {
            description:
              'Gateway acceptance is separate from later batch settlement',
            content: content('Order'),
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        security: [],
        responses: { '200': { description: 'This OpenAPI 3.1 contract' } },
      },
    },
  },
};
