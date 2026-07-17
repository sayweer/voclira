// ─── Database Models ───────────────────────────────────

// Languages a voice can be generated in — drives the TTS engine and the moderation
// length ceiling. tr → Chatterbox multilingual, en → Chatterbox turbo.
export type SupportedLanguage = 'tr' | 'en'

export interface Creator {
  id: string
  wallet_address: string
  creator_name: string
  voice_id: string
  price_lamports: number
  // USD-primary pricing (Faz 3). price_usd_cents is the canonical price going
  // forward; price_lamports is derived per-checkout from the live SOL rate.
  price_usd_cents: number | null
  is_active: boolean
  total_earned: number
  // Fiat earnings ledger balance mirror (card sales, Faz 5). Crypto stays in total_earned.
  total_earned_usd_cents: number
  total_messages: number
  created_at: string
  block_adult: boolean
  block_profanity: boolean
  block_political: boolean
  language: string
  nft_mint: string | null
  // Chatterbox/Fal migration: R2 private object key for the zero-shot reference WAV.
  voice_profile_object_key: string | null
  // Consent / rıza kaydı (KVKK/GDPR).
  consent_at: string | null
  consent_ip: string | null
  consent_text_version: string | null
  verification_audio_object_key: string | null
}

export type PaymentMethod = 'crypto' | 'card'

export type RefundStatus = 'none' | 'pending' | 'succeeded' | 'failed'

export interface Purchase {
  id: string
  // NOTE: buyer_wallet / tx_signature / amount_lamports / platform_fee_lamports are
  // DB-nullable after the Faz 2 migration (card rows have no wallet/tx). They stay
  // typed non-null here until Faz 4 introduces card drafts that actually set them
  // null — at which point the analytics/RecentPurchaseRow consumers are updated too.
  buyer_wallet: string
  creator_wallet: string
  tx_signature: string
  fan_text: string
  audio_url: string | null
  status: PurchaseStatus
  amount_lamports: number
  platform_fee_lamports: number
  play_count: number
  rejection_reason: string | null
  created_at: string
  // Chatterbox/Fal migration: generation tracking.
  generation_engine: string | null
  provider_request_id: string | null
  provider_error_type: string | null
  input_char_count: number | null
  error_message: string | null
  generation_completed_at: string | null
  audio_deleted_at: string | null
  takedown_reason: string | null
  // ── Faz 2: payment-method-agnostic + USD + provider/refund tracking ──
  payment_method: PaymentMethod
  currency: string
  amount_usd_cents: number | null
  platform_fee_usd_cents: number | null
  processing_fee_usd_cents: number | null
  provider: string | null
  provider_payment_id: string | null
  provider_payment_intent_id: string | null
  buyer_email: string | null
  language: string | null
  paid_at: string | null
  refund_status: RefundStatus
  refund_id: string | null
  refunded_at: string | null
}

export type PurchaseStatus =
  | 'pending_payment'
  | 'paid'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'rejected'
  | 'expired'

// ─── Analytics ─────────────────────────────────────────

export type AnalyticsRangeDays = 7 | 30 | 90

export interface AnalyticsTimeseriesPoint {
  date: string
  gross_lamports: number
  net_lamports: number
  messages: number
  rejections: number
}

export interface AnalyticsSummary {
  range_days: AnalyticsRangeDays
  total_gross_lamports: number
  total_net_lamports: number
  total_platform_fee_lamports: number
  total_messages: number
  total_completed: number
  total_rejected: number
  total_refunded: number
  total_plays: number
  unique_fans: number
  avg_price_lamports: number
  success_rate: number
}

export interface RecentPurchaseRow {
  id: string
  buyer_wallet: string
  amount_lamports: number
  platform_fee_lamports: number
  play_count: number
  status: PurchaseStatus
  rejection_reason: string | null
  created_at: string
  fan_text?: string
  audio_url?: string | null
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary
  timeseries: AnalyticsTimeseriesPoint[]
  recent: RecentPurchaseRow[]
}

// ─── Moderation ────────────────────────────────────────

export type ModerationCategory =
  | 'profanity'
  | 'sexual'
  | 'political'
  | 'violence'
  | 'spam'
  | 'fraud'

export interface ModerationResult {
  isSafe: boolean
  category?: ModerationCategory
  reason?: string
  processingMs: number
}

// ─── API Requests / Responses ──────────────────────────

export interface RegisterCreatorRequest {
  walletAddress: string
  creatorName: string
  priceInUsdCents: number
  language?: string
  // Chatterbox/Fal onboarding: reference + consent WAVs are uploaded to R2 first;
  // register consumes the one-time upload sessions instead of receiving base64 audio.
  uploadSessionId: string
  verificationUploadSessionId: string
  consentTextVersion: string
}

export interface RegisterCreatorResponse {
  success: boolean
  creatorId?: string
  error?: string
}

export interface GenerateVoiceRequest {
  creatorWallet: string
  fanText: string
  txSignature: string
  buyerWallet: string
  language?: SupportedLanguage
}


