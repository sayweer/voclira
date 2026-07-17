import { NextRequest, NextResponse } from 'next/server'
import { getCreatorByWallet } from '@/lib/supabase'
import {
    isSafeToGenerate,
    validateTextLengthForLanguage,
    hashUserText,
    maxTextLengthFor,
    normalizeLanguage,
} from '@/lib/moderation'
import { createSession } from '@/lib/session'
import { getErrorResponse, UnsafeContentError } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { priceUnitsFor, usdCentsToLamports } from '@/lib/limits'
import { getSolUsdRate, isRateTooStale } from '@/lib/exchange-rate'

export const maxDuration = 15

// Pre-payment moderation. Fan submits text BEFORE paying; if unsafe, no payment is taken.
// On success a one-time moderation session is stored (raw text hash) that /api/voice/generate
// must present — locking the approved text to the generated text across the payment boundary.
const MOD_SESSION_PREFIX = 'mod-session'
const MOD_SESSION_TTL = 10 * 60 // 10 dk — ödeme için yeterli pencere

interface ModerateRequest {
    creatorWallet: string
    // Required for crypto (binds the quote to the payer); absent for card fans (no wallet).
    buyerWallet?: string
    text: string
    // Fan-selected generation language; defaults to the creator's declared language.
    language?: string
    paymentMethod?: 'crypto' | 'card'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(req)
    if (!(await checkRateLimit(ip, 10, 60_000))) {
        return NextResponse.json(
            { success: false, error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
            { status: 429 }
        )
    }

    const body = await safeParseJson<Partial<ModerateRequest>>(req)
    if (body === null) {
        return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const { creatorWallet, buyerWallet, text, language: rawLanguage, paymentMethod: rawPaymentMethod } = body
    const paymentMethod = rawPaymentMethod === 'card' ? 'card' : 'crypto'

    if (!creatorWallet || typeof text !== 'string') {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }
    if (!isValidWalletAddress(creatorWallet)) {
        return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
    }
    // Crypto binds the quote to the buyer's wallet; card has no wallet.
    if (paymentMethod === 'crypto') {
        if (!buyerWallet || !isValidWalletAddress(buyerWallet)) {
            return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
        }
    } else if (buyerWallet && !isValidWalletAddress(buyerWallet)) {
        return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
    }

    try {
        const creator = await getCreatorByWallet(creatorWallet)
        if (creator === null) {
            return NextResponse.json({ success: false, error: 'Creator not found' }, { status: 404 })
        }
        if (!creator.is_active) {
            return NextResponse.json({ success: false, error: 'Creator is not active' }, { status: 403 })
        }

        // Fan picks the generation language; fall back to the creator's declared language.
        const language = normalizeLanguage(rawLanguage, normalizeLanguage(creator.language))
        validateTextLengthForLanguage(text, language)

        try {
            await isSafeToGenerate(text, {
                blockAdult: creator.block_adult,
                blockProfanity: creator.block_profanity,
                blockPolitical: creator.block_political,
            })
        } catch (moderationError) {
            if (moderationError instanceof UnsafeContentError) {
                return NextResponse.json(
                    {
                        success: false,
                        approved: false,
                        error: 'Content violates creator brand safety policy',
                        category: moderationError.category,
                        code: 'UNSAFE_CONTENT',
                    },
                    { status: 422 }
                )
            }
            throw moderationError
        }

        // Card fans pay in USD (no rate needed) — just bind the approved text to a
        // one-time session for /api/checkout/card to consume.
        if (paymentMethod === 'card') {
            const moderationSessionId = await createSession(
                MOD_SESSION_PREFIX,
                {
                    buyerWallet: buyerWallet ?? null,
                    creatorWallet,
                    rawTextHash: hashUserText(text),
                    language,
                },
                MOD_SESSION_TTL
            )
            return NextResponse.json({
                success: true,
                approved: true,
                moderationSessionId,
                language,
                maxLength: maxTextLengthFor(language),
            })
        }

        // Crypto: USD-primary quote — lock the SOL amount at the current rate for the
        // payment window, so a fan who paid off the quote can't be under-charged by a swing.
        const priceUsdCents = creator.price_usd_cents
        if (priceUsdCents == null) {
            return NextResponse.json(
                { success: false, error: 'Creator price not configured', code: 'PRICE_NOT_SET' },
                { status: 409 }
            )
        }
        const amountUsdCents = priceUnitsFor(text) * priceUsdCents

        let rate
        try {
            rate = await getSolUsdRate()
        } catch {
            return NextResponse.json(
                { success: false, error: 'Exchange rate unavailable, please try again shortly', code: 'RATE_UNAVAILABLE' },
                { status: 503 }
            )
        }
        // Fail-closed: never price a crypto checkout off a rate older than the max age.
        if (isRateTooStale(rate)) {
            return NextResponse.json(
                { success: false, error: 'Exchange rate unavailable, please try again shortly', code: 'RATE_UNAVAILABLE' },
                { status: 503 }
            )
        }
        const quotedLamports = usdCentsToLamports(amountUsdCents, rate.rateUsdPerSol)
        if (quotedLamports <= 0) {
            return NextResponse.json(
                { success: false, error: 'Invalid price', code: 'INVALID_PRICE' },
                { status: 500 }
            )
        }
        const quotedAt = Date.now()

        // Approved → bind the raw text + buyer + creator + locked quote to a one-time session.
        const moderationSessionId = await createSession(
            MOD_SESSION_PREFIX,
            {
                buyerWallet,
                creatorWallet,
                rawTextHash: hashUserText(text),
                language,
                amountUsdCents,
                quotedLamports,
                rateUsdPerSol: rate.rateUsdPerSol,
                quotedAt,
            },
            MOD_SESSION_TTL
        )

        return NextResponse.json({
            success: true,
            approved: true,
            moderationSessionId,
            language,
            maxLength: maxTextLengthFor(language),
            quote: {
                amountUsdCents,
                lamports: quotedLamports,
                rateUsdPerSol: rate.rateUsdPerSol,
                expiresAt: quotedAt + MOD_SESSION_TTL * 1000,
            },
        })
    } catch (error) {
        const { error: message, code, statusCode } = getErrorResponse(error)
        return NextResponse.json({ success: false, error: message, code }, { status: statusCode })
    }
}
