import type { SupportedLanguage } from '@/types'

// Single source of truth for product limits and economic constants.
// Pure and isomorphic: safe to import from client components, API routes, and lib modules.
// User-facing copy in lib/translations.ts must interpolate these values via t() placeholders —
// never hardcode a user-visible number inside a component or translation string.

export const RECORDING = {
  /** Hard minimum for the reference sample — enforced client-side and via byte size on the server. */
  MIN_SECONDS: 8,
  /** Recorder auto-stops at this ceiling. */
  MAX_SECONDS: 25,
  /** Recommended sweet spot communicated in onboarding copy. */
  TARGET_SECONDS: 15,
} as const

export const CONSENT = {
  /** Minimum spoken-consent recording length. */
  MIN_SECONDS: 3,
} as const

// Per-language character ceilings (Chatterbox engine limits, MVP):
//   Multilingual (tr) max 300 → 280 buffer for tags/punctuation
//   Turbo (en) max 5000 → 500 MVP cap (cost + "mini message" format)
export const TEXT = {
  MIN_LENGTH: 5,
  MAX_LENGTH_BY_LANGUAGE: { tr: 280, en: 500 } as Record<SupportedLanguage, number>,
} as const

export const PRICING = {
  /** One billing unit per started block of this many characters. */
  UNIT_CHARS: 150,
  // ⚠️ price_lamports is deprecated as a stored price (USD-primary since Faz 3;
  // lamports are derived per-checkout from the live rate). These lamport bounds
  // and SOL options are kept only for legacy readers — do not add new usage.
  /** @deprecated USD-primary; see PRICING_USD. */
  MIN_PRICE_LAMPORTS: 10_000_000, // 0.01 SOL
  /** @deprecated USD-primary; see PRICING_USD. */
  MAX_PRICE_LAMPORTS: 100_000_000, // 0.1 SOL
  MIN_PRICE_SOL: 0.01,
  MAX_PRICE_SOL: 0.1,
  PLATFORM_FEE_RATE: 0.1,
  CREATOR_SHARE_RATE: 0.9,
  /** @deprecated USD-primary; see PRICING_USD.PRICE_OPTIONS_USD_CENTS. */
  PRICE_OPTIONS_SOL: [0.01, 0.03, 0.05, 0.08, 0.1],
  /** Now cosmetic only — the live rate comes from lib/exchange-rate.ts. */
  SOL_USD_FALLBACK: 150,
} as const

// USD-primary pricing (Faz 3). The creator sets a USD price; crypto fans pay the
// equivalent SOL at the live rate, locked into the moderation session as a quote.
export const PRICING_USD = {
  MIN_PRICE_USD_CENTS: 100, // $1
  MAX_PRICE_USD_CENTS: 1500, // $15
  PRICE_OPTIONS_USD_CENTS: [100, 200, 300, 500, 1000, 1500],
  /** Transparent processing fee charged to the fan on card payments (covers Stripe's fixed fee). */
  CARD_PROCESSING_FEE_USD_CENTS: 40,
} as const

export const PAYOUT = {
  /** Minimum card-earnings balance a creator can withdraw. */
  MIN_USD_CENTS: 1000, // $10
} as const

export const QUOTE = {
  /** Quote validity — same window as the moderation session. */
  TTL_SECONDS: 600,
  /** Redis cache TTL for the SOL/USD rate. */
  RATE_CACHE_SECONDS: 60,
  /** A rate older than this is rejected for crypto checkout (fail-closed). */
  RATE_MAX_AGE_SECONDS: 600,
  /** Slack for the rare no-session generate fallback (rate may have drifted). */
  NO_SESSION_TOLERANCE: 0.05,
} as const

/** Platform's cut of a USD total, in cents — same rate as the lamport split. */
export function platformFeeUsdCents(totalCents: number): number {
  return Math.floor(totalCents * PRICING.PLATFORM_FEE_RATE)
}

/** Convert USD cents to lamports at a given SOL/USD rate: cents/100 ÷ rate × 1e9. */
export function usdCentsToLamports(cents: number, rateUsdPerSol: number): number {
  return Math.round((cents * 1e7) / rateUsdPerSol)
}

export function isValidPriceUsdCents(cents: number): boolean {
  return (
    typeof cents === 'number' &&
    Number.isInteger(cents) &&
    cents >= PRICING_USD.MIN_PRICE_USD_CENTS &&
    cents <= PRICING_USD.MAX_PRICE_USD_CENTS
  )
}

// On-chain transaction tuning for the fan payment (two SystemProgram transfers).
// Attached client-side in sendPaymentTransaction() so the tx survives mainnet
// congestion instead of silently expiring like the current fire-and-forget send.
export const TX = {
  /** Two transfers need ~450 compute units; 20k is generous headroom. */
  COMPUTE_UNIT_LIMIT: 20_000,
  /** Priority fee per compute unit. 20k CU × 100k µLamports ≈ 2,000 lamports (~0.000002 SOL). */
  PRIORITY_FEE_MICROLAMPORTS: 100_000,
} as const

// Reference samples are converted client-side to 24kHz mono 16-bit WAV (lib/audio-wav.ts),
// so byte size ≈ duration × 48,000 + 44-byte header. Server-side sanity bounds:
const WAV_BYTES_PER_SECOND = 24_000 * 2

export const REFERENCE_AUDIO = {
  WAV_BYTES_PER_SECOND,
  /** Slightly under MIN_SECONDS to tolerate encoder rounding. */
  MIN_BYTES: WAV_BYTES_PER_SECOND * (RECORDING.MIN_SECONDS - 1),
  /** Generous headroom above MAX_SECONDS for uploads that trim server-side checks shouldn't reject. */
  MAX_BYTES: WAV_BYTES_PER_SECOND * (RECORDING.MAX_SECONDS + 15),
} as const

export function maxTextLengthFor(language: string): number {
  return TEXT.MAX_LENGTH_BY_LANGUAGE[language === 'tr' ? 'tr' : 'en']
}

/** Billing units for a message — 0 when empty; identical formula on client and server. */
export function priceUnitsFor(text: string): number {
  return text.length > 0 ? Math.ceil(text.length / PRICING.UNIT_CHARS) : 0
}

/** Platform's cut of a total payment — identical formula on client and server. */
export function platformFeeLamports(totalLamports: number): number {
  return Math.floor(totalLamports * PRICING.PLATFORM_FEE_RATE)
}

export function isValidPriceLamports(lamports: number): boolean {
  return (
    typeof lamports === 'number' &&
    Number.isFinite(lamports) &&
    lamports >= PRICING.MIN_PRICE_LAMPORTS &&
    lamports <= PRICING.MAX_PRICE_LAMPORTS
  )
}
