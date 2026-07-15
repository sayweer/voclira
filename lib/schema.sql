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
