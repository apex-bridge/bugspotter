I'll inspect the relevant admin UI files and backend SSO pieces to write an accurate spec.

---

_Tool: bash_

### Parameters:

```json
{
  "command": "ls apps/admin/src/pages/ && echo --- && cat apps/admin/src/App.tsx",
  "description": "List admin pages and view App.tsx routing"
}
```

### Result:

```
admin-organizations.tsx
audit-login.tsx
bug-report-detail.tsx
bug-reports.tsx
dashboard-layout-wrapper.tsx
dedup-rules.tsx
dashboard.tsx
health.tsx
integrations.tsx
integrations-connect.tsx
login.tsx
notifications.tsx
onboarding.tsx
```
