import { AppError } from '../errors.js';

const DEFAULT_THRESHOLD = 0.8;
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 1;

export function resolveThreshold(value?: number | null): number {
  if (value === undefined || value === null) {
    return DEFAULT_THRESHOLD;
  }
  if (value < MIN_THRESHOLD) {
    throw new AppError(`Threshold must be >= ${MIN_THRESHOLD}`, 422);
  }
  if (value > MAX_THRESHOLD) {
    throw new AppError(`Threshold must be <= ${MAX_THRESHOLD}`, 422);
  }
  return value;
}
