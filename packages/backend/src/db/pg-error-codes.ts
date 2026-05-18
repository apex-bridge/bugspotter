/**
 * Postgres SQLSTATE codes used by application code to disambiguate
 * expected error conditions from real failures.
 *
 * Reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 *
 * Keep this file small — only add a code when at least two callsites
 * need to match on it. The single-callsite case is better served by
 * an inline string with a one-line comment.
 */

/**
 * `unique_violation` — a write violated a UNIQUE constraint (or a
 * UNIQUE partial index). Callers typically catch this to translate
 * the raw error into a friendlier 409 Conflict instead of letting the
 * pg driver's generic error surface as a 500.
 */
export const PG_UNIQUE_VIOLATION = '23505';
