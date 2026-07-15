'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, Language } from '@/lib/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, variables?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({
  children,
  initialLanguage = 'en',
}: {
  children: React.ReactNode;
  // Read from the voclira_lang cookie by the root layout, so the server and the
  // first client paint already use the visitor's language (no EN→TR flash).
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    // localStorage stays authoritative — it covers visitors from before the cookie existed.
    const saved = localStorage.getItem('voclira_lang') as Language;
    if (saved === 'en' || saved === 'tr') {
      setLanguageState(saved);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('voclira_lang', lang);
    // The cookie lets the server render <html lang> and the right copy on the next visit.
    document.cookie = `voclira_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
  };

  const t = (path: string, variables?: Record<string, string | number>): string => {
    const parts = path.split('.');
    let current: any = translations[language];

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        // Fallback to English if not found in current language
        let enFallback: any = translations['en'];
        for (const enPart of parts) {
          if (enFallback && typeof enFallback === 'object' && enPart in enFallback) {
            enFallback = enFallback[enPart];
          } else {
            return path;
          }
        }
        current = enFallback;
        break;
      }
    }

    if (typeof current !== 'string') {
      return path;
    }

    let text = current;
    if (variables) {
      Object.entries(variables).forEach(([key, val]) => {
        text = text.replace(new RegExp(`{${key}}`, 'g'), String(val));
      });
    }

    return text;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
