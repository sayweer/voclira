CREATE TABLE IF NOT EXISTS creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  creator_name TEXT NOT NULL,
  -- voice_id is legacy (ElevenLabs); NOT NULL for backward compat, always '' for
  -- Chatterbox/Fal creators, who instead store a zero-shot reference at
  -- voice_profile_object_key.
  voice_id TEXT NOT NULL,
  price_lamports BIGINT NOT NULL,
  language TEXT DEFAULT 'en',
  is_active BOOLEAN DEFAULT true,
  block_adult BOOLEAN DEFAULT true,
  block_profanity BOOLEAN DEFAULT true,
  block_political BOOLEAN DEFAULT true,
  total_earned BIGINT DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  nft_mint TEXT,
  -- Chatterbox/Fal zero-shot voice reference (R2 private bucket key) + consent record.
  voice_profile_object_key TEXT,
  verification_audio_object_key TEXT,
  consent_at TIMESTAMPTZ,
  consent_ip TEXT,
  consent_text_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migrations for existing deployments (each column added independently, in order added).
ALTER TABLE creators ADD COLUMN IF NOT EXISTS nft_mint TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS voice_profile_object_key TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS verification_audio_object_key TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS consent_ip TEXT;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS consent_text_version TEXT;

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_wallet TEXT NOT NULL,
  creator_wallet TEXT NOT NULL,
  tx_signature TEXT UNIQUE NOT NULL,
  fan_text TEXT NOT NULL,
  audio_url TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','completed','failed','refunded','rejected')),
  amount_lamports BIGINT NOT NULL,
  platform_fee_lamports BIGINT NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  -- Generation provenance / failure diagnostics (voice/generate route).
  generation_engine TEXT,
  provider_request_id TEXT,
  provider_error_type TEXT,
  input_char_count INTEGER,
  error_message TEXT,
  generation_completed_at TIMESTAMPTZ,
  -- Takedown (see app/api/takedown).
  audio_deleted_at TIMESTAMPTZ,
  takedown_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migrations for existing deployments.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS generation_engine TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS provider_error_type TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS input_char_count INTEGER;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS generation_completed_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS audio_deleted_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS takedown_reason TEXT;

-- Widen the status CHECK to include 'failed' (generation failed after payment —
-- previously unrepresentable, leaving such rows stuck at 'pending' forever).
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('pending','completed','failed','refunded','rejected'));

CREATE INDEX IF NOT EXISTS idx_purchases_creator_wallet
  ON purchases(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_purchases_tx_signature
  ON purchases(tx_signature);
CREATE INDEX IF NOT EXISTS idx_purchases_creator_created
  ON purchases(creator_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_creator_status_created
  ON purchases(creator_wallet, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creators_wallet_address
  ON creators(wallet_address);

CREATE OR REPLACE FUNCTION increment_play_count(p_id UUID)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE purchases SET play_count = play_count + 1 WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION increment_creator_stats(p_wallet TEXT, p_net_lamports BIGINT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE creators
  SET
    total_earned   = total_earned   + p_net_lamports,
    total_messages = total_messages + 1
  WHERE wallet_address = p_wallet;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Faz 2 — Fiat / USD-primary migration (additive, idempotent).
-- Apply to Supabase BEFORE deploying the code that reads these columns.
-- Existing crypto rows keep working: payment_method defaults to 'crypto',
-- currency to 'SOL', and the lamports columns are untouched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Creators: USD-primary pricing + fiat earnings ────────
ALTER TABLE creators ADD COLUMN IF NOT EXISTS price_usd_cents INTEGER;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS total_earned_usd_cents BIGINT DEFAULT 0;
ALTER TABLE creators ALTER COLUMN price_lamports SET DEFAULT 0;
-- One-time backfill: derive USD price from the existing SOL price at a nominal
-- $150/SOL, clamped to the $1–$15 band. Only touches rows not yet backfilled.
UPDATE creators SET price_usd_cents =
  LEAST(1500, GREATEST(100, ROUND(price_lamports::numeric / 1e9 * 150 * 100)::integer))
  WHERE price_usd_cents IS NULL;

-- ── Purchases: payment-method-agnostic + USD + provider/refund tracking ──
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'crypto';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SOL';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS amount_usd_cents INTEGER;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS platform_fee_usd_cents INTEGER;
-- Transparent processing fee charged to the fan on card payments (fixed at draft
-- time; NULL on crypto rows).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS processing_fee_usd_cents INTEGER;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS provider_payment_intent_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS buyer_email TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refund_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Card purchases have no wallet/tx_signature/lamports — relax the NOT NULLs.
ALTER TABLE purchases ALTER COLUMN buyer_wallet DROP NOT NULL;
ALTER TABLE purchases ALTER COLUMN tx_signature DROP NOT NULL;
ALTER TABLE purchases ALTER COLUMN amount_lamports DROP NOT NULL;
ALTER TABLE purchases ALTER COLUMN platform_fee_lamports DROP NOT NULL;

-- tx_signature UNIQUE constraint → partial unique index (allows NULLs for card rows;
-- a duplicate non-null signature still raises 23505, so savePurchase idempotency holds).
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_tx_signature_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_tx_signature
  ON purchases(tx_signature) WHERE tx_signature IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_provider_payment
  ON purchases(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

-- Widen status + add payment_method / refund_status domains.
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_check
  CHECK (status IN ('pending_payment','paid','pending','completed','failed','refunded','rejected','expired'));
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_payment_method_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_payment_method_check
  CHECK (payment_method IN ('crypto','card'));
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_refund_status_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_refund_status_check
  CHECK (refund_status IN ('none','pending','succeeded','failed'));

-- ── Creator ledger + payout (fiat earnings accrue here; crypto is unaffected) ──
CREATE TABLE IF NOT EXISTS creator_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_wallet TEXT NOT NULL,
  purchase_id UUID REFERENCES purchases(id),
  payout_request_id UUID,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sale_credit','refund_debit','payout_debit','adjustment')),
  amount_usd_cents INTEGER NOT NULL,   -- signed: credit +, debit -
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_creator ON creator_ledger_entries(creator_wallet, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_purchase_credit
  ON creator_ledger_entries(purchase_id, entry_type) WHERE purchase_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_wallet TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('sol_transfer','bank_transfer')),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','processing','paid','failed','cancelled')),
  dest_wallet TEXT,
  dest_bank_details JSONB,
  sol_rate_usd NUMERIC,
  sol_amount_lamports BIGINT,
  payout_tx_signature TEXT,
  admin_note TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payout_creator ON payout_requests(creator_wallet, requested_at DESC);

CREATE OR REPLACE FUNCTION increment_creator_stats_fiat(p_wallet TEXT, p_net_usd_cents INTEGER)
RETURNS void LANGUAGE sql AS $$
  UPDATE creators SET total_earned_usd_cents = total_earned_usd_cents + p_net_usd_cents,
    total_messages = total_messages + 1 WHERE wallet_address = p_wallet;
$$;

CREATE OR REPLACE FUNCTION get_creator_fiat_balance(p_wallet TEXT)
RETURNS BIGINT LANGUAGE sql AS $$
  SELECT COALESCE(SUM(amount_usd_cents), 0) FROM creator_ledger_entries WHERE creator_wallet = p_wallet;
$$;

-- Atomic payout reservation: if the balance covers it, write request + payout_debit
-- together under a row lock so concurrent requests can't overdraw.
CREATE OR REPLACE FUNCTION request_payout(
  p_wallet TEXT, p_amount_usd_cents INTEGER, p_method TEXT,
  p_dest_wallet TEXT, p_dest_bank_details JSONB
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_balance BIGINT; v_id UUID;
BEGIN
  PERFORM 1 FROM creators WHERE wallet_address = p_wallet FOR UPDATE;  -- lock against concurrent requests
  SELECT COALESCE(SUM(amount_usd_cents),0) INTO v_balance
    FROM creator_ledger_entries WHERE creator_wallet = p_wallet;
  IF v_balance < p_amount_usd_cents THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  INSERT INTO payout_requests (creator_wallet, amount_usd_cents, method, dest_wallet, dest_bank_details)
    VALUES (p_wallet, p_amount_usd_cents, p_method, p_dest_wallet, p_dest_bank_details)
    RETURNING id INTO v_id;
  INSERT INTO creator_ledger_entries (creator_wallet, payout_request_id, entry_type, amount_usd_cents)
    VALUES (p_wallet, v_id, 'payout_debit', -p_amount_usd_cents);
  RETURN v_id;
END; $$;
