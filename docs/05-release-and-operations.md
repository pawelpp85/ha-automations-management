# Release and Operations Guide

## Beta Versioning

Use beta tags for iterative testing:

- `1.0.0b1`, `1.0.0b2`, `1.0.0b3`, ...

Every logical implementation milestone should:

1. Bump beta version.
2. Update `CHANGELOG.md`.
3. Create commit.
4. Push for test availability.

## Suggested Commit Message Pattern

- `feat(scope): summary`
- `fix(scope): summary`
- `docs(scope): summary`

Examples:

- `feat(sync): auto-quarantine removed automations`
- `feat(ui): add room and label bulk assignment`
- `docs(spec): define backup repository format`

## Startup and HA Behavior

- Add-on should expose startup/progress page and health status.
- Home Assistant should not require restart confirmation for normal add-on start.

## Backup Integration Note

- HA backup should include add-on data volume so Git history and quarantine state are recoverable.

## Testing Checklist (Before Each Beta Push)

- Import and periodic sync work correctly.
- YAML round-trip keeps valid indentation/encoding.
- Quarantine/restore/delete actions enforce confirmations.
- Disabled buttons correctly represent action validity.
- Desktop/mobile layouts are usable.
- Light/dark theme compatibility is verified.
