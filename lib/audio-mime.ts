// Single source for MediaRecorder MIME negotiation — used by every recorder
// (onboarding reference sample + consent verification). Ordered by preference:
// iOS Safari records only audio/mp4; Chrome/Firefox prefer webm/opus.
const CANDIDATE_MIMES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

/** Fallback blob type when MediaRecorder reports no supported candidate. */
export const DEFAULT_AUDIO_MIME = 'audio/webm'

export function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of CANDIDATE_MIMES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}
