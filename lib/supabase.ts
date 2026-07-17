import { createClient } from '@supabase/supabase-js'
import type {
  AnalyticsRangeDays,
  AnalyticsResponse,
  AnalyticsSummary,
  AnalyticsTimeseriesPoint,
  Creator,
  Purchase,
  PurchaseStatus,
  RecentPurchaseRow,
  RefundStatus,
  PayoutMethod,
  PayoutRequest,
  BankDetails,
} from '@/types'
import { VocliraError, CreatorNotFoundError } from '@/lib/errors'

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_ANON_KEY ?? ''
)

function dbError(msg: string): never {
  // Log full error detail server-side for debugging
  console.error(`[Supabase] ${msg}`)
  throw new VocliraError('A database error occurred', 'DB_ERROR', 500)
}

export async function getCreatorByWallet(walletAddress: string): Promise<Creator | null> {
  const { data, error } = await supabase
    .from('creators')
    .select('*')
    .eq('wallet_address', walletAddress)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    dbError(`DB error: ${error.message}`)
  }

  return data as Creator
}

export async function saveCreator(data: {
  walletAddress: string
  creatorName: string
  // voiceId is legacy (ElevenLabs). Chatterbox/Fal creators have no voice_id and
  // instead store a zero-shot reference at voiceProfileObjectKey. Defaults to '' (NOT NULL).
  voiceId?: string
  // USD-primary (Faz 3): price stored in cents; price_lamports is left at its DB
  // default (0) and derived per-checkout from the live rate.
  priceUsdCents: number
  language?: string
  isActive?: boolean
  // Chatterbox/Fal migration + consent.
  voiceProfileObjectKey?: string
  consentAt?: string
  consentIp?: string
  consentTextVersion?: string
  verificationAudioObjectKey?: string
}): Promise<Creator> {
  const payload: Record<string, unknown> = {
    wallet_address: data.walletAddress,
    creator_name: data.creatorName,
    voice_id: data.voiceId ?? '',
    price_usd_cents: data.priceUsdCents,
    language: data.language ?? 'en',
    is_active: data.isActive ?? true,
    block_adult: true,
    block_profanity: true,
    block_political: true,
  }
  if (data.voiceProfileObjectKey !== undefined) payload.voice_profile_object_key = data.voiceProfileObjectKey
  if (data.consentAt !== undefined) payload.consent_at = data.consentAt
  if (data.consentIp !== undefined) payload.consent_ip = data.consentIp
  if (data.consentTextVersion !== undefined) payload.consent_text_version = data.consentTextVersion
  if (data.verificationAudioObjectKey !== undefined) {
    payload.verification_audio_object_key = data.verificationAudioObjectKey
  }

  const { data: row, error } = await supabase
    .from('creators')
    .upsert(payload, { onConflict: 'wallet_address' })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new VocliraError('Creator already registered', 'ALREADY_EXISTS', 409)
    }
    dbError(`DB error: ${error.message}`)
  }

  return row as Creator
}

export async function getPurchaseByTxSignature(txSignature: string): Promise<Purchase | null> {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('tx_signature', txSignature)
    .maybeSingle()

  if (error) dbError(`DB error: ${error.message}`)

  return (data as Purchase | null) ?? null
}

export async function updateCreatorPrice(walletAddress: string, priceUsdCents: number): Promise<void> {
  const { error } = await supabase
    .from('creators')
    .update({ price_usd_cents: priceUsdCents })
    .eq('wallet_address', walletAddress)

  if (error) throw new VocliraError('Failed to update price', 'DB_ERROR', 500)
}

/**
 * Re-record flow: replaces only the voice profile + consent fields of an existing
 * creator. Unlike saveCreator's upsert, this preserves price, brand-safety filters,
 * earnings stats, and the NFT mint.
 */
export async function updateCreatorVoice(
  walletAddress: string,
  data: {
    voiceProfileObjectKey: string
    verificationAudioObjectKey: string
    consentAt: string
    consentIp: string
    consentTextVersion: string
    language?: string
  }
): Promise<void> {
  const payload: Record<string, unknown> = {
    voice_profile_object_key: data.voiceProfileObjectKey,
    verification_audio_object_key: data.verificationAudioObjectKey,
    consent_at: data.consentAt,
    consent_ip: data.consentIp,
    consent_text_version: data.consentTextVersion,
    is_active: true,
  }
  if (data.language !== undefined) payload.language = data.language

  const { error } = await supabase
    .from('creators')
    .update(payload)
    .eq('wallet_address', walletAddress)

  if (error) throw new VocliraError('Failed to update voice profile', 'DB_ERROR', 500)
}

export async function updateCreatorNftMint(walletAddress: string, nftMint: string): Promise<void> {
  const { error } = await supabase
    .from('creators')
    .update({ nft_mint: nftMint })
    .eq('wallet_address', walletAddress)

  if (error) throw new VocliraError('Failed to update license mint', 'DB_ERROR', 500)
}

export async function savePurchase(data: {
  buyerWallet: string
  creatorWallet: string
  txSignature: string
  fanText: string
  amountLamports: number
  platformFeeLamports: number
  // USD-primary bookkeeping (Faz 3). Recorded alongside the lamports for crypto sales.
  amountUsdCents?: number
  platformFeeUsdCents?: number
  language?: string
  currency?: string
  paymentMethod?: 'crypto' | 'card'
}): Promise<Purchase> {
  // Insert; if the tx_signature already exists (unique constraint, Postgres 23505),
  // fetch and return the existing row instead. This makes the operation idempotent
  // and prevents the TOCTOU race where two concurrent requests both pass the
  // `getPurchaseByTxSignature → null` check and try to insert.
  const insertPayload: Record<string, unknown> = {
    buyer_wallet: data.buyerWallet,
    creator_wallet: data.creatorWallet,
    tx_signature: data.txSignature,
    fan_text: data.fanText,
    amount_lamports: data.amountLamports,
    platform_fee_lamports: data.platformFeeLamports,
    status: 'pending',
  }
  if (data.amountUsdCents !== undefined) insertPayload.amount_usd_cents = data.amountUsdCents
  if (data.platformFeeUsdCents !== undefined) insertPayload.platform_fee_usd_cents = data.platformFeeUsdCents
  if (data.language !== undefined) insertPayload.language = data.language
  if (data.currency !== undefined) insertPayload.currency = data.currency
  if (data.paymentMethod !== undefined) insertPayload.payment_method = data.paymentMethod

  const { data: row, error } = await supabase
    .from('purchases')
    .insert(insertPayload)
    .select()
    .single()

  if (error) {
    // Postgres unique_violation
    if (error.code === '23505') {
      const existing = await getPurchaseByTxSignature(data.txSignature)
      if (existing) return existing
    }
    dbError(`DB error: ${error.message}`)
  }

  return row as Purchase
}

export interface PurchaseUpdateFields {
  audioUrl?: string
  rejectionReason?: string
  generationEngine?: string
  providerRequestId?: string
  providerErrorType?: string
  inputCharCount?: number
  errorMessage?: string
}

/**
 * Update a purchase by its canonical UUID.
 *
 * Keyed by `id` (not tx_signature) so it also works for card purchases. On
 * 'completed', crypto sales credit lamports stats (increment_creator_stats);
 * card sales credit the fiat ledger (sale_credit) + usd stats. The ledger's
 * unique (purchase_id, entry_type) index is the idempotency guard — a re-completed
 * card sale is credited exactly once.
 */
export async function updatePurchaseStatusById(
  id: string,
  status: PurchaseStatus,
  fields: PurchaseUpdateFields = {}
): Promise<void> {
  const payload: Record<string, unknown> = { status }
  if (fields.audioUrl !== undefined) payload.audio_url = fields.audioUrl
  if (fields.rejectionReason !== undefined) payload.rejection_reason = fields.rejectionReason
  if (fields.generationEngine !== undefined) payload.generation_engine = fields.generationEngine
  if (fields.providerRequestId !== undefined) payload.provider_request_id = fields.providerRequestId
  if (fields.providerErrorType !== undefined) payload.provider_error_type = fields.providerErrorType
  if (fields.inputCharCount !== undefined) payload.input_char_count = fields.inputCharCount
  if (fields.errorMessage !== undefined) payload.error_message = fields.errorMessage
  if (status === 'completed' || status === 'failed') {
    payload.generation_completed_at = new Date().toISOString()
  }

  const { error: updateError } = await supabase
    .from('purchases')
    .update(payload)
    .eq('id', id)

  if (updateError) dbError(`DB error: ${updateError.message}`)

  if (status !== 'completed') return

  const { data: purchase, error: fetchError } = await supabase
    .from('purchases')
    .select('creator_wallet, payment_method, amount_lamports, platform_fee_lamports, amount_usd_cents, platform_fee_usd_cents')
    .eq('id', id)
    .single()

  if (fetchError) dbError(`DB error: ${fetchError.message}`)

  const p = purchase as {
    creator_wallet: string
    payment_method: 'crypto' | 'card'
    amount_lamports: number | null
    platform_fee_lamports: number | null
    amount_usd_cents: number | null
    platform_fee_usd_cents: number | null
  }

  if (p.payment_method === 'card') {
    const netUsdCents = (p.amount_usd_cents ?? 0) - (p.platform_fee_usd_cents ?? 0)
    // Ledger credit first: its unique (purchase_id, entry_type) index makes this the
    // single source of idempotency — a duplicate (23505) means already credited, so skip
    // the stats bump to avoid double-counting.
    const { error: ledgerError } = await supabase.from('creator_ledger_entries').insert({
      creator_wallet: p.creator_wallet,
      purchase_id: id,
      entry_type: 'sale_credit',
      amount_usd_cents: netUsdCents,
    })
    if (ledgerError) {
      if (ledgerError.code === '23505') return
      dbError(`DB error: ${ledgerError.message}`)
    }
    const { error: incError } = await supabase.rpc('increment_creator_stats_fiat', {
      p_wallet: p.creator_wallet,
      p_net_usd_cents: netUsdCents,
    })
    if (incError) dbError(`DB error: ${incError.message}`)
    return
  }

  // Crypto: atomic lamports increment via RPC (avoids read-modify-write races).
  const netLamports = (p.amount_lamports ?? 0) - (p.platform_fee_lamports ?? 0)
  const { error: incError } = await supabase.rpc('increment_creator_stats', {
    p_wallet: p.creator_wallet,
    p_net_lamports: netLamports,
  })
  if (incError) dbError(`DB error: ${incError.message}`)
}

/**
 * Optimistic status transition: only flips the row if it's still in `fromStatus`.
 * Returns false (0 rows) if another request already moved it — the webhook and the
 * client generate call both race to advance a card purchase, and only one may win.
 */
export async function transitionPurchase(
  id: string,
  fromStatus: PurchaseStatus,
  toStatus: PurchaseStatus,
  fields: { paidAt?: string; providerPaymentIntentId?: string } = {}
): Promise<boolean> {
  const payload: Record<string, unknown> = { status: toStatus }
  if (fields.paidAt !== undefined) payload.paid_at = fields.paidAt
  if (fields.providerPaymentIntentId !== undefined) {
    payload.provider_payment_intent_id = fields.providerPaymentIntentId
  }

  const { data, error } = await supabase
    .from('purchases')
    .update(payload)
    .eq('id', id)
    .eq('status', fromStatus)
    .select('id')

  if (error) dbError(`DB error: ${error.message}`)
  return (data?.length ?? 0) > 0
}

export async function getPurchaseByProviderPaymentId(
  provider: string,
  providerPaymentId: string
): Promise<Purchase | null> {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('provider', provider)
    .eq('provider_payment_id', providerPaymentId)
    .maybeSingle()

  if (error) dbError(`DB error: ${error.message}`)
  return (data as Purchase | null) ?? null
}

/** Lookup by the payment-intent id — used by refund webhooks (which carry the intent, not the checkout session). */
export async function getPurchaseByProviderPaymentIntentId(
  providerPaymentIntentId: string
): Promise<Purchase | null> {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('provider_payment_intent_id', providerPaymentIntentId)
    .maybeSingle()

  if (error) dbError(`DB error: ${error.message}`)
  return (data as Purchase | null) ?? null
}

/** Insert a card purchase draft in 'pending_payment' (no wallet/tx/lamports). */
export async function createCardDraftPurchase(data: {
  creatorWallet: string
  fanText: string
  amountUsdCents: number
  platformFeeUsdCents: number
  processingFeeUsdCents: number
  language: string
  buyerEmail: string | null
  provider: string
}): Promise<Purchase> {
  const { data: row, error } = await supabase
    .from('purchases')
    .insert({
      creator_wallet: data.creatorWallet,
      fan_text: data.fanText,
      amount_usd_cents: data.amountUsdCents,
      platform_fee_usd_cents: data.platformFeeUsdCents,
      processing_fee_usd_cents: data.processingFeeUsdCents,
      language: data.language,
      buyer_email: data.buyerEmail,
      provider: data.provider,
      payment_method: 'card',
      currency: 'USD',
      status: 'pending_payment',
    })
    .select()
    .single()

  if (error) dbError(`DB error: ${error.message}`)
  return row as Purchase
}

/** Attach the provider's checkout/payment id after the checkout session is created. */
export async function setPurchaseProviderPaymentId(id: string, providerPaymentId: string): Promise<void> {
  const { error } = await supabase
    .from('purchases')
    .update({ provider_payment_id: providerPaymentId })
    .eq('id', id)

  if (error) dbError(`DB error: ${error.message}`)
}

/** Record a refund's state (webhook or auto-refund on reject/fail). */
export async function updatePurchaseRefund(
  id: string,
  refundStatus: RefundStatus,
  refundId?: string
): Promise<void> {
  const payload: Record<string, unknown> = { refund_status: refundStatus }
  if (refundStatus === 'succeeded') payload.refunded_at = new Date().toISOString()
  if (refundId !== undefined) payload.refund_id = refundId

  const { error } = await supabase.from('purchases').update(payload).eq('id', id)
  if (error) dbError(`DB error: ${error.message}`)
}

/** Creator's withdrawable card-earnings balance (ledger sum, USD cents). */
export async function getCreatorFiatBalance(walletAddress: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_creator_fiat_balance', { p_wallet: walletAddress })
  if (error) dbError(`DB error: ${error.message}`)
  return typeof data === 'number' ? data : Number(data ?? 0)
}

/**
 * Reserve a payout atomically (request_payout SQL fn: balance check + request +
 * payout_debit under a row lock). Throws INSUFFICIENT_BALANCE (400) if underfunded.
 */
export async function requestPayout(params: {
  walletAddress: string
  amountUsdCents: number
  method: PayoutMethod
  destWallet: string | null
  bankDetails: BankDetails | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_payout', {
    p_wallet: params.walletAddress,
    p_amount_usd_cents: params.amountUsdCents,
    p_method: params.method,
    p_dest_wallet: params.destWallet,
    p_dest_bank_details: params.bankDetails,
  })

  if (error) {
    if (error.message?.includes('INSUFFICIENT_BALANCE')) {
      throw new VocliraError('Insufficient balance for this payout', 'INSUFFICIENT_BALANCE', 400)
    }
    dbError(`DB error: ${error.message}`)
  }
  return data as string
}

export async function listPayoutRequests(walletAddress: string): Promise<PayoutRequest[]> {
  const { data, error } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('creator_wallet', walletAddress)
    .order('requested_at', { ascending: false })
    .limit(50)

  if (error) dbError(`DB error: ${error.message}`)
  return (data as PayoutRequest[]) ?? []
}

export async function getCreatorStats(
  walletAddress: string
): Promise<{ totalEarned: number; totalMessages: number }> {
  const { data, error } = await supabase
    .from('creators')
    .select('total_earned, total_messages')
    .eq('wallet_address', walletAddress)
    .single()

  if (error) {
    if (error.code === 'PGRST116') throw new CreatorNotFoundError(walletAddress)
    dbError(`DB error: ${error.message}`)
  }

  const row = data as { total_earned: number; total_messages: number }
  return { totalEarned: row.total_earned, totalMessages: row.total_messages }
}

export async function updateCreatorFilters(
  walletAddress: string,
  filters: { blockAdult: boolean; blockProfanity: boolean; blockPolitical: boolean }
): Promise<void> {
  const { error } = await supabase
    .from('creators')
    .update({
      block_adult: filters.blockAdult,
      block_profanity: filters.blockProfanity,
      block_political: filters.blockPolitical,
    })
    .eq('wallet_address', walletAddress)

  if (error) throw new VocliraError('Failed to update filters', 'DB_ERROR', 500)
}

export async function deleteCreatorVoice(walletAddress: string): Promise<void> {
  const { error } = await supabase
    .from('creators')
    .update({ voice_id: '', is_active: false })
    .eq('wallet_address', walletAddress)

  if (error) throw new VocliraError('Failed to delete voice', 'DB_ERROR', 500)
}

const ANALYTICS_ROW_CAP = 5000

function toUtcDateString(iso: string): string {
  return iso.slice(0, 10)
}

function buildDateBuckets(days: AnalyticsRangeDays): string[] {
  const buckets: string[] = []
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000)
    buckets.push(d.toISOString().slice(0, 10))
  }
  return buckets
}

export async function getCreatorPurchasesWindow(
  walletAddress: string,
  days: AnalyticsRangeDays
): Promise<Purchase[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('creator_wallet', walletAddress)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(ANALYTICS_ROW_CAP)

  if (error) dbError(`DB error: ${error.message}`)

  return (data as Purchase[]) ?? []
}

export async function getCreatorAnalytics(
  walletAddress: string,
  days: AnalyticsRangeDays
): Promise<AnalyticsResponse> {
  const rows = await getCreatorPurchasesWindow(walletAddress, days)

  const buckets = buildDateBuckets(days)
  const tsMap = new Map<string, AnalyticsTimeseriesPoint>()
  for (const date of buckets) {
    tsMap.set(date, {
      date,
      gross_lamports: 0,
      net_lamports: 0,
      messages: 0,
      rejections: 0,
    })
  }

  let totalGross = 0
  let totalNet = 0
  let totalFee = 0
  let totalCompleted = 0
  let totalRejected = 0
  let totalRefunded = 0
  let totalPlays = 0
  // fanPurchaseCounts tracks how many completed purchases each buyer_wallet has
  const fanPurchaseCounts = new Map<string, number>()
  let priceSum = 0
  let priceCount = 0

  for (const row of rows) {
    const date = toUtcDateString(row.created_at)
    const bucket = tsMap.get(date)

    if (row.status === 'completed') {
      // Card rows have null lamports (their value lives in *_usd_cents; fiat analytics
      // is Faz 7A). Coalesce to keep the SOL rollups correct for crypto rows.
      const gross = row.amount_lamports ?? 0
      const fee = row.platform_fee_lamports ?? 0
      const net = gross - fee
      totalGross += gross
      totalNet += net
      totalFee += fee
      totalCompleted += 1
      totalPlays += row.play_count
      if (row.buyer_wallet) {
        fanPurchaseCounts.set(row.buyer_wallet, (fanPurchaseCounts.get(row.buyer_wallet) ?? 0) + 1)
      }
      priceSum += gross
      priceCount += 1
      if (bucket) {
        bucket.gross_lamports += gross
        bucket.net_lamports += net
        bucket.messages += 1
      }
    } else if (row.status === 'rejected') {
      totalRejected += 1
      if (bucket) bucket.rejections += 1
    } else if (row.status === 'refunded') {
      totalRefunded += 1
    }
  }

  const decided = totalCompleted + totalRejected
  const summary: AnalyticsSummary = {
    range_days: days,
    total_gross_lamports: totalGross,
    total_net_lamports: totalNet,
    total_platform_fee_lamports: totalFee,
    total_messages: totalCompleted,
    total_completed: totalCompleted,
    total_rejected: totalRejected,
    total_refunded: totalRefunded,
    total_plays: totalPlays,
    // unique_fans: buyers who sent at least 2 completed messages in this period
    unique_fans: Array.from(fanPurchaseCounts.values()).filter((n) => n >= 2).length,
    avg_price_lamports: priceCount > 0 ? Math.round(priceSum / priceCount) : 0,
    success_rate: decided > 0 ? totalCompleted / decided : 0,
  }

  const recent: RecentPurchaseRow[] = rows.slice(0, 100).map((row) => ({
    id: row.id,
    buyer_wallet: row.buyer_wallet ?? '',
    amount_lamports: row.amount_lamports ?? 0,
    platform_fee_lamports: row.platform_fee_lamports ?? 0,
    play_count: row.play_count,
    status: row.status,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    fan_text: row.fan_text,
    audio_url: row.audio_url,
  }))

  return {
    summary,
    timeseries: Array.from(tsMap.values()),
    recent,
  }
}

export async function incrementPlayCount(purchaseId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_play_count', { p_id: purchaseId })
  if (error) dbError(`DB error: ${error.message}`)
}

export async function getPurchaseById(purchaseId: string): Promise<Purchase | null> {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('id', purchaseId)
    .maybeSingle()

  if (error) {
    if (error.code === 'PGRST116') return null
    dbError(`DB error: ${error.message}`)
  }

  return (data as Purchase | null) ?? null
}

/** Marks a purchase's audio as taken down (after the R2 object + CDN cache are removed). */
export async function markPurchaseAudioTakenDown(purchaseId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('purchases')
    .update({
      audio_url: null,
      audio_deleted_at: new Date().toISOString(),
      takedown_reason: reason,
    })
    .eq('id', purchaseId)

  if (error) dbError(`DB error: ${error.message}`)
}
