import Stripe from 'stripe'
import { requireServerEnv } from '@/lib/env'
import type {
  PaymentAdapter,
  CreateCheckoutParams,
  NormalizedWebhookEvent,
} from '@/lib/payments/types'

// Lazy singleton — the key is resolved at first use so a missing env never breaks
// the build (crypto-only launch runs with card disabled and no Stripe key).
let _stripe: Stripe | null = null
function stripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(requireServerEnv('STRIPE_SECRET_KEY'))
  return _stripe
}

function normalize(event: Stripe.Event): NormalizedWebhookEvent {
  const base = {
    eventId: event.id,
    purchaseId: null,
    providerPaymentId: null,
    providerPaymentIntentId: null,
    amountUsdCents: null,
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      return {
        ...base,
        type: session.payment_status === 'paid' ? 'payment_succeeded' : 'ignored',
        purchaseId: session.metadata?.purchase_id ?? null,
        providerPaymentId: session.id,
        providerPaymentIntentId:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amountUsdCents: session.amount_total ?? null,
      }
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session
      return {
        ...base,
        type: 'checkout_expired',
        purchaseId: session.metadata?.purchase_id ?? null,
        providerPaymentId: session.id,
      }
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      return {
        ...base,
        type: 'refund_succeeded',
        purchaseId: charge.metadata?.purchase_id ?? null,
        providerPaymentIntentId:
          typeof charge.payment_intent === 'string' ? charge.payment_intent : null,
      }
    }
    default:
      return { ...base, type: 'ignored' }
  }
}

export const stripeAdapter: PaymentAdapter = {
  provider: 'stripe',

  async createCheckout(p: CreateCheckoutParams) {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: p.amountUsdCents,
            product_data: { name: 'Voice message' },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: p.processingFeeUsdCents,
            product_data: { name: 'Processing fee' },
          },
          quantity: 1,
        },
      ],
      metadata: { purchase_id: p.purchaseId },
      payment_intent_data: { metadata: { purchase_id: p.purchaseId } },
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      ...(p.buyerEmail ? { customer_email: p.buyerEmail } : {}),
    })

    if (!session.url) throw new Error('Stripe did not return a checkout URL')
    return { url: session.url, providerPaymentId: session.id }
  },

  async verifyWebhook(rawBody: string, headers: Headers) {
    const signature = headers.get('stripe-signature')
    if (!signature) throw new Error('Missing stripe-signature header')
    // constructEvent throws if the signature/secret don't match — the caller maps that to 400.
    const event = stripe().webhooks.constructEvent(
      rawBody,
      signature,
      requireServerEnv('STRIPE_WEBHOOK_SECRET')
    )
    return normalize(event)
  },

  async refund(p: { providerPaymentIntentId: string; purchaseId: string }) {
    const refund = await stripe().refunds.create({ payment_intent: p.providerPaymentIntentId })
    return { refundId: refund.id }
  },
}
