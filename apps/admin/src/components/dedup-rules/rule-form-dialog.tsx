/**
 * Structured editor for `DedupRule` — discriminated-union form that
 * renders different sub-fields per trigger / action type instead of
 * a raw JSON textarea.
 *
 * Validation is intentionally minimal client-side: we check that the
 * required slots are populated, then let the backend's `parseDedupRule`
 * (Zod) be the source of truth. Errors come back through `toast.error`
 * via the mutation hook, so the dialog stays simple — no parallel
 * Zod re-implementation here that could drift.
 *
 * Form state is a single `formData` object instead of one useState per
 * field. The discriminated unions for trigger/action make per-field
 * state painful (resetting fields when the discriminator changes
 * becomes 5-way conditional), and the rule body fits in one update.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';
import {
  ACTION_TYPES,
  CANONICAL_STATUSES,
  CONDITION_FIELDS,
  CONDITION_OPS,
  TRIGGER_TYPES,
  type ActionSpec,
  type ActionType,
  type ConditionSpec,
  type DedupRule,
  type DedupRuleRow,
  type TriggerSpec,
  type TriggerType,
} from '../../services/dedup-rules-service';

// ---------------------------------------------------------------------
// Defaults: what each variant looks like the first time it's added.
// Kept here so the discriminator-change reset always lands on a valid
// shape (the backend would 400 otherwise on switch+submit).
// ---------------------------------------------------------------------

function defaultTriggerOf(type: TriggerType): TriggerSpec {
  switch (type) {
    case 'duplicate_detected':
      return { type };
    case 'outbox_about_to_skip':
      return { type };
    case 'cluster_growing':
      return { type, threshold: 5, window: '1h' };
    case 'schedule':
      return { type, cron: '0 9 * * 1' };
  }
}

/**
 * Numeric condition fields (per the Zod schema). For these, the
 * executor compares against numbers — sending strings would silently
 * fail to match on `eq`/`in`/`not_in` (the backend's transform only
 * coerces strings → numbers for `gte`/`lte`).
 */
const NUMERIC_CONDITION_FIELDS = new Set<ConditionSpec['field']>([
  'hits_in_window',
  'canonical.closed_days_ago',
]);

function displayConditionValue(value: ConditionSpec['value']): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Parse the raw text input into the shape the backend expects, based
 * on (field, op):
 *  - `in` / `not_in` need an array → split by comma, trim, drop empties.
 *  - Numeric fields parse to number when the input is a clean numeric
 *    string. Anything else stays a string (the backend's Zod
 *    validation will surface a clearer error than a silent type
 *    mismatch).
 */
function parseConditionValue(
  field: ConditionSpec['field'],
  op: ConditionSpec['op'],
  raw: string
): ConditionSpec['value'] {
  const isList = op === 'in' || op === 'not_in';
  const isNumeric = NUMERIC_CONDITION_FIELDS.has(field);
  if (isList) {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (isNumeric) {
      return parts.map((p) => {
        const n = Number(p);
        return Number.isFinite(n) ? n : p;
      });
    }
    return parts;
  }
  if (isNumeric && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return raw;
}

function defaultActionOf(type: ActionType): ActionSpec {
  switch (type) {
    case 'ticket.add_comment':
      return { type, target: 'canonical', body: '' };
    case 'ticket.transition':
      return { type, target: 'canonical', to: 'open' };
    case 'notify.email':
      return { type, to: 'reporter', template: 'dedup_ack' };
    case 'notify.slack':
      return { type, channel: '', message: '' };
    case 'notify.webhook':
      return { type, url: '', payload: null };
  }
}

const EMPTY_RULE: DedupRule = {
  name: '',
  when: { type: 'duplicate_detected' },
  conditions: [],
  then: [defaultActionOf('ticket.add_comment')],
  rate_limit: null,
  enabled: true,
};

// ---------------------------------------------------------------------
// Public dialog
// ---------------------------------------------------------------------

interface DedupRuleFormDialogProps {
  open: boolean;
  editingRule: DedupRuleRow | null;
  readOnly?: boolean;
  onClose: () => void;
  onSubmit: (payload: DedupRule, ruleId?: string) => void;
  isSubmitting?: boolean;
}

export function DedupRuleFormDialog({
  open,
  editingRule,
  readOnly,
  onClose,
  onSubmit,
  isSubmitting,
}: DedupRuleFormDialogProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<DedupRule>(EMPTY_RULE);

  // Reset on open/close + when the editingRule reference changes. The
  // dialog is the same React element across create/edit; without this
  // sync, the previous rule's state would leak into a fresh "create".
  useEffect(() => {
    if (open) {
      setFormData(editingRule ? editingRule.rule_json : EMPTY_RULE);
    }
  }, [open, editingRule]);

  function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error(t('dedupRules.form.errorNameRequired'));
      return;
    }
    if (formData.then.length === 0) {
      toast.error(t('dedupRules.form.errorActionRequired'));
      return;
    }
    onSubmit(formData, editingRule?.id);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingRule ? t('dedupRules.form.editTitle') : t('dedupRules.form.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('dedupRules.form.description')}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={readOnly} className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="rule-name">{t('dedupRules.form.name')}</Label>
            <Input
              id="rule-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('dedupRules.form.namePlaceholder')}
            />
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="rule-enabled"
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked === true })}
            />
            <Label htmlFor="rule-enabled" className="font-normal">
              {t('dedupRules.form.enabled')}
            </Label>
          </div>

          <TriggerEditor
            value={formData.when}
            onChange={(when) => setFormData({ ...formData, when })}
          />

          <ConditionsEditor
            value={formData.conditions}
            onChange={(conditions) => setFormData({ ...formData, conditions })}
          />

          <ActionsEditor
            value={formData.then}
            onChange={(then) => setFormData({ ...formData, then })}
          />

          <RateLimitEditor
            value={formData.rate_limit ?? null}
            onChange={(rate_limit) => setFormData({ ...formData, rate_limit })}
          />
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {editingRule ? t('common.save') : t('common.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Sub-editors
// ---------------------------------------------------------------------

interface TriggerEditorProps {
  value: TriggerSpec;
  onChange: (next: TriggerSpec) => void;
}

function TriggerEditor({ value, onChange }: TriggerEditorProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-md border p-4">
      <Label>{t('dedupRules.form.trigger')}</Label>
      <Select
        value={value.type}
        onChange={(e) => onChange(defaultTriggerOf(e.target.value as TriggerType))}
      >
        {TRIGGER_TYPES.map((tt) => (
          <option key={tt} value={tt}>
            {t(`dedupRules.trigger.${tt}`)}
          </option>
        ))}
      </Select>
      {value.type === 'cluster_growing' && (
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Input
            type="number"
            min={2}
            value={value.threshold}
            onChange={(e) => onChange({ ...value, threshold: Number(e.target.value) || 2 })}
            placeholder={t('dedupRules.form.threshold')}
            aria-label={t('dedupRules.form.threshold')}
          />
          <Input
            value={value.window}
            onChange={(e) => onChange({ ...value, window: e.target.value })}
            placeholder={t('dedupRules.form.windowPlaceholder')}
            aria-label={t('dedupRules.form.window')}
          />
        </div>
      )}
      {value.type === 'schedule' && (
        <Input
          value={value.cron}
          onChange={(e) => onChange({ ...value, cron: e.target.value })}
          placeholder={t('dedupRules.form.cronPlaceholder')}
          aria-label={t('dedupRules.form.cron')}
        />
      )}
    </div>
  );
}

interface ConditionsEditorProps {
  value: ConditionSpec[];
  onChange: (next: ConditionSpec[]) => void;
}

function ConditionsEditor({ value, onChange }: ConditionsEditorProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <Label>{t('dedupRules.form.conditions')}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...value, { field: 'canonical.status', op: 'eq', value: 'open' }])
          }
        >
          <Plus className="h-3 w-3 mr-1" />
          {t('common.add')}
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-xs text-gray-500">{t('dedupRules.form.noConditions')}</p>
      ) : (
        value.map((c, i) => (
          <div key={i} className="flex gap-2 items-start">
            <Select
              value={c.field}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...c, field: e.target.value as ConditionSpec['field'] };
                onChange(next);
              }}
            >
              {CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Select
              value={c.op}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...c, op: e.target.value as ConditionSpec['op'] };
                onChange(next);
              }}
            >
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </Select>
            <Input
              value={displayConditionValue(c.value)}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...c, value: parseConditionValue(c.field, c.op, e.target.value) };
                onChange(next);
              }}
              placeholder={t('dedupRules.form.valuePlaceholder')}
            />
            {c.field === 'hits_in_window' && (
              <Input
                value={c.window ?? ''}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = { ...c, window: e.target.value };
                  onChange(next);
                }}
                placeholder={t('dedupRules.form.windowPlaceholder')}
                className="w-24"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={t('dedupRules.form.removeCondition')}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

interface ActionsEditorProps {
  value: ActionSpec[];
  onChange: (next: ActionSpec[]) => void;
}

function ActionsEditor({ value, onChange }: ActionsEditorProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <Label>{t('dedupRules.form.actions')}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, defaultActionOf('ticket.add_comment')])}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t('common.add')}
        </Button>
      </div>
      {value.map((a, i) => (
        <div key={i} className="space-y-2 rounded border p-3">
          <div className="flex items-center gap-2">
            <Select
              value={a.type}
              onChange={(e) => {
                const next = [...value];
                next[i] = defaultActionOf(e.target.value as ActionType);
                onChange(next);
              }}
              className="flex-1"
            >
              {ACTION_TYPES.map((at) => (
                <option key={at} value={at}>
                  {t(`dedupRules.action.${at.replace('.', '_')}`)}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={t('dedupRules.form.removeAction')}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
          <ActionFields
            action={a}
            onChange={(next) => {
              const list = [...value];
              list[i] = next;
              onChange(list);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ActionFields({
  action,
  onChange,
}: {
  action: ActionSpec;
  onChange: (next: ActionSpec) => void;
}) {
  const { t } = useTranslation();
  switch (action.type) {
    case 'ticket.add_comment':
      return (
        <Textarea
          value={action.body}
          onChange={(e) => onChange({ ...action, body: e.target.value })}
          placeholder={t('dedupRules.form.commentBodyPlaceholder')}
        />
      );
    case 'ticket.transition':
      return (
        <Select
          value={action.to}
          onChange={(e) =>
            onChange({ ...action, to: e.target.value as (typeof CANONICAL_STATUSES)[number] })
          }
        >
          {CANONICAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      );
    case 'notify.email':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={action.to}
            onChange={(e) => onChange({ ...action, to: e.target.value })}
            placeholder={t('dedupRules.form.emailToPlaceholder')}
            aria-label={t('dedupRules.form.emailTo')}
          />
          <Input
            value={action.template}
            onChange={(e) => onChange({ ...action, template: e.target.value })}
            placeholder={t('dedupRules.form.templatePlaceholder')}
            aria-label={t('dedupRules.form.template')}
          />
        </div>
      );
    case 'notify.slack':
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={action.channel ?? ''}
              onChange={(e) => onChange({ ...action, channel: e.target.value || null, user: null })}
              placeholder={t('dedupRules.form.slackChannelPlaceholder')}
              aria-label={t('dedupRules.form.slackChannel')}
            />
            <Input
              value={action.user ?? ''}
              onChange={(e) => onChange({ ...action, user: e.target.value || null, channel: null })}
              placeholder={t('dedupRules.form.slackUserPlaceholder')}
              aria-label={t('dedupRules.form.slackUser')}
            />
          </div>
          <p className="text-xs text-gray-500">{t('dedupRules.form.slackXorHint')}</p>
          <Textarea
            value={action.message}
            onChange={(e) => onChange({ ...action, message: e.target.value })}
            placeholder={t('dedupRules.form.slackMessagePlaceholder')}
          />
        </div>
      );
    case 'notify.webhook':
      return <WebhookFields action={action} onChange={onChange} />;
  }
}

/**
 * Webhook editor with URL + optional JSON payload. The payload is
 * edited as raw text; we try to parse on every keystroke but tolerate
 * invalid JSON (the textarea keeps the bad text so the user can fix
 * it without losing what they typed). Save shows a Zod error if the
 * payload is still invalid at submit time.
 */
function WebhookFields({
  action,
  onChange,
}: {
  action: Extract<ActionSpec, { type: 'notify.webhook' }>;
  onChange: (next: ActionSpec) => void;
}) {
  const { t } = useTranslation();
  const [payloadText, setPayloadText] = useState(() =>
    action.payload ? JSON.stringify(action.payload, null, 2) : ''
  );
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Input
        value={action.url}
        onChange={(e) => onChange({ ...action, url: e.target.value })}
        placeholder={t('dedupRules.form.webhookUrlPlaceholder')}
        aria-label={t('dedupRules.form.webhookUrl')}
      />
      <Textarea
        value={payloadText}
        onChange={(e) => {
          const text = e.target.value;
          setPayloadText(text);
          if (text.trim() === '') {
            setParseError(null);
            onChange({ ...action, payload: null });
            return;
          }
          try {
            const parsed = JSON.parse(text);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              setParseError(t('dedupRules.form.webhookPayloadMustBeObject'));
              return;
            }
            setParseError(null);
            onChange({ ...action, payload: parsed as Record<string, unknown> });
          } catch (err) {
            setParseError(err instanceof Error ? err.message : String(err));
          }
        }}
        placeholder={t('dedupRules.form.webhookPayloadPlaceholder')}
        aria-label={t('dedupRules.form.webhookPayload')}
        className="font-mono text-xs"
        rows={4}
      />
      {parseError && <p className="text-xs text-red-600">{parseError}</p>}
    </div>
  );
}

interface RateLimitEditorProps {
  value: { count: number; window: string } | null;
  onChange: (next: { count: number; window: string } | null) => void;
}

function RateLimitEditor({ value, onChange }: RateLimitEditorProps) {
  const { t } = useTranslation();
  const enabled = value !== null;
  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="rate-limit-enabled"
          checked={enabled}
          onCheckedChange={(checked) =>
            onChange(checked === true ? { count: 1, window: '24h' } : null)
          }
        />
        <Label htmlFor="rate-limit-enabled" className="font-normal">
          {t('dedupRules.form.rateLimitEnable')}
        </Label>
      </div>
      {enabled && (
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Input
            type="number"
            min={1}
            value={value.count}
            onChange={(e) => onChange({ ...value, count: Number(e.target.value) || 1 })}
            placeholder={t('dedupRules.form.rateLimitCount')}
            aria-label={t('dedupRules.form.rateLimitCount')}
          />
          <Input
            value={value.window}
            onChange={(e) => onChange({ ...value, window: e.target.value })}
            placeholder={t('dedupRules.form.windowPlaceholder')}
            aria-label={t('dedupRules.form.rateLimitWindow')}
          />
        </div>
      )}
    </div>
  );
}
