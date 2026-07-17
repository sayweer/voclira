// Provider-agnostic payment adapter boundary. Stripe is the reference impl; the
// same contract maps onto iyzico/Coinflow/etc. so a provider swap never touches
// the routes. All amounts are USD cents.

export type PaymentProvider = 'stripe' | 'iyzico'

export interface CreateCheckoutParams {
  purchaseId: string
  creatorWallet: string
  /** Message price (the 90/10 split is computed from this). */
  amountUsdCents: number
  /** Transparent processing fee shown as its own line item; covers the provider's fixed fee. */
  processingFeeUsdCents: number
  buyerEmail: string | null
  successUrl: string
  cancelUrl: string
}

export type NormalizedEventType =
  | 'payment_succeeded'
  | 'payment_failed'
  | 'checkout_expired'
  | 'refund_succeeded'
  | 'refund_failed'
  | 'ignored'

export interface NormalizedWebhookEvent {
  type: NormalizedEventType
  /** Provider event id — used for webhook idempotency. */
  eventId: string
  purchaseId: string | null
  providerPaymentId: string | null
  providerPaymentIntentId: string | null
  /** Total charged (message + processing fee), USD cents — for the server-side amount check. */
  amountUsdCents: number | null
}

export interface PaymentAdapter {
  readonly provider: PaymentProvider
  createCheckout(p: CreateCheckoutParams): Promise<{ url: string; providerPaymentId: string }>
  /** Verify the signature and normalize; throws if the signature is invalid. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<NormalizedWebhookEvent>
  refund(p: { providerPaymentIntentId: string; purchaseId: string }): Promise<{ refundId: string }>
}
