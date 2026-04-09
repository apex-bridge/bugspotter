/**
 * PostgreSQL SSL configuration helper
 *
 * pg-connection-string (used by node-postgres) does NOT properly translate
 * sslmode=allow/prefer/require into ssl.rejectUnauthorized=false in its
 * default parsing mode. Instead, these modes produce ssl={} which inherits
 * Node.js's default rejectUnauthorized=true — effectively behaving like
 * sslmode=verify-full.
 *
 * Additionally, pg's ConnectionParameters merges config with the parsed
 * connection string using: Object.assign({}, config, parse(connectionString))
 * This means parsed values OVERWRITE explicit config options — so passing
 * ssl: { rejectUnauthorized: false } alongside connectionString is useless
 * because pg-connection-string's ssl: {} overwrites it.
 *
 * To work around both issues, this module strips sslmode from the connection
 * string for the broken cases and returns the corrected ssl config separately.
 * All other sslmode values (disable, verify-ca, verify-full) are handled
 * correctly by pg-connection-string and are left untouched.
 *
 * @see https://www.postgresql.org/docs/current/libpq-ssl.html#LIBPQ-SSL-SSLMODE-STATEMENTS
 */

import type pg from 'pg';

type PoolSslConfig = pg.PoolConfig['ssl'];

export interface SslOverride {
  /** Connection string with sslmode stripped (so pg-connection-string won't produce ssl: {}) */
  connectionString: string;
  /** Corrected ssl config for pg.Pool */
  ssl: PoolSslConfig;
}

/**
 * Parse sslmode from a PostgreSQL connection string URL and return a corrected
 * ssl config for pg.Pool when pg-connection-string gets it wrong.
 *
 * For sslmode=allow/prefer/require (the broken cases), returns a SslOverride
 * containing the connection string with sslmode removed and the correct ssl config.
 * The sslmode must be stripped because pg's ConnectionParameters overwrites
 * explicit config with parsed connection string values.
 *
 * Returns undefined for all other modes, letting pg-connection-string's
 * own parsing take effect — including its handling of sslrootcert, sslcert,
 * sslkey, verify-ca, verify-full, and disable.
 */
export function buildSslConfig(connectionString: string): SslOverride | undefined {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    // If URL parsing fails, let pg handle it with its own parser
    return undefined;
  }

  const sslmode = url.searchParams.get('sslmode');

  if (!sslmode) {
    return undefined;
  }

  switch (sslmode) {
    case 'allow':
    case 'prefer':
    case 'require':
      // Strip sslmode from the connection string so pg-connection-string
      // won't produce ssl: {} that overwrites our explicit ssl config.
      url.searchParams.delete('sslmode');
      return {
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: false },
      };

    default:
      // All other modes (disable, verify-ca, verify-full, no-verify, etc.)
      // are handled correctly by pg-connection-string — don't override.
      return undefined;
  }
}
