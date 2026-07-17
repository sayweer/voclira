import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getCreatorByWallet, savePurchase, updatePurchaseStatusById, getPurchaseByTxSignature } from '@/lib/supabase'
import { verifyTransaction } from '@/lib/solana'
import { isSafeToGenerate, validateTextLengthForLanguage, hashUserText, normalizeLanguage } from '@/lib/moderation'
import { generateSpeech } from '@/lib/tts'
import { getSignedGetUrl, uploadPublicObject } from '@/lib/r2'
import { consumeSession } from '@/lib/session'
import { getErrorResponse, UnsafeContentError, TtsError } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress, isValidTxSignature, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { priceUnitsFor, platformFeeLamports } from '@/lib/limits'
import type { GenerateVoiceRequest } from '@/types'

// Fal warm pool returns in 2-5s; fail fast rather than burn provisioned memory / show a long spinner.
export const maxDuration = 15

const MOD_SESSION_PREFIX = 'mod-session'
interface ModerationSession {
  buyerWallet: string
  creatorWallet: string
  rawTextHash: string
  language: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req)
  if (!(await checkRateLimit(ip, 5, 60_000))) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  const body = await safeParseJson<Partial<GenerateVoiceRequest> & { moderationSessionId?: string }>(req)
  if (body === null) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
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
    // enforce that the approved raw text + parties match. Generation ALWAYS re-moderates
    // below, so a missing session is safe (back-compat) — the session only adds a lock.
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
    }

    validateTextLengthForLanguage(fanText, language)

    // Multi-unit pricing: the fan pays ceil(len / UNIT_CHARS) × unit price —
    // the exact formula the client uses, so the on-chain amount is enforced
    // and the recorded amount matches what was actually paid.
    const expectedTotalLamports = priceUnitsFor(fanText) * creator.price_lamports
    await verifyTransaction(txSignature, creatorWallet, expectedTotalLamports, buyerWallet)

    const purchase = await savePurchase({
      buyerWallet,
      creatorWallet,
      txSignature,
      fanText,
      amountLamports: expectedTotalLamports,
      platformFeeLamports: platformFeeLamports(expectedTotalLamports),
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
      // Delivery uses fixed natural acoustic params inside generateSpeech — text is never rewritten.
      const referenceAudioSignedUrl = await getSignedGetUrl(creator.voice_profile_object_key, 300)
      const tts = await generateSpeech({
        text: fanText,
        referenceAudioSignedUrl,
        language,
      })
      const engine = language === 'tr' ? 'chatterbox-multilingual' : 'chatterbox-turbo'

      // Fal output URLs are ephemeral → copy to the public bucket permanently.
      const res = await fetch(tts.audioUrl)
      if (!res.ok) throw new TtsError(`Fal audio fetch failed: ${res.status}`)
      const contentType = res.headers.get('content-type') ?? 'audio/wav'
      if (!contentType.startsWith('audio/')) throw new TtsError(`Unexpected content-type: ${contentType}`)
      const ext = contentType.includes('mpeg') ? 'mp3' : 'wav'
      const bytes = new Uint8Array(await res.arrayBuffer())
      const audioUrl = await uploadPublicObject(`purchases/${randomUUID()}.${ext}`, bytes, contentType)

      await updatePurchaseStatusById(purchase.id, 'completed', {
        audioUrl,
        generationEngine: engine,
        providerRequestId: tts.requestId,
        inputCharCount: fanText.length,
      })

      console.log('[VoiceGenerate] completed', { engine, durationMs: tts.durationMs, requestId: tts.requestId })

      return NextResponse.json(
        { success: true, audioUrl, durationMs: tts.durationMs, purchaseId: purchase.id },
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
