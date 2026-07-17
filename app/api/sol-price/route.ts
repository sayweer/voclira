import { NextResponse } from 'next/server'
import { PRICING } from '@/lib/limits'
import { getSolUsdRate } from '@/lib/exchange-rate'

// Cosmetic display rate for the client. Shares lib/exchange-rate's 60s Redis cache
// with the crypto quote path, so the "≈ SOL" preview matches the checkout rate and
// providers aren't hit on every page load.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const rate = await getSolUsdRate()
    return NextResponse.json({ usd: rate.rateUsdPerSol, stale: rate.source === 'last-good' })
  } catch {
    return NextResponse.json({ usd: PRICING.SOL_USD_FALLBACK, stale: true })
  }
}
