import { NextResponse } from 'next/server'
import { PRICING } from '@/lib/limits'

export const revalidate = 180

const FALLBACK_USD = PRICING.SOL_USD_FALLBACK

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { next: { revalidate: 180 } }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)

    const json = (await res.json()) as { solana?: { usd?: number } }
    const usd = json.solana?.usd
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) {
      throw new Error('Invalid price payload')
    }

    return NextResponse.json({ usd, stale: false })
  } catch {
    return NextResponse.json({ usd: FALLBACK_USD, stale: true })
  }
}
