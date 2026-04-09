import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldMappings } from '@bugspotter/types';
import { FieldMappingsForm } from './field-mappings-form';
import { MarkdownEditor } from './markdown-editor';

interface FieldMappingsTabProps {
  autoCreate: boolean;
  platform: string;
  fieldMappings: FieldMappings | null;
  onFieldMappingsChange: (mappings: FieldMappings | null) => void;
  descriptionTemplate: string | null;
  onDescriptionTemplateChange: (template: string | null) => void;
  renderFieldMappings?: (props: {
    mappings: FieldMappings | null;
    onChange: (mappings: FieldMappings | null) => void;
  }) => React.ReactNode;
}

export function FieldMappingsTab({
  autoCreate,
  platform,
  fieldMappings,
  onFieldMappingsChange,
  descriptionTemplate,
  onDescriptionTemplateChange,
  renderFieldMappings,
}: FieldMappingsTabProps) {
  const { t } = useTranslation();
  const [showVars, setShowVars] = useState(false);
  if (!autoCreate) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="text-sm">{t('integrationConfig.fieldMappingsTab.fieldMappingsOnly')}</p>
        <p className="text-xs mt-2">{t('integrationConfig.fieldMappingsTab.enableAutoCreate')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      {/* Field Mappings Section */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium mb-1">
            {t('integrationConfig.fieldMappingsTab.platformFieldMappings')}
          </h3>
          <p className="text-xs text-gray-500">
            {t('integrationConfig.fieldMappingsTab.platformMappingDescription', { platform })}
          </p>
        </div>
        {renderFieldMappings ? (
          renderFieldMappings({
            mappings: fieldMappings,
            onChange: onFieldMappingsChange,
          })
        ) : (
          <FieldMappingsForm
            platform={platform}
            mappings={fieldMappings}
            onChange={onFieldMappingsChange}
          />
        )}
      </div>

      {/* Description Template Section */}
      <div className="space-y-3 pt-4 border-t">
        <div>
          <h3 className="text-sm font-medium mb-1">
            {t('integrationConfig.fieldMappingsTab.customDescriptionTemplate')}
          </h3>
          <p className="text-xs text-gray-500">
            {t('integrationConfig.fieldMappingsTab.customDescriptionDescription', { platform })}
          </p>
          <button
            type="button"
            onClick={() => setShowVars(!showVars)}
            aria-expanded={showVars}
            aria-controls="template-variables-panel"
            className="text-xs text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            {showVars
              ? t('integrationConfig.fieldMappingsTab.templateVariablesHide')
              : t('integrationConfig.fieldMappingsTab.templateVariablesToggle')}
          </button>
          {showVars && (
            <div
              id="template-variables-panel"
              className="text-xs text-gray-500 bg-gray-50 border rounded-md p-3 space-y-1"
            >
              <p className="font-medium">
                {t('integrationConfig.fieldMappingsTab.templateVariablesTitle')}
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesCore')}</li>
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesUser')}</li>
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesError')}</li>
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesBrowser')}</li>
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesLocation')}</li>
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesAttachments')}</li>
                <li>{t('integrationConfig.fieldMappingsTab.templateVariablesMetadata')}</li>
              </ul>
            </div>
          )}
        </div>
        <MarkdownEditor
          value={descriptionTemplate || ''}
          onChange={(value: string) => {
            onDescriptionTemplateChange(value.trim().length === 0 ? null : value);
          }}
        />
      </div>
    </div>
  );
}
