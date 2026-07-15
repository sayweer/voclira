'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useLanguage } from '@/components/LanguageProvider'

interface AudioUploadProps {
  /** Recommended minimum total duration in seconds; a soft warning shows below it. */
  minDurationSec: number
  onFiles: (files: File[], totalDurationSec: number) => void
}

/** Reads an audio file's duration from metadata without decoding the whole file. */
function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    audio.src = url
  })
}

function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}s ${m}dk`
  if (m > 0) return `${m}dk ${sec}sn`
  return `${sec}sn`
}

/** File picker for a pre-recorded reference sample (single file, converted to WAV on upload). */
export function AudioUpload({ minDurationSec, onFiles }: AudioUploadProps) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selected, setSelected] = useState<{ count: number; duration: number } | null>(null)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    const durations = await Promise.all(files.map(getAudioDuration))
    const totalDuration = durations.reduce((sum, d) => sum + d, 0)
    setSelected({ count: files.length, duration: totalDuration })
    onFiles(files, totalDuration)
  }

  const belowMin = selected !== null && selected.duration > 0 && selected.duration < minDurationSec

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border bg-background hover:border-primary/50 transition-all text-sm text-muted-foreground"
      >
        <Upload className="w-4 h-4" />
        {t('onboarding.uploadCta')}
      </button>

      {selected && (
        <p className="text-xs text-muted-foreground text-center">
          {t('onboarding.uploadSelected', {
            count: selected.count,
            duration: selected.duration > 0 ? formatDuration(selected.duration) : '—',
          })}
        </p>
      )}
      {belowMin && (
        <p className="text-xs text-amber-400 text-center">
          {t('onboarding.uploadDurationWarn', { minSeconds: minDurationSec })}
        </p>
      )}
    </div>
  )
}
