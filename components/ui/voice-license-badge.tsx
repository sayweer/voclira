'use client'

import { MouseEvent, useEffect, useRef, useState } from 'react'
import { translations } from '@/lib/translations'

interface VoiceLicenseBadgeProps {
  href: string
  language: 'tr' | 'en'
}

const identityMatrix =
  '1, 0, 0, 0, ' +
  '0, 1, 0, 0, ' +
  '0, 0, 1, 0, ' +
  '0, 0, 0, 1'

const maxRotate = 0.25
const minRotate = -0.25
const maxScale = 1
const minScale = 0.97

export function VoiceLicenseBadge({ href, language }: VoiceLicenseBadgeProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [firstOverlayPosition, setFirstOverlayPosition] = useState(0)
  const [matrix, setMatrix] = useState(identityMatrix)
  const [currentMatrix, setCurrentMatrix] = useState(identityMatrix)
  const [disableInOutOverlayAnimation, setDisableInOutOverlayAnimation] = useState(true)
  const [disableOverlayAnimation, setDisableOverlayAnimation] = useState(false)
  const [isTimeoutFinished, setIsTimeoutFinished] = useState(false)
  const enterTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimeout1 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimeout2 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimeout3 = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getDimensions = () => {
    const rect = ref.current?.getBoundingClientRect()
    return {
      left: rect?.left ?? 0,
      right: rect?.right ?? 0,
      top: rect?.top ?? 0,
      bottom: rect?.bottom ?? 0,
    }
  }

  const getMatrix = (clientX: number, clientY: number) => {
    const { left, right, top, bottom } = getDimensions()
    const xCenter = (left + right) / 2
    const yCenter = (top + bottom) / 2

    const scale = [
      maxScale - (maxScale - minScale) * Math.abs(xCenter - clientX) / (xCenter - left),
      maxScale - (maxScale - minScale) * Math.abs(yCenter - clientY) / (yCenter - top),
      maxScale - (maxScale - minScale) * (Math.abs(xCenter - clientX) + Math.abs(yCenter - clientY)) / (xCenter - left + yCenter - top),
    ]

    const rotate = {
      x1: 0.25 * ((yCenter - clientY) / yCenter - (xCenter - clientX) / xCenter),
      x2: maxRotate - (maxRotate - minRotate) * Math.abs(right - clientX) / (right - left),
      x3: 0,
      y0: 0,
      y2: maxRotate - (maxRotate - minRotate) * (top - clientY) / (top - bottom),
      y3: 0,
      z0: -(maxRotate - (maxRotate - minRotate) * Math.abs(right - clientX) / (right - left)),
      z1: 0.2 - (0.2 + 0.6) * (top - clientY) / (top - bottom),
      z3: 0,
    }

    return (
      `${scale[0]}, ${rotate.y0}, ${rotate.z0}, 0, ` +
      `${rotate.x1}, ${scale[1]}, ${rotate.z1}, 0, ` +
      `${rotate.x2}, ${rotate.y2}, ${scale[2]}, 0, ` +
      `${rotate.x3}, ${rotate.y3}, ${rotate.z3}, 1`
    )
  }

  const getOppositeMatrix = (_matrix: string, clientY: number, onMouseEnter?: boolean) => {
    const { top, bottom } = getDimensions()
    const oppositeY = bottom - clientY + top
    const weakening = onMouseEnter ? 0.7 : 4
    const multiplier = onMouseEnter ? -1 : 1

    return _matrix.split(', ').map((item, index) => {
      if (index === 2 || index === 4 || index === 8) {
        return -parseFloat(item) * multiplier / weakening
      } else if (index === 0 || index === 5 || index === 10) {
        return '1'
      } else if (index === 6) {
        return multiplier * (maxRotate - (maxRotate - minRotate) * (top - oppositeY) / (top - bottom)) / weakening
      } else if (index === 9) {
        return (maxRotate - (maxRotate - minRotate) * (top - oppositeY) / (top - bottom)) / weakening
      }
      return item
    }).join(', ')
  }

  const onMouseEnter = (e: MouseEvent<HTMLAnchorElement>) => {
    if (leaveTimeout1.current) clearTimeout(leaveTimeout1.current)
    if (leaveTimeout2.current) clearTimeout(leaveTimeout2.current)
    if (leaveTimeout3.current) clearTimeout(leaveTimeout3.current)
    setDisableOverlayAnimation(true)

    const { left, right, top, bottom } = getDimensions()
    const xCenter = (left + right) / 2
    const yCenter = (top + bottom) / 2

    setDisableInOutOverlayAnimation(false)
    enterTimeout.current = setTimeout(() => setDisableInOutOverlayAnimation(true), 350)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFirstOverlayPosition((Math.abs(xCenter - e.clientX) + Math.abs(yCenter - e.clientY)) / 1.5)
      })
    })

    const m = getMatrix(e.clientX, e.clientY)
    const oppositeMatrix = getOppositeMatrix(m, e.clientY, true)
    setMatrix(oppositeMatrix)
    setIsTimeoutFinished(false)
    setTimeout(() => setIsTimeoutFinished(true), 200)
  }

  const onMouseMove = (e: MouseEvent<HTMLAnchorElement>) => {
    const { left, right, top, bottom } = getDimensions()
    const xCenter = (left + right) / 2
    const yCenter = (top + bottom) / 2

    setTimeout(() => setFirstOverlayPosition((Math.abs(xCenter - e.clientX) + Math.abs(yCenter - e.clientY)) / 1.5), 150)
    if (isTimeoutFinished) setCurrentMatrix(getMatrix(e.clientX, e.clientY))
  }

  const onMouseLeave = (e: MouseEvent<HTMLAnchorElement>) => {
    const oppositeMatrix = getOppositeMatrix(matrix, e.clientY)
    if (enterTimeout.current) clearTimeout(enterTimeout.current)

    setCurrentMatrix(oppositeMatrix)
    setTimeout(() => setCurrentMatrix(identityMatrix), 200)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setDisableInOutOverlayAnimation(false)
        leaveTimeout1.current = setTimeout(() => setFirstOverlayPosition(-firstOverlayPosition / 4), 150)
        leaveTimeout2.current = setTimeout(() => setFirstOverlayPosition(0), 300)
        leaveTimeout3.current = setTimeout(() => {
          setDisableOverlayAnimation(false)
          setDisableInOutOverlayAnimation(true)
        }, 500)
      })
    })
  }

  useEffect(() => {
    if (isTimeoutFinished) setMatrix(currentMatrix)
  }, [currentMatrix, isTimeoutFinished])

  const overlayAnimations = Array.from({ length: 10 }, (_, e) => `
    @keyframes voiceBadgeOverlay${e + 1} {
      0%   { transform: rotate(${e * 10}deg); }
      50%  { transform: rotate(${(e + 1) * 10}deg); }
      100% { transform: rotate(${e * 10}deg); }
    }
  `).join(' ')

  const overlayColors: string[] = [
    'hsl(30, 60%, 55%)',   // terracotta warm
    'hsl(45, 80%, 60%)',   // golden cream
    'hsl(96, 40%, 45%)',   // olive green
    'hsl(140, 30%, 50%)',  // soft sage
    'hsl(200, 50%, 55%)',  // sky
    'hsl(233, 60%, 55%)',  // indigo
    'hsl(271, 50%, 50%)',  // purple
    'transparent',
    'transparent',
    'white',
  ]

  const title = translations[language].license.licensedTitle

  return (
    <a
      ref={ref}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-full max-w-sm cursor-pointer select-none"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
    >
      <style>{overlayAnimations}</style>
      <div
        style={{
          transform: `perspective(700px) matrix3d(${matrix})`,
          transformOrigin: 'center center',
          transition: 'transform 200ms ease-out',
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 54" className="w-full h-auto">
          <defs>
            <filter id="voiceBadgeBlur">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
            <mask id="voiceBadgeMask">
              <rect width="260" height="54" fill="white" rx="10" />
            </mask>
          </defs>

          {/* Background */}
          <rect width="260" height="54" rx="10" fill="#EEE0CC" />
          {/* Inner border */}
          <rect x="4" y="4" width="252" height="46" rx="8" fill="transparent" stroke="#607456" strokeWidth="1" strokeOpacity="0.5" />

          {/* Text: brand + title */}
          <text fontFamily="Helvetica-Bold, Helvetica" fontSize="8" fontWeight="bold" fill="#607456" x="53" y="19" letterSpacing="1.5">
            VOCLIRA
          </text>
          <text fontFamily="Helvetica-Bold, Helvetica" fontSize="13" fontWeight="bold" fill="#2A0E0E" x="52" y="38">
            {title}
          </text>

          {/* Shield-check icon (lucide path, adapted to ~34×34 viewBox centered at 8,9 translate) */}
          <g transform="translate(9, 8)" fill="none" stroke="#607456" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {/* Shield outline */}
            <path d="M18 2L4 7v7c0 7.18 5.93 13.9 14 16 8.07-2.1 14-8.82 14-16V7L18 2z" transform="scale(0.95) translate(-1, 0)" />
            {/* Checkmark */}
            <polyline points="12,17 15,20 22,13" transform="scale(0.95) translate(-1, 0)" />
          </g>

          {/* Holographic overlay layers */}
          <g style={{ mixBlendMode: 'overlay' }} mask="url(#voiceBadgeMask)">
            {overlayColors.map((color, i) => (
              <g
                key={i}
                style={{
                  transform: `rotate(${firstOverlayPosition + i * 10}deg)`,
                  transformOrigin: 'center center',
                  transition: !disableInOutOverlayAnimation ? 'transform 200ms ease-out' : 'none',
                  animation: disableOverlayAnimation ? 'none' : `voiceBadgeOverlay${i + 1} 5s infinite`,
                  willChange: 'transform',
                }}
              >
                <polygon
                  points="0,0 260,54 260,0 0,54"
                  fill={color}
                  filter="url(#voiceBadgeBlur)"
                  opacity="0.5"
                />
              </g>
            ))}
          </g>
        </svg>
      </div>
    </a>
  )
}
