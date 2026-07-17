'use client';

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import Landing from '@/components/screens/Landing';
import Onboarding from '@/components/screens/Onboarding';
import Dashboard from '@/components/screens/Dashboard';
import SettingsModal from '@/components/SettingsModal';
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'
import { useLanguage } from '@/components/LanguageProvider'
import type { RegisterCreatorRequest } from '@/types'
import { uploadReferenceAudio } from '@/lib/upload-client'

export default function App() {
  const wallet = useWallet()
  const { publicKey, disconnect, connected, signMessage } = wallet
  const { t, language, setLanguage } = useLanguage()
  const walletAddress = publicKey?.toBase58() ?? ''
  const walletAddressStr = publicKey?.toBase58() ?? null

  const getSignature = useCallback(async (): Promise<{ signature: string; nonce: string }> => {
    if (!signMessage) throw new Error('Wallet does not support message signing')
    if (!walletAddressStr) throw new Error('No wallet connected')

    const nonceRes = await fetch('/api/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: walletAddressStr }),
    })
    if (!nonceRes.ok) throw new Error('Failed to obtain auth nonce')
    const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string }

    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = await signMessage(messageBytes)
    return { signature: bs58.encode(signatureBytes), nonce }
  }, [signMessage, walletAddressStr])

  const getAuthHeaders = useCallback(async (walletAddr: string, forceRefresh = false): Promise<Record<string, string>> => {
    if (!walletAddr) throw new Error('No wallet address provided')
    const tokenKey = `voclira_session_${walletAddr}`
    let token = forceRefresh ? null : sessionStorage.getItem(tokenKey)

    if (!token) {
      const { signature, nonce } = await getSignature()
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: walletAddr, signature, nonce }),
      })
      if (!loginRes.ok) {
        const body = await loginRes.json().catch(() => null)
        throw new Error(body?.error ?? 'Failed to log in via signature')
      }
      const data = await loginRes.json()
      token = data.token
      if (token) {
        sessionStorage.setItem(tokenKey, token)
      } else {
        throw new Error('No token returned from login')
      }
    }

    return {
      'Authorization': `Bearer ${token}`
    }
  }, [getSignature])

  const [appState, setAppState] = useState<'landing' | 'onboarding' | 'dashboard'>('landing');
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3>(1);
  const [consented, setConsented] = useState(false);
  const [consentBlob, setConsentBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  // USD-primary (Faz 3): price is USD cents, e.g. 300 = $3. Default $3.
  const [selectedPrice, setSelectedPrice] = useState(300);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isCheckingDB, setIsCheckingDB] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioMimeType, setAudioMimeType] = useState('audio/webm')
  const [creatorStats, setCreatorStats] = useState<{
    totalEarned: number
    totalMessages: number
    priceUsdCents: number
    hasVoice: boolean
    nftMint: string | null
  } | null>(null)
  const [mintingLicense, setMintingLicense] = useState(false)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [blockAdult, setBlockAdult] = useState(true)
  const [blockProfanity, setBlockProfanity] = useState(true)
  const [blockPolitical, setBlockPolitical] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  useEffect(() => {
    if (!connected || !walletAddressStr || appState !== 'landing') return

    let ignore = false

    const checkCreator = async () => {
      setIsCheckingDB(true)
      try {
        const res = await fetch(`/api/creator/${walletAddressStr}?public=true`, {
          cache: 'no-store',
        })
        if (ignore) return
        if (res.ok) {
          const creator = await res.json()
          if (ignore) return
          const ready = creator.is_active && creator.has_voice
          if (ready) {
            setAppState('dashboard')
            return
          }
          setAppState('onboarding')
          setOnboardingStep(1)
        } else {
          setAppState('onboarding')
          setOnboardingStep(1)
        }
      } catch {
        if (ignore) return
        setAppState('onboarding')
        setOnboardingStep(1)
      } finally {
        if (!ignore) setIsCheckingDB(false)
      }
    }

    checkCreator()
    return () => { ignore = true }
  }, [connected, walletAddressStr])

  useEffect(() => {
    if (appState !== 'dashboard' || !walletAddressStr) return

    let ignore = false

    const fetchStats = async (retry = true) => {
      setStatsLoading(true)
      try {
        const headers = await getAuthHeaders(walletAddressStr)
        const res = await fetch(`/api/creator/${walletAddressStr}`, {
          cache: 'no-store',
          headers,
        })
        if (ignore) return
        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddressStr}`)
          await fetchStats(false)
          return
        }
        if (res.ok) {
          const creator = await res.json()
          if (ignore) return
          setCreatorStats({
            totalEarned: creator.total_earned,
            totalMessages: creator.total_messages,
            priceUsdCents: creator.price_usd_cents ?? 300,
            // A creator is "ready" the moment a zero-shot reference exists —
            // the legacy ElevenLabs voice_id is meaningless for new profiles.
            hasVoice: Boolean(creator.voice_profile_object_key),
            nftMint: creator.nft_mint ?? null,
          })
          setBlockAdult(creator.block_adult ?? true)
          setBlockProfanity(creator.block_profanity ?? true)
          setBlockPolitical(creator.block_political ?? true)
          setSelectedPrice(creator.price_usd_cents ?? 300)

          if (
            creator.block_adult == null ||
            creator.block_profanity == null ||
            creator.block_political == null
          ) {
            console.warn('[fetchStats] creator row has null filter columns', {
              block_adult: creator.block_adult,
              block_profanity: creator.block_profanity,
              block_political: creator.block_political,
            })
          }
        }
      } catch (err) {
        console.error('[fetchStats] Failed to load creator data:', err)
      } finally {
        if (!ignore) setStatsLoading(false)
      }
    }

    fetchStats()
    return () => { ignore = true }
  }, [appState, walletAddressStr, getAuthHeaders])

  const handleDisconnectWallet = async () => {
    await disconnect()
    setAppState('landing')
    setOnboardingStep(1)
    setAudioReady(false)
    setRecordingSeconds(0)
    setIsRecording(false)
    setAudioBlob(null)
    setAudioMimeType('audio/webm')
    setRegisterError(null)
    setCreatorStats(null)
    setBlockAdult(true)
    setBlockProfanity(true)
    setBlockPolitical(true)
    setSelectedPrice(0.05)
    setConsented(false)
    setConsentBlob(null)
  }

  const handleFilterUpdate = async (
    key: 'blockAdult' | 'blockProfanity' | 'blockPolitical',
    value: boolean
  ) => {
    if (!walletAddress) return

    const previousValue =
      key === 'blockAdult' ? blockAdult
        : key === 'blockProfanity' ? blockProfanity
        : blockPolitical

    const newFilters = {
      blockAdult: key === 'blockAdult' ? value : blockAdult,
      blockProfanity: key === 'blockProfanity' ? value : blockProfanity,
      blockPolitical: key === 'blockPolitical' ? value : blockPolitical,
    }

    if (key === 'blockAdult') setBlockAdult(value)
    if (key === 'blockProfanity') setBlockProfanity(value)
    if (key === 'blockPolitical') setBlockPolitical(value)

    const rollback = () => {
      if (key === 'blockAdult') setBlockAdult(previousValue)
      if (key === 'blockProfanity') setBlockProfanity(previousValue)
      if (key === 'blockPolitical') setBlockPolitical(previousValue)
    }

    const performUpdate = async (retry = true) => {
      try {
        const headers = await getAuthHeaders(walletAddress)
        const res = await fetch('/api/creator/update-filters', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({ walletAddress, ...newFilters }),
        })
        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddress}`)
          await performUpdate(false)
          return
        }
        if (!res.ok) {
          rollback()
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null
          alert(errBody?.error ?? `Failed to update filter (HTTP ${res.status}).`)
        }
      } catch {
        rollback()
        alert('Network error while updating filter. Please try again.')
      }
    }
    performUpdate()
  }

  const handleDeleteVoice = async () => {
    if (!walletAddress) return
    const performDelete = async (retry = true) => {
      try {
        const headers = await getAuthHeaders(walletAddress)
        const res = await fetch('/api/creator/delete-voice', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({ walletAddress }),
        })
        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddress}`)
          await performDelete(false)
          return
        }
        if (!res.ok) {
          alert('Failed to delete voice. Please try again.')
          return
        }
        setCreatorStats(null)
        setAppState('onboarding')
        setOnboardingStep(1)
        setConsented(false)
        setConsentBlob(null)
        setAudioReady(false)
        setAudioBlob(null)
      } catch {
        alert('Network error. Please try again.')
      }
    }
    performDelete()
  }

  const handleStartRecording = () => {
    setIsRecording(true)
    setRecordingSeconds(0)
  }

  const handleAudioReady = (blob: Blob, mimeType: string) => {
    setAudioBlob(blob)
    setAudioMimeType(mimeType)
    setAudioReady(true)
    setIsRecording(false)
  }

  const handleDiscardRecording = () => {
    setAudioReady(false)
    setAudioBlob(null)
    setRecordingSeconds(0)
  }

  const handleConsentRecorded = (blob: Blob | null) => {
    setConsentBlob(blob)
  }

  const handleLaunch = async () => {
    if (!publicKey || !audioBlob || !consentBlob) {
      setRegisterError(
        !publicKey
          ? 'Wallet not connected'
          : !consentBlob
            ? 'Please record the consent sentence before continuing.'
            : 'No audio recording found. Please go back and record your voice.'
      )
      return
    }
    setIsRegistering(true)
    setRegisterError(null)

    try {
      const walletAddr = publicKey.toBase58()

      // Convert + upload both WAVs (reference voice + consent verification) to R2,
      // then register with the one-time upload sessions instead of base64 audio.
      const [uploadSessionId, verificationUploadSessionId] = await Promise.all([
        uploadReferenceAudio(audioBlob, walletAddr, 'voice-profile'),
        uploadReferenceAudio(consentBlob, walletAddr, 'verification-audio'),
      ])

      const body: RegisterCreatorRequest = {
        walletAddress: walletAddr,
        creatorName: walletAddr.slice(0, 8),
        priceInUsdCents: selectedPrice,
        language,
        uploadSessionId,
        verificationUploadSessionId,
        consentTextVersion: 'v1',
      }

      const res = await fetch('/api/creator/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409 && data.code === 'ALREADY_REGISTERED') {
          // Active creator re-recording: the upload sessions are still unconsumed,
          // so replace the voice profile via the authenticated update endpoint.
          const updateVoice = async (retry = true): Promise<Response> => {
            const headers = await getAuthHeaders(walletAddr)
            const r = await fetch('/api/creator/update-voice', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({
                walletAddress: walletAddr,
                uploadSessionId,
                verificationUploadSessionId,
                consentTextVersion: 'v1',
                language,
              }),
            })
            if (r.status === 401 && retry) {
              sessionStorage.removeItem(`voclira_session_${walletAddr}`)
              return updateVoice(false)
            }
            return r
          }

          const upRes = await updateVoice()
          if (!upRes.ok) {
            const upData = (await upRes.json().catch(() => null)) as { error?: string } | null
            setRegisterError(upData?.error ?? 'Voice update failed')
            return
          }
          setAppState('dashboard')
          return
        }
        setRegisterError(data.error ?? 'Registration failed')
        return
      }

      setAppState('dashboard')
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Network error. Please try again.')
    } finally {
      setIsRegistering(false)
    }
  }

  const handleActivateLicense = async () => {
    if (!publicKey) {
      setLicenseError(t('license.walletNotConnected'))
      return
    }
    const walletAddr = publicKey.toBase58()
    setMintingLicense(true)
    setLicenseError(null)

    try {
      // Lazy-load the heavy Metaplex bundle only when the creator mints.
      const { mintVoiceLicense } = await import('@/lib/voiceLicense')
      const { nftMint, txSignature } = await mintVoiceLicense(wallet, walletAddr)

      const recordMint = async (retry = true): Promise<void> => {
        const headers = await getAuthHeaders(walletAddr)
        const res = await fetch('/api/creator/update-license', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ walletAddress: walletAddr, nftMint, txSignature }),
        })
        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddr}`)
          return recordMint(false)
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Failed to record license (HTTP ${res.status})`)
        }
      }
      await recordMint()

      setCreatorStats(prev => (prev ? { ...prev, nftMint } : prev))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('license.activationFailed')
      console.warn('[handleActivateLicense]', msg)
      setLicenseError(msg)
    } finally {
      setMintingLicense(false)
    }
  }

  const handleCopyLink = () => {
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (isCheckingDB) {
    return (
      <div className="app-container min-h-screen w-full bg-background text-foreground flex flex-col items-center justify-center gap-3">
        <div className="text-lg font-semibold">{t('dashboard.checkingProfile')}</div>
        <div className="text-sm text-muted-foreground">{t('dashboard.connectingSolana')}</div>
      </div>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="app-container min-h-screen w-full bg-background text-foreground">
      <AnimatePresence mode="wait">
      <motion.div
        key={appState}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
      {appState === 'landing' && (
        <Landing />
      )}

      {appState === 'onboarding' && (
        <Onboarding
          step={onboardingStep}
          isRecording={isRecording}
          recordingSeconds={recordingSeconds}
          audioReady={audioReady}
          selectedPrice={selectedPrice}
          walletAddress={walletAddress}
          consented={consented}
          consentBlob={consentBlob}
          onConsentChange={setConsented}
          onConsentRecorded={handleConsentRecorded}
          onStartRecording={handleStartRecording}
          onNextStep={() => setOnboardingStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))}
          onBackStep={() => setOnboardingStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
          onSelectPrice={setSelectedPrice}
          onAudioReady={handleAudioReady}
          onLaunch={handleLaunch}
          isRegistering={isRegistering}
          registerError={registerError}
          selectedLanguage={language}
          onSelectLanguage={setLanguage}
          onDiscardRecording={handleDiscardRecording}
        />
      )}

      {appState === 'dashboard' && (
        <Dashboard
          walletAddress={walletAddress}
          creatorStats={creatorStats}
          priceLabel={`$${((creatorStats?.priceUsdCents ?? selectedPrice) / 100).toFixed(2)}`}
          copiedLink={copiedLink}
          onOpenSettings={() => setSettingsOpen(true)}
          onCopyLink={handleCopyLink}
          getAuthHeaders={getAuthHeaders}
        />
      )}
      </motion.div>
      </AnimatePresence>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        walletAddress={walletAddress}
        selectedPrice={selectedPrice}
        onDisconnect={handleDisconnectWallet}
        onRerecord={() => {
          setAppState('onboarding');
          setOnboardingStep(1);
          setAudioReady(false);
          setRecordingSeconds(0);
          setIsRecording(false);
          setAudioBlob(null);
          setAudioMimeType('audio/webm');
          setRegisterError(null);
          setCreatorStats(null);
          setConsented(false);
          setConsentBlob(null);
          setSettingsOpen(false);
        }}
        onPriceUpdate={(newPrice) => {
          setSelectedPrice(newPrice);
        }}
        onPriceUpdateSuccess={(newCents) => {
          setCreatorStats(prev => prev ? { ...prev, priceUsdCents: newCents } : null);
        }}
        blockAdult={blockAdult}
        blockProfanity={blockProfanity}
        blockPolitical={blockPolitical}
        onFilterUpdate={handleFilterUpdate}
        hasVoice={Boolean(creatorStats?.hasVoice)}
        onDeleteVoice={handleDeleteVoice}
        statsLoading={statsLoading}
        getAuthHeaders={getAuthHeaders}
        nftMint={creatorStats?.nftMint ?? null}
        onActivateLicense={handleActivateLicense}
        mintingLicense={mintingLicense}
        licenseError={licenseError}
      />
    </div>
    </MotionConfig>
  );
}
