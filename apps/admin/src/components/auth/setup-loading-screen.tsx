import { useTranslation } from 'react-i18next';

export function SetupLoadingScreen() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center" role="status" aria-live="polite">
        <div
          className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"
          aria-hidden="true"
        ></div>
        <p className="mt-4 text-gray-600">{t('auth.checkingSystemStatus')}</p>
      </div>
    </div>
  );
}
