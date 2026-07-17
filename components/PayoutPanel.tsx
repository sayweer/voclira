'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/LanguageProvider'
import { PAYOUT } from '@/lib/limits'
import type { PayoutRequest, PayoutMethod, PayoutStatus } from '@/types'

interface PayoutPanelProps {
  walletAddress: string
  getAuthHeaders: (walletAddr: string, forceRefresh?: boolean) => Promise<Record<string, string>>
}

const STATUS_STYLES: Record<PayoutStatus, string> = {
  requested: 'bg-amber-500/15 text-amber-700',
  approved: 'bg-blue-500/15 text-blue-700',
  processing: 'bg-blue-500/15 text-blue-700',
  paid: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-red-500/15 text-red-700',
  cancelled: 'bg-neutral-500/15 text-neutral-600',
}

export default function PayoutPanel({ walletAddress, getAuthHeaders }: PayoutPanelProps) {
  const { t } = useLanguage()
  const [balanceUsdCents, setBalanceUsdCents] = useState<number | null>(null)
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [method, setMethod] = useState<PayoutMethod>('sol_transfer')
  const [amountUsd, setAmountUsd] = useState('')
  const [destWallet, setDestWallet] = useState('')
  const [iban, setIban] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const minUsd = PAYOUT.MIN_USD_CENTS / 100

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders(walletAddress)
      const res = await fetch(`/api/payout/list?walletAddress=${walletAddress}`, {
        headers,
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        setBalanceUsdCents(typeof data.balanceUsdCents === 'number' ? data.balanceUsdCents : 0)
        setRequests(Array.isArray(data.requests) ? data.requests : [])
      }
    } catch {
      /* non-blocking */
    }
  }, [walletAddress, getAuthHeaders])

  useEffect(() => {
    load()
  }, [load])

  const balanceLabel = balanceUsdCents != null ? `$${(balanceUsdCents / 100).toFixed(2)}` : '—'

  const submit = async () => {
    setError(null)
    setSuccess(false)
    const cents = Math.round(parseFloat(amountUsd) * 100)
    if (!Number.isFinite(cents) || cents < PAYOUT.MIN_USD_CENTS) {
      setError(t('payout.minError', { min: minUsd }))
      return
    }
    setSubmitting(true)
    try {
      const headers = await getAuthHeaders(walletAddress)
      const body: Record<string, unknown> = { walletAddress, amountUsdCents: cents, method }
      if (method === 'sol_transfer') {
        body.destWallet = destWallet.trim() || walletAddress
      } else {
        body.bankDetails = { iban: iban.trim(), accountHolder: accountHolder.trim() }
      }
      const res = await fetch('/api/payout/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(true)
        setAmountUsd('')
        setIban('')
        setAccountHolder('')
        await load()
      } else if (data.code === 'INSUFFICIENT_BALANCE') {
        setError(t('payout.insufficient'))
      } else if (data.code === 'INVALID_IBAN') {
        setError(t('payout.invalidIban'))
      } else {
        setError(data.error ?? t('payout.failed'))
      }
    } catch {
      setError(t('payout.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="bg-card border-border p-6 space-y-5">
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold">{t('payout.title')}</span>
        <div className="text-right">
          <p className="font-display text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t('payout.availableBalance')}
          </p>
          <p className="font-display text-2xl font-bold">{balanceLabel}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          {(['sol_transfer', 'bank_transfer'] as PayoutMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-all ${
                method === m
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:border-primary/50'
              }`}
            >
              {m === 'sol_transfer' ? t('payout.methodSol') : t('payout.methodBank')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <input
            type="number"
            min={minUsd}
            step={1}
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            placeholder={t('payout.amountPlaceholder', { min: minUsd })}
            className="w-32 bg-input border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {method === 'sol_transfer' ? (
          <input
            type="text"
            value={destWallet}
            onChange={(e) => setDestWallet(e.target.value)}
            placeholder={t('payout.destWalletPlaceholder')}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary"
          />
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder={t('payout.ibanPlaceholder')}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
            <input
              type="text"
              value={accountHolder}
              onChange={(e) => setAccountHolder(e.target.value)}
              placeholder={t('payout.accountHolderPlaceholder')}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        )}

        <Button
          onClick={submit}
          disabled={submitting}
          className="bg-primary hover:bg-secondary text-primary-foreground font-semibold w-full disabled:opacity-50"
        >
          {submitting ? t('payout.requesting') : t('payout.requestButton')}
        </Button>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {success && <p className="text-xs text-emerald-600 font-medium">{t('payout.success')}</p>}
      </div>

      {requests.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="font-display text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t('payout.historyTitle')}
          </p>
          <div className="space-y-1.5">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">${(r.amount_usd_cents / 100).toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.method === 'sol_transfer' ? t('payout.methodSol') : t('payout.methodBank')}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status]}`}
                >
                  {t(`payout.status.${r.status}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
