import { NextRequest, NextResponse } from 'next/server'
import {
  getCreatorByWallet,
  createCardDraftPurchase,
  setPurchaseProviderPaymentId,
  updatePurchaseStatusById,
} from '@/lib/supabase'
import { validateTextLengthForLanguage, hashUserText, normalizeLanguage } from '@/lib/moderation'
import { consumeSession } from '@/lib/session'
import { getErrorResponse } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { priceUnitsFor, platformFeeUsdCents, PRICING_USD } from '@/lib/limits'
import { getPaymentAdapter } from '@/lib/payments'
import { requireServerEnv } from '@/lib/env'

const MOD_SESSION_PREFIX = 'mod-session'
interface CardModerationSession {
  buyerWallet: string | null
  creatorWallet: string
  rawTextHash: string
  language: string
}

interface CardCheckoutBody {
  creatorWallet?: string
  text?: string
  language?: string
  moderationSessionId?: string
  buyerEmail?: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Feature flag — card checkout stays off until Faz 7B (LLC + Stripe live).
  if (process.env.NEXT_PUBLIC_CARD_PAYMENTS_ENABLED !== 'true') {
    return NextResponse.json(
      { success: false, error: 'Card payments are not enabled', code: 'FEATURE_DISABLED' },
      { status: 503 }
    )
  }

  const ip = getClientIp(req)
  if (!(await checkRateLimit(ip, 5, 60_000))) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  const body = await safeParseJson<CardCheckoutBody>(req)
  if (body === null) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { creatorWallet, text, language: rawLanguage, moderationSessionId, buyerEmail } = body
  if (!creatorWallet || typeof text !== 'string' || !moderationSessionId) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
  }
  if (!isValidWalletAddress(creatorWallet)) {
    return NextResponse.json({ success: false, error: 'Invalid creator wallet address' }, { status: 400 })
  }

  try {
    const creator = await getCreatorByWallet(creatorWallet)
    if (creator === null) {
      return NextResponse.json({ success: false, error: 'Creator not found' }, { status: 404 })
    }
    if (!creator.is_active) {
      return NextResponse.json({ success: false, error: 'Creator is not active' }, { status: 403 })
    }
    if (!creator.voice_profile_object_key) {
      return NextResponse.json(
        { success: false, error: 'Creator has no voice profile', code: 'NO_VOICE_PROFILE' },
        { status: 409 }
      )
    }
    if (creator.price_usd_cents == null) {
      return NextResponse.json(
        { success: false, error: 'Creator price not configured', code: 'PRICE_NOT_SET' },
        { status: 409 }
      )
    }

    const language = normalizeLanguage(rawLanguage, normalizeLanguage(creator.language))

    // Mandatory one-time moderation session (there is no on-chain proof of the
    // approved text for card, so the session hash is the only binding).
    const session = await consumeSession<CardModerationSession>(MOD_SESSION_PREFIX, moderationSessionId)
    if (!session || session.creatorWallet !== creatorWallet || session.rawTextHash !== hashUserText(text)) {
      return NextResponse.json(
        { success: false, error: 'Moderation session invalid or expired', code: 'MOD_SESSION_INVALID' },
        { status: 409 }
      )
    }

    validateTextLengthForLanguage(text, language)

    // Server computes all amounts. Creator/platform split comes from the message price
    // (90/10, unchanged); the processing fee is a separate transparent line item.
    const amountUsdCents = priceUnitsFor(text) * creator.price_usd_cents
    const feeUsdCents = platformFeeUsdCents(amountUsdCents)
    const processingFeeUsdCents = PRICING_USD.CARD_PROCESSING_FEE_USD_CENTS

    const email =
      typeof buyerEmail === 'string' && buyerEmail.includes('@') ? buyerEmail.trim() : null

    const adapter = getPaymentAdapter()

    // Draft the purchase first so the text is frozen — it can't be swapped after payment.
    const draft = await createCardDraftPurchase({
      creatorWallet,
      fanText: text,
      amountUsdCents,
      platformFeeUsdCents: feeUsdCents,
      processingFeeUsdCents,
      language,
      buyerEmail: email,
      provider: adapter.provider,
    })

    try {
      const appUrl = requireServerEnv('NEXT_PUBLIC_APP_URL')
      const { url, providerPaymentId } = await adapter.createCheckout({
        purchaseId: draft.id,
        creatorWallet,
        amountUsdCents,
        processingFeeUsdCents,
        buyerEmail: email,
        successUrl: `${appUrl}/fan/${creatorWallet}?purchaseId=${draft.id}`,
        cancelUrl: `${appUrl}/fan/${creatorWallet}?cancelled=1`,
      })
      await setPurchaseProviderPaymentId(draft.id, providerPaymentId)
      return NextResponse.json({ success: true, url, purchaseId: draft.id }, { status: 200 })
    } catch (checkoutErr) {
      await updatePurchaseStatusById(draft.id, 'failed', {
        errorMessage: checkoutErr instanceof Error ? checkoutErr.message : 'checkout failed',
        providerErrorType: 'checkout',
      })
      throw checkoutErr
    }
  } catch (error) {
    const { error: message, code, statusCode } = getErrorResponse(error)
    return NextResponse.json({ success: false, error: message, code }, { status: statusCode })
  }
}
