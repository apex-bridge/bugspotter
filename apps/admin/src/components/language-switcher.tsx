import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select-radix';
import { Globe } from 'lucide-react';
import { userService } from '../services/user-service';
import { useAuth } from '../contexts/auth-context';
import type { LanguageCode } from '../types';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'kk', name: 'Қазақша' },
] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();

  const isValidLanguage = (code: string): code is LanguageCode =>
    LANGUAGES.some((lang) => lang.code === code);

  const updateLanguageMutation = useMutation({
    mutationFn: (language: string) => {
      if (!isValidLanguage(language)) {
        throw new Error(`Invalid language: ${language}`);
      }
      return userService.updatePreferences({ language });
    },
    onError: () => {
      toast.error(t('errors.failedToSaveLanguage'));
    },
  });

  const handleLanguageChange = (languageCode: string) => {
    // Update UI immediately
    i18n.changeLanguage(languageCode);

    // Persist to localStorage as fallback
    localStorage.setItem('preferredLanguage', languageCode);

    // Save to user preferences if logged in
    if (user) {
      updateLanguageMutation.mutate(languageCode);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Globe className="h-4 w-4 text-gray-500" aria-hidden="true" />
      <Select value={i18n.language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[140px]" aria-label="Select language">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
