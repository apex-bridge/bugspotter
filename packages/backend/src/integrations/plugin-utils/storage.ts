/**
 * Storage utilities for custom plugins
 * Provides helpers to get presigned URLs for bug report resources
 */

export interface StorageContext {
  getPresignedUrl: (resourcePath: string, projectId: string) => Promise<string>;
}

export interface BugReportWithResources {
  project_id: string;
  screenshot_url?: string | null;
  replay_url?: string | null;
  video_url?: string | null;
  logs_url?: string | null;
  [key: string]: any;
}

export interface ResourceUrls {
  screenshot?: string;
  replay?: string;
  video?: string;
  logs?: string;
}

/**
 * Get presigned URLs for all available bug report resources
 * @param context - Storage context with getPresignedUrl method
 * @param bugReport - Bug report with resource URLs
 * @returns Object with presigned URLs for available resources
 * @example
 * const urls = await getResourceUrls(context, bugReport);
 * // Returns: { screenshot: "https://...", replay: "https://..." }
 */
export async function getResourceUrls(
  context: StorageContext,
  bugReport: BugReportWithResources
): Promise<ResourceUrls> {
  const urls: ResourceUrls = {};

  const resources: Array<{ key: keyof ResourceUrls; field: string }> = [
    { key: 'screenshot', field: 'screenshot_url' },
    { key: 'replay', field: 'replay_url' },
    { key: 'video', field: 'video_url' },
    { key: 'logs', field: 'logs_url' },
  ];

  for (const resource of resources) {
    const resourcePath = bugReport[resource.field];
    if (resourcePath && typeof resourcePath === 'string') {
      try {
        urls[resource.key] = await context.getPresignedUrl(resourcePath, bugReport.project_id);
      } catch {
        // Skip resources that fail to generate URLs (e.g., missing files)
        continue;
      }
    }
  }

  return urls;
}
