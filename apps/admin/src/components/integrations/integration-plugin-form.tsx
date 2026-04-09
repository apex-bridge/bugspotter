import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import { Alert, AlertDescription } from '../ui/alert';
import { integrationService } from '../../services/integration-service';
import { handleApiError } from '../../lib/api-client';
import { toast } from 'sonner';
import { Shield, AlertTriangle, AlertCircle } from 'lucide-react';
import type { SecurityAnalysisResult } from '../../types';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

// Comprehensive CodeMirror editor configuration for consistency across all editors
const CODE_MIRROR_BASIC_SETUP = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  foldGutter: true,
  dropCursor: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  rectangularSelection: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
};

export interface PluginFormData {
  plugin_code: string;
  // Guided mode fields
  pluginName: string;
  pluginPlatform: string;
  pluginVersion: string;
  pluginDescription: string;
  pluginAuthType: 'basic' | 'bearer' | 'api_key' | 'custom';
  createTicketCode: string;
  testConnectionCode: string;
  validateConfigCode: string;
  includeTestConnection: boolean;
  includeValidateConfig: boolean;
  // Security consent
  allowCodeExecution: boolean;
}

interface IntegrationPluginFormProps {
  initialData?: Partial<PluginFormData>;
  onSubmit: (formData: PluginFormData, useGuidedMode: boolean) => Promise<void>;
  loading?: boolean;
  onCancel?: () => void;
  // If true, guided mode is forced off (code cannot be parsed)
  guidedModeDisabled?: boolean;
  // Default mode (can be overridden by user)
  defaultMode?: 'guided' | 'advanced';
  // Submit button text (optional, defaults to translated 'Save Changes')
  submitButtonText?: string;
}

const DEFAULT_FORM_DATA: PluginFormData = {
  plugin_code: '',
  pluginName: '',
  pluginPlatform: '',
  pluginVersion: '1.0.0',
  pluginDescription: '',
  pluginAuthType: 'basic',
  createTicketCode: '',
  testConnectionCode: '',
  validateConfigCode: '',
  includeTestConnection: false,
  includeValidateConfig: false,
  allowCodeExecution: false,
};

export default function IntegrationPluginForm({
  initialData = {},
  onSubmit,
  loading = false,
  onCancel,
  guidedModeDisabled = false,
  defaultMode = 'guided',
  submitButtonText,
}: IntegrationPluginFormProps) {
  const { t } = useTranslation();
  const [analyzing, setAnalyzing] = useState(false);
  const [securityAnalysis, setSecurityAnalysis] = useState<SecurityAnalysisResult | null>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);

  // Mode toggle: guided (simpler) vs advanced (full code)
  const [useGuidedMode, setUseGuidedMode] = useState(
    guidedModeDisabled ? false : defaultMode === 'guided'
  );

  const [formData, setFormData] = useState<PluginFormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData,
  });

  // Sync form data when initialData prop changes, but only if user hasn't made edits yet
  useEffect(() => {
    if (!isFormDirty) {
      setFormData({
        ...DEFAULT_FORM_DATA,
        ...initialData,
      });
    }
  }, [initialData, isFormDirty]);

  // Clear security analysis when code changes (prevent stale analysis on modified code)
  // Always clear unconditionally - no need to check current value
  useEffect(() => {
    setSecurityAnalysis(null);
  }, [formData.plugin_code]);

  const updateField = useCallback(
    <K extends keyof PluginFormData>(field: K, value: PluginFormData[K]) => {
      setIsFormDirty(true);
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleAnalyzeCode = async () => {
    if (!formData.plugin_code) {
      toast.error(t('pluginForm.noCodeToAnalyze'));
      return;
    }

    setAnalyzing(true);
    try {
      const result = await integrationService.analyzeCode(formData.plugin_code);
      setSecurityAnalysis(result);

      if (!result.safe) {
        toast.error(t('pluginForm.codeFailedSecurity'));
      } else if (result.warnings.length > 0) {
        toast.warning(t('pluginForm.codeAnalysisWarning', { count: result.warnings.length }));
      } else {
        toast.success(t('pluginForm.codePassedSecurity'));
      }
    } catch (error) {
      const message = handleApiError(error);
      toast.error(t('pluginForm.analysisFailed', { message }));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Security consent validation
    if (!formData.allowCodeExecution) {
      toast.error(t('pluginForm.enableCodeExecutionRequired'));
      return;
    }

    // Validate guided mode fields
    if (useGuidedMode) {
      if (!formData.pluginName || !formData.pluginPlatform || !formData.createTicketCode) {
        toast.error(t('pluginForm.guidedModeValidationError'));
        return;
      }
      // Backend will generate and analyze code from parts
    } else {
      // Advanced mode validation
      if (formData.plugin_code && !securityAnalysis) {
        toast.error(t('pluginForm.analyzeCodeBeforeSubmit'));
        return;
      }

      if (securityAnalysis && !securityAnalysis.safe) {
        toast.error(t('pluginForm.fixViolationsBeforeSubmit'));
        return;
      }
    }

    await onSubmit(formData, useGuidedMode);
    setIsFormDirty(false); // Reset after successful submit
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('pluginForm.title')}</CardTitle>
          <CardDescription>
            {useGuidedMode
              ? t('pluginForm.guidedModeDescription')
              : t('pluginForm.advancedModeDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Mode Toggle */}
          <div
            className="inline-flex gap-2"
            role="group"
            aria-label="Plugin development mode selection"
          >
            <Button
              type="button"
              variant={useGuidedMode ? 'primary' : 'outline'}
              onClick={() => setUseGuidedMode(true)}
              aria-pressed={useGuidedMode}
              disabled={guidedModeDisabled}
              data-testid="guided-mode-button"
            >
              {guidedModeDisabled
                ? t('pluginForm.guidedModeDisabledLabel')
                : t('pluginForm.guidedMode')}
            </Button>
            <Button
              type="button"
              variant={!useGuidedMode ? 'primary' : 'outline'}
              onClick={() => setUseGuidedMode(false)}
              aria-pressed={!useGuidedMode}
              data-testid="advanced-mode-button"
            >
              {t('pluginForm.advancedMode')}
            </Button>
          </div>

          {guidedModeDisabled && useGuidedMode && (
            <Alert>
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{t('pluginForm.guidedModeNotAvailable')}</AlertDescription>
            </Alert>
          )}

          {useGuidedMode && !guidedModeDisabled ? (
            /* Guided Mode - Separate Fields */
            <div className="space-y-6">
              {/* Plugin Metadata */}
              <div className="border-l-4 border-blue-500 pl-4 space-y-4">
                <h3 className="font-semibold text-lg">{t('pluginForm.pluginMetadata')}</h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="pluginName">{t('pluginForm.pluginName')}</Label>
                    <Input
                      id="pluginName"
                      data-testid="plugin-name-input"
                      value={formData.pluginName}
                      onChange={(e) => updateField('pluginName', e.target.value)}
                      placeholder={t('pluginForm.pluginNamePlaceholder')}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="pluginPlatform">{t('pluginForm.platform')}</Label>
                    <Input
                      id="pluginPlatform"
                      data-testid="plugin-platform-input"
                      value={formData.pluginPlatform}
                      onChange={(e) => updateField('pluginPlatform', e.target.value.toLowerCase())}
                      placeholder={t('pluginForm.platformPlaceholder')}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="pluginVersion">{t('pluginForm.version')}</Label>
                    <Input
                      id="pluginVersion"
                      value={formData.pluginVersion}
                      onChange={(e) => updateField('pluginVersion', e.target.value)}
                      placeholder={t('pluginForm.versionPlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="pluginDescription">{t('pluginForm.description')}</Label>
                  <Textarea
                    id="pluginDescription"
                    data-testid="plugin-description"
                    value={formData.pluginDescription}
                    onChange={(e) => updateField('pluginDescription', e.target.value)}
                    placeholder={t('pluginForm.descriptionPlaceholder')}
                    rows={2}
                  />
                </div>
              </div>

              {/* Authentication Helper */}
              <div className="border-l-4 border-green-500 pl-4 space-y-4">
                <h3 className="font-semibold text-lg">{t('pluginForm.authenticationHelper')}</h3>

                <div>
                  <Label htmlFor="pluginAuthType">{t('pluginForm.authenticationType')}</Label>
                  <Select
                    value={formData.pluginAuthType}
                    onValueChange={(value) =>
                      updateField(
                        'pluginAuthType',
                        value as 'custom' | 'basic' | 'bearer' | 'api_key'
                      )
                    }
                  >
                    <SelectTrigger id="pluginAuthType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">{t('pluginForm.basicAuth')}</SelectItem>
                      <SelectItem value="bearer">{t('pluginForm.bearerToken')}</SelectItem>
                      <SelectItem value="api_key">{t('pluginForm.apiKey')}</SelectItem>
                      <SelectItem value="custom">{t('pluginForm.customAuth')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Auth Helper Preview */}
                <Alert>
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription>
                    <strong>{t('pluginForm.autoGeneratedCodeSnippet')}</strong>
                    <pre className="mt-2 p-2 bg-gray-800 text-green-400 rounded text-xs overflow-x-auto">
                      {formData.pluginAuthType === 'basic' &&
                        `const auth = Buffer.from(context.config.email + ':' + context.config.apiToken).toString('base64');`}
                      {formData.pluginAuthType === 'bearer' &&
                        `const auth = context.config.apiToken;`}
                      {formData.pluginAuthType === 'api_key' &&
                        `const apiKey = context.config.apiKey;`}
                      {formData.pluginAuthType === 'custom' &&
                        `// No helper - you'll handle authentication in your code`}
                    </pre>
                    {formData.pluginAuthType !== 'custom' && (
                      <p className="mt-2 text-sm">{t('pluginForm.variableWillBeAvailable')}</p>
                    )}
                  </AlertDescription>
                </Alert>
              </div>

              {/* Create Ticket Code */}
              <div className="border-l-4 border-purple-500 pl-4 space-y-4">
                <h3 className="font-semibold text-lg">{t('pluginForm.ticketCreationLogic')}</h3>
                <p className="text-sm text-gray-600">{t('pluginForm.ticketCreationDescription')}</p>

                <div data-testid="create-ticket-code-editor">
                  <Label htmlFor="create-ticket-code" className="sr-only">
                    {t('pluginForm.createTicketCodeEditor')}
                  </Label>
                  <CodeMirror
                    id="create-ticket-code"
                    value={formData.createTicketCode}
                    height="400px"
                    extensions={[javascript({ jsx: false })]}
                    onChange={(value) => updateField('createTicketCode', value)}
                    theme={vscodeDark}
                    basicSetup={CODE_MIRROR_BASIC_SETUP}
                  />
                </div>
              </div>

              {/* Optional: Test Connection */}
              <div className="border-l-4 border-orange-500 pl-4 space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="include-test-connection"
                    checked={formData.includeTestConnection}
                    onChange={(e) => updateField('includeTestConnection', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="include-test-connection" className="cursor-pointer">
                    {t('pluginForm.includeTestConnection')}
                  </Label>
                </div>

                {formData.includeTestConnection && (
                  <div>
                    <Label htmlFor="test-connection-code" className="sr-only">
                      {t('pluginForm.testConnectionCodeEditor')}
                    </Label>
                    <CodeMirror
                      id="test-connection-code"
                      value={formData.testConnectionCode}
                      height="200px"
                      extensions={[javascript({ jsx: false })]}
                      onChange={(value) => updateField('testConnectionCode', value)}
                      theme={vscodeDark}
                      basicSetup={CODE_MIRROR_BASIC_SETUP}
                    />
                  </div>
                )}
              </div>

              {/* Optional: Validate Config */}
              <div className="border-l-4 border-pink-500 pl-4 space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="include-validate-config"
                    checked={formData.includeValidateConfig}
                    onChange={(e) => updateField('includeValidateConfig', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="include-validate-config" className="cursor-pointer">
                    {t('pluginForm.includeValidateConfig')}
                  </Label>
                </div>

                {formData.includeValidateConfig && (
                  <div>
                    <Label htmlFor="validate-config-code" className="sr-only">
                      {t('pluginForm.validateConfigCodeEditor')}
                    </Label>
                    <CodeMirror
                      id="validate-config-code"
                      value={formData.validateConfigCode}
                      height="200px"
                      extensions={[javascript({ jsx: false })]}
                      onChange={(value) => updateField('validateConfigCode', value)}
                      theme={vscodeDark}
                      basicSetup={CODE_MIRROR_BASIC_SETUP}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Advanced Mode - Full Code Editor */
            <div className="space-y-4">
              <div data-testid="advanced-code-editor">
                <Label htmlFor="plugin-code" className="sr-only">
                  {t('pluginForm.pluginCodeEditor')}
                </Label>
                <CodeMirror
                  id="plugin-code"
                  value={formData.plugin_code}
                  height="500px"
                  extensions={[javascript({ jsx: false })]}
                  onChange={(value) => updateField('plugin_code', value)}
                  theme={vscodeDark}
                  basicSetup={CODE_MIRROR_BASIC_SETUP}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAnalyzeCode}
                  disabled={!formData.plugin_code || analyzing}
                  data-testid="analyze-security-button"
                >
                  <Shield className="w-4 h-4 mr-2" aria-hidden="true" />
                  {analyzing ? t('pluginForm.analyzing') : t('pluginForm.analyzeSecurity')}
                </Button>
              </div>

              {securityAnalysis && (
                <Alert variant={securityAnalysis.safe ? 'default' : 'destructive'}>
                  {securityAnalysis.safe ? (
                    <Shield className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  )}
                  <AlertDescription>
                    <div className="space-y-2">
                      <div className="font-semibold">
                        {securityAnalysis.safe
                          ? t('pluginForm.securityValidationPassed')
                          : t('pluginForm.securityViolationsDetected')}
                      </div>
                      <div>{t('pluginForm.riskLevel', { level: securityAnalysis.risk_level })}</div>

                      {securityAnalysis.violations.length > 0 && (
                        <div>
                          <div className="font-medium mt-2">{t('pluginForm.violations')}</div>
                          <ul className="list-disc list-inside">
                            {securityAnalysis.violations.map((v: string, i: number) => (
                              <li key={i}>{v}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {securityAnalysis.warnings.length > 0 && (
                        <div>
                          <div className="font-medium mt-2">{t('pluginForm.warnings')}</div>
                          <ul className="list-disc list-inside">
                            {securityAnalysis.warnings.map((w: string, i: number) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Consent */}
      <Card className="border-orange-500">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              id="allow-code-execution"
              checked={formData.allowCodeExecution}
              onChange={(e) => updateField('allowCodeExecution', e.target.checked)}
              className="w-5 h-5 mt-0.5"
              data-testid="allow-code-execution-checkbox"
            />
            <div className="flex-1">
              <Label htmlFor="allow-code-execution" className="cursor-pointer font-semibold">
                {t('pluginForm.allowCodeExecution')}
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                {t('pluginForm.allowCodeExecutionDescription')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={loading} data-testid="save-plugin-button">
          {loading ? t('pluginForm.saving') : submitButtonText || t('common.save')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            {t('pluginForm.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
