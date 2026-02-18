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
| `remote_ssh_key_base64` | string | `""` | Base64 encoded private SSH key (single-line alternative for UIs without multiline input). |
| `remote_https_username` | string | `""` | Username used when `remote_auth_mode=https`. |
| `remote_https_token` | string | `""` | Token/password used when `remote_auth_mode=https`. |
| `git_user_name` | string | `HA Automation Manager` | Git author name for local backup commits. |
| `git_user_email` | string | `ha-automation-manager@local` | Git author email for local backup commits. |

## Recommended Setup

1. Start with local-only mode (`remote_enabled: false`).
2. Verify import/quarantine/restore behavior.
3. Enable remote push only after adding valid credentials.

## Example Configuration for Private GitHub Repository

### SSH (recommended)

Use a dedicated deploy key with write access to the private repository.

```yaml
sync_interval_seconds: 300
remote_enabled: true
remote_url: "git@github.com:pawelpp85/ha-automations-management-backup.git"
remote_branch: "main"
remote_auth_mode: "ssh"
remote_ssh_key: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  <your-private-key-content>
  -----END OPENSSH PRIVATE KEY-----
remote_https_username: ""
remote_https_token: ""
git_user_name: "HA Automation Manager"
git_user_email: "ha-automation-manager@local"
```

Alternative for one-line input forms:

```yaml
remote_ssh_key: ""
remote_ssh_key_base64: "LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0K..."
```

If your environment uses a custom SSH host alias (for example `github-nuc`), set URL like:

```yaml
remote_url: "git@github-nuc:pawelpp85/ha-automations-management-backup.git"
```

If your add-on options form does not support multiline field editing, paste key in one line with escaped newlines:

```yaml
remote_ssh_key: "-----BEGIN OPENSSH PRIVATE KEY-----\\n<line1>\\n<line2>\\n-----END OPENSSH PRIVATE KEY-----"
```

### HTTPS (PAT token)

Use a GitHub Personal Access Token with repository write permissions.

```yaml
sync_interval_seconds: 300
remote_enabled: true
remote_url: "https://github.com/pawelpp85/ha-automations-management-backup.git"
remote_branch: "main"
remote_auth_mode: "https"
remote_ssh_key: ""
remote_ssh_key_base64: ""
remote_https_username: "pawelpp85"
remote_https_token: "github_pat_xxx"
git_user_name: "HA Automation Manager"
git_user_email: "ha-automation-manager@local"
```

## Security Notes

- Store secrets only in add-on options, never in repository files.
- Use a dedicated deploy key or token with least required permissions.
- Test on staging/local Home Assistant only, never on production first.
