# HA Automations Management Add-on

Version: `1.0.0b1`

This repository contains the project definition for a Home Assistant add-on focused on automation organization, quarantine backup, and Git-based history.

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
- `CHANGELOG.md` - beta release history

## Current Status

Project bootstrap documentation is complete for beta iteration `1.0.0b1`. Next step is implementation of add-on backend and frontend according to these documents.
