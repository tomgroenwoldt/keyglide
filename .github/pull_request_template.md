## What does this change?

<!-- A sentence or two. Link the issue if there is one: Fixes #123 -->

## Why?

<!-- What problem does it solve? Skip if the "what" already covers it. -->

## How did you test it?

<!-- What you actually ran or clicked through. -->

## Checklist

- [ ] Lint and format pass (`just -f frontend/Justfile lint check-format`, `cargo clippy`)
- [ ] `cargo test` passes in `editor-service/` (only if you touched the PTY or sandbox)
- [ ] Database changes are a new migration, not an edit to an existing one
- [ ] New tables have row level security enabled with explicit policies
- [ ] `frontend/src/database.types.ts` regenerated if the schema changed
