import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { buildSslConfig } from '../../src/db/ssl.js';

// Access pg's internal ConnectionParameters (CJS) to prove the Object.assign bug
const require = createRequire(import.meta.url);
const ConnectionParameters = require('pg/lib/connection-parameters');

const DB_URL = 'postgresql://user:pass@host:5432/db?sslmode=require';

describe('pg ConnectionParameters Object.assign bug (proves the root cause)', () => {
  it('BUG: explicit ssl option is overwritten when connectionString contains sslmode', () => {
    // This is exactly what the old code did — pass both connectionString and ssl
    const params = new ConnectionParameters({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
    });

    // pg does: Object.assign({}, config, parse(connectionString))
    // parse() returns ssl: {} which OVERWRITES our { rejectUnauthorized: false }
    // Result: rejectUnauthorized is undefined → Node.js defaults to true
    expect(params.ssl).toEqual({});
    expect(params.ssl.rejectUnauthorized).toBeUndefined(); // Bug! Our value was lost
  });

  it('FIX: stripping sslmode from connectionString lets our ssl option survive', () => {
    const override = buildSslConfig(DB_URL);
    expect(override).toBeDefined();

    // Now use the cleaned connection string (no sslmode) + explicit ssl
    const params = new ConnectionParameters({
      connectionString: override!.connectionString,
      ssl: override!.ssl,
    });

    // parse() no longer produces ssl: {} because sslmode is gone
    // Our explicit ssl: { rejectUnauthorized: false } survives
    expect(params.ssl).toEqual({ rejectUnauthorized: false });
    expect(params.ssl.rejectUnauthorized).toBe(false); // Fix works!
  });
});

describe('buildSslConfig', () => {
  it('returns undefined when no sslmode parameter is present', () => {
    const result = buildSslConfig('postgresql://user:pass@localhost:5432/db');
    expect(result).toBeUndefined();
  });

  it('returns undefined for unparseable connection string', () => {
    const result = buildSslConfig('not-a-url');
    expect(result).toBeUndefined();
  });

  it('returns ssl override with sslmode stripped for sslmode=require', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=require');
    expect(result).toEqual({
      connectionString: 'postgresql://user:pass@host:5432/db',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('returns ssl override with sslmode stripped for sslmode=prefer', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=prefer');
    expect(result).toEqual({
      connectionString: 'postgresql://user:pass@host:5432/db',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('returns ssl override with sslmode stripped for sslmode=allow', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=allow');
    expect(result).toEqual({
      connectionString: 'postgresql://user:pass@host:5432/db',
      ssl: { rejectUnauthorized: false },
    });
  });

  it('returns undefined for sslmode=disable (handled by pg-connection-string)', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=disable');
    expect(result).toBeUndefined();
  });

  it('returns undefined for sslmode=verify-full (handled by pg-connection-string)', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=verify-full');
    expect(result).toBeUndefined();
  });

  it('returns undefined for sslmode=verify-ca (handled by pg-connection-string)', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=verify-ca');
    expect(result).toBeUndefined();
  });

  it('returns undefined for unknown sslmode value', () => {
    const result = buildSslConfig('postgresql://user:pass@host:5432/db?sslmode=unknown');
    expect(result).toBeUndefined();
  });

  it('preserves other query parameters when stripping sslmode', () => {
    const result = buildSslConfig(
      'postgresql://user:pass@host:5432/db?sslmode=require&application_name=bugspotter'
    );
    expect(result).toBeDefined();
    expect(result!.ssl).toEqual({ rejectUnauthorized: false });
    expect(result!.connectionString).toContain('application_name=bugspotter');
    expect(result!.connectionString).not.toContain('sslmode');
  });

  it('handles postgres:// scheme (alias)', () => {
    const result = buildSslConfig('postgres://user:pass@host:5432/db?sslmode=require');
    expect(result).toBeDefined();
    expect(result!.ssl).toEqual({ rejectUnauthorized: false });
    expect(result!.connectionString).not.toContain('sslmode');
  });
});
