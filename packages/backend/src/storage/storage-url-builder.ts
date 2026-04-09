/**
 * Storage URL Builder
 * Single Responsibility: Build API URLs for accessing stored resources
 *
 * Separates URL/routing concerns from business logic (workers, services).
 * All API route structures for storage resources are centralized here.
 */

const API_BASE = '/api/v1/storage';

/**
 * Build API URL for screenshot (original or thumbnail)
 */
export function buildScreenshotUrl(
  projectId: string,
  bugReportId: string,
  variant: 'original' | 'thumbnail' = 'original'
): string {
  const filename = variant === 'thumbnail' ? 'thumbnail.jpg' : 'original.png';
  return `${API_BASE}/screenshots/${projectId}/${bugReportId}/${filename}`;
}

/**
 * Build API URL for attachment
 */
export function buildAttachmentUrl(
  projectId: string,
  bugReportId: string,
  filename: string
): string {
  return `${API_BASE}/attachments/${projectId}/${bugReportId}/${filename}`;
}
