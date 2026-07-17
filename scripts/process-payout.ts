/**
 * Operator payout script — runs LOCALLY only (never on Vercel).
 *
 *   npx tsx scripts/process-payout.ts
 *
 * Requires env: SUPABASE_URL, SUPABASE_ANON_KEY, SOLANA_RPC_URL, TREASURY_SECRET_KEY.
 * TREASURY_SECRET_KEY (base58 or JSON array) must NEVER be deployed — it lives only
 * on the operator's machine. Lists all 'requested' payouts and processes each after
 * confirmation: sol_transfer sends from the treasury; bank_transfer is marked paid
 * after a manual wire. On failure the reserved amount is credited back (adjustment).
 */
import { createClient } from '@supabase/supabase-js'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import bs58 from 'bs58'
import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { PayoutRequest } from '@/types'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required env: ${name}`)
    process.exit(1)
  }
  return value
}

function loadTreasury(secret: string): Keypair {
  try {
    const trimmed = secret.trim()
    if (trimmed.startsWith('[')) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]))
    }
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    console.error('Invalid TREASURY_SECRET_KEY (expected base58 or JSON array)')
    process.exit(1)
  }
}

const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'))
const connection = new Connection(requireEnv('SOLANA_RPC_URL'), 'confirmed')
const treasury = loadTreasury(requireEnv('TREASURY_SECRET_KEY'))

async function getSolRate(): Promise<number> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
  if (!res.ok) throw new Error(`rate HTTP ${res.status}`)
  const json = (await res.json()) as { solana?: { usd?: number } }
  const usd = json.solana?.usd
  if (typeof usd !== 'number' || usd <= 0) throw new Error('rate unavailable')
  return usd
}

async function markPaid(id: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('payout_requests')
    .update({ status: 'paid', processed_at: new Date().toISOString(), ...fields })
    .eq('id', id)
  if (error) console.error('  DB update failed:', error.message)
}

async function markFailed(p: PayoutRequest, note: string): Promise<void> {
  await supabase
    .from('payout_requests')
    .update({ status: 'failed', processed_at: new Date().toISOString(), admin_note: note.slice(0, 500) })
    .eq('id', p.id)
  // Compensating entry: credit the reserved amount back (reverses the payout_debit).
  await supabase.from('creator_ledger_entries').insert({
    creator_wallet: p.creator_wallet,
    payout_request_id: p.id,
    entry_type: 'adjustment',
    amount_usd_cents: p.amount_usd_cents,
  })
  console.log('  ↩ reserved amount credited back (adjustment)')
}

async function processSolTransfer(rl: readline.Interface, p: PayoutRequest): Promise<void> {
  if (!p.dest_wallet) {
    console.log('  ✗ no destination wallet, skipping')
    return
  }
  let rate: number
  try {
    rate = await getSolRate()
  } catch {
    console.log('  ✗ SOL rate unavailable, skipping')
    return
  }
  const sol = p.amount_usd_cents / 100 / rate
  const lamports = Math.round(sol * LAMPORTS_PER_SOL)
  console.log(`  dest   : ${p.dest_wallet}`)
  console.log(`  rate   : $${rate}/SOL → ${sol.toFixed(6)} SOL (${lamports} lamports)`)

  const answer = await rl.question('  Send this SOL transfer? (yes/skip): ')
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('  skipped')
    return
  }

  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: new PublicKey(p.dest_wallet),
        lamports,
      })
    )
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.feePayer = treasury.publicKey
    const signature = await connection.sendTransaction(tx, [treasury])
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    await markPaid(p.id, {
      payout_tx_signature: signature,
      sol_rate_usd: rate,
      sol_amount_lamports: lamports,
    })
    console.log(`  ✓ paid — ${signature}`)
  } catch (err) {
    console.error('  ✗ transfer failed:', err)
    await markFailed(p, String(err))
  }
}

async function processBankTransfer(rl: readline.Interface, p: PayoutRequest): Promise<void> {
  console.log(`  IBAN   : ${p.dest_bank_details?.iban ?? '(missing)'}`)
  console.log(`  holder : ${p.dest_bank_details?.accountHolder ?? '(missing)'}`)
  const answer = await rl.question('  Mark PAID after wiring manually? (yes/skip): ')
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('  skipped')
    return
  }
  await markPaid(p.id, {})
  console.log('  ✓ marked paid')
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('status', 'requested')
    .order('requested_at', { ascending: true })

  if (error) {
    console.error('Failed to load payouts:', error.message)
    process.exit(1)
  }

  const rows = (data as PayoutRequest[]) ?? []
  if (rows.length === 0) {
    console.log('No requested payouts.')
    return
  }

  const balanceLamports = await connection.getBalance(treasury.publicKey)
  console.log(`Treasury: ${treasury.publicKey.toBase58()}`)
  console.log(`Balance : ${(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
  console.log(`Pending : ${rows.length} payout request(s)\n`)

  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    for (const p of rows) {
      console.log('─'.repeat(60))
      console.log(`Payout ${p.id}`)
      console.log(`  creator: ${p.creator_wallet}`)
      console.log(`  amount : $${(p.amount_usd_cents / 100).toFixed(2)}`)
      console.log(`  method : ${p.method}`)
      if (p.method === 'sol_transfer') {
        await processSolTransfer(rl, p)
      } else {
        await processBankTransfer(rl, p)
      }
    }
  } finally {
    rl.close()
  }
  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
