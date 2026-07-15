'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { pickSupportedAudioMime, DEFAULT_AUDIO_MIME } from '@/lib/audio-mime'

export type RecorderError = 'permission' | 'access' | null

export interface VoiceRecorder {
  isRecording: boolean
  seconds: number
  blob: Blob | null
  mimeType: string
  error: RecorderError
  start: () => Promise<void>
  stop: () => void
  reset: () => void
}

/**
 * Minimal MediaRecorder wrapper used by the consent-verification recorder.
 * Handles getUserMedia, recording, an elapsed-seconds timer, and stream cleanup.
 * Returns the recorded Blob once stopped.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [mimeType, setMimeType] = useState(DEFAULT_AUDIO_MIME)
  const [error, setError] = useState<RecorderError>(null)

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const start = useCallback(async () => {
    setError(null)
    setBlob(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mt = pickSupportedAudioMime()
      const rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined)
      recorderRef.current = rec
      chunksRef.current = []

      rec.ondataavailable = (e) => chunksRef.current.push(e.data)
      rec.onstop = () => {
        const effective = mt || DEFAULT_AUDIO_MIME
        setBlob(new Blob(chunksRef.current, { type: effective }))
        setMimeType(effective)
        cleanupStream()
        setIsRecording(false)
      }

      rec.start()
      setSeconds(0)
      setIsRecording(true)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err) {
      cleanupStream()
      const isPerm =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      setError(isPerm ? 'permission' : 'access')
      setIsRecording(false)
    }
  }, [])

  const stop = useCallback(() => {
    recorderRef.current?.stop()
  }, [])

  const reset = useCallback(() => {
    setBlob(null)
    setSeconds(0)
    setError(null)
  }, [])

  useEffect(() => () => cleanupStream(), [])

  return { isRecording, seconds, blob, mimeType, error, start, stop, reset }
}
