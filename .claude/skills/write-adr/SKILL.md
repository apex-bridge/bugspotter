---
name: write-adr
description: Write or revise an Architecture Decision Record in docs/adr/ in this repo's concise format (decision summary, tables over prose, one rendered Mermaid diagram where a flow exists, appendices for required inventories). TRIGGER when asked to draft, rewrite, shorten or review an ADR, to "make the ADR more concise/readable/visual", or when an issue moves to the needs-adr stage and the ADR is written by hand instead of by adr-agent.
---

# write-adr

The format lives in one place: `docs/adr/TEMPLATE.md`. `scripts/ai-sdlc/generate-adr.mjs`
(the CI `adr-agent`) puts that file in its prompt; this skill points interactive sessions
at the same file, so hand-written and agent-written ADRs look the same.

## Steps

1. Read `docs/adr/TEMPLATE.md` (format and rules) and `docs/adr/README.md` (architecture
   index: which repo owns which component).
2. Read the linked spec in `docs/specs/` in full. Its `ADR:` field is the file name; its
   constraints and acceptance criteria are binding, including any content it requires
   inside the ADR (headings, lists, test categories).
3. Database-related decision: get the real table list instead of guessing:
   ```sh
   node scripts/ai-sdlc/table-inventory.mjs
   ```
4. Check every repo fact you cite against the code and give it a `file:line`.
5. Write the ADR from the template. Main body within about 120 lines; long required
   material in appendices.
6. Render each Mermaid block before committing, e.g.
   `npx @mermaid-js/mermaid-cli -i diagram.mmd -o diagram.svg`.
7. If the spec has check commands for the ADR (grep/awk test cases), run them.
8. Add the row for the new ADR to the index table in `docs/adr/README.md` when the spec
   lists it.

Status stays `Proposed`; the repository owner sets `Accepted` when ratifying.
