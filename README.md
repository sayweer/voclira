<p align="center">
  <img src="docs/banner.png" alt="Voclira" width="100%" />
</p>

<h3 align="center">License your voice. Earn while you sleep.</h3>

<p align="center">
  Built on <b>Solana</b> · Powered by <b>Fal.ai Chatterbox</b> (open-source TTS) · Protected by <b>Llama 3.1</b> (Groq)
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white" alt="Next.js 14" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Solana-devnet-14F195?logo=solana&logoColor=black" alt="Solana" />
  <img src="https://img.shields.io/badge/Payments-SOL_%2B_Card-635BFF?logo=stripe&logoColor=white" alt="SOL + Card payments" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/license-all_rights_reserved-red" alt="License" />
</p>

---

## Overview

**Voclira** is a Web3 voice licensing platform. Creators record a short voice reference once, set a price in **US dollars**, and earn every time a fan requests a personalized AI-generated voice message through their dedicated Fan Page. Fans pay with **SOL** or, where enabled, a **credit/debit card** — the same message, two checkout rails. A selectable bilingual interface (English & Turkish) sits on top, and every request passes through an AI moderation firewall before any audio is generated.

The voice clone is **zero-shot** — there is no training step or waiting period. A creator records ~15 seconds, and their voice is ready to license instantly.

Pricing is **USD-primary**: the creator sets a dollar price ($1–$15), and a crypto fan's wallet is quoted the exact SOL equivalent at checkout time from a live SOL/USD rate. Card checkout is fully implemented and ships behind a feature flag (`NEXT_PUBLIC_CARD_PAYMENTS_ENABLED`), so the platform can run crypto-only until a card processor is live.

---

## How It Works

### 🎙 Creator Flow

1. **Record** (or upload) an 8–25s voice reference + a spoken consent statement — zero-shot cloning, no training wait
2. **Set** a price in USD ($1–$15) and your brand-safety filters
3. **Share** your dedicated Fan Page link anywhere

<p align="center">
  <img src="docs/screenshot-onboarding.png" alt="Creating a voice identity by reading a short script aloud" width="340" />
</p>

### 💬 Fan Flow

1. Open the creator's **Fan Page** link
2. Type a message → choose a checkout rail:
   - **SOL** — approve the wallet-quoted SOL amount via a connected Phantom/Solflare wallet (90% creator / 10% platform, paid on-chain directly)
   - **Card** — pay the message price + a fixed processing fee via Stripe Checkout (feature-flagged)
3. The text is screened by the **AI moderation firewall** *before* the wallet ever opens (&lt;800ms)
4. **Fal.ai Chatterbox** generates audio in the creator's voice (zero-shot, no training step)
5. The fan plays and downloads the generated clip

### 💸 Payments & Payouts

- **Crypto sales** settle instantly on-chain: the fan's transaction pays the creator 90% and the platform 10% directly — the platform never takes custody.
- **Card sales** accrue to a per-creator **ledger** (USD cents). Creators request a payout once they clear the minimum ($10), choosing either an on-chain **SOL transfer** from the treasury or a **bank transfer** (IBAN). Payouts are settled by an operator-run script — no private keys ever touch the server.

### 📊 Creator Dashboard & Analytics

Creators track earnings, play counts, success rate, and net earnings over time across both payment rails — with CSV export.

<p align="center">
  <img src="docs/screenshot-dashboard.png" alt="Creator analytics dashboard showing earnings and activity over time" width="100%" />
</p>

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Dashboard, Fan/Play views & API routes |
| Blockchain | Solana Devnet | Wallet connections, on-chain SOL payments |
| Card Payments | Stripe Checkout | Fiat rail (feature-flagged) + refunds & webhooks |
| Voice AI | Fal.ai (Chatterbox, open-source) | Zero-shot voice cloning & text-to-speech |
| Storage | Cloudflare R2 | Reference audio (private) & generated audio (public CDN) |
| Moderation | Llama 3.1 8B (Groq) | Brand-safety AI firewall |
| Database | Supabase (Postgres) | Creator profiles, purchases, ledger & payouts |
| Rate Limiting | Upstash Redis | Persistent rate limiting + one-time sessions + SOL/USD rate cache |
| Styling | Tailwind CSS | Modern glassmorphism UI |

---

## Architecture

```
[Creator]
    ↓ records voice reference + spoken consent, sets a USD price
[R2 private bucket] → voice_profile_object_key stored in Supabase
    ↓
[Fan Page link] → shared on social media

[Fan visits Fan Page]
    ↓ types message
[Llama 3.1 Moderation]  ← runs BEFORE payment; wallet never opens for unsafe/over-length text
    ├── UNSAFE → rejected, no payment prompt
    └── SAFE → moderationSession locks the approved text + a SOL quote, then:
                    │
          ┌─────────┴─────────┐
    [SOL checkout]        [Card checkout]  (feature-flagged)
    wallet pays quoted     Stripe Checkout: price + fixed fee
    SOL: 90% creator /     → webhook marks purchase 'paid'
    10% platform           → ledger credits the creator (USD)
          └─────────┬─────────┘
                    ↓ client triggers generation
        [Fal.ai Chatterbox TTS]  (zero-shot, signed reference URL, re-moderated)
                    ↓
        Audio copied from Fal's ephemeral URL into the R2 public bucket
                    ↓
        Fan plays & downloads audio on the play screen
```

---

## Bilingual Support (TR / EN)

Voclira ships with full bilingual capabilities. Users can switch between English and Turkish on the fly:

- Preference persisted locally via `localStorage` under `voclira_lang`
- Responsive floating glassmorphism `<LanguageToggle />` button
- Comprehensive UI localization across landing, onboarding, analytics charts, settings, dashboard, and playback pages

---

## Getting Started

### Prerequisites

- Node.js 18+
- Solana CLI + Phantom wallet (devnet)
- Fal.ai account & API key (+ account credit for generation)
- Cloudflare R2 — two buckets (public + private) and an API token
- Groq account & API key
- Supabase project
- Upstash Redis database (rate limiting + one-time upload/moderation sessions)

### Installation

```bash
git clone https://github.com/sayweer/voclira
cd voclira
npm install
cp .env.local.example .env.local   # then fill in your keys
npm run dev
```

### Environment Variables

Configure your `.env.local` (see [`.env.local.example`](.env.local.example)):

| Variable | Description | Where to get |
|---|---|---|
| `GROQ_API_KEY` | Groq API key | console.groq.com |
| `FAL_KEY` | Fal.ai API key | fal.ai/dashboard |
| `FAL_CHATTERBOX_TURBO_MODEL` | Fal model id used for EN generation | fal.ai/models (chatterbox/text-to-speech/turbo) |
| `FAL_CHATTERBOX_MULTILINGUAL_MODEL` | Fal model id used for TR generation | fal.ai/models (chatterbox/text-to-speech/multilingual) |
| `R2_ACCOUNT_ID` | Cloudflare account id (builds `R2_ENDPOINT`) | Cloudflare dashboard |
| `R2_ENDPOINT` | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token | Cloudflare → R2 → Manage API tokens |
| `R2_PUBLIC_BUCKET` | Bucket for fan-generated audio (public) | Cloudflare dashboard |
| `R2_PRIVATE_BUCKET` | Bucket for reference + consent audio (private) | Cloudflare dashboard |
| `R2_PUBLIC_URL` | Public domain/CDN fronting `R2_PUBLIC_BUCKET` | Cloudflare dashboard |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` | Optional — CDN purge on takedown | Cloudflare dashboard |
| `SUPABASE_URL` | Supabase project URL | supabase.com dashboard |
| `SUPABASE_ANON_KEY` | Supabase anon key | supabase.com dashboard |
| `SOLANA_RPC_URL` | Solana RPC endpoint (server-side, **required** — no fallback) | devnet: api.devnet.solana.com · mainnet: dedicated RPC (Helius/Triton) |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana RPC endpoint (client-side; **required on mainnet-beta**) | devnet: api.devnet.solana.com · mainnet: dedicated RPC |
| `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` or `mainnet-beta` | wallet adapter config |
| `PLATFORM_WALLET` | Platform fee wallet address | Phantom wallet |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | console.upstash.com |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | console.upstash.com |
| `NEXT_PUBLIC_CARD_PAYMENTS_ENABLED` | Card checkout feature flag — `true` to enable (off ⇒ crypto-only) | leave unset until card is live |
| `PAYMENT_PROVIDER` | Card provider adapter (`stripe`) | defaults to `stripe` |
| `STRIPE_SECRET_KEY` | Stripe secret key (card checkout + refunds) | dashboard.stripe.com |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Stripe dashboard → Webhooks |
| `NEXT_PUBLIC_APP_URL` | Public origin for Stripe success/cancel redirects | e.g. https://voclira.com |

> Card payments are behind `NEXT_PUBLIC_CARD_PAYMENTS_ENABLED`. All the code ships, but the
> flag stays off (crypto-only) until the Stripe account is live — no Stripe env is needed to run.

### Database Setup

Run the SQL script in [`lib/schema.sql`](lib/schema.sql) inside your Supabase SQL editor.

---

## API Reference

Routes marked **(auth)** require `x-wallet-signature` + `x-wallet-nonce` headers (see [Security](#security)) — the signature is never sent in the JSON body.

```
POST /api/upload-url
Body: { walletAddress, type: 'voice-profile' | 'verification-audio' }
Returns a one-time presigned R2 PUT URL + uploadSessionId.

POST /api/moderate
Body: { creatorWallet, buyerWallet, fanText }
Pre-payment moderation check; returns a moderationSessionId consumed by /api/voice/generate.

POST /api/creator/register
Body: { walletAddress, creatorName, priceInLamports, language, uploadSessionId, verificationUploadSessionId, consentTextVersion }
Consumes both one-time upload sessions (reference + consent audio already in R2) and creates the creator.

GET /api/creator/[walletAddress]
Returns creator info by wallet address.

PATCH /api/creator/update-price (auth)
Body: { walletAddress, priceInUsdCents }

PATCH /api/creator/update-voice (auth)
Body: { walletAddress, uploadSessionId, verificationUploadSessionId?, consentTextVersion? }
Replaces the creator's reference voice from freshly uploaded R2 sessions.

PATCH /api/creator/update-filters (auth)
Body: { walletAddress, blockAdult, blockProfanity, blockPolitical }

PATCH /api/creator/update-license (auth)
Body: { walletAddress, nftMint, txSignature }
Verifies the mint transaction on-chain before persisting nft_mint.

DELETE /api/creator/delete-voice (auth)
Body: { walletAddress }

GET /api/creator/analytics/[walletAddress]?range=7|30|90 (auth)
GET /api/creator/analytics/[walletAddress]/export (auth)

GET /api/creator/license-metadata/[walletAddress]
On-chain metadata JSON for the creator's Voice License NFT.

GET /api/sol-price
Live SOL/USD rate (Redis-cached → CoinGecko → Jupiter → last-good).

── Payments ──

POST /api/checkout/card
Body: { creatorWallet, text, moderationSessionId, buyerEmail, language? }
Creates a Stripe Checkout session (message price + fixed processing fee). 503 when the card flag is off.

POST /api/webhooks/payment
Stripe webhook (signature-verified, idempotent). Marks the purchase 'paid' and credits the creator ledger.

GET /api/purchase/[purchaseId]
Polls a card purchase's status (pending → paid → completed) for the fan page.

POST /api/payout/request (auth)
Body: { walletAddress, amountUsdCents, method: 'sol_transfer' | 'bank_transfer', destWallet? | bankDetails? }
Atomically reserves the payout against the creator's ledger balance (min $10).

GET /api/payout/list (auth)
Returns the creator's ledger balance + payout request history.

── Voice ──

POST /api/voice/generate
SOL:  { creatorWallet, fanText, txSignature, buyerWallet, language?, moderationSessionId? }
Card: { purchaseId }   ← for an already-'paid' card purchase
Verifies the SOL tx or the paid card purchase, re-moderates, generates via Fal.ai Chatterbox, uploads to R2.
Returns: { success, audioUrl, durationMs, purchaseId }

POST /api/voice/play/[purchaseId]
Increments play counts for the audio clip.

POST /api/takedown (auth — creator owner or platform admin)
Body: { purchaseId, reason }
Deletes the R2 object, purges the CDN cache, and marks the purchase taken down.
```

> Payouts are settled off the request queue by an operator-run script (`scripts/process-payout.ts`,
> standalone `tsx`). The treasury signing key lives only on the operator's machine — never on the server.

---

## Security

- **Wallet signature verification** — all authenticated routes verify `nacl` + `bs58` signatures
- **Replay protection** — single-use nonces in Upstash Redis (5-min TTL), atomically consumed
- **Persistent rate limiting** — Upstash Redis with in-memory fallback
- **Transaction validation** — verifies the buyer's balance decreased by at least the full transferred amount
- **Race-condition safety** — purchases are idempotent (Postgres `unique_violation` reconciliation)
- **Defense in depth** — voice is re-moderated at generation time even when a pre-payment session exists
- **Webhook integrity** — Stripe events are signature-verified and processed exactly once (Redis `NX` idempotency lock)
- **Atomic payouts** — payout reservation and the ledger debit happen in a single Postgres function; a creator can never overdraw their balance
- **No custody / no server keys** — SOL sales pay the creator directly on-chain; treasury payout signing happens only in an operator-run script, never on the server

---

## Known Limitations

- `delete-voice` clears the creator's DB row but does not yet delete the underlying R2 reference/consent audio objects.
- Audio storage is dual-format following the ElevenLabs → Fal.ai/R2 migration: legacy purchases store `audio_url` as raw base64, current ones as an R2 public URL. The frontend handles both transparently via `audioSrcFromStored()`.
- **Card checkout ships behind `NEXT_PUBLIC_CARD_PAYMENTS_ENABLED`.** The full Stripe rail (checkout, webhook, ledger, payout) is implemented, but the flag stays off — the platform runs crypto-only — until a card processor is live. No Stripe env is required to run.
- Payouts are settled by a manually run operator script; there is no automated payout scheduler yet.
- `refunded` is a manual-operations status: after an off-platform refund, an admin sets the row directly (there is no custody layer to auto-refund SOL from).

---

## ⚠️ Project Status

Voclira currently runs entirely on **Solana devnet** and will stay there for now — so the full roadmap (long-form narration, **audiobooks**, and other planned features) is **not yet available** in production.

Want to try it anyway? Head to **[voclira.xyz](https://voclira.xyz)**, create an account, and bring a voice to life for messages of **up to 300 characters**.

---

## License

© 2026 Voclira — all rights reserved. Published publicly for reference; see [LICENSE](LICENSE) for terms.

<p align="center">
  <br />
  <img src="docs/logo.png" alt="Voclira" width="72" />
</p>
