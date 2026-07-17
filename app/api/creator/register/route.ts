import { NextRequest, NextResponse } from 'next/server'
import { getCreatorByWallet, saveCreator } from '@/lib/supabase'
import { getPrivateObjectSize } from '@/lib/r2'
import { RECORDING, REFERENCE_AUDIO, PRICING_USD, isValidPriceUsdCents } from '@/lib/limits'
import { consumeSession } from '@/lib/session'
import { getErrorResponse } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import type { RegisterCreatorRequest } from '@/types'

// Chatterbox/Fal onboarding: no ElevenLabs cloning. The creator's reference WAV and
// consent verification WAV are uploaded directly to R2 (private) via presigned PUT;
// here we consume the one-time upload sessions, confirm the objects exist (HEAD),
// and persist voice_profile_object_key + consent.
const UPLOAD_SESSION_PREFIX = 'upload-session'

interface UploadSession {
  objectKey: string
  walletAddress: string
  type: 'voice-profile' | 'verification-audio'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req)
  if (!(await checkRateLimit(ip, 10, 60 * 60 * 1000))) {
    return NextResponse.json(
      { success: false, error: 'Too many registration attempts. Please try again later.' },
      { status: 429 }
    )
  }

  const body = await safeParseJson<Partial<RegisterCreatorRequest>>(req)
  if (body === null) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    walletAddress,
    creatorName,
    priceInUsdCents,
    language,
    uploadSessionId,
    verificationUploadSessionId,
    consentTextVersion,
  } = body

  if (
    !walletAddress ||
    !creatorName ||
    priceInUsdCents === undefined ||
    !uploadSessionId ||
    !verificationUploadSessionId ||
    !consentTextVersion
  ) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
  }
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
  }
  if (typeof creatorName !== 'string' || creatorName.trim().length < 1 || creatorName.trim().length > 100) {
    return NextResponse.json({ success: false, error: 'Creator name must be 1-100 characters' }, { status: 400 })
  }
  if (!isValidPriceUsdCents(priceInUsdCents)) {
    return NextResponse.json(
      {
        success: false,
        error: `Price must be between $${PRICING_USD.MIN_PRICE_USD_CENTS / 100} and $${PRICING_USD.MAX_PRICE_USD_CENTS / 100}`,
      },
      { status: 400 }
    )
  }
  const lang = language === 'tr' ? 'tr' : 'en'

  try {
    const existing = await getCreatorByWallet(walletAddress)
    if (existing !== null && existing.is_active && existing.voice_profile_object_key) {
      // Active creators re-record via the authenticated /api/creator/update-voice
      // endpoint — the client falls back to it on this code (upload sessions are
      // still unconsumed at this point, so they remain valid for that call).
      return NextResponse.json(
        { success: false, error: 'Creator already registered', code: 'ALREADY_REGISTERED' },
        { status: 409 }
      )
    }

    // Consume both one-time upload sessions; validate they belong to this wallet,
    // are the right type, and that the uploaded object actually exists in R2.
    const voiceSession = await consumeSession<UploadSession>(UPLOAD_SESSION_PREFIX, uploadSessionId)
    const verifySession = await consumeSession<UploadSession>(UPLOAD_SESSION_PREFIX, verificationUploadSessionId)

    if (
      !voiceSession ||
      voiceSession.walletAddress !== walletAddress ||
      voiceSession.type !== 'voice-profile' ||
      !verifySession ||
      verifySession.walletAddress !== walletAddress ||
      verifySession.type !== 'verification-audio'
    ) {
      return NextResponse.json(
        { success: false, error: 'Upload session invalid or expired', code: 'UPLOAD_SESSION_INVALID' },
        { status: 409 }
      )
    }

    const [voiceSize, verifySize] = await Promise.all([
      getPrivateObjectSize(voiceSession.objectKey),
      getPrivateObjectSize(verifySession.objectKey),
    ])
    if (voiceSize === null || verifySize === null) {
      return NextResponse.json(
        { success: false, error: 'Uploaded audio not found', code: 'UPLOAD_MISSING' },
        { status: 409 }
      )
    }
    // Uploads are 24kHz mono WAVs, so byte size ≈ duration — enforce the advertised
    // reference length server-side (the client-side duration checks are advisory only).
    if (voiceSize < REFERENCE_AUDIO.MIN_BYTES || voiceSize > REFERENCE_AUDIO.MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Reference audio must be between ${RECORDING.MIN_SECONDS} and ${RECORDING.MAX_SECONDS} seconds`,
          code: 'REFERENCE_AUDIO_SIZE',
        },
        { status: 400 }
      )
    }

    const creator = await saveCreator({
      walletAddress,
      creatorName,
      priceUsdCents: priceInUsdCents,
      language: lang,
      voiceProfileObjectKey: voiceSession.objectKey,
      consentAt: new Date().toISOString(),
      consentIp: ip,
      consentTextVersion,
      verificationAudioObjectKey: verifySession.objectKey,
    })

    return NextResponse.json({ success: true, creatorId: creator.id }, { status: 201 })
  } catch (error) {
    const { error: message, code, statusCode } = getErrorResponse(error)
    return NextResponse.json({ success: false, error: message, code }, { status: statusCode })
  }
}
