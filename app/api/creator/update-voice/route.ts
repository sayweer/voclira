import { NextRequest, NextResponse } from 'next/server'
import { getCreatorByWallet, updateCreatorVoice } from '@/lib/supabase'
import { getPrivateObjectSize } from '@/lib/r2'
import { RECORDING, REFERENCE_AUDIO } from '@/lib/limits'
import { consumeSession } from '@/lib/session'
import { getErrorResponse } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { verifyWalletAuthOrSession } from '@/lib/auth'

// Re-record flow for ACTIVE creators. Unlike /api/creator/register (unauthenticated,
// guarded by the already-registered check), replacing an existing voice profile is a
// destructive action on a live creator — so this route REQUIRES wallet auth.
// Consumes the same one-time upload sessions the register flow produces.
const UPLOAD_SESSION_PREFIX = 'upload-session'

interface UploadSession {
  objectKey: string
  walletAddress: string
  type: 'voice-profile' | 'verification-audio'
}

interface UpdateVoiceBody {
  walletAddress?: string
  uploadSessionId?: string
  verificationUploadSessionId?: string
  consentTextVersion?: string
  language?: string
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req)
  if (!(await checkRateLimit(ip, 10, 60 * 60 * 1000))) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      { status: 429 }
    )
  }

  const body = await safeParseJson<UpdateVoiceBody>(req)
  if (body === null) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletAddress, uploadSessionId, verificationUploadSessionId, consentTextVersion, language } = body

  if (!walletAddress || !uploadSessionId || !verificationUploadSessionId || !consentTextVersion) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
  }
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
  }

  const authorized = await verifyWalletAuthOrSession(walletAddress, req.headers)
  if (!authorized) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const creator = await getCreatorByWallet(walletAddress)
    if (creator === null) {
      return NextResponse.json({ success: false, error: 'Creator not found' }, { status: 404 })
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

    await updateCreatorVoice(walletAddress, {
      voiceProfileObjectKey: voiceSession.objectKey,
      verificationAudioObjectKey: verifySession.objectKey,
      consentAt: new Date().toISOString(),
      consentIp: ip,
      consentTextVersion,
      language: language === 'tr' || language === 'en' ? language : undefined,
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    const { error: message, code, statusCode } = getErrorResponse(error)
    return NextResponse.json({ success: false, error: message, code }, { status: statusCode })
  }
}
