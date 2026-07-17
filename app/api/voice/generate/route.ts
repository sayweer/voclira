import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import {
  getCreatorByWallet,
  savePurchase,
  updatePurchaseStatusById,
  getPurchaseByTxSignature,
  getPurchaseById,
  transitionPurchase,
  updatePurchaseRefund,
} from '@/lib/supabase'
import { verifyTransaction } from '@/lib/solana'
import { isSafeToGenerate, validateTextLengthForLanguage, hashUserText, normalizeLanguage } from '@/lib/moderation'
import { generateSpeech } from '@/lib/tts'
import { getSignedGetUrl, uploadPublicObject } from '@/lib/r2'
import { consumeSession } from '@/lib/session'
import { getErrorResponse, UnsafeContentError, TtsError } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress, isValidTxSignature, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { priceUnitsFor, platformFeeLamports, platformFeeUsdCents, usdCentsToLamports, QUOTE } from '@/lib/limits'
import { getSolUsdRate } from '@/lib/exchange-rate'
import { getPaymentAdapter } from '@/lib/payments'
import type { GenerateVoiceRequest, Creator, Purchase, SupportedLanguage } from '@/types'

// Fal warm pool returns in 2-5s; fail fast rather than burn provisioned memory / show a long spinner.
export const maxDuration = 15

const MOD_SESSION_PREFIX = 'mod-session'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ModerationSession {
  buyerWallet: string | null
  creatorWallet: string
  rawTextHash: string
  language: string
  // USD-primary quote locked at moderation time (crypto only; absent for card sessions).
  amountUsdCents?: number
  quotedLamports?: number
  rateUsdPerSol?: number
  quotedAt?: number
}

/**
 * Shared TTS → R2 core: generate the voice, copy the ephemeral Fal output into the
 * permanent public bucket, and return the audio URL + provenance. Used by both the
 * crypto and card generation paths.
 */
async function runTtsAndUpload(
  creator: Creator,
  fanText: string,
  language: SupportedLanguage
): Promise<{ audioUrl: string; engine: string; requestId: string; durationMs: number }> {
  const referenceAudioSignedUrl = await getSignedGetUrl(creator.voice_profile_object_key!, 300)
  const tts = await generateSpeech({ text: fanText, referenceAudioSignedUrl, language })
  const engine = language === 'tr' ? 'chatterbox-multilingual' : 'chatterbox-turbo'

  // Fal output URLs are ephemeral → copy to the public bucket permanently.
  const res = await fetch(tts.audioUrl)
  if (!res.ok) throw new TtsError(`Fal audio fetch failed: ${res.status}`)
  const contentType = res.headers.get('content-type') ?? 'audio/wav'
  if (!contentType.startsWith('audio/')) throw new TtsError(`Unexpected content-type: ${contentType}`)
  const ext = contentType.includes('mpeg') ? 'mp3' : 'wav'
  const bytes = new Uint8Array(await res.arrayBuffer())
  const audioUrl = await uploadPublicObject(`purchases/${randomUUID()}.${ext}`, bytes, contentType)

  return { audioUrl, engine, requestId: tts.requestId, durationMs: tts.durationMs }
}

/** Auto-refund a card purchase (reject/fail). Best-effort — a failed refund is flagged for manual review. */
async function refundCardPurchase(purchase: Purchase): Promise<void> {
  if (!purchase.provider_payment_intent_id) {
    console.error('[VoiceGenerate] cannot auto-refund — no payment intent', purchase.id)
    return
  }
  await updatePurchaseRefund(purchase.id, 'pending')
  try {
    const { refundId } = await getPaymentAdapter().refund({
      providerPaymentIntentId: purchase.provider_payment_intent_id,
      purchaseId: purchase.id,
    })
    await updatePurchaseRefund(purchase.id, 'succeeded', refundId)
  } catch (refundErr) {
    console.error('[VoiceGenerate] auto-refund failed:', refundErr)
    await updatePurchaseRefund(purchase.id, 'failed')
  }
}

/**
 * Card generation: the fan already paid (webhook set 'paid'). Claim paid → pending
 * atomically (one caller wins), re-moderate, generate, and complete — auto-refunding
 * on rejection or failure. Idempotent: a completed purchase returns its cached audio.
 */
async function handleCardGenerate(purchaseId: string): Promise<NextResponse> {
  if (!UUID_RE.test(purchaseId)) {
    return NextResponse.json({ success: false, error: 'Invalid purchase id' }, { status: 400 })
  }

  const purchase = await getPurchaseById(purchaseId)
  if (!purchase) {
    return NextResponse.json({ success: false, error: 'Purchase not found' }, { status: 404 })
  }
  if (purchase.status === 'completed' && purchase.audio_url) {
    return NextResponse.json(
      { success: true, audioUrl: purchase.audio_url, purchaseId: purchase.id },
      { status: 200 }
    )
  }
  if (purchase.status === 'pending') {
    return NextResponse.json({ success: false, error: 'Generation in progress', code: 'IN_PROGRESS' }, { status: 409 })
  }
  if (purchase.status !== 'paid') {
    return NextResponse.json({ success: false, error: 'Payment not confirmed', code: 'NOT_PAID' }, { status: 402 })
  }

  // Claim the purchase: only one concurrent generate call flips paid → pending.
  const claimed = await transitionPurchase(purchase.id, 'paid', 'pending')
  if (!claimed) {
    return NextResponse.json({ success: false, error: 'Generation in progress', code: 'IN_PROGRESS' }, { status: 409 })
  }

  const creator = await getCreatorByWallet(purchase.creator_wallet)
  if (!creator || !creator.voice_profile_object_key) {
    await updatePurchaseStatusById(purchase.id, 'failed', {
      errorMessage: 'creator unavailable',
      providerErrorType: 'internal',
    })
    await refundCardPurchase(purchase)
    return NextResponse.json(
      { success: false, error: 'Creator is unavailable', code: 'NO_VOICE_PROFILE', refundNeeded: true },
      { status: 409 }
    )
  }

  const fanText = purchase.fan_text
  const language = normalizeLanguage(purchase.language ?? undefined, normalizeLanguage(creator.language))

  try {
    // Defense-in-depth: re-moderate (moderation also ran before checkout).
    try {
      await isSafeToGenerate(fanText, {
        blockAdult: creator.block_adult,
        blockProfanity: creator.block_profanity,
        blockPolitical: creator.block_political,
      })
    } catch (moderationError) {
      if (moderationError instanceof UnsafeContentError) {
        await updatePurchaseStatusById(purchase.id, 'rejected', {
          rejectionReason: `${moderationError.category}: ${moderationError.reason}`,
        })
        await refundCardPurchase(purchase)
        return NextResponse.json(
          { success: false, error: 'Content violates creator brand safety policy', refundNeeded: true },
          { status: 422 }
        )
      }
      throw moderationError
    }

    const { audioUrl, engine, requestId, durationMs } = await runTtsAndUpload(creator, fanText, language)

    await updatePurchaseStatusById(purchase.id, 'completed', {
      audioUrl,
      generationEngine: engine,
      providerRequestId: requestId,
      inputCharCount: fanText.length,
    })

    return NextResponse.json(
      { success: true, audioUrl, durationMs, purchaseId: purchase.id },
      { status: 200 }
    )
  } catch (postError) {
    const providerErrorType = postError instanceof TtsError ? 'tts' : 'internal'
    const errorMessage = postError instanceof Error ? postError.message : String(postError)
    try {
      await updatePurchaseStatusById(purchase.id, 'failed', { errorMessage, providerErrorType })
    } catch (reconcileErr) {
      console.error('[VoiceGenerate] Failed to reconcile card purchase:', reconcileErr)
    }
    await refundCardPurchase(purchase)
    const { error: message, code, statusCode } = getErrorResponse(postError)
    return NextResponse.json({ success: false, error: message, code, refundNeeded: true }, { status: statusCode })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req)
  if (!(await checkRateLimit(ip, 5, 60_000))) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  const body = await safeParseJson<
    Partial<GenerateVoiceRequest> & { moderationSessionId?: string; purchaseId?: string }
  >(req)
  if (body === null) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  // Card path: the purchase already exists and was marked 'paid' by the webhook.
  if (typeof body.purchaseId === 'string' && !body.txSignature) {
    try {
      return await handleCardGenerate(body.purchaseId)
    } catch (error) {
      const { error: message, code, statusCode, refundNeeded } = getErrorResponse(error)
      return NextResponse.json({ success: false, error: message, code, refundNeeded }, { status: statusCode })
    }
  }

  const { creatorWallet, fanText, txSignature, buyerWallet, language: rawLanguage, moderationSessionId } = body

  if (!creatorWallet || !fanText || !txSignature || !buyerWallet) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
  }

  if (!isValidWalletAddress(creatorWallet)) {
    return NextResponse.json({ success: false, error: 'Invalid creator wallet address' }, { status: 400 })
  }
  if (!isValidWalletAddress(buyerWallet)) {
    return NextResponse.json({ success: false, error: 'Invalid buyer wallet address' }, { status: 400 })
  }
  if (!isValidTxSignature(txSignature)) {
    return NextResponse.json({ success: false, error: 'Invalid transaction signature' }, { status: 400 })
  }
  if (typeof fanText !== 'string' || fanText.trim().length < 5) {
    return NextResponse.json({ success: false, error: 'Text too short' }, { status: 400 })
  }

  try {
    // Idempotency: replays of a processed tx return the existing result / are rejected.
    const existing = await getPurchaseByTxSignature(txSignature)
    if (existing !== null) {
      if (existing.status === 'completed' && existing.audio_url) {
        return NextResponse.json(
          { success: true, audioUrl: existing.audio_url, purchaseId: existing.id },
          { status: 200 }
        )
      }
      return NextResponse.json(
        { success: false, error: 'Transaction already processed', code: 'DUPLICATE_TX' },
        { status: 409 }
      )
    }

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

    // Fan picks the generation language per message; fall back to the creator's declared language.
    const language = normalizeLanguage(rawLanguage, normalizeLanguage(creator.language))

    // Optional moderation session: if the fan went through /api/moderate (pre-payment),
    // enforce that the approved raw text + parties match, and reuse its locked quote.
    // Generation ALWAYS re-moderates below, so a missing session is safe (back-compat) —
    // the session only adds a lock and the exact quoted amount.
    let quotedLamports: number | null = null
    let quotedAmountUsdCents: number | null = null
    if (moderationSessionId) {
      const session = await consumeSession<ModerationSession>(MOD_SESSION_PREFIX, moderationSessionId)
      if (
        !session ||
        session.creatorWallet !== creatorWallet ||
        session.buyerWallet !== buyerWallet ||
        session.rawTextHash !== hashUserText(fanText)
      ) {
        return NextResponse.json(
          { success: false, error: 'Moderation session invalid or expired', code: 'MOD_SESSION_INVALID' },
          { status: 409 }
        )
      }
      quotedLamports = typeof session.quotedLamports === 'number' ? session.quotedLamports : null
      quotedAmountUsdCents = typeof session.amountUsdCents === 'number' ? session.amountUsdCents : null
    }

    validateTextLengthForLanguage(fanText, language)

    // USD-primary: the fan's SOL amount was locked into the quote at moderation time.
    const priceUsdCents = creator.price_usd_cents
    if (priceUsdCents == null) {
      return NextResponse.json(
        { success: false, error: 'Creator price not configured', code: 'PRICE_NOT_SET' },
        { status: 409 }
      )
    }
    const units = priceUnitsFor(fanText)
    const amountUsdCents = quotedAmountUsdCents ?? units * priceUsdCents
    const feeUsdCents = platformFeeUsdCents(amountUsdCents)

    // Prefer the exact quoted lamports (normal path). Without a session (e.g. a
    // MOD_SESSION_INVALID retry) recompute from the live rate with slack for drift.
    let expectedTotalLamports: number
    if (quotedLamports != null) {
      expectedTotalLamports = quotedLamports
    } else {
      const rate = await getSolUsdRate()
      expectedTotalLamports = Math.floor(
        usdCentsToLamports(units * priceUsdCents, rate.rateUsdPerSol) * (1 - QUOTE.NO_SESSION_TOLERANCE)
      )
    }
    await verifyTransaction(txSignature, creatorWallet, expectedTotalLamports, buyerWallet)

    const purchase = await savePurchase({
      buyerWallet,
      creatorWallet,
      txSignature,
      fanText,
      amountLamports: expectedTotalLamports,
      platformFeeLamports: platformFeeLamports(expectedTotalLamports),
      amountUsdCents,
      platformFeeUsdCents: feeUsdCents,
      language,
      currency: 'SOL',
      paymentMethod: 'crypto',
    })

    // Purchase row now exists ('pending'). Any failure below transitions it to
    // 'rejected' (moderation) or 'failed' (generation) so it never stays stuck.
    try {
      // Defense-in-depth: re-moderate even if a session existed (client could bypass /api/moderate).
      try {
        await isSafeToGenerate(fanText, {
          blockAdult: creator.block_adult,
          blockProfanity: creator.block_profanity,
          blockPolitical: creator.block_political,
        })
      } catch (moderationError) {
        if (moderationError instanceof UnsafeContentError) {
          await updatePurchaseStatusById(purchase.id, 'rejected', {
            rejectionReason: `${moderationError.category}: ${moderationError.reason}`,
          })
          return NextResponse.json(
            { success: false, error: 'Content violates creator brand safety policy', refundNeeded: true },
            { status: 422 }
          )
        }
        throw moderationError
      }

      // The fan's exact text is spoken verbatim (already moderated + length-validated above).
      const { audioUrl, engine, requestId, durationMs } = await runTtsAndUpload(creator, fanText, language)

      await updatePurchaseStatusById(purchase.id, 'completed', {
        audioUrl,
        generationEngine: engine,
        providerRequestId: requestId,
        inputCharCount: fanText.length,
      })

      console.log('[VoiceGenerate] completed', { engine, durationMs, requestId })

      return NextResponse.json(
        { success: true, audioUrl, durationMs, purchaseId: purchase.id },
        { status: 200 }
      )
    } catch (postSaveError) {
      // Generation failed mid-flight → mark 'failed' so the purchase never stays stuck.
      const providerErrorType = postSaveError instanceof TtsError ? 'tts' : 'internal'
      const errorMessage = postSaveError instanceof Error ? postSaveError.message : String(postSaveError)
      try {
        await updatePurchaseStatusById(purchase.id, 'failed', { errorMessage, providerErrorType })
      } catch (reconcileErr) {
        console.error('[VoiceGenerate] Failed to reconcile pending purchase:', reconcileErr)
      }
      throw postSaveError
    }
  } catch (error) {
    const { error: message, code, statusCode, refundNeeded } = getErrorResponse(error)
    return NextResponse.json({ success: false, error: message, code, refundNeeded }, { status: statusCode })
  }
}
