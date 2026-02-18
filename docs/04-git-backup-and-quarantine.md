# Git Backup and Quarantine Workflow

## Local Repository Lifecycle

- On first run, initialize local repository if missing.
- Configure user identity for add-on commits.
- Keep repository physically separate from management project source.

## Commit Policy

### Automatic commits
- Trigger after successful auto-import of new automations.
- Trigger after automatic quarantine due to HA-side removal.

### Manual commits
- User can request commit for metadata updates or quarantine actions.

### Push policy
- Push is always explicit user action.
- Push requires optional remote configuration.

## Optional Remote Configuration

Example fields:

- `remote_url`
- `auth_mode` (`ssh` or `https`)
- `ssh_private_key` (if SSH)
- `https_token` (if HTTPS)
- `branch`

If remote configuration is missing, local-only operation must remain fully functional.

## Quarantine Semantics

1. User selects automation and clicks `Quarantine`.
2. Add-on requests confirmation.
3. Automation YAML is stored in quarantine path and committed.
4. Automation is removed from HA.
5. UI marks automation as quarantined and grayed-out.

## Restore Semantics

1. User selects quarantined automation.
2. Add-on validates YAML integrity.
3. Automation is recreated in HA.
4. Backup location is updated and committed.

## Permanent Delete Semantics

- Allowed only for quarantined records.
- Requires explicit confirmation.
- Removes YAML and metadata from backup repository.
