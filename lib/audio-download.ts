export type DownloadResult = 'shared' | 'downloaded' | 'opened-new-tab' | 'cancelled' | 'failed'

/** Stored audio_url may be a raw base64 MP3 (legacy purchases) or an R2 public URL (current). */
export function audioSrcFromStored(stored: string): string {
    return /^https?:\/\//.test(stored) ? stored : `data:audio/mpeg;base64,${stored}`
}

interface DownloadOptions {
    base64?: string
    url?: string
    /** Base file name WITHOUT extension — the extension is derived from the audio's MIME type. */
    filename: string
    mimeType?: string
}

/** Generated audio is WAV (Chatterbox) or MP3 (legacy base64) — never trust a hardcoded extension. */
function extensionForMime(mime: string): string {
    if (mime.includes('wav')) return 'wav'
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
    if (mime.includes('mp4')) return 'm4a'
    if (mime.includes('ogg')) return 'ogg'
    if (mime.includes('webm')) return 'webm'
    return 'mp3'
}

function isIOSSafari(): boolean {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return false
    const ua = navigator.userAgent
    const iOS =
        /iPad|iPhone|iPod/.test(ua) ||
        (ua.includes('Mac') && 'ontouchend' in document)
    const webkitNotChrome = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
    return iOS && webkitNotChrome
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64)
    const chunkSize = 8 * 1024
    const chunks: Uint8Array<ArrayBuffer>[] = []
    for (let offset = 0; offset < binary.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, binary.length)
        const slice = new Uint8Array(end - offset)
        for (let i = offset; i < end; i++) {
            slice[i - offset] = binary.charCodeAt(i)
        }
        chunks.push(slice)
    }
    return new Blob(chunks, { type: mimeType })
}

function triggerAnchorDownload(blob: Blob, filename: string): boolean {
    try {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.rel = 'noopener'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return true
    } catch (err) {
        console.error('[audio-download] anchor click failed:', err)
        return false
    }
}

function openInNewTab(blob: Blob): boolean {
    try {
        const url = URL.createObjectURL(blob)
        const win = window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
        return win !== null
    } catch (err) {
        console.error('[audio-download] window.open failed:', err)
        return false
    }
}

export async function downloadAudio(opts: DownloadOptions): Promise<DownloadResult> {
    const mimeType = opts.mimeType ?? 'audio/mpeg'

    let blob: Blob
    try {
        if (opts.url) {
            const res = await fetch(opts.url)
            if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
            blob = await res.blob()
        } else if (opts.base64) {
            blob = base64ToBlob(opts.base64, mimeType)
        } else {
            throw new Error('no audio source provided')
        }
    } catch (err) {
        console.error('[audio-download] source load failed:', err)
        return 'failed'
    }

    const effectiveMime = blob.type || mimeType
    const filename = `${opts.filename}.${extensionForMime(effectiveMime)}`

    // iOS Safari: <a download> is ignored on blob/data URLs. The only reliable
    // path is Web Share API → user picks "Save to Files" / AirDrop / Messages.
    if (isIOSSafari()) {
        const shareFn = typeof navigator !== 'undefined' ? navigator.share : undefined
        const canShareFn = typeof navigator !== 'undefined' ? navigator.canShare : undefined
        if (typeof shareFn === 'function') {
            const file = new File([blob], filename, { type: effectiveMime })
            const shareData: ShareData = { files: [file], title: filename }
            const canShare = typeof canShareFn === 'function' ? canShareFn.call(navigator, shareData) : true
            if (canShare) {
                try {
                    await navigator.share(shareData)
                    return 'shared'
                } catch (err) {
                    if (err instanceof Error && err.name === 'AbortError') {
                        return 'cancelled'
                    }
                    console.warn('[audio-download] navigator.share failed, falling back:', err)
                }
            }
        }
    }

    if (triggerAnchorDownload(blob, filename)) {
        return 'downloaded'
    }

    if (openInNewTab(blob)) {
        return 'opened-new-tab'
    }

    return 'failed'
}
