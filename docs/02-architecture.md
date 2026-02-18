# Architecture Proposal

## High-Level Components

1. Home Assistant Add-on Container
- Backend API server for automation metadata and quarantine operations.
- Ingress-compatible frontend UI.

2. Metadata Store
- Lightweight DB (SQLite) for category, labels, room mapping, and state metadata.
- Tracks imported and quarantined state independently from HA runtime state.

3. Git Backup Repository
- Dedicated local path, for example `/data/automation_backup_repo`.
- Stores YAML snapshots and metadata manifests.

4. Home Assistant Integration
- WebSocket and REST integration for automation list/read/write actions.
- Periodic scheduler for reconciliation jobs.

## Suggested Directory Layout (Implementation Phase)

- `addon/` - add-on manifest and runtime entrypoints
- `backend/` - API, sync engine, git service, HA integration adapters
- `frontend/` - UI for overview, devices, and quarantine
- `docs/` - product and architecture documentation

## Data Model

### AutomationRecord
- `ha_id` (string)
- `title` (string)
- `yaml_path` (string)
- `yaml_hash` (string)
- `category` (string, nullable)
- `labels` (array[string])
- `room` (string, nullable)
- `status` (`active` | `quarantine`)
- `last_seen_in_ha` (datetime)
- `last_imported_at` (datetime)

### DeviceLink
- `device_id` (string)
- `automation_ha_id` (string)
- `relation_type` (trigger | condition | action)

## Backup Repository Format

- `automations/active/<ha_id>.yaml`
- `automations/quarantine/<ha_id>.yaml`
- `metadata/automations.json`
- `metadata/devices.json`

All write operations should be atomic (temp file + rename) and UTF-8 encoded.

## Event Flow

1. Import job reads HA automations.
2. YAML and metadata are persisted locally.
3. Git commit is created with structured message.
4. UI refreshes automation/device indexes.
5. Optional manual push sends commits to remote.
