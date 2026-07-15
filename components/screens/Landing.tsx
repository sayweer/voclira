'use client';

import { motion } from 'framer-motion'
import {
  BookOpen,
  ChevronDown,
  Clapperboard,
  Coins,
  FileText,
  Flame,
  Gamepad2,
  GraduationCap,
  Heart,
  Megaphone,
  Mic,
  ShieldCheck,
} from 'lucide-react'
import { WalletButton } from '@/components/WalletButton'
import { useLanguage } from '@/components/LanguageProvider'
import LanguageToggle from '@/components/LanguageToggle'
import { BrandLogo } from '@/components/BrandLogo'
import NewsMarquee from '@/components/ui/news-marquee'
import { GooeyText } from '@/components/ui/gooey-text-morphing'
import DisplayCards from '@/components/ui/display-cards'
import RadialOrbitalTimeline, { OrbitalItem } from '@/components/ui/radial-orbital-timeline'
import { RECORDING } from '@/lib/limits'


const NEWS_IMAGES = Array.from({ length: 17 }, (_, i) => `/news/news-${i + 1}.png`)

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
}

// Stack offsets shrink below `sm` so the fanned deck fits phone viewports —
// one component serves every breakpoint (no separate mobile markup).
const FEATURE_STACK_CLASSES = [
  "[grid-area:stack] hover:-translate-y-10 before:absolute before:w-[100%] before:rounded-xl before:h-[100%] before:content-[''] before:bg-blend-overlay before:bg-voclira-cream/25 grayscale-[60%] hover:before:opacity-0 before:transition-opacity before:duration-700 hover:grayscale-0 before:left-0 before:top-0",
  "[grid-area:stack] translate-x-4 translate-y-10 sm:translate-x-16 hover:-translate-y-1 before:absolute before:w-[100%] before:rounded-xl before:h-[100%] before:content-[''] before:bg-blend-overlay before:bg-voclira-cream/25 grayscale-[60%] hover:before:opacity-0 before:transition-opacity before:duration-700 hover:grayscale-0 before:left-0 before:top-0",
  '[grid-area:stack] translate-x-8 translate-y-20 sm:translate-x-32 hover:translate-y-10',
]

export default function Landing() {
  const { t, language } = useLanguage()

  const gooeyWords = language === 'tr'
    ? ['kontrol sende', 'para cüzdanında', 'gelecek seste olsun']
    : ['control is yours', 'money in your wallet', 'future is in your voice']

  const features = [
    {
      key: 'cloning',
      icon: <Mic className="size-4 text-voclira-cream" />,
      iconClassName: 'bg-voclira-olive',
    },
    {
      key: 'income',
      icon: <Coins className="size-4 text-voclira-cream" />,
      iconClassName: 'bg-voclira-terracotta',
    },
    {
      key: 'licensing',
      icon: <FileText className="size-4 text-voclira-cream" />,
      iconClassName: 'bg-voclira-burgundy',
    },
  ]

  const featureCards = features.map((f, i) => ({
    icon: f.icon,
    iconClassName: f.iconClassName,
    title: t(`landing.features.${f.key}.title`),
    description: t(`landing.features.${f.key}.desc`, {
      minSeconds: RECORDING.MIN_SECONDS,
      maxSeconds: RECORDING.MAX_SECONDS,
    }),
    date: t(`landing.features.${f.key}.tag`),
    className: FEATURE_STACK_CLASSES[i],
  }))

  const useCases = [
    { key: 'motivation', icon: Flame, relatedIds: [2, 5] },
    { key: 'emotional', icon: Heart, relatedIds: [1] },
    { key: 'audiobook', icon: BookOpen, relatedIds: [6, 4] },
    { key: 'dubbing', icon: Clapperboard, relatedIds: [3, 7] },
    { key: 'podcast', icon: Mic, relatedIds: [1, 8] },
    { key: 'education', icon: GraduationCap, relatedIds: [3] },
    { key: 'gaming', icon: Gamepad2, relatedIds: [4] },
    { key: 'ads', icon: Megaphone, relatedIds: [5] },
  ]

  const orbitalItems: OrbitalItem[] = useCases.map((uc, i) => ({
    id: i + 1,
    title: t(`landing.useCases.items.${uc.key}.title`),
    content: t(`landing.useCases.items.${uc.key}.desc`),
    icon: uc.icon,
    relatedIds: uc.relatedIds,
  }))

  return (
    <div className="voclira-landing relative min-h-screen bg-voclira-cream text-voclira-burgundy overflow-x-hidden">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen flex-col">
        <NewsMarquee images={NEWS_IMAGES} />

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-6">
          <BrandLogo variant="light" withWordmark={false} />
          <LanguageToggle className="!bg-voclira-paper !text-voclira-burgundy !border-voclira-burgundy/20 !shadow-none hover:!bg-voclira-paper/80" />
        </div>

        <motion.div
          className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16 text-center"
          variants={container}
          initial="hidden"
          animate="visible"
        >
          {/* Masthead */}
          <motion.div variants={item} className="w-full max-w-3xl">
            <div className="border-y-2 border-voclira-burgundy/50 py-1">
              <div className="border-y border-voclira-burgundy/30 py-4">
                <h1 className="font-display font-black tracking-tight text-6xl sm:text-7xl md:text-8xl">
                  Voclira
                </h1>
              </div>
            </div>
            <p
              lang={language}
              className="mt-3 font-display text-sm uppercase tracking-[0.25em] text-voclira-burgundy/70"
            >
              {t('landing.edition')}
            </p>
          </motion.div>

          <motion.div variants={item} className="w-full">
            <GooeyText
              texts={gooeyWords}
              morphTime={1}
              cooldownTime={1.5}
              className="h-14 sm:h-20"
              textClassName="font-display font-semibold text-4xl sm:text-6xl text-voclira-terracotta whitespace-nowrap"
            />
          </motion.div>

          <motion.p
            variants={item}
            className="max-w-md italic text-voclira-burgundy/80"
          >
            {t('landing.heroTagline')}
          </motion.p>

          {/* CTA */}
          <motion.div variants={item} className="mt-4 flex flex-col items-center gap-3">
            <div className="voclira-ring">
              <span className="[&>button]:px-8 [&>button]:py-3.5 [&>button]:text-base">
                <WalletButton />
              </span>
            </div>
            <p className="text-xs text-voclira-burgundy/60">{t('landing.ctaHint')}</p>
          </motion.div>
        </motion.div>

        {/* Scroll cue */}
        <a
          href="#features"
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="absolute inset-x-0 bottom-6 z-10 flex flex-col items-center gap-1 text-voclira-burgundy/60 transition-colors hover:text-voclira-burgundy"
        >
          <span className="text-[11px] uppercase tracking-[0.2em]">
            {t('landing.scrollCue')}
          </span>
          <ChevronDown className="size-4 animate-bounce motion-reduce:animate-none" />
        </a>
      </section>

      {/* ── Creator features ─────────────────────────────────── */}
      <section id="features" className="relative mx-auto max-w-5xl px-6 py-20">
        <header className="mb-12 flex items-center gap-4">
          <span className="h-px flex-1 bg-voclira-burgundy/30" />
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.25em]">
            {t('landing.features.title')}
          </h2>
          <span className="h-px flex-1 bg-voclira-burgundy/30" />
        </header>

        {/* Skewed stack — single responsive component for every breakpoint */}
        <div className="flex justify-center pb-24">
          <DisplayCards cards={featureCards} />
        </div>

        {/* Content-control footnote */}
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-voclira-burgundy/70">
          <ShieldCheck className="size-4 shrink-0 text-voclira-olive" />
          <p>{t('landing.features.control')}</p>
        </div>
      </section>

      {/* ── Use cases: night-edition orbital ─────────────────── */}
      <section className="relative bg-voclira-night py-20 text-voclira-cream">
        <div className="mx-auto max-w-5xl px-6">
          <header className="mb-8 flex items-center gap-4">
            <span className="h-px flex-1 bg-voclira-cream/30" />
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.25em]">
              {t('landing.useCases.title')}
            </h2>
            <span className="h-px flex-1 bg-voclira-cream/30" />
          </header>

          {/* Orbiting use cases — the orbital scales itself down on phones */}
          <RadialOrbitalTimeline items={orbitalItems} />
        </div>
      </section>

      {/* ── Footer CTA ───────────────────────────────────────── */}
      <section className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 pb-24 text-center">
        <div className="w-full border-y-2 border-voclira-burgundy/50 py-0.5">
          <div className="w-full border-y border-voclira-burgundy/30 py-6">
            <p className="text-sm text-voclira-burgundy/70">{t('landing.joinedCreators')}</p>
          </div>
        </div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-voclira-burgundy/50">
          Voclira — Solana
        </p>
      </section>
    </div>
  )
}
