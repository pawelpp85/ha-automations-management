# HA Automations Management - Configuration

## Purpose

This add-on organizes Home Assistant automations and keeps a local Git-backed backup with quarantine support.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `sync_interval_seconds` | integer (30-3600) | `300` | How often the add-on imports/syncs automations from Home Assistant. |
| `remote_enabled` | boolean | `false` | Enables manual push to external Git repository. Local backup works even when disabled. |
| `remote_url` | string | `""` | Remote Git URL, for example `git@github.com:user/repo.git` or `https://github.com/user/repo.git`. |
| `remote_branch` | string | `main` | Branch name used by manual push action. |
| `remote_auth_mode` | `ssh` or `https` | `ssh` | Authentication mode for remote push. |
| `remote_ssh_key` | string | `""` | Private SSH key content used when `remote_auth_mode=ssh`. |
| `remote_https_username` | string | `""` | Username used when `remote_auth_mode=https`. |
| `remote_https_token` | string | `""` | Token/password used when `remote_auth_mode=https`. |
| `git_user_name` | string | `HA Automation Manager` | Git author name for local backup commits. |
| `git_user_email` | string | `ha-automation-manager@local` | Git author email for local backup commits. |

## Recommended Setup

1. Start with local-only mode (`remote_enabled: false`).
2. Verify import/quarantine/restore behavior.
3. Enable remote push only after adding valid credentials.

## Security Notes

- Store secrets only in add-on options, never in repository files.
- Use a dedicated deploy key or token with least required permissions.
- Test on staging/local Home Assistant only, never on production first.
