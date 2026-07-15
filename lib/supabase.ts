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
  priceInLamports: number
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
    price_lamports: data.priceInLamports,
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

export async function updateCreatorPrice(walletAddress: string, priceInLamports: number): Promise<void> {
  const { error } = await supabase
    .from('creators')
    .update({ price_lamports: priceInLamports })
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
}): Promise<Purchase> {
  // Insert; if the tx_signature already exists (unique constraint, Postgres 23505),
  // fetch and return the existing row instead. This makes the operation idempotent
  // and prevents the TOCTOU race where two concurrent requests both pass the
  // `getPurchaseByTxSignature → null` check and try to insert.
  const { data: row, error } = await supabase
    .from('purchases')
    .insert({
      buyer_wallet: data.buyerWallet,
      creator_wallet: data.creatorWallet,
      tx_signature: data.txSignature,
      fan_text: data.fanText,
      amount_lamports: data.amountLamports,
      platform_fee_lamports: data.platformFeeLamports,
      status: 'pending',
    })
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

export async function updatePurchaseStatus(
  txSignature: string,
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
    .eq('tx_signature', txSignature)

  if (updateError) dbError(`DB error: ${updateError.message}`)

  if (status === 'completed') {
    const { data: purchase, error: fetchError } = await supabase
      .from('purchases')
      .select('creator_wallet, amount_lamports, platform_fee_lamports')
      .eq('tx_signature', txSignature)
      .single()

    if (fetchError) dbError(`DB error: ${fetchError.message}`)

    const p = purchase as {
      creator_wallet: string
      amount_lamports: number
      platform_fee_lamports: number
    }

    const netLamports = p.amount_lamports - p.platform_fee_lamports

    // Atomic increment via RPC — avoids race condition from read-modify-write
    const { error: incError } = await supabase.rpc('increment_creator_stats', {
      p_wallet: p.creator_wallet,
      p_net_lamports: netLamports,
    })

    if (incError) dbError(`DB error: ${incError.message}`)
  }
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
      const net = row.amount_lamports - row.platform_fee_lamports
      totalGross += row.amount_lamports
      totalNet += net
      totalFee += row.platform_fee_lamports
      totalCompleted += 1
      totalPlays += row.play_count
      fanPurchaseCounts.set(row.buyer_wallet, (fanPurchaseCounts.get(row.buyer_wallet) ?? 0) + 1)
      priceSum += row.amount_lamports
      priceCount += 1
      if (bucket) {
        bucket.gross_lamports += row.amount_lamports
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
    buyer_wallet: row.buyer_wallet,
    amount_lamports: row.amount_lamports,
    platform_fee_lamports: row.platform_fee_lamports,
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
