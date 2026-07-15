CREATE TABLE IF NOT EXISTS creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  creator_name TEXT NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migration for existing deployments: add the on-chain voice license mint address.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS nft_mint TEXT;

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
  created_at TIMESTAMPTZ DEFAULT now()
);

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
