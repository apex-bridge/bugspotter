import { describe, it, expect } from 'vitest';
import { parseThresholdInput } from '../../../components/intelligence/threshold-input';

describe('parseThresholdInput', () => {
  it('returns the number for a valid in-range value', () => {
    expect(parseThresholdInput('0.8')).toBe(0.8);
  });

  it('accepts the inclusive boundaries 0 and 1', () => {
    expect(parseThresholdInput('0')).toBe(0);
    expect(parseThresholdInput('1')).toBe(1);
  });

  it('returns null for out-of-range values', () => {
    expect(parseThresholdInput('1.5')).toBeNull();
    expect(parseThresholdInput('-0.1')).toBeNull();
  });

  it('returns null for empty or non-numeric input', () => {
    expect(parseThresholdInput('')).toBeNull();
    expect(parseThresholdInput('abc')).toBeNull();
  });
});
