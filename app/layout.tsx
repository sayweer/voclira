import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { Fraunces } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import { WalletProviderDynamic } from '@/components/WalletProviderDynamic'
import { LanguageProvider } from '@/components/LanguageProvider'
import { LangSync } from '@/components/LangSync'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Voclira - License Your Voice on Solana',
  description: 'Web3 voice licensing platform. Create your voice clone, earn SOL from fan requests.',
  icons: {
    icon: '/icon.png',
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Set by LanguageProvider's setLanguage — lets SSR emit the right lang + copy.
  const lang = cookies().get('voclira_lang')?.value === 'tr' ? 'tr' : 'en'
  return (
    <html lang={lang} className={`dark ${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">
        <WalletProviderDynamic>
          <LanguageProvider initialLanguage={lang}>
            <LangSync />
            {children}
          </LanguageProvider>
        </WalletProviderDynamic>
      </body>
    </html>
  )
}
