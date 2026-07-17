import { NextRequest, NextResponse } from 'next/server'
import { requestPayout } from '@/lib/supabase'
import { getErrorResponse } from '@/lib/errors'
import { safeParseJson, isValidWalletAddress } from '@/lib/validation'
import { verifyWalletAuthOrSession } from '@/lib/auth'
import { PAYOUT } from '@/lib/limits'
import type { PayoutMethod, BankDetails } from '@/types'

const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/

interface PayoutRequestBody {
  walletAddress?: string
  amountUsdCents?: number
  method?: PayoutMethod
  destWallet?: string
  bankDetails?: { iban?: string; accountHolder?: string }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await safeParseJson<PayoutRequestBody>(req)
  if (body === null) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletAddress, amountUsdCents, method, destWallet, bankDetails } = body
  if (!walletAddress || amountUsdCents === undefined || !method) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
  }
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 })
  }
  if (!Number.isInteger(amountUsdCents) || amountUsdCents < PAYOUT.MIN_USD_CENTS) {
    return NextResponse.json(
      { success: false, error: `Minimum payout is $${PAYOUT.MIN_USD_CENTS / 100}`, code: 'AMOUNT_TOO_LOW' },
      { status: 400 }
    )
  }
  if (method !== 'sol_transfer' && method !== 'bank_transfer') {
    return NextResponse.json({ success: false, error: 'Invalid payout method' }, { status: 400 })
  }

  let destWalletFinal: string | null = null
  let bankDetailsFinal: BankDetails | null = null
  if (method === 'sol_transfer') {
    // Default the destination to the creator's own wallet.
    const dest = destWallet || walletAddress
    if (!isValidWalletAddress(dest)) {
      return NextResponse.json({ success: false, error: 'Invalid destination wallet' }, { status: 400 })
    }
    destWalletFinal = dest
  } else {
    const iban = (bankDetails?.iban ?? '').replace(/\s/g, '').toUpperCase()
    const accountHolder = (bankDetails?.accountHolder ?? '').trim()
    if (!IBAN_RE.test(iban)) {
      return NextResponse.json({ success: false, error: 'Invalid IBAN', code: 'INVALID_IBAN' }, { status: 400 })
    }
    if (accountHolder.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Account holder name required', code: 'INVALID_ACCOUNT_HOLDER' },
        { status: 400 }
      )
    }
    bankDetailsFinal = { iban, accountHolder }
  }

  const authorized = await verifyWalletAuthOrSession(walletAddress, req.headers)
  if (!authorized) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payoutRequestId = await requestPayout({
      walletAddress,
      amountUsdCents,
      method,
      destWallet: destWalletFinal,
      bankDetails: bankDetailsFinal,
    })
    return NextResponse.json({ success: true, payoutRequestId }, { status: 200 })
  } catch (error) {
    const { error: message, code, statusCode } = getErrorResponse(error)
    return NextResponse.json({ success: false, error: message, code }, { status: statusCode })
  }
}
