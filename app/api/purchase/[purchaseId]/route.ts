import { NextRequest, NextResponse } from 'next/server'
import { getPurchaseById } from '@/lib/supabase'
import { getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Client polls this after returning from card checkout. Minimal, public-safe shape:
// it never returns fan_text or buyer_email (the ?purchaseId link could be opened by anyone).
export async function GET(
  req: NextRequest,
  { params }: { params: { purchaseId: string } }
): Promise<NextResponse> {
  const ip = getClientIp(req)
  if (!(await checkRateLimit(`purchase-poll:${ip}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMITED' }, { status: 429 })
  }

  if (!UUID_RE.test(params.purchaseId)) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const purchase = await getPurchaseById(params.purchaseId)
  if (!purchase) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({
    id: purchase.id,
    status: purchase.status,
    audioUrl: purchase.audio_url,
    refundStatus: purchase.refund_status,
    paymentMethod: purchase.payment_method,
  })
}
