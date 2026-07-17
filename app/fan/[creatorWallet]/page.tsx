'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '@/components/WalletButton'
import { Mic } from 'lucide-react'
import { useLanguage } from '@/components/LanguageProvider'
import LanguageToggle from '@/components/LanguageToggle'
import { BrandLogo } from '@/components/BrandLogo'
import { WavePath } from '@/components/ui/wave-path'
import { downloadAudio, audioSrcFromStored } from '@/lib/audio-download'
import { TEXT, PRICING, PRICING_USD, maxTextLengthFor, priceUnitsFor, platformFeeLamports } from '@/lib/limits'
import { sendPaymentTransaction } from '@/lib/solana-client'
import type { SupportedLanguage } from '@/types'

const CARD_ENABLED = process.env.NEXT_PUBLIC_CARD_PAYMENTS_ENABLED === 'true'
type ReturnStatus = 'verifying' | 'generating' | 'rejected' | 'expired' | 'cancelled' | 'timeout' | null

interface Creator {
  wallet_address: string
  creator_name: string
  price_usd_cents: number | null
  is_active: boolean
  language: string
}

const LANGUAGE_OPTIONS: Array<{ id: SupportedLanguage; emoji: string; label: string }> = [
  { id: 'tr', emoji: '🇹🇷', label: 'Türkçe' },
  { id: 'en', emoji: '🇬🇧', label: 'English' },
]

export default function FanPage() {
  const params = useParams()
  const creatorWallet = params.creatorWallet as string
  const { publicKey, sendTransaction, connected } = useWallet()
  const { t } = useLanguage()

  const [creator, setCreator] = useState<Creator | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  // Generation language: defaults to the creator's declared language, fan can override.
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('en')
  const languagePicked = useRef(false)
  const [isPaying, setIsPaying] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioDownloadUrl, setAudioDownloadUrl] = useState<string | null>(null)
  const [downloadHint, setDownloadHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txSignature, setTxSignature] = useState<string | null>(null)
  const [purchaseId, setPurchaseId] = useState<string | null>(null)
  const [platformWallet, setPlatformWallet] = useState<string | null>(null)
  // Cosmetic display rate for "≈ SOL"; the actual charge is the server-locked quote.
  const [solUsd, setSolUsd] = useState<number | null>(null)

  // Dual checkout: card is the default tab when enabled; crypto otherwise.
  const searchParams = useSearchParams()
  const returnPurchaseId = searchParams.get('purchaseId')
  const cancelledFlag = searchParams.get('cancelled')
  const isCardReturn = Boolean(returnPurchaseId) || cancelledFlag === '1'
  const [checkoutTab, setCheckoutTab] = useState<'card' | 'crypto'>(CARD_ENABLED ? 'card' : 'crypto')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [cardProcessing, setCardProcessing] = useState(false)
  const [returnStatus, setReturnStatus] = useState<ReturnStatus>(
    cancelledFlag === '1' ? 'cancelled' : returnPurchaseId ? 'verifying' : null
  )

  // Fetch creator on mount
  useEffect(() => {
    const fetchCreator = async () => {
      try {
        const res = await fetch(`/api/creator/${creatorWallet}?public=true`)
        if (res.ok) {
          const data = await res.json()
          setCreator(data)
          if (!languagePicked.current) setSelectedLanguage(data.language === 'tr' ? 'tr' : 'en')
        } else {
          setError(res.status === 404 ? t('fan.creatorNotFound') : t('fan.loadFailed'))
        }
      } catch {
        setError(t('fan.networkError'))
      } finally {
        setLoading(false)
      }
    }
    fetchCreator()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorWallet])

  // Fetch platform wallet on mount
  useEffect(() => {
    const fetchPlatformConfig = async () => {
      try {
        const res = await fetch('/api/platform-config')
        if (res.ok) {
          const data = await res.json()
          setPlatformWallet(data.platformWallet)
        }
      } catch {
        // Platform config fetch failure is non-blocking;
        // payment will fail gracefully if wallet is missing
      }
    }
    fetchPlatformConfig()
  }, [])

  // Cosmetic SOL/USD rate for the "≈ SOL" preview (payment uses the locked quote).
  useEffect(() => {
    fetch('/api/sol-price')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.usd === 'number') setSolUsd(data.usd)
      })
      .catch(() => {})
  }, [])

  // Card checkout return: poll the purchase (2s × up to 60s) and trigger generation
  // once it's paid. Shows verifying → generating → audio player (or rejected/expired).
  useEffect(() => {
    if (cancelledFlag === '1') return
    if (!returnPurchaseId) return
    let stopped = false
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const showAudio = (url: string) => {
      setAudioUrl(audioSrcFromStored(url))
      setAudioDownloadUrl(url)
      setPurchaseId(returnPurchaseId)
      setReturnStatus(null)
    }
    const run = async () => {
      for (let i = 0; i < 30 && !stopped; i++) {
        try {
          const res = await fetch(`/api/purchase/${returnPurchaseId}`, { cache: 'no-store' })
          if (res.ok) {
            const data = await res.json()
            if (data.status === 'completed' && data.audioUrl) {
              showAudio(data.audioUrl)
              return
            }
            if (data.status === 'rejected' || data.status === 'failed') {
              setReturnStatus('rejected')
              return
            }
            if (data.status === 'expired') {
              setReturnStatus('expired')
              return
            }
            if (data.status === 'paid') {
              setReturnStatus('generating')
              const gen = await fetch('/api/voice/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ purchaseId: returnPurchaseId }),
              })
              const genData = await gen.json()
              if (gen.ok && typeof genData.audioUrl === 'string') {
                showAudio(genData.audioUrl)
                return
              }
              if (gen.status === 422 || genData.refundNeeded) {
                setReturnStatus('rejected')
                return
              }
              // 409 IN_PROGRESS / transient → keep polling
            } else if (data.status === 'pending') {
              setReturnStatus('generating')
            }
            // pending_payment → keep verifying
          }
        } catch {
          /* keep polling */
        }
        if (!stopped) await sleep(2000)
      }
      if (!stopped) setReturnStatus((s) => (s === 'generating' ? s : 'timeout'))
    }
    run()
    return () => {
      stopped = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPurchaseId, cancelledFlag])

  // Language-dependent limits + USD-primary price display — single source: lib/limits.ts
  const maxLen = maxTextLengthFor(selectedLanguage)
  const overLimit = message.length > maxLen
  const tooShort = message.trim().length > 0 && message.trim().length < TEXT.MIN_LENGTH
  const charUnits = priceUnitsFor(message)
  const priceUsdCents = creator?.price_usd_cents ?? null
  const totalUsdCents = priceUsdCents != null ? charUnits * priceUsdCents : 0
  const priceUsdLabel = priceUsdCents != null ? (priceUsdCents / 100).toFixed(2) : '—'
  const totalUsdLabel = (totalUsdCents / 100).toFixed(2)
  const approxSol =
    solUsd && totalUsdCents > 0 ? (totalUsdCents / 100 / solUsd).toFixed(4) : null

  // Card total: message price + a flat, transparent processing fee.
  const processingFeeLabel = (PRICING_USD.CARD_PROCESSING_FEE_USD_CENTS / 100).toFixed(2)
  const cardTotalUsdCents = totalUsdCents + PRICING_USD.CARD_PROCESSING_FEE_USD_CENTS
  const cardTotalLabel = (cardTotalUsdCents / 100).toFixed(2)

  // Pay and generate — moderation runs BEFORE the wallet opens, so rejected
  // or over-limit text never costs the fan anything.
  const handlePayAndGenerate = async () => {
    if (!publicKey || !creator || !message.trim() || tooShort || overLimit) return
    if (!platformWallet) {
      setError(t('fan.configNotLoaded'))
      return
    }
    setIsPaying(true)
    setError(null)
    setAudioUrl(null)
    setAudioDownloadUrl(null)
    setDownloadHint(null)

    try {
      const buyerWallet = publicKey.toBase58()

      // 1) Pre-payment moderation — binds the approved text to the generate call.
      const modRes = await fetch('/api/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorWallet,
          buyerWallet,
          text: message,
          language: selectedLanguage,
        }),
      })
      const modData = await modRes.json()
      if (!modRes.ok) {
        setError(
          modData.code === 'UNSAFE_CONTENT'
            ? t('fan.contentRejected')
            : modData.error ?? t('fan.generationFailed')
        )
        return
      }
      const moderationSessionId =
        typeof modData.moderationSessionId === 'string' ? modData.moderationSessionId : null

      // USD-primary: the SOL amount is the quote locked server-side at moderation
      // time — the client never recomputes it from the (now derived) price.
      const quotedLamports =
        typeof modData.quote?.lamports === 'number' ? modData.quote.lamports : null
      if (quotedLamports === null || quotedLamports <= 0) {
        setError(t('fan.rateUnavailable'))
        return
      }

      // 2) On-chain payment — 90% creator, 10% platform fee. sendPaymentTransaction
      // attaches a priority fee + compute budget and confirms against blockhash
      // expiry (with one retry) so the tx survives mainnet congestion.
      const platformFee = platformFeeLamports(quotedLamports)
      const creatorAmount = quotedLamports - platformFee

      const signature = await sendPaymentTransaction({
        publicKey,
        sendTransaction,
        transfers: [
          { to: creatorWallet, lamports: creatorAmount },
          { to: platformWallet, lamports: platformFee },
        ],
      })
      setTxSignature(signature)

      // 3) Generate. If the one-time moderation session was already consumed
      // (e.g. an earlier attempt), retry once WITHOUT it — generate re-moderates anyway.
      const generateOnce = async (sessionId: string | null) => {
        const res = await fetch('/api/voice/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creatorWallet,
            fanText: message,
            txSignature: signature,
            buyerWallet,
            language: selectedLanguage,
            ...(sessionId ? { moderationSessionId: sessionId } : {}),
          }),
        })
        return { res, data: await res.json() }
      }

      let { res, data } = await generateOnce(moderationSessionId)
      if (res.status === 409 && data.code === 'MOD_SESSION_INVALID') {
        ;({ res, data } = await generateOnce(null))
      }

      if (!res.ok) {
        setError(
          data.refundNeeded
            ? t('fan.rejectedAfterPayment', { tx: `${signature.slice(0, 12)}…` })
            : data.error ?? t('fan.generationFailed')
        )
        return
      }

      const url = typeof data.audioUrl === 'string' ? data.audioUrl : null
      setAudioUrl(url ? audioSrcFromStored(url) : null)
      setAudioDownloadUrl(url)
      setPurchaseId(typeof data.purchaseId === 'string' ? data.purchaseId : null)
      setTxSignature(null)
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : t('fan.paymentFailed')
      setError(errMessage)
    } finally {
      setIsPaying(false)
    }
  }

  // Card checkout: moderation (card) → Stripe session → redirect. No wallet involved;
  // the fan returns to ?purchaseId and the polling effect finishes the flow.
  const handleCardCheckout = async () => {
    if (!creator || !message.trim() || tooShort || overLimit) return
    setCardProcessing(true)
    setError(null)
    try {
      const modRes = await fetch('/api/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorWallet,
          text: message,
          language: selectedLanguage,
          paymentMethod: 'card',
        }),
      })
      const modData = await modRes.json()
      if (!modRes.ok) {
        setError(
          modData.code === 'UNSAFE_CONTENT' ? t('fan.contentRejected') : modData.error ?? t('fan.generationFailed')
        )
        return
      }

      const coRes = await fetch('/api/checkout/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorWallet,
          text: message,
          language: selectedLanguage,
          moderationSessionId: modData.moderationSessionId,
          ...(buyerEmail.trim() ? { buyerEmail: buyerEmail.trim() } : {}),
        }),
      })
      const coData = await coRes.json()
      if (coRes.ok && typeof coData.url === 'string') {
        window.location.href = coData.url
        return
      }
      setError(coData.error ?? t('fan.generationFailed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fan.paymentFailed'))
    } finally {
      setCardProcessing(false)
    }
  }

  const handleDownload = async () => {
    if (!audioDownloadUrl) return
    setDownloadHint(null)
    const result = await downloadAudio({
      url: audioDownloadUrl,
      filename: 'voice-message',
    })
    if (result === 'opened-new-tab') {
      setDownloadHint(t('download.openedNewTabHint'))
    } else if (result === 'failed') {
      setDownloadHint(t('download.failedHint'))
    }
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="app-container voclira-landing min-h-screen w-full bg-voclira-cream text-voclira-burgundy">
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 border-b-2 border-voclira-burgundy/40">
        <BrandLogo variant="light" href="/" />
        <LanguageToggle className="!bg-voclira-paper !text-voclira-burgundy !border-voclira-burgundy/20 !shadow-none hover:!bg-voclira-paper/80" />
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-col items-center justify-center px-4 py-16 min-h-[calc(100vh-80px)]">
        <div className="w-full max-w-lg">

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-24">
              <div
                className="w-8 h-8 rounded-full border-2 border-voclira-burgundy border-t-transparent animate-spin"
              />
              <p className="text-voclira-burgundy/60 text-sm">{t('fan.loadingCreator')}</p>
            </div>
          )}

          {/* Creator not found or inactive */}
          {!loading && (!creator || !creator.is_active) && (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <div className="text-5xl">🔍</div>
              <h2 className="font-display text-xl font-semibold text-voclira-burgundy">
                {creator && !creator.is_active ? t('fan.creatorUnavailable') : t('fan.creatorNotFound')}
              </h2>
              <p className="text-voclira-burgundy/60 text-sm text-center">
                {creator && !creator.is_active
                  ? t('fan.creatorUnavailableDesc')
                  : t('fan.creatorNotFoundDesc')}
              </p>
            </div>
          )}

          {/* Creator card */}
          {!loading && creator && creator.is_active && (
            <div className="flex flex-col gap-6">

              {/* Creator identity card */}
              <div className="relative overflow-hidden rounded-2xl border-2 border-voclira-burgundy/25 bg-voclira-paper shadow-[0_8px_30px_rgba(123,37,37,0.12)] p-6 flex flex-col gap-3">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 bg-voclira-burgundy/10 border-2 border-voclira-burgundy/25">
                    <Mic className="w-6 h-6 text-voclira-terracotta" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="font-display text-xs text-voclira-burgundy/60 uppercase tracking-[0.25em] font-medium">
                      {t('fan.sendVoiceTo')}
                    </p>
                    <h1 className="font-display text-2xl font-bold tracking-tight text-voclira-burgundy">
                      {creator.creator_name ?? creatorWallet.slice(0, 8)}
                    </h1>
                  </div>
                </div>

                {/* Price pill */}
                <div className="inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-medium bg-voclira-olive/15 border border-voclira-olive/40 text-voclira-olive">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-voclira-olive animate-pulse"
                  />
                  {t('fan.pricePer150Chars', { price: priceUsdLabel, unitChars: PRICING.UNIT_CHARS })}
                </div>
              </div>

              {/* Card checkout result — status banner until the audio player appears */}
              {isCardReturn && !audioUrl && (
                <div className="rounded-2xl border-2 border-voclira-burgundy/25 bg-voclira-paper p-8 flex flex-col items-center gap-4 text-center">
                  {(returnStatus === 'verifying' || returnStatus === 'generating') && (
                    <div className="w-8 h-8 rounded-full border-2 border-voclira-burgundy border-t-transparent animate-spin" />
                  )}
                  <p className="text-sm text-voclira-burgundy">
                    {returnStatus === 'verifying' && t('fan.verifyingPayment')}
                    {returnStatus === 'generating' && t('fan.generatingVoice')}
                    {returnStatus === 'rejected' && t('fan.rejectedRefunded')}
                    {returnStatus === 'expired' && t('fan.paymentExpired')}
                    {returnStatus === 'cancelled' && t('fan.checkoutCancelled')}
                    {returnStatus === 'timeout' && t('fan.pollingTimeout')}
                  </p>
                  {(returnStatus === 'timeout' || returnStatus === 'cancelled') && returnPurchaseId && (
                    <a
                      href={`/play/${returnPurchaseId}`}
                      className="text-xs font-semibold text-voclira-terracotta underline"
                    >
                      {t('fan.openStatusLink')}
                    </a>
                  )}
                  {error && <p className="text-xs text-red-600">{error}</p>}
                </div>
              )}

              {/* Composer — hidden while a card-checkout result is showing */}
              {!isCardReturn && (
              <div className="flex flex-col gap-4">

                {/* Textarea */}
                <div className="rounded-2xl border border-voclira-burgundy/20 bg-voclira-paper p-1 flex flex-col gap-0 transition-colors focus-within:border-voclira-burgundy/40">
                  <textarea
                    id="fan-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={maxLen}
                    disabled={isPaying}
                    placeholder={t('fan.typeMessagePlaceholder')}
                    rows={4}
                    className="w-full resize-none rounded-xl px-4 pt-4 pb-2 text-sm text-voclira-night placeholder:text-voclira-burgundy/40 bg-transparent outline-none focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex justify-end px-4 pb-3">
                    <span
                      className={`text-xs ${overLimit || maxLen - message.length <= 30 ? 'text-red-600' : 'text-voclira-burgundy/50'}`}
                    >
                      {message.length}/{maxLen}
                    </span>
                  </div>
                </div>

                {/* Length validation hints — mirror the server rules so nothing fails after payment */}
                {(overLimit || tooShort) && (
                  <p className="text-xs text-red-600 -mt-2 px-1">
                    {overLimit
                      ? t('fan.overLimit', { max: maxLen })
                      : t('fan.tooShort', { min: TEXT.MIN_LENGTH })}
                  </p>
                )}

                {/* Generation language selector — defaults to the creator's language */}
                <div className="flex flex-col gap-2">
                  <label className="font-display text-xs font-medium text-voclira-burgundy/60 uppercase tracking-[0.25em]">
                    {t('fan.languageLabel')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGE_OPTIONS.map((opt) => {
                      const active = selectedLanguage === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={isPaying}
                          onClick={() => {
                            languagePicked.current = true
                            setSelectedLanguage(opt.id)
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                            active
                              ? 'bg-voclira-olive border-voclira-olive text-voclira-cream shadow-[0_2px_12px_rgba(96,116,86,0.35)]'
                              : 'bg-voclira-paper border-voclira-burgundy/20 text-voclira-burgundy/70 hover:border-voclira-burgundy/40'
                          }`}
                        >
                          <span className="mr-1">{opt.emoji}</span>
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <WavePath className="my-3 text-voclira-burgundy/40" />

                {/* Checkout tabs — only when card payments are enabled */}
                {CARD_ENABLED && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCheckoutTab('card')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-all ${
                        checkoutTab === 'card'
                          ? 'border-voclira-burgundy bg-voclira-burgundy text-voclira-cream'
                          : 'border-voclira-burgundy/20 bg-voclira-paper text-voclira-burgundy/70 hover:border-voclira-burgundy/40'
                      }`}
                    >
                      💳 {t('fan.payWithCard')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutTab('crypto')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-all ${
                        checkoutTab === 'crypto'
                          ? 'border-voclira-burgundy bg-voclira-burgundy text-voclira-cream'
                          : 'border-voclira-burgundy/20 bg-voclira-paper text-voclira-burgundy/70 hover:border-voclira-burgundy/40'
                      }`}
                    >
                      ◎ {t('fan.payWithSol')}
                    </button>
                  </div>
                )}

                {checkoutTab === 'card' ? (
                  <div className="flex flex-col gap-3">
                    {/* Optional receipt / recovery email */}
                    <div className="flex flex-col gap-1">
                      <label className="font-display text-xs font-medium text-voclira-burgundy/60 uppercase tracking-[0.25em]">
                        {t('fan.emailOptionalLabel')}
                      </label>
                      <input
                        type="email"
                        value={buyerEmail}
                        onChange={(e) => setBuyerEmail(e.target.value)}
                        placeholder={t('fan.emailHint')}
                        disabled={cardProcessing}
                        className="w-full rounded-xl border border-voclira-burgundy/20 bg-voclira-paper px-4 py-2.5 text-sm text-voclira-night placeholder:text-voclira-burgundy/40 outline-none focus:border-voclira-burgundy/40 disabled:opacity-60"
                      />
                    </div>

                    {/* Transparent total: message price + flat processing fee */}
                    <div className="rounded-xl border border-voclira-terracotta/40 bg-voclira-terracotta/10 px-4 py-3 text-sm text-voclira-burgundy/80">
                      {charUnits > 0
                        ? t('fan.processingFeeLine', { msg: totalUsdLabel, fee: processingFeeLabel, total: cardTotalLabel })
                        : t('fan.priceLabel', { price: priceUsdLabel, unitChars: PRICING.UNIT_CHARS })}
                    </div>

                    <motion.button
                      type="button"
                      onClick={handleCardCheckout}
                      disabled={!message.trim() || tooShort || overLimit || cardProcessing}
                      whileTap={{ scale: 0.98 }}
                      className="w-full rounded-xl py-3.5 px-6 font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 bg-voclira-burgundy text-voclira-cream shadow-[0_4px_20px_rgba(123,37,37,0.35)] hover:bg-voclira-burgundy/90 disabled:bg-voclira-burgundy/30 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                      {cardProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-voclira-cream/40 border-t-voclira-cream rounded-full animate-spin" />
                          {t('fan.processingPayment')}
                        </>
                      ) : (
                        t('fan.cardPayButton', { total: cardTotalLabel })
                      )}
                    </motion.button>

                    {error && (
                      <div className="rounded-xl px-4 py-3 text-sm flex items-start gap-2 bg-red-600/10 border border-red-600/30 text-red-700">
                        <span className="mt-0.5 flex-shrink-0">⚠️</span>
                        <span>{error}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                {/* Wallet prompt — shown when not connected */}
                {!connected && (
                  <div className="rounded-2xl border-2 border-voclira-burgundy/25 bg-voclira-paper p-8 flex flex-col items-center gap-5 text-center">
                    <div className="text-4xl">👛</div>
                    <div className="flex flex-col gap-1">
                      <p className="font-semibold text-voclira-burgundy">{t('fan.connectWalletPrompt')}</p>
                      <p className="text-xs text-voclira-burgundy/60">
                        {t('fan.receiveAiVoiceClip')}
                      </p>
                    </div>
                    <div className="voclira-ring">
                      <WalletButton />
                    </div>
                  </div>
                )}

                {/* Pay flow — only when wallet connected */}
                {connected && (
                  <>

                  {/* Price preview */}
                  <div className="rounded-xl border border-voclira-terracotta/40 bg-voclira-terracotta/10 px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-voclira-burgundy/60">
                        {charUnits > 0
                          ? t('fan.priceUnitLabel', { units: charUnits, price: priceUsdLabel })
                          : t('fan.priceLabel', { price: priceUsdLabel, unitChars: PRICING.UNIT_CHARS })}
                      </span>
                    </div>
                    <div className="font-display font-bold text-base text-voclira-terracotta text-right">
                      {charUnits > 0 ? (
                        <>
                          <div>= ${totalUsdLabel}</div>
                          {approxSol && (
                            <div className="text-xs font-normal text-voclira-burgundy/50">
                              {t('fan.approxSol', { sol: approxSol })}
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>

                  {/* Pay button */}
                  <motion.button
                    id="pay-and-generate-btn"
                    onClick={handlePayAndGenerate}
                    disabled={!message.trim() || tooShort || overLimit || isPaying}
                    whileTap={{ scale: 0.98 }}
                    className="w-full rounded-xl py-3.5 px-6 font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 bg-voclira-burgundy text-voclira-cream shadow-[0_4px_20px_rgba(123,37,37,0.35)] hover:bg-voclira-burgundy/90 disabled:bg-voclira-burgundy/30 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    {isPaying ? (
                      <>
                        <div className="w-4 h-4 border-2 border-voclira-cream/40 border-t-voclira-cream rounded-full animate-spin" />
                        {t('fan.processingPayment')}
                      </>
                    ) : (
                      <>
                        {t('fan.payAndGenerate', { price: totalUsdLabel })}
                      </>
                    )}
                  </motion.button>

                  {/* Error */}
                  {error && (
                    <div className="rounded-xl px-4 py-3 text-sm flex items-start gap-2 bg-red-600/10 border border-red-600/30 text-red-700">
                      <span className="mt-0.5 flex-shrink-0">⚠️</span>
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Transaction confirmation */}
                  {txSignature && !audioUrl && isPaying && (
                    <p className="text-xs text-voclira-burgundy/60 text-center">
                      {t('fan.txConfirmed')}
                    </p>
                  )}

                  </>
                )}
                  </>
                )}
              </div>
              )}

              {/* Audio player — shared across the card + crypto flows */}
              {audioUrl && (
                <motion.div
                  className="rounded-2xl border-2 border-voclira-burgundy/25 bg-voclira-paper shadow-[0_8px_30px_rgba(123,37,37,0.12)] p-5 flex flex-col gap-3"
                  initial={{ opacity: 0, scale: 0.95, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🎉</span>
                    <p className="font-semibold text-voclira-burgundy text-sm">
                      {t('fan.voiceReady')}
                    </p>
                  </div>
                  <p className="text-[10px] uppercase tracking-wider text-voclira-burgundy/50">
                    {t('fan.aiGenerated')}
                  </p>
                  <audio
                    controls
                    playsInline
                    src={audioUrl}
                    className="w-full mt-1 accent-voclira-terracotta"
                    onPlay={() => {
                      if (!purchaseId) return
                      fetch(`/api/voice/play/${purchaseId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(publicKey ? { buyerWallet: publicKey.toBase58() } : {}),
                      }).catch(() => {
                        /* play tracking is best-effort */
                      })
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!audioDownloadUrl}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 bg-voclira-terracotta/15 border border-voclira-terracotta/40 text-voclira-burgundy hover:bg-voclira-terracotta/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('fan.downloadAudio')}
                  </button>
                  {downloadHint && (
                    <p className="text-xs text-voclira-burgundy/60 mt-1 leading-snug">
                      {downloadHint}
                    </p>
                  )}
                </motion.div>
              )}

            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-voclira-burgundy/50">
          {t('fan.protectedSafety')}
        </p>
      </footer>
    </div>
    </MotionConfig>
  )
}
