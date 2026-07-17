import { NextRequest, NextResponse } from 'next/server'
import { getCreatorPurchasesWindow } from '@/lib/supabase'
import { verifyWalletAuthOrSession } from '@/lib/auth'
import { isValidWalletAddress, getClientIp } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { getErrorResponse } from '@/lib/errors'
import type { AnalyticsRangeDays, Purchase } from '@/types'

const ALLOWED_DAYS = new Set<number>([7, 30, 90])

function parseDays(raw: string | null): AnalyticsRangeDays {
  const n = Number(raw)
  if (ALLOWED_DAYS.has(n)) return n as AnalyticsRangeDays
  return 30
}

function escapeCsv(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function lamportsToSol(n: number): string {
  return (n / 1_000_000_000).toFixed(9)
}

function toCsv(rows: Purchase[]): string {
  const header = [
    'date',
    'status',
    'buyer_wallet',
    'amount_sol',
    'platform_fee_sol',
    'net_sol',
    'play_count',
    'rejection_reason',
    'tx_signature',
  ].join(',')

  const body = rows.map((r) => {
    // Card rows have null lamports (USD columns hold their value; Faz 7A adds them here).
    const gross = r.amount_lamports ?? 0
    const fee = r.platform_fee_lamports ?? 0
    const net = gross - fee
    return [
      escapeCsv(r.created_at),
      escapeCsv(r.status),
      escapeCsv(r.buyer_wallet),
      escapeCsv(lamportsToSol(gross)),
      escapeCsv(lamportsToSol(fee)),
      escapeCsv(lamportsToSol(net)),
      escapeCsv(String(r.play_count)),
      escapeCsv(r.rejection_reason),
      escapeCsv(r.tx_signature),
    ].join(',')
  })

  return [header, ...body].join('\n') + '\n'
}

export async function GET(
  req: NextRequest,
  { params }: { params: { walletAddress: string } }
): Promise<NextResponse> {
  const ip = getClientIp(req)
  if (!await checkRateLimit(`analytics-export:${ip}`, 10, 60_000)) {
    return NextResponse.json(
      { success: false, error: 'Too many requests', code: 'RATE_LIMITED' },
      { status: 429 }
    )
  }

  const walletAddress = params.walletAddress
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json(
      { success: false, error: 'Invalid wallet address' },
      { status: 400 }
    )
  }

  const authorized = await verifyWalletAuthOrSession(walletAddress, req.headers)
  if (!authorized) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const days = parseDays(req.nextUrl.searchParams.get('days'))

  try {
    const rows = await getCreatorPurchasesWindow(walletAddress, days)
    const csv = toCsv(rows)
    const filename = `voclira-${walletAddress.slice(0, 8)}-${days}d.csv`
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    const { error: message, code, statusCode } = getErrorResponse(error)
    return NextResponse.json(
      { success: false, error: message, code },
      { status: statusCode }
    )
  }
}
