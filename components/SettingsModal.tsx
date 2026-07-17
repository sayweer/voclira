'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Loader2, ShieldCheck, X, Trash2 } from 'lucide-react';
import { VoiceLicenseBadge } from '@/components/ui/voice-license-badge';
import { Button } from '@/components/ui/button';
import { SlideButton } from '@/components/ui/slide-button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/components/LanguageProvider';
import { PRICING, PRICING_USD, isValidPriceUsdCents } from '@/lib/limits';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  selectedPrice: number;
  onDisconnect: () => void;
  onRerecord: () => void;
  onPriceUpdate: (priceUsdCents: number) => void;
  onPriceUpdateSuccess: (newCents: number) => void;
  blockAdult: boolean;
  blockProfanity: boolean;
  blockPolitical: boolean;
  onFilterUpdate: (key: 'blockAdult' | 'blockProfanity' | 'blockPolitical', value: boolean) => void;
  hasVoice: boolean;
  onDeleteVoice: () => Promise<void>;
  statsLoading: boolean;
  getAuthHeaders: (walletAddr: string, forceRefresh?: boolean) => Promise<Record<string, string>>;
  nftMint: string | null;
  onActivateLicense: () => void;
  mintingLicense: boolean;
  licenseError: string | null;
}

export default function SettingsModal({
  isOpen,
  onClose,
  walletAddress,
  selectedPrice,
  onDisconnect,
  onRerecord,
  onPriceUpdate,
  onPriceUpdateSuccess,
  blockAdult,
  blockProfanity,
  blockPolitical,
  onFilterUpdate,
  hasVoice,
  onDeleteVoice,
  statsLoading,
  getAuthHeaders,
  nftMint,
  onActivateLicense,
  mintingLicense,
  licenseError,
}: SettingsModalProps) {
  const { t, language } = useLanguage();
  const [newPrice, setNewPrice] = useState(selectedPrice);
  const [isUpdating, setIsUpdating] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceSuccess, setPriceSuccess] = useState(false);

  useEffect(() => {
    setNewPrice(selectedPrice);
  }, [selectedPrice]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handlePriceUpdate = async () => {
    // newPrice is USD cents; isValidPriceUsdCents also rejects the NaN an emptied input produces.
    if (!isValidPriceUsdCents(newPrice)) {
      setPriceError(t('settings.priceRangeError', {
        min: PRICING_USD.MIN_PRICE_USD_CENTS / 100,
        max: PRICING_USD.MAX_PRICE_USD_CENTS / 100,
      }));
      return;
    }
    setIsUpdating(true);
    setPriceError(null);
    setPriceSuccess(false);

    const performUpdate = async (retry = true) => {
      try {
        const headers = await getAuthHeaders(walletAddress);
        const res = await fetch('/api/creator/update-price', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            walletAddress,
            priceInUsdCents: newPrice,
          }),
        });

        if (res.status === 401 && retry) {
          sessionStorage.removeItem(`voclira_session_${walletAddress}`);
          await performUpdate(false);
          return;
        }

        if (res.ok) {
          setPriceSuccess(true);
          onPriceUpdate(newPrice);
          onPriceUpdateSuccess(newPrice);
          setTimeout(() => setPriceSuccess(false), 3000);
        } else {
          setPriceError(t('settings.updateFailed'));
        }
      } catch {
        setPriceError(t('settings.networkError'));
      } finally {
        setIsUpdating(false);
      }
    };
    performUpdate();
  };

  return (
    <AnimatePresence>
      {isOpen && (
    <>
      {/* Overlay */}
      <motion.div
        className="fixed inset-0 bg-voclira-night/60 backdrop-blur-sm z-40"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />

      {/* Modal */}
      <motion.div
        className="theme-paper fixed inset-0 flex items-center justify-center p-4 z-50"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Card className="text-foreground bg-card border border-voclira-night/15 w-full max-w-md rounded-2xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden shadow-[0_24px_48px_-12px_rgba(42,14,14,0.45)]">
          {/* Header — olive masthead */}
          <div className="flex items-center justify-between px-6 py-4 bg-voclira-olive shrink-0">
            <h2 className="font-display text-xl font-bold tracking-tight text-voclira-cream">{t('settings.title')}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-voclira-cream/80 hover:text-voclira-cream hover:bg-voclira-cream/15 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7">
            {/* Voice Management Section */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.25em] text-voclira-burgundy">
                {t('settings.voiceManagement')}
                <span className="h-px flex-1 bg-voclira-night/10" aria-hidden="true" />
              </h3>
              {hasVoice ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-voclira-olive/15 border border-voclira-olive/40 mb-3">
                  <div className="w-2 h-2 rounded-full bg-voclira-olive animate-pulse" />
                  <span className="text-sm text-foreground font-medium">{t('settings.voiceCloneActive')}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-voclira-terracotta/15 border border-voclira-terracotta/45 mb-3">
                  <div className="w-2 h-2 rounded-full bg-voclira-terracotta" />
                  <span className="text-sm text-voclira-burgundy font-medium">{t('settings.noVoiceClone')}</span>
                </div>
              )}
              <SlideButton
                label={t('settings.recordNewSample')}
                color="olive"
                onConfirm={onRerecord}
              />
              <SlideButton
                label={t('settings.deleteVoice')}
                color="burgundy"
                onConfirm={onDeleteVoice}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.permanentRemoveWarn')}
              </p>
            </div>

            {/* Pricing Section */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.25em] text-voclira-burgundy">
                {t('settings.pricing')}
                <span className="h-px flex-1 bg-voclira-night/10" aria-hidden="true" />
              </h3>
              <label className="text-sm text-muted-foreground">
                {t('settings.pricePer150', { unitChars: PRICING.UNIT_CHARS })}
              </label>
              <div className="flex gap-2 items-center">
                {statsLoading ? (
                  <div className="animate-pulse w-20 h-9 rounded-lg bg-muted" />
                ) : (
                  <input
                    type="number"
                    min={PRICING_USD.MIN_PRICE_USD_CENTS / 100}
                    max={PRICING_USD.MAX_PRICE_USD_CENTS / 100}
                    step={0.5}
                    value={Number.isFinite(newPrice) ? newPrice / 100 : ''}
                    onChange={(e) => setNewPrice(Math.round(parseFloat(e.target.value) * 100))}
                    className="w-20 bg-input border border-voclira-night/20 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-voclira-olive focus:ring-2 focus:ring-voclira-olive/25 transition-colors"
                  />
                )}
                <span className="text-sm text-muted-foreground">USD</span>
                <Button
                  onClick={handlePriceUpdate}
                  disabled={isUpdating || statsLoading}
                  className="bg-voclira-olive hover:bg-voclira-olive/90 text-voclira-cream font-semibold px-4 disabled:opacity-50"
                >
                  {isUpdating ? t('settings.updating') : t('settings.update')}
                </Button>
              </div>
              {priceError && (
                <p className="text-xs text-destructive">{priceError}</p>
              )}
              {priceSuccess && (
                <p className="text-xs text-voclira-olive font-medium">{t('settings.updateSuccess')}</p>
              )}
            </div>

            {/* Brand Safety Filters Section */}
            <div className="space-y-4">
              <h3 className="flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.25em] text-voclira-burgundy">
                {t('settings.brandSafety')}
                <span className="h-px flex-1 bg-voclira-night/10" aria-hidden="true" />
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settings.brandSafetyDesc')}
              </p>

              {/* Toggle Rows */}
              <div className="space-y-3">
                {/* Adult Content Toggle */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 text-sm cursor-pointer">
                    <span>{t('settings.blockAdult')}</span>
                  </label>
                  {statsLoading ? (
                    <div className="animate-pulse w-12 h-6 rounded-full bg-muted" />
                  ) : (
                    <div
                      onClick={() => onFilterUpdate('blockAdult', !blockAdult)}
                      className={`w-12 h-6 rounded-full transition-colors flex items-center cursor-pointer ${
                        blockAdult ? 'bg-voclira-olive' : 'bg-voclira-night/15'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-card border border-voclira-night/10 shadow-sm transition-transform ${
                          blockAdult ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </div>
                  )}
                </div>

                {/* Profanity Toggle */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 text-sm cursor-pointer">
                    <span>{t('settings.blockProfanity')}</span>
                  </label>
                  {statsLoading ? (
                    <div className="animate-pulse w-12 h-6 rounded-full bg-muted" />
                  ) : (
                    <div
                      onClick={() => onFilterUpdate('blockProfanity', !blockProfanity)}
                      className={`w-12 h-6 rounded-full transition-colors flex items-center cursor-pointer ${
                        blockProfanity ? 'bg-voclira-olive' : 'bg-voclira-night/15'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-card border border-voclira-night/10 shadow-sm transition-transform ${
                          blockProfanity ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </div>
                  )}
                </div>

                {/* Political Content Toggle */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 text-sm cursor-pointer">
                    <span>{t('settings.blockPolitical')}</span>
                  </label>
                  {statsLoading ? (
                    <div className="animate-pulse w-12 h-6 rounded-full bg-muted" />
                  ) : (
                    <div
                      onClick={() => onFilterUpdate('blockPolitical', !blockPolitical)}
                      className={`w-12 h-6 rounded-full transition-colors flex items-center cursor-pointer ${
                        blockPolitical ? 'bg-voclira-olive' : 'bg-voclira-night/15'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-card border border-voclira-night/10 shadow-sm transition-transform ${
                          blockPolitical ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Voice License Section */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.25em] text-voclira-burgundy">
                {t('license.title')}
                <span className="h-px flex-1 bg-voclira-night/10" aria-hidden="true" />
              </h3>
              {nftMint ? (
                <VoiceLicenseBadge
                  href={`https://solscan.io/account/${nftMint}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : '?cluster=devnet'}`}
                  language={language as 'tr' | 'en'}
                />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{t('license.activateDesc')}</p>
                  <Button
                    onClick={onActivateLicense}
                    disabled={mintingLicense}
                    className="w-full bg-voclira-terracotta hover:bg-voclira-terracotta/90 text-voclira-cream font-semibold flex items-center gap-2"
                  >
                    {mintingLicense ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('license.minting')}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        {t('license.activateButton')}
                      </>
                    )}
                  </Button>
                  {licenseError && (
                    <div className="flex items-start gap-2 bg-destructive/5 border border-destructive/20 px-3 py-2 rounded-lg text-destructive text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 text-destructive mt-0.5" />
                      <span>{licenseError}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Account Section — danger zone */}
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <h3 className="font-display text-xs font-semibold uppercase tracking-[0.25em] text-destructive">
                {t('settings.account')}
              </h3>
              <SlideButton
                label={t('settings.disconnectWallet')}
                color="burgundy"
                onConfirm={() => {
                  onDisconnect();
                  onClose();
                }}
              />
            </div>

            {/* Footer */}
            <div className="text-center text-xs text-muted-foreground pt-4 border-t border-voclira-night/10">
              {t('settings.versionText')}
            </div>
          </div>
        </Card>
      </motion.div>
    </>
      )}
    </AnimatePresence>
  );
}
