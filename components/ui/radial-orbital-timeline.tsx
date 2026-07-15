'use client';

import { useState, useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'

export interface OrbitalItem {
  id: number
  title: string
  content: string
  icon: React.ElementType
  relatedIds: number[]
}

interface RadialOrbitalTimelineProps {
  items: OrbitalItem[]
}

const MAX_ORBIT_RADIUS = 200
const MIN_ORBIT_RADIUS = 96

export default function RadialOrbitalTimeline({ items }: RadialOrbitalTimelineProps) {
  const [rotationAngle, setRotationAngle] = useState<number>(0)
  const [autoRotate, setAutoRotate] = useState<boolean>(true)
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null)
  const [orbitRadius, setOrbitRadius] = useState<number>(MAX_ORBIT_RADIUS)
  const containerRef = useRef<HTMLDivElement>(null)
  const orbitRef = useRef<HTMLDivElement>(null)

  // Responsive orbit: shrink the wheel to the container so the same interactive
  // component works on phones — node size (and thus touch targets) stays intact.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const width = el.clientWidth
      setOrbitRadius(Math.max(MIN_ORBIT_RADIUS, Math.min(MAX_ORBIT_RADIUS, width / 2 - 56)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current || e.target === orbitRef.current) {
      setActiveNodeId(null)
      setAutoRotate(true)
    }
  }

  const toggleItem = (id: number) => {
    if (activeNodeId === id) {
      setActiveNodeId(null)
      setAutoRotate(true)
      return
    }
    setActiveNodeId(id)
    setAutoRotate(false)
    // Rotate the wheel so the selected node lands at the top (270°)
    const nodeIndex = items.findIndex((item) => item.id === id)
    setRotationAngle(270 - (nodeIndex / items.length) * 360)
  }

  useEffect(() => {
    if (!autoRotate) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const rotationTimer = setInterval(() => {
      setRotationAngle((prev) => Number(((prev + 0.3) % 360).toFixed(3)))
    }, 50)

    return () => clearInterval(rotationTimer)
  }, [autoRotate])

  const calculateNodePosition = (index: number, total: number) => {
    const angle = ((index / total) * 360 + rotationAngle) % 360
    const radian = (angle * Math.PI) / 180

    const x = orbitRadius * Math.cos(radian)
    const y = orbitRadius * Math.sin(radian)

    const zIndex = Math.round(100 + 50 * Math.cos(radian))
    const opacity = Math.max(0.4, Math.min(1, 0.4 + 0.6 * ((1 + Math.sin(radian)) / 2)))

    return { x, y, zIndex, opacity }
  }

  const relatedToActive =
    activeNodeId !== null
      ? items.find((item) => item.id === activeNodeId)?.relatedIds ?? []
      : []

  return (
    <div
      className="relative flex h-[28rem] w-full flex-col items-center justify-center overflow-hidden sm:h-[40rem]"
      ref={containerRef}
      onClick={handleContainerClick}
    >
      <div className="relative flex h-full w-full max-w-4xl items-center justify-center">
        <div
          className="absolute flex h-full w-full items-center justify-center"
          ref={orbitRef}
          style={{ perspective: '1000px' }}
        >
          {/* Center pulse */}
          <div className="absolute z-10 flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-voclira-olive via-voclira-terracotta to-voclira-burgundy">
            <div className="absolute h-20 w-20 animate-ping rounded-full border border-voclira-cream/20 opacity-70" />
            <div
              className="absolute h-24 w-24 animate-ping rounded-full border border-voclira-cream/10 opacity-50"
              style={{ animationDelay: '0.5s' }}
            />
            <div className="h-8 w-8 rounded-full bg-voclira-cream/80 backdrop-blur-md" />
          </div>

          {/* Orbit ring */}
          <div
            className="absolute rounded-full border border-voclira-cream/15"
            style={{ width: orbitRadius * 2 - 16, height: orbitRadius * 2 - 16 }}
          />

          {items.map((item, index) => {
            const position = calculateNodePosition(index, items.length)
            const isExpanded = activeNodeId === item.id
            const isRelated = relatedToActive.includes(item.id)
            const Icon = item.icon

            return (
              <div
                key={item.id}
                className="absolute cursor-pointer transition-all duration-700"
                style={{
                  transform: `translate(${position.x}px, ${position.y}px)`,
                  zIndex: isExpanded ? 200 : position.zIndex,
                  opacity: isExpanded ? 1 : position.opacity,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleItem(item.id)
                }}
              >
                <button
                  type="button"
                  aria-label={item.title}
                  aria-expanded={isExpanded}
                  className={`flex h-10 w-10 transform cursor-pointer items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    isExpanded
                      ? 'scale-150 border-voclira-cream bg-voclira-cream text-voclira-burgundy shadow-lg shadow-voclira-cream/30'
                      : isRelated
                        ? 'animate-pulse border-voclira-terracotta bg-voclira-terracotta/60 text-voclira-cream'
                        : 'border-voclira-cream/40 bg-voclira-night text-voclira-cream'
                  }`}
                >
                  <Icon size={16} />
                </button>

                <div
                  className={`absolute top-12 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-semibold tracking-wider transition-all duration-300 ${
                    isExpanded ? 'scale-125 text-voclira-cream' : 'text-voclira-cream/70'
                  }`}
                >
                  {item.title}
                </div>

                {isExpanded && (
                  <div className="absolute top-24 left-1/2 w-64 max-w-[calc(100vw-3rem)] -translate-x-1/2 overflow-visible rounded-xl border border-voclira-cream/30 bg-voclira-night/95 p-4 shadow-xl shadow-voclira-cream/10 backdrop-blur-lg">
                    <div className="absolute -top-3 left-1/2 h-3 w-px -translate-x-1/2 bg-voclira-cream/50" />
                    <p className="font-display text-sm font-semibold text-voclira-cream">
                      {item.title}
                    </p>
                    <p className="mt-2 text-xs text-voclira-cream/80">{item.content}</p>

                    {item.relatedIds.length > 0 && (
                      <div className="mt-4 border-t border-voclira-cream/10 pt-3">
                        <div className="flex flex-wrap gap-1">
                          {item.relatedIds.map((relatedId) => {
                            const relatedItem = items.find((i) => i.id === relatedId)
                            if (!relatedItem) return null
                            return (
                              <button
                                key={relatedId}
                                className="flex h-6 items-center rounded-full border border-voclira-cream/20 bg-transparent px-2 text-xs text-voclira-cream/80 transition-all hover:border-voclira-terracotta hover:text-voclira-cream"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleItem(relatedId)
                                }}
                              >
                                {relatedItem.title}
                                <ArrowRight size={8} className="ml-1 text-voclira-cream/60" />
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
