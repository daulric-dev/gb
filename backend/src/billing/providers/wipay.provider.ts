import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  centsToDecimal,
  decimalToCents,
  env,
  ProviderApiError,
  readJson,
  requireEnv,
  safeEqual,
  send,
} from './http';
import type { FetchLike, ProviderOptions } from './http';
import {
  WebhookVerificationError,
  type BillingEvent,
  type CheckoutResult,
  type InvoicePaymentContext,
  type PaymentProvider,
  type WebhookRequest,
} from './payment-provider';

/**
 * Countries the Payments API accepts as `country_code` (API doc v1.0.8).
 * Each has its own host: https://<cc>.wipayfinancial.com.
 */
const COUNTRIES = new Set(['BB', 'JM', 'TT']);
const CURRENCIES = new Set(['USD', 'TTD', 'JMD']);
const FEE_STRUCTURES = new Set(['customer_pay', 'merchant_absorb', 'split']);

/** Our own parameters on the response_url (WiPay appends its own after). */
const P = {
  invoice: 'gb_inv',
  amount: 'gb_amt',
  currency: 'gb_cur',
  signature: 'gb_sig',
} as const;

/** WiPay limits response_url to 255 characters. */
const MAX_RESPONSE_URL = 255;

/**
 * WiPay (Caribbean) hosted payment page, "WiPay Plugins Payment Request"
 * API v1 (Payments API Documentation 1.0.8, 23/12/2024). Invoice mode: each
 * invoice is paid once on WiPay's hosted card page.
 *
 * Flow: POST https://<cc>.wipayfinancial.com/plugins/payments/request with
 * `Accept: application/json` -> `{ url, message, transaction_id }`; the
 * browser goes to `url`; after paying, WiPay redirects the browser (GET) to
 * our `response_url` with `status`, `transaction_id`, `order_id`, `total`,
 * `hash`, ... appended as a query string. That URL is ctx.callbackUrl, which
 * the billing core routes to parseWebhook.
 *
 * Verification. WiPay's `hash` = md5(transaction_id + ORIGINAL total + API
 * key) and is only sent for `status=success`. The original total is not in
 * WiPay's response (its `total` is the final amount, fees included under
 * customer_pay/split), and `order_id` is limited to 16 characters on the
 * FGB-hosted page, too short for our invoice id. So the response_url
 * carries our own parameters - invoice id, original total, currency - bound
 * to the order_id by an HMAC keyed with the API key (`gb_sig`). A callback is
 * accepted only when:
 *   1. gb_sig matches (invoice id + amount + currency + order_id untouched),
 *   2. transaction_id embeds `-<order_id>-` (WiPay builds it that way), and
 *   3. for success, WiPay's md5 hash matches over transaction_id + gb_amt.
 * All comparisons are constant-time. In live mode, sandbox transactions
 * (`SB-` prefix) are refused.
 *
 * Assumption to confirm in sandbox before going live: WiPay appends its
 * response parameters to a response_url that already has a query string
 * with `&` (a naive `?` append is also handled, see normalizeParams).
 *
 * Failed/error results carry no WiPay hash (by WiPay's design), so an
 * `invoice.payment_failed` is only as trustworthy as gb_sig: it proves the
 * redirect came from a payment attempt we started, not that WiPay sent it.
 * Treat it as informational.
 *
 * Env: WIPAY_ACCOUNT_NUMBER, WIPAY_API_KEY, WIPAY_ENV=sandbox|live (default
 * sandbox; sandbox requires account 1234567890 and API key 123),
 * WIPAY_COUNTRY_CODE=TT|JM|BB (default TT), WIPAY_CURRENCY (USD|TTD|JMD,
 * default USD), WIPAY_FEE_STRUCTURE (merchant_absorb|customer_pay|split,
 * default merchant_absorb so the school pays exactly the invoice amount).
 */
export class WiPayProvider implements PaymentProvider {
  readonly id = 'wipay';
  readonly label = 'WiPay';
  readonly mode = 'invoice' as const;

  private readonly fetchFn: FetchLike;

  constructor(options: ProviderOptions = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  isConfigured(): boolean {
    return (
      !!env('WIPAY_ACCOUNT_NUMBER') &&
      !!env('WIPAY_API_KEY') &&
      this.environment() !== null &&
      COUNTRIES.has(this.countryCode()) &&
      CURRENCIES.has(this.currency()) &&
      FEE_STRUCTURES.has(this.feeStructure())
    );
  }

  async payInvoice(ctx: InvoicePaymentContext): Promise<CheckoutResult> {
    const account = requireEnv(this.label, 'WIPAY_ACCOUNT_NUMBER');
    const apiKey = requireEnv(this.label, 'WIPAY_API_KEY');
    const environment = this.environment();
    const country = this.countryCode();
    const feeStructure = this.feeStructure();
    if (!environment) {
      throw new ProviderApiError(
        this.label,
        'WIPAY_ENV must be sandbox or live',
      );
    }
    if (!COUNTRIES.has(country)) {
      throw new ProviderApiError(
        this.label,
        `unsupported WIPAY_COUNTRY_CODE ${country}`,
      );
    }
    if (!FEE_STRUCTURES.has(feeStructure)) {
      throw new ProviderApiError(
        this.label,
        `unsupported WIPAY_FEE_STRUCTURE ${feeStructure}`,
      );
    }

    const currency = ctx.currency.toUpperCase();
    if (!CURRENCIES.has(currency) || currency !== this.currency()) {
      throw new ProviderApiError(
        this.label,
        `invoice currency ${currency} is not accepted (WIPAY_CURRENCY=${this.currency()})`,
      );
    }
    if (currency === 'USD' && ctx.amountCents < 100) {
      throw new ProviderApiError(
        this.label,
        'the minimum WiPay payment is 1.00 USD',
      );
    }

    const total = centsToDecimal(ctx.amountCents, currency);
    const orderId = newOrderId();
    const responseUrl = withParams(ctx.callbackUrl, {
      [P.invoice]: ctx.invoiceId,
      [P.amount]: total,
      [P.currency]: currency,
      [P.signature]: signParams(
        apiKey,
        ctx.invoiceId,
        total,
        currency,
        orderId,
      ),
    });
    if (responseUrl.length > MAX_RESPONSE_URL) {
      throw new ProviderApiError(
        this.label,
        `response URL is longer than WiPay's ${MAX_RESPONSE_URL} characters`,
      );
    }

    const form = new URLSearchParams({
      account_number: account,
      avs: '0',
      country_code: country,
      currency,
      environment,
      fee_structure: feeStructure,
      method: 'credit_card',
      order_id: orderId,
      origin: 'GradeBook',
      response_url: responseUrl,
      total,
      version: '1.0.0',
    });
    // Optional payer email (max 50): WiPay emails the payer a receipt.
    if (ctx.customerEmail && ctx.customerEmail.length <= 50) {
      form.set('email', ctx.customerEmail);
    }

    const url = `https://${country.toLowerCase()}.wipayfinancial.com/plugins/payments/request`;
    const res = await send(this.label, this.fetchFn, url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      redirect: 'manual',
    });
    const data = await readJson(res);
    if (res.status >= 400) {
      throw new ProviderApiError(
        this.label,
        `payment request failed: ${data?.message ?? res.statusText}`,
        res.status,
      );
    }
    const hostedPage: string | null =
      data?.url ?? res.headers.get('location') ?? null;
    if (!hostedPage) {
      throw new ProviderApiError(
        this.label,
        'payment request returned no hosted page URL',
      );
    }
    return {
      redirectUrl: hostedPage,
      providerRef: data?.transaction_id ?? orderId,
    };
  }

  parseWebhook(req: WebhookRequest): Promise<BillingEvent[]> {
    try {
      return Promise.resolve([this.verify(req)]);
    } catch (err) {
      return Promise.reject(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // ---------------------------------------------------------------------

  private verify(req: WebhookRequest): BillingEvent {
    const apiKey = env('WIPAY_API_KEY');
    if (!apiKey) throw new WebhookVerificationError('WIPAY_API_KEY is not set');

    const q = normalizeParams(req);
    const invoiceId = q[P.invoice];
    const amount = q[P.amount];
    const currency = q[P.currency];
    const signature = q[P.signature];
    const orderId = q.order_id;
    const status = q.status;
    const transactionId = q.transaction_id;

    if (
      !invoiceId ||
      !amount ||
      !currency ||
      !signature ||
      !orderId ||
      !status
    ) {
      throw new WebhookVerificationError(
        'WiPay callback is missing parameters',
      );
    }
    if (
      !safeEqual(
        signature,
        signParams(apiKey, invoiceId, amount, currency, orderId),
      )
    ) {
      throw new WebhookVerificationError(
        'WiPay callback parameters were altered',
      );
    }
    if (transactionId && !transactionId.includes(`-${orderId}-`)) {
      throw new WebhookVerificationError(
        'WiPay transaction does not match the order',
      );
    }
    if (transactionId?.startsWith('SB-') && this.environment() === 'live') {
      throw new WebhookVerificationError(
        'Sandbox WiPay transaction in live mode',
      );
    }

    if (status === 'success') {
      const hash = q.hash;
      if (!transactionId || !hash) {
        throw new WebhookVerificationError(
          'WiPay success without transaction_id/hash',
        );
      }

      // WiPay defines its response signature as
      // md5(transaction_id + total + API key); recomputing exactly that is the
      // only way to verify the callback. It checks a third-party signature,
      // it is not password storage, and our own HMAC-SHA256 gb_sig already
      // binds the invoice, amount and order to the request.
      const expected = createHash('md5')
        // codeql[js/insufficient-password-hash] WiPay's API mandates this md5 response signature; not password storage.
        .update(`${transactionId}${amount}${apiKey}`)
        .digest('hex');

      if (!safeEqual(hash.toLowerCase(), expected)) {
        throw new WebhookVerificationError('WiPay hash does not match');
      }

      let amountCents: number;
      try {
        amountCents = decimalToCents(amount, currency);
      } catch {
        throw new WebhookVerificationError('WiPay callback amount is invalid');
      }
      return {
        type: 'invoice.paid',
        eventId: transactionId,
        invoiceId,
        providerInvoiceId: transactionId,
        amountCents,
        currency,
        // WiPay's `date` has no timezone; the receipt time is close enough.
        paidAt: new Date(),
      };
    }

    const eventId = transactionId ?? `${orderId}:${status}`;
    if (status === 'failed' || status === 'error') {
      return {
        type: 'invoice.payment_failed',
        eventId,
        invoiceId,
        providerInvoiceId: transactionId ?? null,
      };
    }
    return {
      type: 'ignored',
      eventId,
      reason: `unknown WiPay status ${status}`,
    };
  }

  private environment(): 'sandbox' | 'live' | null {
    const value = (env('WIPAY_ENV') ?? 'sandbox').toLowerCase();
    return value === 'sandbox' || value === 'live' ? value : null;
  }

  private countryCode(): string {
    return (env('WIPAY_COUNTRY_CODE') ?? 'TT').toUpperCase();
  }

  private currency(): string {
    return (env('WIPAY_CURRENCY') ?? 'USD').toUpperCase();
  }

  private feeStructure(): string {
    return (env('WIPAY_FEE_STRUCTURE') ?? 'merchant_absorb').toLowerCase();
  }
}

/**
 * Per-attempt order id: alphanumeric, 14 characters (FGB allows 16, FAC 48)
 * and unique per payment attempt as WiPay asks.
 */
function newOrderId(): string {
  const time = Date.now().toString(36).slice(-8);
  const random = randomBytes(4).toString('hex').slice(0, 4);
  return `gb${time}${random}`;
}

/** Short HMAC binding our response_url parameters to the order. */
export function signParams(
  apiKey: string,
  invoiceId: string,
  amount: string,
  currency: string,
  orderId: string,
): string {
  return createHmac('sha256', apiKey)
    .update(`wipay|${invoiceId}|${amount}|${currency}|${orderId}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Query (and a form body, if WiPay ever POSTs) as one flat record. If WiPay
 * appended its parameters with a second `?` instead of `&`, the value before
 * it swallows the rest (`gb_sig=abc?status=success`); split that back out.
 */
function normalizeParams(req: WebhookRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (key: string, value: string) => {
    const q = value.indexOf('?');
    if (q >= 0) {
      out[key] = value.slice(0, q);
      for (const [k, v] of new URLSearchParams(value.slice(q + 1))) {
        if (!(k in out)) add(k, v);
      }
      return;
    }
    if (!(key in out)) out[key] = value;
  };
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') add(k, v);
  }
  const contentType = req.headers['content-type'] ?? '';
  if (
    req.rawBody?.length &&
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    for (const [k, v] of new URLSearchParams(req.rawBody.toString('utf8')))
      add(k, v);
  }
  return out;
}
