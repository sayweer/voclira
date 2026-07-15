'use client'

import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BorderBeam } from '@/components/ui/border-beam'
import { Download, Loader2, TrendingUp } from 'lucide-react'
import type {
  AnalyticsRangeDays,
  AnalyticsResponse,
  RecentPurchaseRow,
} from '@/types'
import { useLanguage } from '@/components/LanguageProvider'

interface AnalyticsProps {
  walletAddress: string
  getAuthHeaders: (walletAddr: string, forceRefresh?: boolean) => Promise<Record<string, string>>
}

const RANGES: AnalyticsRangeDays[] = [7, 30, 90]

function lamportsToSol(n: number, fractionDigits = 4): string {
  return (n / 1_000_000_000).toFixed(fractionDigits)
}

function truncateWallet(w: string): string {
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

function formatDate(iso: string, lang: string): string {
  const d = new Date(iso)
  return d.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-600/10 text-emerald-700 border-emerald-600/25'
    case 'rejected':
      return 'bg-rose-600/10 text-rose-700 border-rose-600/25'
    case 'refunded':
      return 'bg-amber-500/15 text-amber-700 border-amber-600/25'
    default:
      return 'bg-zinc-500/10 text-zinc-600 border-zinc-500/25'
  }
}

function statusLabel(status: string, t: any) {
  switch (status) {
    case 'completed': return t('messageCard.statusCompleted')
    case 'rejected': return t('messageCard.statusRejected')
    case 'refunded': return t('messageCard.statusRefunded')
    default: return t('messageCard.statusPending')
  }
}

export default function Analytics({ walletAddress, getAuthHeaders }: AnalyticsProps) {
  const { t } = useLanguage()
  const [days, setDays] = useState<AnalyticsRangeDays>(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let ignore = false

    const run = async (retry = true) => {
      setLoading(true)
      setError(null)
      try {
        const headers = await getAuthHeaders(walletAddress)
        const res = await fetch(
          `/api/creator/analytics/${walletAddress}?days=${days}`,
          {
            headers,
            cache: 'no-store',
          }
        )
        if (ignore) return
        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddress}`)
          await run(false)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          setError(body?.error ?? t('dashboard.errorLoading'))
          setData(null)
          return
        }
        const json = (await res.json()) as AnalyticsResponse
        if (ignore) return
        setData(json)
      } catch {
        if (!ignore) {
          setError(t('dashboard.errorLoading'))
          setData(null)
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    run()
    return () => {
      ignore = true
    }
  }, [walletAddress, days, getAuthHeaders, t])

  const handleExport = async () => {
    setExporting(true)
    const performExport = async (retry = true) => {
      try {
        const headers = await getAuthHeaders(walletAddress)
        const res = await fetch(
          `/api/creator/analytics/${walletAddress}/export?days=${days}`,
          {
            headers,
          }
        )
        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddress}`)
          await performExport(false)
          return
        }
        if (!res.ok) {
          throw new Error(`Export failed (HTTP ${res.status})`)
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `voclira-${days}d.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } catch {
        alert(t('settings.updateFailed'))
      } finally {
        setExporting(false)
      }
    }
    performExport()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card/40 p-1">
          {RANGES.map((r) => {
            const active = r === days
            return (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={
                  'px-4 py-1.5 text-sm font-medium rounded-md transition-colors ' +
                  (active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {r}d
              </button>
            )
          })}
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting || loading || !data}
          variant="outline"
          size="sm"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {exporting ? t('analytics.exporting') : t('analytics.exportCsv')}
        </Button>
      </div>

      {loading && <SkeletonGrid />}

      {!loading && error && (
        <Card className="bg-rose-600/10 border-rose-600/30 p-6">
          <p className="text-sm text-rose-700">{error}</p>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          <SummaryCards data={data} />
          <ChartCard data={data} days={days} />
          <RecentTable rows={data.recent.slice(0, 25)} />
        </>
      )}
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="bg-card border-border p-6">
          <div className="h-3 w-24 bg-muted-foreground/20 rounded mb-3 animate-pulse" />
          <div className="h-8 w-32 bg-muted-foreground/20 rounded animate-pulse" />
        </Card>
      ))}
    </div>
  )
}

function SummaryCards({ data }: { data: AnalyticsResponse }) {
  const { t } = useLanguage()
  const s = data.summary
  const successPct = (s.success_rate * 100).toFixed(1)

  const cards = [
    {
      label: t('analytics.grossRevenue'),
      value: `${lamportsToSol(s.total_gross_lamports, 4)} SOL`,
      sub: `${t('analytics.feePaid')} ${lamportsToSol(s.total_platform_fee_lamports, 4)} SOL`,
    },
    {
      label: t('analytics.netEarned'),
      value: `${lamportsToSol(s.total_net_lamports, 4)} SOL`,
      sub: t('analytics.netSolAfterFee'),
    },
    {
      label: t('analytics.uniqueFans'),
      value: String(s.unique_fans),
      sub: t('analytics.fansSubtext'),
    },
    {
      label: t('analytics.successRate'),
      value: `${successPct}%`,
      sub: t('analytics.rejectedSubtext', { count: s.total_rejected }),
    },
    {
      label: t('analytics.avgPrice'),
      value: `${lamportsToSol(s.avg_price_lamports, 4)} SOL`,
      sub: t('analytics.completedSubtext'),
    },
    {
      label: t('analytics.totalPlays'),
      value: String(s.total_plays),
      sub: t('analytics.playsSubtext'),
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((c, idx) => (
        <Card key={idx} className="bg-card border-border p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-display text-muted-foreground text-xs uppercase tracking-[0.25em] mb-2">
                {c.label}
              </p>
              <h3 className="font-display text-2xl font-bold">{c.value}</h3>
              <p className="text-muted-foreground text-xs mt-1">{c.sub}</p>
            </div>
            {idx === 0 && <TrendingUp className="w-5 h-5 text-primary" />}
          </div>
        </Card>
      ))}
    </div>
  )
}

function ChartCard({ data, days }: { data: AnalyticsResponse; days: AnalyticsRangeDays }) {
  const { t, language } = useLanguage()
  if (data.summary.total_completed === 0 && data.summary.total_rejected === 0) {
    return (
      <Card className="bg-card border-border p-12">
        <div className="flex flex-col items-center justify-center text-center gap-2">
          <div className="text-3xl">📈</div>
          <p className="font-semibold">{t('analytics.noActivity')}</p>
          <p className="text-sm text-muted-foreground">
            {t('analytics.noActivityDesc', { days })}
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border p-6">
      <div className="mb-4">
        <h3 className="font-display text-lg font-semibold">{t('analytics.activityOverTime')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('analytics.activityDesc')}
        </p>
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.timeseries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(42, 14, 14, 0.10)" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => d.slice(5)}
              stroke="#6F4E3D"
              fontSize={12}
            />
            <YAxis
              yAxisId="left"
              stroke="#D53E0F"
              fontSize={12}
              tickFormatter={(v: number) => (v / 1e9).toFixed(2)}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#607456"
              fontSize={12}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: '#FFFCF5',
                border: '1px solid rgba(42, 14, 14, 0.15)',
                borderRadius: 8,
                fontSize: 12,
                color: '#2A0E0E',
              }}
              labelStyle={{ color: '#2A0E0E' }}
              formatter={(value, name) => {
                const localizedName = name === 'Net SOL' ? t('analytics.netSol') : t('analytics.messagesName')
                if (name === 'Net SOL' && typeof value === 'number') {
                  return [`${(value / 1e9).toFixed(4)} SOL`, localizedName]
                }
                return [String(value), localizedName]
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="circle"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="net_lamports"
              name={t('analytics.netSol')}
              stroke="#D53E0F"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="messages"
              name={t('analytics.messagesName')}
              stroke="#607456"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function RecentTable({ rows }: { rows: RecentPurchaseRow[] }) {
  const { t, language } = useLanguage()
  if (rows.length === 0) {
    return (
      <Card className="bg-card border-border p-6">
        <p className="text-sm text-muted-foreground">{t('analytics.noRecentActivity')}</p>
      </Card>
    )
  }

  return (
    <Card className="relative overflow-hidden bg-card border-border p-6">
      <BorderBeam lightColor="#D53E0F" lightWidth={250} duration={10} />
      <h3 className="font-display text-lg font-semibold mb-4">{t('analytics.recentActivity')}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border font-display text-xs uppercase tracking-[0.2em]">
              <th className="pb-2 pr-4 font-normal">{t('analytics.date')}</th>
              <th className="pb-2 pr-4 font-normal">{t('analytics.fan')}</th>
              <th className="pb-2 pr-4 font-normal text-right">{t('analytics.netSol')}</th>
              <th className="pb-2 pr-4 font-normal text-right">{t('analytics.plays')}</th>
              <th className="pb-2 font-normal">{t('analytics.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const net = r.amount_lamports - r.platform_fee_lamports
              return (
                <tr key={r.id} className="border-b border-border/30 last:border-0">
                  <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                    {formatDate(r.created_at, language)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {truncateWallet(r.buyer_wallet)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {r.status === 'completed' ? lamportsToSol(net, 4) : '—'}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {r.status === 'completed' ? r.play_count : '—'}
                  </td>
                  <td className="py-3">
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ' +
                        statusBadgeClass(r.status)
                      }
                      title={r.rejection_reason ?? undefined}
                    >
                      {statusLabel(r.status, t)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
