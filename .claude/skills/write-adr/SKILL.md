---
name: write-adr
description: Write, rewrite or review an ADR in docs/adr/ in the repo format (docs/adr/TEMPLATE.md). TRIGGER when asked to draft, shorten or review an ADR, or to write one by hand at the needs-adr stage.
---

# write-adr

The format is defined in `docs/adr/TEMPLATE.md`, the same file the CI `adr-agent`
(`scripts/ai-sdlc/generate-adr.mjs`) uses.

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

An `Accepted` ADR is immutable (`docs/adr/README.md`): a review of one is read-only, and a
changed decision goes into a new ADR that marks the old one `Superseded`. Only a `Proposed`
ADR is rewritten in place.
