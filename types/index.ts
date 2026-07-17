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
  // Card purchases have no wallet / on-chain tx / lamports — these are null for them
  // (crypto rows always set them). Analytics/CSV consumers coalesce to 0/''.
  buyer_wallet: string | null
  creator_wallet: string
  tx_signature: string | null
  fan_text: string
  audio_url: string | null
  status: PurchaseStatus
  amount_lamports: number | null
  platform_fee_lamports: number | null
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

// ─── Creator ledger + payout (fiat earnings) ───────────

export type PayoutMethod = 'sol_transfer' | 'bank_transfer'

export type PayoutStatus =
  | 'requested'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'

export interface BankDetails {
  iban: string
  accountHolder: string
}

export interface PayoutRequest {
  id: string
  creator_wallet: string
  amount_usd_cents: number
  method: PayoutMethod
  status: PayoutStatus
  dest_wallet: string | null
  dest_bank_details: BankDetails | null
  sol_rate_usd: number | null
  sol_amount_lamports: number | null
  payout_tx_signature: string | null
  admin_note: string | null
  requested_at: string
  processed_at: string | null
}

export type LedgerEntryType = 'sale_credit' | 'refund_debit' | 'payout_debit' | 'adjustment'

export interface LedgerEntry {
  id: string
  creator_wallet: string
  purchase_id: string | null
  payout_request_id: string | null
  entry_type: LedgerEntryType
  amount_usd_cents: number
  created_at: string
}

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
  // Card (fiat) earnings for the period — net = gross − platform fee, in USD cents.
  total_gross_usd_cents: number
  total_net_usd_cents: number
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
  // Payment method + fiat amount so the UI can render card rows in USD.
  payment_method: PaymentMethod
  amount_usd_cents: number | null
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


