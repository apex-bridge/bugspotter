/**
 * Common Jira field ID suggestions with default values
 */
export const JIRA_FIELD_SUGGESTIONS = [
  { value: 'priority', label: 'Priority', suggestedValue: 'priority' },
  { value: 'labels', label: 'Labels', suggestedValue: '["auto-created"]' },
  { value: 'assignee', label: 'Assignee', suggestedValue: '' },
  { value: 'components', label: 'Components', suggestedValue: '' },
  { value: 'fixVersions', label: 'Fix Versions', suggestedValue: '' },
  { value: 'duedate', label: 'Due Date', suggestedValue: '' },
  { value: 'customfield_10001', label: 'Custom Field (example)', suggestedValue: '' },
];

/**
 * BugSpotter bug report fields that can be mapped to external ticket systems
 */
export const BUGSPOTTER_FIELD_SUGGESTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'metadata.url', label: 'URL' },
  { value: 'metadata.userAgent', label: 'User Agent' },
  { value: 'metadata.browser', label: 'Browser' },
  { value: 'metadata.os', label: 'Operating System' },
  { value: 'screenshot_url', label: 'Screenshot URL' },
  { value: 'replay_url', label: 'Replay URL' },
];
