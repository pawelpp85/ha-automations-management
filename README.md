# HA Automations Management Add-on

Home Assistant add-on for organizing automations and scripts, keeping quarantine backups, and tracking YAML history in a local Git repository.

## Add-on Repository URL

Add this URL in Home Assistant -> Add-on Store -> Repositories:

`https://github.com/pawelpp85/ha-automations-management`

## What Is Implemented

- `Automations` and `Scripts` views with metadata editing: `category`, `labels`, `room`.
- Metadata auto-save (delayed) and sync to Home Assistant.
- Per-column sorting (ASC/DESC) from table headers.
- Fast filtering by name, category, label, room, status.
- `Devices` view with relationships to automations and scripts, including linked script calls.
- Device cards sorted by number of related entities (highest first).
- Quarantine workflow:
  - Move entity out of HA and keep YAML in backup.
  - Restore from quarantine back to HA.
  - Permanently delete from quarantine.
- `History` (raw YAML) view:
  - load/edit YAML,
  - YAML validation,
  - Git history browsing and loading past versions.
- Git actions in UI:
  - `Commit`,
  - `Push` (optional remote),
  - `View changes` (when working tree is dirty),
  - `View last commit` (when no local changes).
- Automatic import from HA on startup and interval, including automatic commits.

## Repository Layout

- `addon/` - Home Assistant add-on package.
- `addon/rootfs/app/src/` - backend API and services.
- `addon/rootfs/app/public/` - web UI.
- `addon/rootfs/app/test/` - automated tests.
- `addon/DOCS.md` - add-on configuration reference.

## Local Run

```bash
docker build -t ha-automations-management-local -f addon/Dockerfile addon
docker run --rm -p 8099:8099 --name ha-am-local ha-automations-management-local
```

Open: `http://127.0.0.1:8099`

## Tests (Local Only)

Never run tests against production Home Assistant.

```bash
cd addon/rootfs/app
npm test
```
