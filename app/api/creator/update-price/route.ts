import { NextRequest, NextResponse } from 'next/server'
import { getCreatorByWallet, updateCreatorPrice } from '@/lib/supabase'
import { getErrorResponse } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress } from '@/lib/validation'
import { PRICING_USD, isValidPriceUsdCents } from '@/lib/limits'
import { verifyWalletAuthOrSession } from '@/lib/auth'

interface UpdatePriceBody {
  walletAddress?: string
  priceInUsdCents?: number
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // Safe JSON parsing
  const body = await safeParseJson<UpdatePriceBody>(req)
  if (body === null) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletAddress, priceInUsdCents } = body

  if (!walletAddress || priceInUsdCents === undefined) {
    return NextResponse.json(
      { error: 'Missing required fields' },
      { status: 400 }
    )
  }

  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
  }

  if (!isValidPriceUsdCents(priceInUsdCents)) {
    return NextResponse.json(
      { error: `Price must be between $${PRICING_USD.MIN_PRICE_USD_CENTS / 100} and $${PRICING_USD.MAX_PRICE_USD_CENTS / 100} per 150 characters` },
      { status: 400 }
    )
  }

  // Wallet signature verification (single-use nonce/session token)
  const authorized = await verifyWalletAuthOrSession(walletAddress, req.headers)
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const creator = await getCreatorByWallet(walletAddress)
    if (creator === null || !creator.is_active) {
      return NextResponse.json({ error: 'Creator not found or inactive' }, { status: 404 })
    }

    await updateCreatorPrice(walletAddress, priceInUsdCents)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    const { error: msg, statusCode } = getErrorResponse(error)
    return NextResponse.json({ error: msg }, { status: statusCode })
  }
}
