# HA Automations Management Add-on

Version: `1.0.0b13`

This repository contains the project definition for a Home Assistant add-on focused on automation organization, quarantine backup, and Git-based history.

## Add-on Repository URL

Use this URL in Home Assistant Add-on Store -> Repositories:

`https://github.com/pawelpp85/ha-automations-management`

## Core Goals

- Save and restore automations using a quarantine workflow.
- Organize automations into functional groups for faster maintenance.

## Key Features

- Automation catalog with category, labels, and room assignment.
- Device-centric view showing shared device usage across automations.
- Quarantine mode: remove from Home Assistant while preserving YAML in backup history.
- Local Git repository for change history, with optional remote push.
- Safe actions: delete from Home Assistant only after explicit user confirmation.

## Documentation Index

- `docs/01-product-spec.md` - product requirements and acceptance rules
- `docs/02-architecture.md` - technical architecture proposal
- `docs/03-ui-ux.md` - UI behavior, states, and responsive rules
- `docs/04-git-backup-and-quarantine.md` - Git and quarantine workflows
- `docs/05-release-and-operations.md` - versioning, release, and operations
- `addon/DOCS.md` - add-on configuration reference and security notes
- `CHANGELOG.md` - beta release history

## Current Status

Backend and frontend are available in beta iteration `1.0.0b13`, including Automations, Devices, and Quarantine views.

## Run Add-on UI Locally

```bash
docker build -t ha-automations-management-local -f addon/Dockerfile addon
docker run --rm -p 8099:8099 --name ha-am-local ha-automations-management-local
```

Then open `http://127.0.0.1:8099`.

## Run Tests (Local Only)

Never run tests against production Home Assistant.

```bash
cd addon/rootfs/app
npm test
```

Safety checks in the test suite enforce non-production execution context.
