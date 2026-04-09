/**
 * Renders help text for Jira field IDs
 */
export function JiraHelpText() {
  return (
    <div className="text-xs text-gray-500 space-y-1 pt-2">
      <p>
        <strong>Tip:</strong> You can find Jira field IDs in your Jira instance under Field
        Configuration.
      </p>
      <p>
        Standard fields like <code className="px-1 bg-gray-100 rounded">priority</code>,{' '}
        <code className="px-1 bg-gray-100 rounded">labels</code>, and{' '}
        <code className="px-1 bg-gray-100 rounded">assignee</code> can be used directly.
      </p>
      <p>
        Custom fields use IDs like{' '}
        <code className="px-1 bg-gray-100 rounded">customfield_10001</code>.
      </p>
    </div>
  );
}
