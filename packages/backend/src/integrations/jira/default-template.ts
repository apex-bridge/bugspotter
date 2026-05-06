/**
 * Default Jira description template applied to newly-created auto-create rules
 * when the caller does not provide one. Uses the same {{var}} syntax as
 * `template-renderer.ts`. Mirrors the template that ships in the demo project,
 * with the marketing footer removed for self-hosted/customer Jiras.
 */
export const JIRA_DEFAULT_DESCRIPTION_TEMPLATE = `## {{title}}

{{description}}

---

### Environment

| Field    | Value          |
| -------- | -------------- |
| Priority | {{priority}}   |
| Browser  | {{browser}}    |
| OS       | {{os}}         |
| Page URL | {{url}}        |

### Session Replay

[Watch session replay]({{replay_url}})

### Screenshot

[View screenshot]({{screenshot_url}})
`;
