'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BorderBeam } from '@/components/ui/border-beam';
import { Dock } from '@/components/ui/dock-two';
import { BrandLogo } from '@/components/BrandLogo';
import {
  Copy,
  Check,
  Settings,
  TrendingUp,
  LayoutDashboard,
  BarChart3,
  MessageSquare,
  Coins,
  Play,
  Pause,
  Search,
  RefreshCw,
  AudioLines,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  Volume2,
  Loader2,
  HelpCircle,
} from 'lucide-react';
import type { RecentPurchaseRow } from '@/types';
import { audioSrcFromStored } from '@/lib/audio-download';
import { PRICING } from '@/lib/limits';
import { useLanguage } from '@/components/LanguageProvider';
import LanguageToggle from '@/components/LanguageToggle';

const Analytics = dynamic(() => import('@/components/screens/Analytics'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      Loading analytics…
    </div>
  ),
})

type DashboardTab = 'overview' | 'analytics' | 'messages'

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
}

const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

const PAGE_SIZE = 10

interface DashboardProps {
  walletAddress: string;
  creatorStats: {
    totalEarned: number
    totalMessages: number
    priceUsdCents: number
    hasVoice: boolean
    nftMint: string | null
  } | null;
  /** Pre-formatted USD price label, e.g. "$3.00". */
  priceLabel: string;
  copiedLink: boolean;
  onOpenSettings: () => void;
  onCopyLink: () => void;
  getAuthHeaders: (walletAddr: string, forceRefresh?: boolean) => Promise<Record<string, string>>;
}

export default function Dashboard({
  walletAddress,
  creatorStats,
  priceLabel,
  copiedLink,
  onOpenSettings,
  onCopyLink,
  getAuthHeaders,
}: DashboardProps) {
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [purchases, setPurchases] = useState<RecentPurchaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'rejected'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');

  // Audio Player State
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Track listeners attached to the current audio element so we can detach them
  // before swapping in a new one — otherwise each replayed message leaks 3
  // listener references + the underlying Audio object.
  const audioListenersRef = useRef<{
    loadedmetadata: () => void
    timeupdate: () => void
    ended: () => void
  } | null>(null);

  const detachAudioListeners = () => {
    const audio = audioRef.current;
    const listeners = audioListenersRef.current;
    if (!audio || !listeners) return;
    audio.removeEventListener('loadedmetadata', listeners.loadedmetadata);
    audio.removeEventListener('timeupdate', listeners.timeupdate);
    audio.removeEventListener('ended', listeners.ended);
    audioListenersRef.current = null;
  };

  const fetchPurchases = useCallback(async (retry = true) => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders(walletAddress);
      const res = await fetch(`/api/creator/analytics/${walletAddress}?days=30`, {
        headers,
        cache: 'no-store'
      });
      if (res.status === 401 && retry) {
        sessionStorage.removeItem(`voclira_session_${walletAddress}`);
        await fetchPurchases(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? t('dashboard.loadMessagesFailed', { status: res.status }));
      }
      const json = await res.json();
      setPurchases(json.recent ?? []);
      setPage(1);
    } catch (err: any) {
      console.error('[Dashboard] Error fetching purchases:', err);
      setError(err.message || t('dashboard.errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [walletAddress, getAuthHeaders, language, t]);

  useEffect(() => {
    if (tab === 'messages' && walletAddress) {
      fetchPurchases();
    }
  }, [tab, walletAddress, fetchPurchases]);

  useEffect(() => {
    return () => {
      detachAudioListeners();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch('/api/sol-price')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!ignore && typeof json?.usd === 'number') setSolUsd(json.usd);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const playAudio = (purchaseId: string, stored: string) => {
    if (playingId === purchaseId) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play().catch(console.error);
        setIsPlaying(true);
      }
      return;
    }

    // Tear down previous audio + its listeners before creating a new one
    detachAudioListeners();
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audioUrl = audioSrcFromStored(stored);
    const newAudio = new Audio(audioUrl);
    audioRef.current = newAudio;
    setPlayingId(purchaseId);
    setIsPlaying(true);
    setCurrentTime(0);
    setDuration(0);

    const onLoadedMetadata = () => {
      setDuration(newAudio.duration || 0);
    };
    const onTimeUpdate = () => {
      setCurrentTime(newAudio.currentTime || 0);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setPlayingId(null);
    };

    newAudio.addEventListener('loadedmetadata', onLoadedMetadata);
    newAudio.addEventListener('timeupdate', onTimeUpdate);
    newAudio.addEventListener('ended', onEnded);
    audioListenersRef.current = {
      loadedmetadata: onLoadedMetadata,
      timeupdate: onTimeUpdate,
      ended: onEnded,
    };

    newAudio.play().catch((e) => {
      console.error('Playback failed', e);
      setIsPlaying(false);
      setPlayingId(null);
    });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const filteredPurchases = purchases.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      const matchWallet = p.buyer_wallet.toLowerCase().includes(term);
      const matchText = p.fan_text?.toLowerCase().includes(term) ?? false;
      return matchWallet || matchText;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredPurchases.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedPurchases = filteredPurchases.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const truncatedAddress = walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 6);
  const fanPageUrl = walletAddress && origin
    ? `${origin}/fan/${walletAddress}`
    : ''
  const shareText = encodeURIComponent(
    t('dashboard.shareTweetText') +
    `${fanPageUrl}\n\n#Voclira #AI`
  )
  const xShareUrl = fanPageUrl
    ? `https://x.com/intent/post?text=${shareText}`
    : '#'
  const linkedInShareUrl = fanPageUrl
    ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(fanPageUrl)}`
    : '#'

  const dockItems = [
    { id: 'overview', icon: LayoutDashboard, label: t('dashboard.overviewTab'), onClick: () => setTab('overview') },
    { id: 'analytics', icon: BarChart3, label: t('dashboard.analyticsTab'), onClick: () => setTab('analytics') },
    { id: 'messages', icon: MessageSquare, label: t('dashboard.messagesTab'), onClick: () => setTab('messages') },
  ]

  return (
    <div className="theme-paper min-h-screen pb-12 bg-background text-foreground">
      {/* Olive header band: nav + dock */}
      <header className="sticky top-0 z-10 bg-voclira-olive text-voclira-cream border-b border-voclira-night/15 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <BrandLogo variant="cream" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-voclira-cream/80">
              <div className="w-3 h-3 rounded-full bg-voclira-cream/90"></div>
              <span>{truncatedAddress}</span>
            </div>
            <LanguageToggle />
            <button
              onClick={onOpenSettings}
              className="p-2 hover:bg-voclira-cream/15 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5 text-voclira-cream" />
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-3 flex justify-center">
          <Dock items={dockItems} activeId={tab} />
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="space-y-8"
        >
        {tab === 'analytics' && (
          <Analytics walletAddress={walletAddress} getAuthHeaders={getAuthHeaders} />
        )}

        {tab === 'overview' && (
          <>
            {/* Stats Row */}
            <motion.div
              className="grid grid-cols-1 md:grid-cols-3 gap-4"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {/* Total Earned */}
              <motion.div variants={staggerItem}>
                <Card className="bg-card border-border p-6 space-y-2 h-full">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">{t('dashboard.totalEarned')}</p>
                      <h3 className="font-display text-4xl font-bold text-primary">
                        {((creatorStats?.totalEarned ?? 0) / 1e9).toFixed(2)} SOL
                      </h3>
                      <p className="text-muted-foreground text-sm mt-1">
                        ≈ ${(((creatorStats?.totalEarned ?? 0) / 1e9) * (solUsd ?? PRICING.SOL_USD_FALLBACK)).toFixed(0)} USD
                      </p>
                    </div>
                    <TrendingUp className="w-6 h-6 text-voclira-terracotta" />
                  </div>
                </Card>
              </motion.div>

              {/* Messages Generated */}
              <motion.div variants={staggerItem}>
                <Card className="bg-card border-border p-6 space-y-2 h-full">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">{t('dashboard.messagesGenerated')}</p>
                      <h3 className="font-display text-4xl font-bold">{creatorStats?.totalMessages ?? 0}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{t('dashboard.allTimeRequests')}</p>
                    </div>
                    <MessageSquare className="w-6 h-6 text-voclira-terracotta" />
                  </div>
                </Card>
              </motion.div>

              {/* Price Per 150 Chars */}
              <motion.div variants={staggerItem}>
                <Card className="bg-card border-border p-6 space-y-2 h-full">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">{t('dashboard.pricePer150', { unitChars: PRICING.UNIT_CHARS })}</p>
                      <h3 className="font-display text-4xl font-bold">{priceLabel}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{t('dashboard.currentRate')}</p>
                    </div>
                    <Coins className="w-6 h-6 text-voclira-terracotta" />
                  </div>
                </Card>
              </motion.div>
            </motion.div>

            {/* Fan Page URL Card */}
            <Card className="bg-card border-border p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{t('dashboard.fanPageLink')}</span>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={fanPageUrl}
                  readOnly
                  placeholder={t('dashboard.connectForLink')}
                  className="w-full bg-black/5 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-muted-foreground focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (!fanPageUrl) return
                      navigator.clipboard.writeText(fanPageUrl)
                      onCopyLink()
                    }}
                    size="sm"
                    className="bg-primary hover:bg-secondary text-primary-foreground font-semibold flex items-center gap-1.5"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-4 h-4" /> {t('dashboard.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> {t('dashboard.copyLink')}
                      </>
                    )}
                  </Button>

                  <a
                    href={xShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-xs font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    {t('dashboard.share')}
                  </a>

                  <a
                    href={linkedInShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#0A66C2] text-white rounded-lg text-xs font-semibold hover:bg-[#004182] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452z" />
                    </svg>
                    {t('dashboard.share')}
                  </a>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                {t('dashboard.shareTextDesc')}
              </p>
            </Card>
          </>
        )}

        {tab === 'messages' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
                  <AudioLines className="w-6 h-6 text-primary" />
                  {t('dashboard.receivedMessages')}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('dashboard.receivedDesc')}
                </p>
              </div>
              <span aria-hidden="true" className="hidden md:block h-px flex-1 bg-voclira-night/15" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchPurchases()}
                disabled={loading}
                className="flex items-center gap-2 border-border bg-card/40 text-foreground hover:bg-black/5 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {t('dashboard.refresh')}
              </Button>
            </div>

            {/* Search & Filter Bar */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card/30 backdrop-blur-md p-4 rounded-xl border border-border/80 shadow-inner">
              {/* Filter Tabs */}
              <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-none">
                <FilterButton active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                  {t('dashboard.all')}
                </FilterButton>
                <FilterButton active={statusFilter === 'completed'} onClick={() => setStatusFilter('completed')}>
                  {t('dashboard.completed')}
                </FilterButton>
                <FilterButton active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')}>
                  {t('dashboard.pending')}
                </FilterButton>
                <FilterButton active={statusFilter === 'rejected'} onClick={() => setStatusFilter('rejected')}>
                  {t('dashboard.rejected')}
                </FilterButton>
              </div>

              {/* Search Input */}
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t('dashboard.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-black/5 border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>

            {/* Messages Container */}
            {loading && purchases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="text-sm font-medium">{t('dashboard.loadingMessages')}</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 text-rose-700 space-y-4 border border-rose-600/30 bg-rose-600/5 rounded-xl backdrop-blur-sm">
                <AlertCircle className="w-10 h-10" />
                <p className="text-sm font-medium">{error}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-rose-600/40 hover:bg-rose-600/10 text-rose-700"
                  onClick={() => fetchPurchases()}
                >
                  {t('dashboard.retry')}
                </Button>
              </div>
            ) : filteredPurchases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border border-border/80 border-dashed rounded-xl bg-card/10 space-y-3">
                <AudioLines className="w-10 h-10 opacity-30 text-primary" />
                <p className="text-sm font-semibold text-foreground/80">{t('dashboard.notFound')}</p>
                <p className="text-xs max-w-md text-center px-4">
                  {purchases.length === 0
                    ? t('dashboard.emptyDesc')
                    : t('dashboard.noMatchDesc')}
                </p>
              </div>
            ) : (
              <>
                <motion.div
                  key={`messages-page-${currentPage}`}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {pagedPurchases.map((p) => (
                    <motion.div key={p.id} variants={staggerItem}>
                      <MessageCard
                        purchase={p}
                        isPlaying={playingId === p.id && isPlaying}
                        currentTime={playingId === p.id ? currentTime : 0}
                        duration={playingId === p.id ? duration : 0}
                        onPlay={() => p.audio_url && playAudio(p.id, p.audio_url)}
                        onSeek={handleSeek}
                      />
                    </motion.div>
                  ))}
                </motion.div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="space-y-2 pt-2">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage === 1}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        {t('dashboard.pagePrev')}
                      </Button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          onClick={() => setPage(n)}
                          className={
                            'w-8 h-8 rounded-lg text-xs font-semibold border transition-all ' +
                            (n === currentPage
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-black/5')
                          }
                        >
                          {n}
                        </button>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage === totalPages}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        {t('dashboard.pageNext')}
                      </Button>
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      {t('dashboard.pageInfo', { current: currentPage, total: totalPages })}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        </motion.div>
        </AnimatePresence>

      </div>
    </div>
  );
}

function formatDate(iso: string, lang: string): string {
  const d = new Date(iso)
  return d.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />
    case 'rejected':
      return <XCircle className="w-4 h-4 text-rose-600" />
    case 'refunded':
      return <HelpCircle className="w-4 h-4 text-amber-600" />
    case 'failed':
      return <AlertCircle className="w-4 h-4 text-orange-600" />
    default:
      return <Clock className="w-4 h-4 text-sky-600 animate-pulse" />
  }
}

function statusLabel(status: string, t: any) {
  switch (status) {
    case 'completed': return t('messageCard.statusCompleted')
    case 'rejected': return t('messageCard.statusRejected')
    case 'refunded': return t('messageCard.statusRefunded')
    case 'failed': return t('messageCard.statusFailed')
    default: return t('messageCard.statusPending')
  }
}

function statusClass(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-600/10 text-emerald-700 border-emerald-600/25'
    case 'rejected':
      return 'bg-rose-600/10 text-rose-700 border-rose-600/25'
    case 'refunded':
      return 'bg-amber-500/15 text-amber-700 border-amber-600/25'
    case 'failed':
      return 'bg-orange-600/10 text-orange-700 border-orange-600/25'
    default:
      return 'bg-sky-600/10 text-sky-700 border-sky-600/25'
  }
}

function formatPlayerTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap ' +
        (active
          ? 'bg-primary border-primary text-primary-foreground shadow-md shadow-primary/20 scale-105'
          : 'bg-black/5 border-border text-muted-foreground hover:text-foreground hover:bg-black/10')
      }
    >
      {children}
    </button>
  )
}

interface MessageCardProps {
  purchase: RecentPurchaseRow
  isPlaying: boolean
  currentTime: number
  duration: number
  onPlay: () => void
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function MessageCard({
  purchase,
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onSeek,
}: MessageCardProps) {
  const { t, language } = useLanguage()
  const buyerTruncated = purchase.buyer_wallet.slice(0, 6) + '...' + purchase.buyer_wallet.slice(-6)
  const amountSol = (purchase.amount_lamports / 1e9).toFixed(3)

  return (
    <Card className="bg-gradient-to-br from-card/90 to-card/50 backdrop-blur-md border-border/80 hover:border-ember-3/30 transition-all duration-300 shadow-md p-5 flex flex-col justify-between space-y-4 h-full">
      {/* Top Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs font-mono text-muted-foreground tracking-tight select-all">
            {t('messageCard.buyer')} {buyerTruncated}
          </span>
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-0.5">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(purchase.created_at, language)}
          </span>
        </div>
        <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusClass(purchase.status)}`}>
          {statusIcon(purchase.status)}
          <span>{statusLabel(purchase.status, t)}</span>
        </div>
      </div>

      {/* Message content */}
      <div className="flex-1">
        <p className="italic font-serif text-sm text-foreground/90 pl-3 border-l-2 border-primary/30 py-1.5 bg-black/5 rounded-r-lg pr-3 leading-relaxed">
          "{purchase.fan_text || t('messageCard.noText')}"
        </p>
      </div>

      {/* Bottom Action Footer Row */}
      <div className="border-t border-border/40 pt-3 flex flex-col space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {t('messageCard.amount')} <strong className="text-foreground">{amountSol} SOL</strong>
          </span>
          {purchase.play_count > 0 && (
            <span className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
              <Volume2 className="w-3.5 h-3.5 text-primary" />
              {t('dashboard.timesPlayed', { count: purchase.play_count })}
            </span>
          )}
        </div>

        {/* Audio Player Row or Status Notification */}
        {purchase.status === 'completed' && purchase.audio_url ? (
          <div className="flex items-center gap-3 bg-black/5 px-3 py-2 rounded-lg border border-border/50">
            {/* Play/Pause Button */}
            <button
              onClick={onPlay}
              className="w-8 h-8 flex items-center justify-center bg-primary hover:bg-secondary text-primary-foreground rounded-full transition-all shrink-0 active:scale-95 shadow-md shadow-primary/10"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            {/* Progress Slider */}
            <div className="flex-1 flex flex-col space-y-1">
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={onSeek}
                className="w-full accent-primary h-1 bg-black/15 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground/80 font-mono">
                <span>{formatPlayerTime(currentTime)}</span>
                <span>{formatPlayerTime(duration)}</span>
              </div>
            </div>
          </div>
        ) : purchase.status === 'rejected' ? (
          <div className="flex items-start gap-2 bg-rose-600/5 border border-rose-600/20 px-3 py-2 rounded-lg text-rose-700/90 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block text-rose-600">{t('messageCard.moderationBlocked')}</span>
              <span className="italic">{purchase.rejection_reason || t('messageCard.blockedBySafety')}</span>
            </div>
          </div>
        ) : purchase.status === 'pending' ? (
          <div className="flex items-center gap-2 bg-sky-600/5 border border-sky-600/15 px-3 py-2 rounded-lg text-sky-700 text-xs">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-sky-600" />
            <span>{t('messageCard.generatingVoiceDesc')}</span>
          </div>
        ) : purchase.status === 'refunded' ? (
          <div className="flex items-center gap-2 bg-amber-600/5 border border-amber-600/15 px-3 py-2 rounded-lg text-amber-700 text-xs">
            <HelpCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{t('messageCard.refundedDesc')}</span>
          </div>
        ) : purchase.status === 'failed' ? (
          <div className="flex items-center gap-2 bg-orange-600/5 border border-orange-600/15 px-3 py-2 rounded-lg text-orange-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-orange-600" />
            <span>{t('messageCard.failedDesc')}</span>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

