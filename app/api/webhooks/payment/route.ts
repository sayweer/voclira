import { NextRequest, NextResponse } from 'next/server'
import { getPaymentAdapter } from '@/lib/payments'
import {
  getPurchaseById,
  getPurchaseByProviderPaymentIntentId,
  transitionPurchase,
  updatePurchaseRefund,
} from '@/lib/supabase'
import { redis, isRedisAvailable } from '@/lib/redis'

// Stripe expects a fast ACK; TTS NEVER runs here (the client triggers generation).
export const maxDuration = 10

const EVENT_IDEMPOTENCY_TTL_SECONDS = 3 * 24 * 60 * 60 // 259200

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()
  const adapter = getPaymentAdapter()

  let event
  try {
    event = await adapter.verifyWebhook(rawBody, req.headers)
  } catch (err) {
    console.warn('[Webhook] signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency: mark the event before handling so duplicates short-circuit. On a
  // handler error we delete the key so Stripe's retry can re-process it.
  const idemKey = `webhook-evt:${adapter.provider}:${event.eventId}`
  const redisReady = isRedisAvailable() && redis !== null
  if (redisReady) {
    const set = await redis!.set(idemKey, '1', { nx: true, ex: EVENT_IDEMPOTENCY_TTL_SECONDS })
    if (set === null) return NextResponse.json({ received: true }, { status: 200 })
  }

  try {
    switch (event.type) {
      case 'payment_succeeded': {
        if (!event.purchaseId) {
          console.warn('[Webhook] payment_succeeded without purchaseId', event.eventId)
          break
        }
        const purchase = await getPurchaseById(event.purchaseId)
        if (!purchase) {
          console.warn('[Webhook] purchase not found', event.purchaseId)
          break
        }
        // Amount check: the charge must equal message price + processing fee.
        const expectedTotal =
          (purchase.amount_usd_cents ?? 0) + (purchase.processing_fee_usd_cents ?? 0)
        if (event.amountUsdCents !== null && event.amountUsdCents !== expectedTotal) {
          console.error('[Webhook] amount mismatch', {
            purchaseId: purchase.id,
            expected: expectedTotal,
            got: event.amountUsdCents,
          })
          await transitionPurchase(purchase.id, 'pending_payment', 'failed')
          break
        }
        await transitionPurchase(purchase.id, 'pending_payment', 'paid', {
          paidAt: new Date().toISOString(),
          providerPaymentIntentId: event.providerPaymentIntentId ?? undefined,
        })
        break
      }
      case 'checkout_expired': {
        if (event.purchaseId) {
          await transitionPurchase(event.purchaseId, 'pending_payment', 'expired')
        }
        break
      }
      case 'refund_succeeded': {
        let purchase = event.purchaseId ? await getPurchaseById(event.purchaseId) : null
        if (!purchase && event.providerPaymentIntentId) {
          purchase = await getPurchaseByProviderPaymentIntentId(event.providerPaymentIntentId)
        }
        if (purchase) await updatePurchaseRefund(purchase.id, 'succeeded')
        break
      }
      default:
        // payment_failed / refund_failed / ignored → log-only no-op.
        break
    }
  } catch (err) {
    console.error('[Webhook] handler error:', err)
    if (redisReady) await redis!.del(idemKey) // allow Stripe's retry to re-process
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
