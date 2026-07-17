import { NextRequest, NextResponse } from 'next/server'
import { getCreatorFiatBalance, listPayoutRequests } from '@/lib/supabase'
import { getErrorResponse } from '@/lib/errors'
import { isValidWalletAddress } from '@/lib/validation'
import { verifyWalletAuthOrSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const walletAddress = req.nextUrl.searchParams.get('walletAddress') ?? ''
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
  }

  const authorized = await verifyWalletAuthOrSession(walletAddress, req.headers)
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [balanceUsdCents, requests] = await Promise.all([
      getCreatorFiatBalance(walletAddress),
      listPayoutRequests(walletAddress),
    ])
    return NextResponse.json({ balanceUsdCents, requests })
  } catch (error) {
    const { error: message, code, statusCode } = getErrorResponse(error)
    return NextResponse.json({ error: message, code }, { status: statusCode })
  }
}
