/**
 * Helpers for editing a notification channel's config.
 *
 * Two things make the edit form's config round-trip non-obvious:
 *
 * 1. The API deliberately withholds the credential-bearing fields on read (see
 *    the backend's notification-schema.ts), so the form shows them blank. A
 *    blank one means "unchanged", not "cleared" - sending it back would
 *    overwrite a stored SMTP password or webhook URL with an empty string.
 * 2. Form inputs hold strings, but the stored config is typed: `smtp_port` is a
 *    number, `smtp_secure` a boolean, `headers` an object. Writing the raw form
 *    strings back would retype the column.
 *
 * The backend merges what it receives over what it has, so keys left out here
 * keep their stored value - which is also why the form only ever sends the
 * fields it actually renders.
 */

/** Config keys the API never returns, and which the form therefore shows blank. */
export const WRITE_ONLY_CONFIG_KEYS = [
  'smtp_pass',
  'webhook_url',
  'auth_value',
  'signature_secret',
  'headers',
] as const;

const WRITE_ONLY = new Set<string>(WRITE_ONLY_CONFIG_KEYS);

/**
 * Config keys the edit form renders. Anything outside this set (`mentions`,
 * `retry_policy`, `auth_type`, ...) is left untouched rather than round-tripped
 * through a text input, and survives via the backend's merge.
 */
const EDITABLE_CONFIG_KEYS = new Set([
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_secure',
  'from_address',
  'from_name',
  'webhook_url',
  'channel',
  'url',
  'method',
  'headers',
]);

const NUMBER_CONFIG_KEYS = new Set(['smtp_port']);
const BOOLEAN_CONFIG_KEYS = new Set(['smtp_secure']);

/**
 * True when a config field is one the API withholds - the form renders these
 * with a "leave blank to keep the stored value" hint.
 */
export function isWriteOnlyConfigKey(key: string): boolean {
  return WRITE_ONLY.has(key);
}

/**
 * Seed form state from a channel's config: the rendered fields only, as
 * strings. Absent and null values are skipped, so a withheld credential stays
 * blank rather than becoming the string "undefined".
 */
export function toFormConfig(config: Record<string, unknown> | null | undefined) {
  const form: Record<string, string> = {};

  for (const [key, value] of Object.entries(config ?? {})) {
    if (!EDITABLE_CONFIG_KEYS.has(key) || value === null || value === undefined) {
      continue;
    }
    // `headers` is the one object the form renders, as JSON in a textarea. It
    // is write-only, so in practice it never arrives - handled for symmetry.
    form[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  return form;
}

export type ChannelConfigUpdate =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: 'invalid-headers' };

/**
 * Turn form state into the `config` for a PATCH: blank credentials dropped so
 * they keep their stored value, and the typed fields coerced back off strings.
 */
export function buildChannelConfigUpdate(formConfig: Record<string, string>): ChannelConfigUpdate {
  const config: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(formConfig)) {
    // Blank credential: the user did not touch it, so leave it alone. A
    // non-blank one is a deliberate replacement. Blanking a non-secret field
    // (`from_name`, say) is a real edit and is sent as an empty string.
    if (WRITE_ONLY.has(key) && value === '') {
      continue;
    }

    if (key === 'headers') {
      // Whitespace is insignificant in JSON, so a textarea holding only spaces
      // is "untouched" for the same reason an empty one is.
      if (value.trim() === '') {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return { ok: false, error: 'invalid-headers' };
      }

      // The webhook handler spreads this straight into the outgoing request
      // headers, so anything that is not a plain object - `null`, `[...]`,
      // `"x"`, `5` - parses fine and then corrupts every delivery. Reject it
      // here rather than store it.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'invalid-headers' };
      }

      config.headers = parsed;
      continue;
    }

    if (NUMBER_CONFIG_KEYS.has(key)) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        config[key] = parsed;
      }
      continue;
    }

    if (BOOLEAN_CONFIG_KEYS.has(key)) {
      config[key] = value === 'true';
      continue;
    }

    config[key] = value;
  }

  return { ok: true, config };
}
