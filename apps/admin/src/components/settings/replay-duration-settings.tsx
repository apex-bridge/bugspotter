/**
 * Session Replay Duration Settings Section
 * Controls buffer duration for replay capture
 */

import { SettingsSection } from './settings-section';
import { useTranslation } from 'react-i18next';
import { Clock, AlertCircle } from 'lucide-react';
import { Input } from '../ui/input';
import type { InstanceSettings } from '../../types';

// Replay duration constraints (in seconds)
const MIN_REPLAY_DURATION = 5;
const MAX_REPLAY_DURATION = 60;
const DEFAULT_REPLAY_DURATION = 15;
const RECOMMENDED_MAX_DURATION = 30;
const DURATION_STEP = 5;

interface ReplayDurationSettingsProps {
  formData: Partial<InstanceSettings>;
  updateField: <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => void;
}

export function ReplayDurationSettings({ formData, updateField }: ReplayDurationSettingsProps) {
  const { t } = useTranslation();
  const duration = formData.replay_duration ?? DEFAULT_REPLAY_DURATION;

  const handleDurationChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= MIN_REPLAY_DURATION && parsed <= MAX_REPLAY_DURATION) {
      updateField('replay_duration', parsed);
    }
  };

  return (
    <SettingsSection
      title={t('settings.replayDuration.title')}
      description={t('settings.replayDuration.description')}
    >
      <div className="space-y-6">
        {/* Duration Input */}
        <div className="space-y-2">
          <label htmlFor="replay-duration" className="block text-sm font-medium text-gray-700">
            {t('settings.replayDuration.bufferDuration')}
          </label>
          <Input
            id="replay-duration"
            type="number"
            min={MIN_REPLAY_DURATION}
            max={MAX_REPLAY_DURATION}
            step={DURATION_STEP}
            value={duration}
            onChange={(e) => handleDurationChange(e.target.value)}
            className="max-w-xs"
          />
          <p className="text-sm text-gray-500">
            {t('settings.replayDuration.recommended', {
              default: DEFAULT_REPLAY_DURATION,
              max: RECOMMENDED_MAX_DURATION,
              min: MIN_REPLAY_DURATION,
              absMax: MAX_REPLAY_DURATION,
            })}
          </p>
        </div>

        {/* Warning for High Values */}
        {duration > RECOMMENDED_MAX_DURATION && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-amber-900 mb-1">
                  {t('settings.replayDuration.highMemoryWarning')}
                </h4>
                <p className="text-sm text-amber-800">
                  {t('settings.replayDuration.highMemoryDescription', {
                    max: RECOMMENDED_MAX_DURATION,
                  })}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                {t('settings.replayDuration.durationTradeoff')}
              </h4>
              <p className="text-sm text-blue-800 mb-3">
                {t('settings.replayDuration.durationTradeoffDescription')}
              </p>
              <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>{t('settings.replayDuration.duration5to10', { min: MIN_REPLAY_DURATION })}</li>
                <li>
                  {t('settings.replayDuration.duration15', { default: DEFAULT_REPLAY_DURATION })}
                </li>
                <li>
                  {t('settings.replayDuration.duration30', {
                    recommended: RECOMMENDED_MAX_DURATION,
                  })}
                </li>
                <li>{t('settings.replayDuration.duration60', { max: MAX_REPLAY_DURATION })}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
