import en from './en'

export type Locale = typeof en

const locales: Record<string, Locale> = { en }

let currentLocale: Locale = en

export function setLocale(lang: string) {
  const locale = locales[lang]
  if (locale) {
    currentLocale = locale
  }
}

/** Returns the current locale object. Not reactive — runtime language switching requires a page reload. */
export function useLocale(): Locale {
  return currentLocale
}
