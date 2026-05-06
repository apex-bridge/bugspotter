/**
 * Default Jira ticket body used when an auto-create rule is created without
 * an explicit `description_template`. Mirrors the body that ships in the demo
 * project, with the marketing footer removed for self-hosted/customer Jiras.
 * The {{var}} syntax is resolved by `template-renderer.ts` at ticket-creation time.
 */
export const DEFAULT_JIRA_TICKET_BODY = `## {{title}}

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
