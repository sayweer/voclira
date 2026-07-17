'use client';

import { useRef, useEffect, useState, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Mic, ChevronRight, RotateCw } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import LanguageToggle from '@/components/LanguageToggle';
import { BrandLogo } from '@/components/BrandLogo';
import { WavePath } from '@/components/ui/wave-path';
import { AudioUpload } from '@/components/onboarding/AudioUpload';
import { ConsentStep } from '@/components/onboarding/ConsentStep';
import { translations } from '@/lib/translations';
import { RECORDING, PRICING, PRICING_USD } from '@/lib/limits';
import { pickSupportedAudioMime, DEFAULT_AUDIO_MIME } from '@/lib/audio-mime';

interface OnboardingProps {
  step: 1 | 2 | 3;
  isRecording: boolean;
  recordingSeconds: number;
  audioReady: boolean;
  selectedPrice: number;
  walletAddress: string;
  consented: boolean;
  consentBlob: Blob | null;
  onConsentChange: (value: boolean) => void;
  onConsentRecorded: (blob: Blob | null) => void;
  onStartRecording: () => void;
  onNextStep: () => void;
  onBackStep: () => void;
  onSelectPrice: (price: number) => void;
  onLaunch: () => void;
  onAudioReady: (blob: Blob, mimeType: string) => void;
  onDiscardRecording: () => void;
  isRegistering: boolean;
  registerError: string | null;
  selectedLanguage: 'en' | 'tr';
  onSelectLanguage: (lang: 'en' | 'tr') => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

// Example message size used in the earnings preview (a fan sending 2 billing units).
const EXAMPLE_UNITS = 2;

export default function Onboarding({
  step,
  isRecording,
  recordingSeconds,
  audioReady,
  selectedPrice,
  walletAddress,
  consented,
  consentBlob,
  onConsentChange,
  onConsentRecorded,
  onStartRecording,
  onNextStep,
  onBackStep,
  onSelectPrice,
  onLaunch,
  onAudioReady,
  onDiscardRecording,
  isRegistering,
  registerError,
  selectedLanguage,
  onSelectLanguage,
}: OnboardingProps) {
  const { t } = useLanguage()
  const truncatedAddress = walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 6);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [micError, setMicError] = useState<string | null>(null)
  const [savedDuration, setSavedDuration] = useState(0)
  const [solUsd, setSolUsd] = useState<number | null>(null)

  // Live SOL/USD rate for the price previews (same pattern as Dashboard).
  useEffect(() => {
    let ignore = false
    fetch('/api/sol-price')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!ignore && typeof json?.usd === 'number') setSolUsd(json.usd)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [])
  const recordingSecondsRef = useRef(recordingSeconds)
  useEffect(() => { recordingSecondsRef.current = recordingSeconds }, [recordingSeconds])

  // Canvas visualizer refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const smoothVolumeRef = useRef<number>(0)
  const phaseRef = useRef<number>(0)
  const isRecordingRef = useRef<boolean>(isRecording)

  // Update isRecordingRef so visualizer loop knows current recording state
  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])

  // Setup visualizer animation loop
  useEffect(() => {
    let active = true

    const draw = () => {
      if (!active) return

      const canvas = canvasRef.current
      if (!canvas) {
        animationFrameRef.current = requestAnimationFrame(draw)
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        animationFrameRef.current = requestAnimationFrame(draw)
        return
      }

      const W = canvas.width
      const H = canvas.height

      // Clear with transparent background
      ctx.clearRect(0, 0, W, H)

      let targetVolume = 0
      if (isRecordingRef.current && analyserRef.current) {
        const analyser = analyserRef.current
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyser.getByteTimeDomainData(dataArray)

        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          const v = (dataArray[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / bufferLength)
        // Boost sensitivity by a factor of 4.5 so waves react strongly to normal speech
        targetVolume = Math.min(rms * 4.5, 1.0)
      }

      // Smooth the volume change to prevent sudden jittering
      smoothVolumeRef.current = smoothVolumeRef.current * 0.82 + targetVolume * 0.18

      // Wave speed modulates slightly with input volume
      const speed = 0.05 + smoothVolumeRef.current * 0.14
      phaseRef.current += speed

      const centerY = H / 2
      const baseAmplitude = isRecordingRef.current ? 12 : 2.5 // More visible idle breathing wave
      const voiceAmplitude = smoothVolumeRef.current * (H * 0.70) // Let voice drive up to 70% of canvas height
      const totalAmplitude = baseAmplitude + voiceAmplitude

      // Wave configurations: frequency, multiplier, gradient, alpha, and phase offset
      const waves = [
        {
          frequency: 2.0,
          amplitudeMult: 1.0,
          colorStart: '#9B0F06', // Ember Red
          colorEnd: '#D53E0F',   // Ember Orange
          alpha: 0.95,
          phaseOffset: 0,
        },
        {
          frequency: 3.5,
          amplitudeMult: 0.7,
          colorStart: '#D53E0F', // Ember Orange
          colorEnd: '#EED9B9',   // Cream
          alpha: 0.6,
          phaseOffset: Math.PI / 3,
        },
        {
          frequency: 5.0,
          amplitudeMult: 0.4,
          colorStart: '#5E0006', // Bordeaux
          colorEnd: '#9B0F06',   // Ember Red
          alpha: 0.4,
          phaseOffset: (Math.PI * 2) / 3,
        },
      ]

      waves.forEach((w) => {
        ctx.beginPath()
        ctx.lineWidth = w.amplitudeMult === 1.0 ? 4.5 : 2.0 // Thicker lines for better neon presence

        // Create linear gradient for smooth neon color transitions
        const grad = ctx.createLinearGradient(0, 0, W, 0)
        grad.addColorStop(0, hexToRgba(w.colorStart, w.alpha * 0.15))
        grad.addColorStop(0.5, hexToRgba(w.colorEnd, w.alpha))
        grad.addColorStop(1, hexToRgba(w.colorStart, w.alpha * 0.15))
        ctx.strokeStyle = grad

        // Apply a glowing neon shadow for the primary wave
        if (w.amplitudeMult === 1.0) {
          ctx.shadowBlur = 15 // Increased blur for stronger glow
          ctx.shadowColor = hexToRgba(w.colorEnd, 0.7)
        } else {
          ctx.shadowBlur = 0
        }

        // Draw sine wave path
        for (let x = 0; x <= W; x += 2) {
          const t = x / W
          // Reduced pinch exponent to 1.8 for fuller, more pronounced waves in the center
          const envelope = Math.pow(Math.sin(t * Math.PI), 1.8)

          const angle = t * w.frequency * Math.PI * 2 + phaseRef.current + w.phaseOffset
          const y = centerY + Math.sin(angle) * totalAmplitude * w.amplitudeMult * envelope

          if (x === 0) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.stroke()
      })

      animationFrameRef.current = requestAnimationFrame(draw)
    }

    // Helper helper to convert hex to rgba
    const hexToRgba = (hex: string, alpha: number) => {
      const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
      const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b)
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex)
      return result
        ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`
    }

    animationFrameRef.current = requestAnimationFrame(draw)

    return () => {
      active = false
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  const startVisualization = (stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      const audioContext = new AudioContextClass()
      audioContextRef.current = audioContext

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      sourceRef.current = source
    } catch (err) {
      console.error('Failed to initialize Web Audio API for visualizer', err)
    }
  }

  const stopVisualization = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (e) {
        console.warn('Error disconnecting audio source', e)
      }
      sourceRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close()
      } catch (e) {
        console.warn('Error closing audio context', e)
      }
      audioContextRef.current = null
    }
    analyserRef.current = null
  }

  useEffect(() => {
    if (isRecording && recordingSeconds >= RECORDING.MAX_SECONDS) {
      mediaRecorderRef.current?.stop()
    }
  }, [isRecording, recordingSeconds])

  // Cleanup visualizer context on unmount
  useEffect(() => {
    return () => {
      stopVisualization()
    }
  }, [])

  const handleRecord = async () => {
    if (!isRecording) {
      try {
        setMicError(null)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mimeType = pickSupportedAudioMime()
        const mediaRecorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        )
        mediaRecorderRef.current = mediaRecorder
        audioChunksRef.current = []

        mediaRecorder.ondataavailable = (e) => {
          audioChunksRef.current.push(e.data)
        }

        mediaRecorder.onstop = () => {
          setSavedDuration(recordingSecondsRef.current)
          const effectiveType = mimeType || DEFAULT_AUDIO_MIME
          const blob = new Blob(audioChunksRef.current, { type: effectiveType })
          onAudioReady(blob, effectiveType)
          stream.getTracks().forEach(t => t.stop())
          stopVisualization()
        }

        // Start Web Audio visualization
        startVisualization(stream)
        mediaRecorder.start()
        onStartRecording()
      } catch (err) {
        stopVisualization()
        const isPermission = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        setMicError(
          isPermission
            ? t('onboarding.micPermissionDenied')
            : t('onboarding.micAccessError')
        )
      }
    } else {
      mediaRecorderRef.current?.stop()
    }
  }

  // An uploaded reference file feeds the same downstream state as a recording. Duration
  // metadata can be unknown (0) for some containers; in that case assume it clears the
  // minimum rather than blocking a valid upload.
  const handleReferenceUpload = (files: File[], durationSec: number) => {
    const file = files[0]
    if (!file) return
    setSavedDuration(durationSec > 0 ? durationSec : RECORDING.MIN_SECONDS)
    onAudioReady(file, file.type || DEFAULT_AUDIO_MIME)
  }

  const handleDiscardRecording = () => {
    setSavedDuration(0)
    onDiscardRecording()
  }

  const totalSteps = 3

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav Bar */}
      <div className="border-b-2 border-ember-3/30 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="border-b border-ember-3/15 mb-0.5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <BrandLogo variant="dark" />
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-3 h-3 rounded-full bg-ember-3"></div>
              <span>{truncatedAddress}</span>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="max-w-4xl mx-auto w-full px-4 py-6">
        <div className="flex items-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => {
            const n = i + 1
            return (
              <Fragment key={n}>
                {i > 0 && (
                  <div className={`h-1 flex-1 ${step >= n ? 'bg-primary' : 'bg-border'}`}></div>
                )}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    step === n
                      ? 'bg-primary text-primary-foreground'
                      : step > n
                        ? 'bg-primary/30 text-primary'
                        : 'bg-border text-muted-foreground'
                  }`}
                >
                  {n}
                </div>
              </Fragment>
            )
          })}
          <span className="font-display text-xs uppercase tracking-[0.25em] text-muted-foreground ml-4">
            {t('onboarding.stepLabel', { step })}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 pb-8">
        {step === 1 ? (
          /* Step 1: language + consent */
          <Card className="w-full max-w-lg bg-card border-border p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold">{t('onboarding.consentTitle')}</h2>
            </div>

            {/* Language Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t('onboarding.selectLanguage')}</label>
              <div className="flex gap-3">
                <button
                  onClick={() => onSelectLanguage('en')}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all border ${
                    selectedLanguage === 'en'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-muted-foreground border-border'
                  }`}
                >
                  🇬🇧 English
                </button>
                <button
                  onClick={() => onSelectLanguage('tr')}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all border ${
                    selectedLanguage === 'tr'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-muted-foreground border-border'
                  }`}
                >
                  🇹🇷 Türkçe
                </button>
              </div>
            </div>

            <ConsentStep
              language={selectedLanguage}
              consented={consented}
              onConsentChange={onConsentChange}
              consentBlob={consentBlob}
              onConsentRecorded={onConsentRecorded}
            />

            {/* Continue Button */}
            <Button
              onClick={onNextStep}
              disabled={!consented || !consentBlob}
              className="w-full bg-primary text-primary-foreground hover:bg-secondary disabled:bg-primary/30 disabled:text-primary/50 disabled:cursor-not-allowed"
            >
              {t('onboarding.buttonContinue')} <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </Card>
        ) : step === 2 ? (
          /* Step 2: reference voice recording */
          <Card className="w-full max-w-lg bg-card border-border p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold">{t('onboarding.title')}</h2>
              <p className="text-muted-foreground">
                {t('onboarding.subtitle', { targetSeconds: RECORDING.TARGET_SECONDS })}
              </p>
            </div>

            {/* Info Box */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm text-amber-100">
                {t('onboarding.infoBox', {
                  targetSeconds: RECORDING.TARGET_SECONDS,
                  minSeconds: RECORDING.MIN_SECONDS,
                  maxSeconds: RECORDING.MAX_SECONDS,
                })}
              </p>
            </div>

            {/* Script Box */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{t('onboarding.readAloud')}</label>
              <div className="bg-black/40 border border-border rounded-lg p-4 max-h-48 overflow-y-auto text-sm font-mono">
                <textarea
                  readOnly
                  // The script must match the creator's VOICE language (not the UI
                  // language) — read it directly, same pattern as the consent script.
                  value={translations[selectedLanguage].onboarding.recordingScript}
                  className="w-full bg-transparent text-foreground text-sm font-mono resize-none outline-none"
                  rows={4}
                />
              </div>
            </div>

            {/* Live Waveform Visualizer */}
            {!audioReady && (
              <div className="w-full bg-black/40 border border-border/60 rounded-xl p-4 flex flex-col items-center justify-center relative overflow-hidden h-24">
                <canvas
                  ref={canvasRef}
                  className="w-full h-full block"
                  width={640}
                  height={160}
                />
                {!isRecording && (
                  <span className="absolute bottom-2 font-display text-[10px] text-muted-foreground tracking-[0.25em] uppercase pointer-events-none">
                    {t('onboarding.visualizerReady')}
                  </span>
                )}
              </div>
            )}

            {/* Recording Button */}
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={handleRecord}
                disabled={audioReady}
                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
                  audioReady
                    ? 'bg-accent'
                    : isRecording
                    ? 'bg-ember-3 pulse-ring'
                    : 'bg-primary hover:bg-secondary'
                } text-primary-foreground disabled:opacity-75`}
              >
                {audioReady ? (
                  <span className="text-2xl">✓</span>
                ) : isRecording ? (
                  <Mic className="w-8 h-8 text-ember-4" />
                ) : (
                  <Mic className="w-8 h-8" />
                )}
              </button>
              <p className="text-sm text-muted-foreground">
                {audioReady
                  ? t('onboarding.recordingComplete')
                  : isRecording
                  ? `${formatTime(recordingSeconds)} — ${t('onboarding.tapToStop')}`
                  : t('onboarding.tapToStart')}
              </p>
              {isRecording && recordingSeconds < RECORDING.MIN_SECONDS && (
                <p className="text-xs text-amber-400 text-center max-w-xs">
                  {t('onboarding.cloneQualityWarn', {
                    minSeconds: RECORDING.MIN_SECONDS,
                    targetSeconds: RECORDING.TARGET_SECONDS,
                  })}
                </p>
              )}
              {audioReady && savedDuration < RECORDING.MIN_SECONDS && (
                <p className="text-sm text-red-400 text-center max-w-xs">
                  {t('onboarding.minDurationError', { minSeconds: RECORDING.MIN_SECONDS })}
                </p>
              )}
              {audioReady && (
                <button
                  type="button"
                  onClick={handleDiscardRecording}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" /> {t('onboarding.reRecord')}
                </button>
              )}
              {micError && (
                <p className="text-sm text-red-400 text-center max-w-xs">{micError}</p>
              )}
            </div>

            {/* Upload alternative */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('onboarding.orRecord')}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <AudioUpload minDurationSec={RECORDING.MIN_SECONDS} onFiles={handleReferenceUpload} />

            {/* Action Buttons */}
            <div className="flex gap-4 pt-2">
              <Button
                onClick={onBackStep}
                variant="outline"
                className="flex-1 border-border hover:bg-primary/10"
              >
                {t('onboarding.backButton')}
              </Button>
              <Button
                onClick={onNextStep}
                disabled={!audioReady || savedDuration < RECORDING.MIN_SECONDS}
                className="flex-1 bg-primary text-primary-foreground hover:bg-secondary disabled:bg-primary/30 disabled:text-primary/50 disabled:cursor-not-allowed"
              >
                {t('onboarding.buttonCreateVoice')} <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        ) : (
          /* Step 3: price + launch */
          <Card className="w-full max-w-lg bg-card border-border p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold">{t('onboarding.priceTitle')}</h2>
              <p className="text-muted-foreground">
                {t('onboarding.priceSubtitle', { unitChars: PRICING.UNIT_CHARS })}
              </p>
            </div>

            {/* Price Options (USD-primary; approx SOL shown for crypto fans) */}
            <div className="grid grid-cols-3 gap-2">
              {PRICING_USD.PRICE_OPTIONS_USD_CENTS.map((cents) => (
                <button
                  key={cents}
                  onClick={() => onSelectPrice(cents)}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedPrice === cents
                      ? 'bg-primary border-primary text-primary-foreground scale-105'
                      : 'border-border bg-background hover:border-primary/50'
                  }`}
                >
                  <div className="font-semibold">${cents / 100}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('onboarding.charsPerUnit', { unitChars: PRICING.UNIT_CHARS })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ≈ {(cents / 100 / (solUsd ?? PRICING.SOL_USD_FALLBACK)).toFixed(3)} SOL
                  </div>
                </button>
              ))}
            </div>

            {/* Info Row */}
            <div className="text-center text-sm text-muted-foreground space-y-1">
              <p>{t('onboarding.mostCreators', { unitChars: PRICING.UNIT_CHARS })}</p>
              <p className="text-xs">{t('onboarding.priceUsdHint')}</p>
            </div>

            <WavePath className="my-3 text-ember-3/30" />

            {/* Earnings Preview */}
            <div className="bg-[#1B0506] border border-ember-2/40 rounded-lg p-4 space-y-2">
              <p className="text-sm text-foreground">
                {t('onboarding.earningsPreview', {
                  exampleChars: EXAMPLE_UNITS * PRICING.UNIT_CHARS,
                  exampleUnits: EXAMPLE_UNITS,
                })}
              </p>
              <div className="space-y-1">
                <p className="font-display text-lg font-bold text-ember-3">
                  {t('onboarding.perRequest')} ${((selectedPrice / 100) * EXAMPLE_UNITS * PRICING.CREATOR_SHARE_RATE).toFixed(2)}
                </p>
                <p className="font-display text-lg font-bold text-ember-3">
                  {t('onboarding.monthlyEstimate')} ${((selectedPrice / 100) * EXAMPLE_UNITS * PRICING.CREATOR_SHARE_RATE * 30 * 10).toFixed(2)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{t('onboarding.platformFeeNote')}</p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 pt-4">
              <Button
                onClick={onBackStep}
                variant="outline"
                className="flex-1 border-border hover:bg-primary/10"
              >
                {t('onboarding.backButton')}
              </Button>
              <Button
                onClick={onLaunch}
                disabled={isRegistering}
                className="flex-1 bg-primary text-primary-foreground hover:bg-secondary disabled:opacity-60"
              >
                {isRegistering ? (
                  <>
                    <RotateCw className="w-4 h-4 mr-2 animate-spin" />
                    {t('onboarding.creatingVoice')}
                  </>
                ) : (
                  t('onboarding.launchButton')
                )}
              </Button>
            </div>
            {registerError && (
              <p className="text-sm text-red-400 text-center">{registerError}</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
