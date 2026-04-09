import type { ResourceType } from '../types/organization';

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatResourceValue(type: ResourceType, value: number): string {
  return type === 'storage_bytes' ? formatBytes(value) : value.toLocaleString();
}
