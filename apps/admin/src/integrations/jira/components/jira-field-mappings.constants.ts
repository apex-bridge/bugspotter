export const JIRA_PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;

export type JiraPriority = (typeof JIRA_PRIORITIES)[number];

/**
 * Field type discriminated union for type-safe field configuration
 */
export type FieldConfig =
  | {
      id: 'assignee';
      label: string;
      type: 'user-picker';
    }
  | {
      id: 'priority';
      label: string;
      type: 'select';
    }
  | {
      id: 'components' | 'labels';
      label: string;
      singularLabel: string;
      type: 'tags';
      placeholder: string;
      arrayFormat: 'object' | 'string';
    };

export const FIELD_TYPES: readonly FieldConfig[] = [
  { id: 'assignee', label: 'Assignee', type: 'user-picker' },
  {
    id: 'components',
    label: 'Components',
    singularLabel: 'Component',
    type: 'tags',
    placeholder: 'e.g., Frontend, Backend',
    arrayFormat: 'object',
  },
  {
    id: 'labels',
    label: 'Labels',
    singularLabel: 'Label',
    type: 'tags',
    placeholder: 'e.g., urgent, bug',
    arrayFormat: 'string',
  },
  { id: 'priority', label: 'Priority', type: 'select' },
] as const;
