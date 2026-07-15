'use client'

import { useEffect } from 'react'
import { Mic, Check, RotateCw } from 'lucide-react'
import { useVoiceRecorder } from '@/lib/useVoiceRecorder'
import { useLanguage } from '@/components/LanguageProvider'
import { translations } from '@/lib/translations'
import { CONSENT } from '@/lib/limits'

interface ConsentStepProps {
  language: 'en' | 'tr'
  consented: boolean
  onConsentChange: (value: boolean) => void
  consentBlob: Blob | null
  onConsentRecorded: (blob: Blob | null) => void
}

/**
 * Onboarding step 1: legal consent. The creator reads an on-screen sentence aloud
 * (captured as the verification-audio WAV) and checks the box. Both are required to
 * continue — the spoken sentence proves the voice is theirs and that they consent to
 * cloning. `language` selects which sentence is shown; the parent owns consentTextVersion.
 */
export function ConsentStep({
  language,
  consented,
  onConsentChange,
  consentBlob,
  onConsentRecorded,
}: ConsentStepProps) {
  const { t } = useLanguage()
  // The spoken consent sentence must match the creator's voice language (selected in
  // onboarding), not the UI language — read it explicitly rather than via t().
  const consentScript = translations[language].onboarding.consentScript
  const { isRecording, seconds, blob, error, start, stop, reset } = useVoiceRecorder()

  // Lift the recorded blob to the parent once recording stops — but only when it
  // meets the minimum length. Short recordings stay local so the Continue button
  // (gated on the parent's consentBlob) cannot proceed with an unverifiable sample.
  useEffect(() => {
    if (!blob) return
    onConsentRecorded(seconds >= CONSENT.MIN_SECONDS ? blob : null)
  }, [blob, seconds, onConsentRecorded])

  const handleMicClick = () => {
    if (isRecording) {
      stop()
      return
    }
    if (blob || consentBlob) {
      // Re-record: clear both local and parent state, then start fresh.
      reset()
      onConsentRecorded(null)
    }
    void start()
  }

  const tooShort = blob !== null && seconds > 0 && seconds < CONSENT.MIN_SECONDS

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-display font-bold">{t('onboarding.consentTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('onboarding.consentIntro')}</p>
      </div>

      {/* Sentence to read aloud */}
      <div className="bg-black/40 border border-border rounded-lg p-4">
        <p className="text-sm text-foreground leading-relaxed">“{consentScript}”</p>
      </div>

      {/* Record consent */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleMicClick}
          aria-label={t('onboarding.consentRecordCta')}
          className={`flex items-center justify-center gap-2 flex-1 py-3 rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            isRecording
              ? 'bg-ember-3 text-primary-foreground pulse-ring'
              : consentBlob
                ? 'bg-accent text-foreground border border-border'
                : 'bg-primary text-primary-foreground hover:bg-secondary'
          }`}
        >
          {isRecording ? (
            <><Mic className="w-4 h-4" /> {t('onboarding.consentRecordStop')} · {seconds}s</>
          ) : blob || consentBlob ? (
            <><RotateCw className="w-4 h-4" /> {t('onboarding.consentReRecord')}</>
          ) : (
            <><Mic className="w-4 h-4" /> {t('onboarding.consentRecordCta')}</>
          )}
        </button>
        {consentBlob && !isRecording && (
          <span className="flex items-center gap-1 text-sm text-ember-3 shrink-0">
            <Check className="w-4 h-4" /> {t('onboarding.consentRecorded')}
          </span>
        )}
      </div>

      {tooShort && <p className="text-xs text-amber-400">{t('onboarding.consentTooShort')}</p>}
      {error && (
        <p className="text-xs text-red-400">
          {error === 'permission'
            ? t('onboarding.micPermissionDenied')
            : t('onboarding.micAccessError')}
        </p>
      )}

      {/* Legal checkbox */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => onConsentChange(e.target.checked)}
          className="mt-0.5 w-5 h-5 shrink-0 accent-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <span className="text-sm text-muted-foreground leading-relaxed">
          {t('onboarding.consentCheckbox')}
        </span>
      </label>
    </div>
  )
}
