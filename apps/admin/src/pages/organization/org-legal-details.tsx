/**
 * Organization Legal Details Page
 * Form for managing legal entity details (company name + region-specific JSONB).
 * For KZ: BIN, IIK, BIK, bank name, legal address, director name.
 */

import { useState, useEffect, useRef, forwardRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, Save, AlertCircle, CheckCircle } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { useOrganization } from '../../contexts/organization-context';
import { invoiceService } from '../../services/invoice-service';

interface KzFormData {
  company_name: string;
  bin: string;
  legal_address: string;
  bank_name: string;
  iik: string;
  bik: string;
  director_name: string;
  phone: string;
  email: string;
}

const EMPTY_FORM: KzFormData = {
  company_name: '',
  bin: '',
  legal_address: '',
  bank_name: '',
  iik: 'KZ',
  bik: '',
  director_name: '',
  phone: '',
  email: '',
};

// ---------------------------------------------------------------------------
// Validation rules (match backend KZ billing plugin validators)
// ---------------------------------------------------------------------------

type Validator = (value: string) => string | null;

function validateRequired(value: string): string | null {
  return value.trim() ? null : 'required';
}

function validateBin(value: string): string | null {
  if (!value.trim()) {
    return 'required';
  }
  if (!/^\d{12}$/.test(value)) {
    return 'binFormat';
  }
  return null;
}

function validateIik(value: string): string | null {
  if (!value.trim() || value === 'KZ') {
    return 'required';
  }
  if (!/^KZ[A-Z0-9]{18}$/i.test(value)) {
    return 'iikFormat';
  }
  return null;
}

function validateBik(value: string): string | null {
  if (!value.trim()) {
    return 'required';
  }
  const normalized = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(normalized)) {
    return 'bikFormat';
  }
  return null;
}

function validateEmail(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'emailFormat';
  }
  return null;
}

const FIELD_VALIDATORS: Partial<Record<keyof KzFormData, Validator>> = {
  company_name: validateRequired,
  bin: validateBin,
  legal_address: validateRequired,
  bank_name: validateRequired,
  iik: validateIik,
  bik: validateBik,
  director_name: validateRequired,
  email: validateEmail,
};

function validateForm(form: KzFormData): Partial<Record<keyof KzFormData, string>> {
  const errors: Partial<Record<keyof KzFormData, string>> = {};
  for (const [key, validator] of Object.entries(FIELD_VALIDATORS)) {
    const error = validator!(form[key as keyof KzFormData]);
    if (error) {
      errors[key as keyof KzFormData] = error;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Shared field rendering helper
// ---------------------------------------------------------------------------

const INPUT_BASE =
  'w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-1 focus:ring-blue-500';
const INPUT_NORMAL = `${INPUT_BASE} border-gray-300 focus:border-blue-500 bg-white`;
const INPUT_ERROR = `${INPUT_BASE} border-red-400 focus:border-red-500 bg-red-50`;

const DISABLED_CLASSES = 'bg-gray-50 cursor-not-allowed';

const PhoneInputField = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, disabled, ...rest }, ref) => (
    <input
      ref={ref}
      disabled={disabled}
      {...rest}
      className={`${INPUT_NORMAL} ${disabled ? DISABLED_CLASSES : ''} ${className ?? ''}`}
    />
  )
);

export default function OrgLegalDetailsPage() {
  const { t } = useTranslation();
  const { currentOrganization } = useOrganization();
  const isOwner = currentOrganization?.my_role === 'owner';
  const readOnly = !isOwner;
  const queryClient = useQueryClient();
  const [form, setForm] = useState<KzFormData>(EMPTY_FORM);
  const [touched, setTouched] = useState<Partial<Record<keyof KzFormData, boolean>>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const { data: entity, isLoading } = useQuery({
    queryKey: ['legal-details', currentOrganization?.id],
    queryFn: () => invoiceService.getLegalDetails(),
    enabled: !!currentOrganization,
  });

  useEffect(() => {
    if (entity) {
      const details = entity.details ?? {};
      const str = (key: string): string => {
        const val = (details as Record<string, unknown>)[key];
        return typeof val === 'string' ? val : '';
      };
      setForm({
        company_name: String(entity.company_name ?? ''),
        bin: str('bin'),
        legal_address: str('legal_address'),
        bank_name: str('bank_name'),
        iik: str('iik') || 'KZ',
        bik: str('bik'),
        director_name: str('director_name'),
        phone: str('phone'),
        email: str('email'),
      });
    }
  }, [entity]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const { company_name, ...kzDetails } = form;
      return invoiceService.saveLegalDetails({ company_name, details: kzDetails });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal-details'] });
      setSaveMessage(t('invoiceBilling.legalDetails.saved'));
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => setSaveMessage(null), 3000);
    },
  });

  const updateField = (field: keyof KzFormData, value: string) => {
    let filtered = value;
    switch (field) {
      case 'bin':
        // Digits only, max 12
        filtered = value.replace(/\D/g, '').slice(0, 12);
        break;
      case 'bik':
        // Alphanumeric only, max 11, uppercase immediately
        filtered = value
          .replace(/[^A-Za-z0-9]/g, '')
          .toUpperCase()
          .slice(0, 11);
        break;
      // IIK is handled separately in its own onChange
    }
    setForm((prev) => ({ ...prev, [field]: filtered }));
  };

  const handleBlur = (field: keyof KzFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    // Normalize BIK on blur (strip whitespace, uppercase) to match backend
    if (field === 'bik') {
      setForm((prev) => ({ ...prev, bik: prev.bik.replace(/\s/g, '').toUpperCase() }));
    }
  };

  if (!currentOrganization) {
    return null;
  }

  const errors = validateForm(form);
  const hasErrors = Object.keys(errors).length > 0;

  const fields: {
    key: keyof KzFormData;
    label: string;
    required: boolean;
    placeholder?: string;
    hint?: string;
    maxLength?: number;
  }[] = [
    { key: 'company_name', label: t('invoiceBilling.legalDetails.companyName'), required: true },
    {
      key: 'bin',
      label: t('invoiceBilling.legalDetails.bin'),
      required: true,
      placeholder: '123456789012',
      hint: t('invoiceBilling.validation.binHint'),
      maxLength: 12,
    },
    { key: 'legal_address', label: t('invoiceBilling.legalDetails.legalAddress'), required: true },
    { key: 'bank_name', label: t('invoiceBilling.legalDetails.bankName'), required: true },
    {
      key: 'iik',
      label: t('invoiceBilling.legalDetails.iik'),
      required: true,
      hint: t('invoiceBilling.validation.iikHint'),
    },
    {
      key: 'bik',
      label: t('invoiceBilling.legalDetails.bik'),
      required: true,
      placeholder: 'HSBKKZKX',
      hint: t('invoiceBilling.validation.bikHint'),
      maxLength: 11,
    },
    { key: 'director_name', label: t('invoiceBilling.legalDetails.directorName'), required: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          <Building2 className="inline-block h-6 w-6 mr-2" aria-hidden="true" />
          {t('invoiceBilling.legalDetails.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t('invoiceBilling.legalDetails.subtitle')}</p>
      </div>

      {readOnly && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          {t('invoiceBilling.legalDetails.readOnly')}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : (
        <form
          className="space-y-4 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (readOnly) {
              return;
            }
            const allTouched = Object.fromEntries(
              Object.keys(form).map((k) => [k, true])
            ) as Record<keyof KzFormData, boolean>;
            setTouched(allTouched);
            if (!hasErrors) {
              saveMutation.mutate();
            }
          }}
        >
          {fields.map(({ key, label, required, placeholder, hint, maxLength }) => {
            const fieldError = touched[key] ? errors[key] : null;

            // IIK: prefix "KZ" is locked
            if (key === 'iik') {
              return (
                <div key={key}>
                  <label
                    htmlFor="legal-iik"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {label} <span className="text-red-500">*</span>
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-100 text-gray-500 text-sm">
                      KZ
                    </span>
                    <input
                      id="legal-iik"
                      type="text"
                      value={form.iik.startsWith('KZ') ? form.iik.slice(2) : form.iik}
                      onChange={(e) => {
                        // Strip leading KZ if user pastes a full IBAN
                        const raw = e.target.value.replace(/^KZ/i, '');
                        const chars = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 18);
                        updateField('iik', `KZ${chars}`);
                      }}
                      onBlur={() => handleBlur('iik')}
                      placeholder="123456789012345678"
                      aria-required
                      maxLength={18}
                      disabled={readOnly}
                      aria-invalid={!!fieldError}
                      aria-describedby={fieldError ? 'legal-iik-error' : 'legal-iik-hint'}
                      className={`flex-1 rounded-none rounded-r-md border px-3 py-2 text-sm shadow-sm focus:ring-1 focus:ring-blue-500 ${
                        fieldError
                          ? 'border-red-400 focus:border-red-500 bg-red-50'
                          : 'border-gray-300 bg-white'
                      } ${readOnly ? DISABLED_CLASSES : ''}`}
                    />
                  </div>
                  {hint && !fieldError && (
                    <p id="legal-iik-hint" className="mt-1 text-xs text-gray-400">
                      {hint}
                    </p>
                  )}
                  {fieldError && (
                    <p id="legal-iik-error" className="mt-1 text-xs text-red-500" role="alert">
                      {t(`invoiceBilling.validation.${fieldError}`)}
                    </p>
                  )}
                </div>
              );
            }

            return (
              <div key={key}>
                <label
                  htmlFor={`legal-${key}`}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {label} {required && <span className="text-red-500">*</span>}
                </label>
                <input
                  id={`legal-${key}`}
                  type="text"
                  value={form[key]}
                  onChange={(e) => updateField(key, e.target.value)}
                  onBlur={() => handleBlur(key)}
                  placeholder={placeholder}
                  maxLength={maxLength}
                  disabled={readOnly}
                  aria-required={required}
                  aria-invalid={!!fieldError}
                  aria-describedby={
                    fieldError ? `legal-${key}-error` : hint ? `legal-${key}-hint` : undefined
                  }
                  className={`${fieldError ? INPUT_ERROR : INPUT_NORMAL} ${readOnly ? DISABLED_CLASSES : ''}`}
                />
                {hint && !fieldError && (
                  <p id={`legal-${key}-hint`} className="mt-1 text-xs text-gray-400">
                    {hint}
                  </p>
                )}
                {fieldError && (
                  <p id={`legal-${key}-error`} className="mt-1 text-xs text-red-500" role="alert">
                    {t(`invoiceBilling.validation.${fieldError}`)}
                  </p>
                )}
              </div>
            );
          })}

          {/* Phone */}
          <div>
            <label htmlFor="legal-phone" className="block text-sm font-medium text-gray-700 mb-1">
              {t('invoiceBilling.legalDetails.phone')}
            </label>
            <PhoneInput
              id="legal-phone"
              international
              defaultCountry="KZ"
              value={form.phone}
              onChange={(value) => updateField('phone', value ?? '')}
              inputComponent={PhoneInputField}
              disabled={readOnly}
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="legal-email" className="block text-sm font-medium text-gray-700 mb-1">
              {t('invoiceBilling.legalDetails.email')}
            </label>
            <input
              id="legal-email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              onBlur={() => handleBlur('email')}
              placeholder="company@example.com"
              disabled={readOnly}
              aria-invalid={!!(touched.email && errors.email)}
              aria-describedby={touched.email && errors.email ? 'legal-email-error' : undefined}
              className={`${touched.email && errors.email ? INPUT_ERROR : INPUT_NORMAL} ${readOnly ? DISABLED_CLASSES : ''}`}
            />
            {touched.email && errors.email && (
              <p id="legal-email-error" className="mt-1 text-xs text-red-500" role="alert">
                {t(`invoiceBilling.validation.${errors.email}`)}
              </p>
            )}
          </div>

          {saveMutation.isError && (
            <div className="flex items-center gap-2 text-sm text-red-600" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {t('invoiceBilling.legalDetails.saveError')}
            </div>
          )}

          {saveMessage && (
            <div
              className="flex items-center gap-2 text-sm text-green-600"
              role="status"
              aria-live="polite"
            >
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              {saveMessage}
            </div>
          )}

          {!readOnly && (
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? t('common.saving') : t('invoiceBilling.legalDetails.save')}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
