/**
 * Session Replay Quality Settings Section
 * Controls visual fidelity vs storage cost tradeoffs
 */

import { useTranslation, Trans } from 'react-i18next';
import { SettingsSection } from './settings-section';
import { AlertCircle, HardDrive } from 'lucide-react';
import type { InstanceSettings } from '../../types';

interface ReplayQualitySettingsProps {
  formData: Partial<InstanceSettings>;
  updateField: <K extends keyof InstanceSettings>(field: K, value: InstanceSettings[K]) => void;
}

// Replay size impact constants (multipliers applied to base size)
const BASE_REPLAY_SIZE_KB = 100; // Baseline replay size without any quality options
const STYLESHEETS_MULTIPLIER = 0.3; // +30% size impact for inline stylesheets
const IMAGES_MULTIPLIER = 3.0; // +300% size impact for inline images
const FONTS_MULTIPLIER = 0.15; // +15% size impact for font collection
const CANVAS_MULTIPLIER = 1.0; // +100% size impact for canvas recording

export function ReplayQualitySettings({ formData, updateField }: ReplayQualitySettingsProps) {
  const { t } = useTranslation();

  // Calculate estimated size impact based on enabled quality options
  const estimateSizeImpact = () => {
    let multiplier = 1;

    if (formData.replay_inline_stylesheets) {
      multiplier += STYLESHEETS_MULTIPLIER;
    }
    if (formData.replay_inline_images) {
      multiplier += IMAGES_MULTIPLIER;
    }
    if (formData.replay_collect_fonts) {
      multiplier += FONTS_MULTIPLIER;
    }
    if (formData.replay_record_canvas) {
      multiplier += CANVAS_MULTIPLIER;
    }

    const estimatedSize = Math.round(BASE_REPLAY_SIZE_KB * multiplier);
    return estimatedSize;
  };

  const sizeImpact = estimateSizeImpact();

  return (
    <SettingsSection
      title={t('settings.replayQuality.title')}
      description={t('settings.replayQuality.description')}
    >
      <div className="space-y-6">
        {/* Visual Fidelity Options */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-gray-700">
            {t('settings.replayQuality.visualFidelity')}
          </h4>

          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={formData.replay_inline_stylesheets ?? true}
              onChange={(e) => updateField('replay_inline_stylesheets', e.target.checked)}
              className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">
                  {t('settings.replayQuality.inlineStylesheets')}
                </p>
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded">
                  {t('settings.replayQuality.recommended')}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.replayQuality.inlineStylesheetsDescription')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.replayQuality.inlineStylesheetsImpact')}
              </p>
            </div>
          </label>

          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={formData.replay_inline_images ?? false}
              onChange={(e) => updateField('replay_inline_images', e.target.checked)}
              className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">
                  {t('settings.replayQuality.inlineImages')}
                </p>
                <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-800 rounded">
                  {t('settings.replayQuality.highCost')}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.replayQuality.inlineImagesDescription')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.replayQuality.inlineImagesImpact')}
              </p>
            </div>
          </label>

          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={formData.replay_collect_fonts ?? true}
              onChange={(e) => updateField('replay_collect_fonts', e.target.checked)}
              className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">
                  {t('settings.replayQuality.collectFonts')}
                </p>
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded">
                  {t('settings.replayQuality.recommended')}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.replayQuality.collectFontsDescription')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.replayQuality.collectFontsImpact')}
              </p>
            </div>
          </label>
        </div>

        {/* Advanced Recording Options */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="text-sm font-semibold text-gray-700">
            {t('settings.replayQuality.advancedRecording')}
          </h4>

          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={formData.replay_record_canvas ?? false}
              onChange={(e) => updateField('replay_record_canvas', e.target.checked)}
              className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">
                  {t('settings.replayQuality.recordCanvas')}
                </p>
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                  {t('settings.replayQuality.specialized')}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.replayQuality.recordCanvasDescription')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.replayQuality.recordCanvasImpact')}
              </p>
            </div>
          </label>

          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={formData.replay_record_cross_origin_iframes ?? false}
              onChange={(e) => updateField('replay_record_cross_origin_iframes', e.target.checked)}
              className="mt-1 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">
                  {t('settings.replayQuality.recordCrossOriginIframes')}
                </p>
                <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">
                  {t('settings.replayQuality.privacyRisk')}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.replayQuality.recordCrossOriginIframesDescription')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.replayQuality.recordCrossOriginIframesImpact')}
              </p>
            </div>
          </label>
        </div>

        {/* Performance Tuning */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="text-sm font-semibold text-gray-700">
            {t('settings.replayQuality.performanceTuning')}
          </h4>
          <p className="text-xs text-gray-500 mb-4">
            {t('settings.replayQuality.performanceTuningDescription')}
          </p>

          <div className="space-y-3">
            <div>
              <label htmlFor="mousemove-sampling" className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {t('settings.replayQuality.mouseMovementThrottle')}
                </span>
                <span className="text-xs text-gray-500">
                  {t('settings.replayQuality.mouseFps', {
                    ms: formData.replay_sampling_mousemove ?? 50,
                    fps: Math.round(1000 / (formData.replay_sampling_mousemove ?? 50)),
                  })}
                </span>
              </label>
              <input
                id="mousemove-sampling"
                type="range"
                min="25"
                max="200"
                step="25"
                value={formData.replay_sampling_mousemove ?? 50}
                onChange={(e) =>
                  updateField('replay_sampling_mousemove', parseInt(e.target.value, 10))
                }
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer mt-2"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{t('settings.replayQuality.mouseFps', { ms: 25, fps: 40 })}</span>
                <span className="text-green-600 font-medium">
                  {t('settings.replayQuality.fpsRecommended', { ms: 50, fps: 20 })}
                </span>
                <span>{t('settings.replayQuality.mouseFps', { ms: 200, fps: 5 })}</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {t('settings.replayQuality.mouseMovementDescription')}
              </p>
            </div>

            <div>
              <label htmlFor="scroll-sampling" className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {t('settings.replayQuality.scrollEventThrottle')}
                </span>
                <span className="text-xs text-gray-500">
                  {t('settings.replayQuality.scrollFps', {
                    ms: formData.replay_sampling_scroll ?? 100,
                    fps: Math.round(1000 / (formData.replay_sampling_scroll ?? 100)),
                  })}
                </span>
              </label>
              <input
                id="scroll-sampling"
                type="range"
                min="50"
                max="500"
                step="50"
                value={formData.replay_sampling_scroll ?? 100}
                onChange={(e) =>
                  updateField('replay_sampling_scroll', parseInt(e.target.value, 10))
                }
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer mt-2"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{t('settings.replayQuality.scrollFps', { ms: 50, fps: 20 })}</span>
                <span className="text-green-600 font-medium">
                  {t('settings.replayQuality.fpsRecommended', { ms: 100, fps: 10 })}
                </span>
                <span>{t('settings.replayQuality.scrollFps', { ms: 500, fps: 2 })}</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {t('settings.replayQuality.scrollEventDescription')}
              </p>
            </div>
          </div>
        </div>

        {/* Size Impact Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <HardDrive className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                {t('settings.replayQuality.estimatedStorageImpact')}
              </h4>
              <p className="text-sm text-blue-800">
                <Trans
                  i18nKey="settings.replayQuality.averageReplaySize"
                  values={{ size: sizeImpact }}
                />
              </p>
              <p className="text-xs text-blue-700 mt-2">
                {t('settings.replayQuality.baselineSize', {
                  base: BASE_REPLAY_SIZE_KB,
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Warning for Image Inlining */}
        {formData.replay_inline_images && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-orange-900 mb-1">
                  {t('settings.replayQuality.highStorageCostWarning')}
                </h4>
                <p className="text-sm text-orange-800">
                  {t('settings.replayQuality.highStorageCostDescription')}
                </p>
                <p className="text-xs text-orange-700 mt-2">
                  {t('settings.replayQuality.highStorageCostAdvice')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recommendations */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">
            {t('settings.replayQuality.recommendationsTitle')}
          </h4>
          <ul className="text-sm text-gray-700 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>
                <Trans i18nKey="settings.replayQuality.recommendationStandard" />
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>
                <Trans i18nKey="settings.replayQuality.recommendationHighFidelity" />
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-orange-600 mt-0.5">!</span>
              <span>
                <Trans i18nKey="settings.replayQuality.recommendationCanvas" />
              </span>
            </li>
          </ul>
        </div>
      </div>
    </SettingsSection>
  );
}
