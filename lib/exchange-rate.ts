import { redis, isRedisAvailable } from '@/lib/redis'
import { QUOTE } from '@/lib/limits'
import { VocliraError } from '@/lib/errors'

// Server-only SOL/USD rate resolver for USD-primary pricing.
// Layered for resilience: 60s Redis cache → CoinGecko → Jupiter → last-good
// (24h) → RATE_UNAVAILABLE. The caller (crypto checkout) additionally rejects a
// rate older than QUOTE.RATE_MAX_AGE_SECONDS; card payments don't need a rate.

export interface SolUsdRate {
  rateUsdPerSol: number
  /** ms epoch of the underlying provider fetch. */
  fetchedAt: number
  source: 'coingecko' | 'jupiter' | 'last-good'
}

const RATE_KEY = 'rate:sol-usd'
const RATE_LAST_GOOD_KEY = 'rate:sol-usd:last-good'
const LAST_GOOD_TTL_SECONDS = 24 * 60 * 60
const FETCH_TIMEOUT_MS = 3000
const SOL_MINT = 'So11111111111111111111111111111111111111112'

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

async function fetchCoinGecko(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' }
    )
    if (!res.ok) return null
    const json = (await res.json()) as { solana?: { usd?: number } }
    return isPositiveFinite(json.solana?.usd) ? json.solana!.usd! : null
  } catch (e) {
    console.warn('[ExchangeRate] CoinGecko fetch failed:', e)
    return null
  }
}

async function fetchJupiter(): Promise<number | null> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, { usdPrice?: number }>
    const price = json[SOL_MINT]?.usdPrice
    return isPositiveFinite(price) ? price : null
  } catch (e) {
    console.warn('[ExchangeRate] Jupiter fetch failed:', e)
    return null
  }
}

/**
 * Resolve the current SOL/USD rate. Throws VocliraError('RATE_UNAVAILABLE', 503)
 * only when the cache, both providers, and the last-good fallback are all empty.
 */
export async function getSolUsdRate(): Promise<SolUsdRate> {
  const redisReady = isRedisAvailable() && redis !== null

  // 1) fresh cache
  if (redisReady) {
    const cached = await redis!.get<SolUsdRate>(RATE_KEY)
    if (cached && isPositiveFinite(cached.rateUsdPerSol)) return cached
  }

  // 2) providers
  let rate = await fetchCoinGecko()
  let source: SolUsdRate['source'] = 'coingecko'
  if (rate === null) {
    rate = await fetchJupiter()
    source = 'jupiter'
  }

  if (rate !== null) {
    const result: SolUsdRate = { rateUsdPerSol: rate, fetchedAt: Date.now(), source }
    if (redisReady) {
      await redis!.set(RATE_KEY, result, { ex: QUOTE.RATE_CACHE_SECONDS })
      await redis!.set(RATE_LAST_GOOD_KEY, result, { ex: LAST_GOOD_TTL_SECONDS })
    }
    return result
  }

  // 3) last-good (may be stale — the caller enforces max age for crypto)
  if (redisReady) {
    const lastGood = await redis!.get<SolUsdRate>(RATE_LAST_GOOD_KEY)
    if (lastGood && isPositiveFinite(lastGood.rateUsdPerSol)) {
      return { ...lastGood, source: 'last-good' }
    }
  }

  throw new VocliraError('SOL/USD rate unavailable', 'RATE_UNAVAILABLE', 503)
}

/** True if a rate is too old to price a crypto checkout against (fail-closed). */
export function isRateTooStale(rate: SolUsdRate): boolean {
  return Date.now() - rate.fetchedAt > QUOTE.RATE_MAX_AGE_SECONDS * 1000
}
