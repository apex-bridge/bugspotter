import type { EmailLocale } from '../types/organization';

/** Derive the email locale from the current UI language. */
export function getEmailLocale(uiLanguage: string | undefined): EmailLocale {
  if (uiLanguage?.startsWith('kk')) {
    return 'kk';
  }
  if (uiLanguage?.startsWith('ru')) {
    return 'ru';
  }
  return 'en';
}
