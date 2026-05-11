/**
 * Default Linear description template applied to newly-created auto-create
 * rules when the caller does not provide one.
 *
 * Linear renders Markdown natively, so we use a plain Markdown body (no
 * ADF). Variables follow the same mustache convention as the Jira default
 * template — handled by `renderCustomTemplate`.
 */
export const LINEAR_DEFAULT_DESCRIPTION_TEMPLATE = `## {{title}}

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
