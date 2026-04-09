import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';
import kk from './locales/kk.json';

const resources = {
  en: {
    translation: en,
  },
  ru: {
    translation: ru,
  },
  kk: {
    translation: kk,
  },
};

// Get saved language from localStorage or default to English
// Use try-catch for environments where localStorage might not be available
let savedLanguage = 'en';
try {
  savedLanguage = localStorage.getItem('preferredLanguage') || 'en';
} catch {
  console.warn('localStorage not available, using default language');
}

// Initialize i18n SYNCHRONOUSLY - no promises, no async
i18n.use(initReactI18next).init({
  resources,
  lng: savedLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
