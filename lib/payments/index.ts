import type { PaymentAdapter } from '@/lib/payments/types'
import { stripeAdapter } from '@/lib/payments/stripe'
import { VocliraError } from '@/lib/errors'

/** Resolve the active payment adapter from PAYMENT_PROVIDER (defaults to Stripe). */
export function getPaymentAdapter(): PaymentAdapter {
  const provider = process.env.PAYMENT_PROVIDER ?? 'stripe'
  switch (provider) {
    case 'stripe':
      return stripeAdapter
    default:
      throw new VocliraError(`Unsupported payment provider: ${provider}`, 'CONFIG_ERROR', 500)
  }
}

export type { PaymentAdapter } from '@/lib/payments/types'
