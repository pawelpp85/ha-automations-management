# Changelog

## 1.0.0b19 - 2026-02-18

- Improved filter matching in UI:
  - spaces in filter queries now act like flexible separators (`hall front` matches `hall_front`, `hall-front`, etc.).
  - applied to automation and devices filters.
- Devices view:
  - added `Quarantine` action next to `History` per automation.
  - changed default sort order to show devices with the highest number of linked automations first.
  - clicking device name now opens Home Assistant device page in a new tab.
- Added regression test for device sorting by automation count.
- Fixed device reference parser to avoid treating service names (for example `light.turn_on`) as device/entity references.
- Bumped add-on metadata version to `1.0.0b19`.

## 1.0.0b18 - 2026-02-18

- Added `Permanent delete` action directly in main `Automations` table for rows already in `quarantine`.
- This allows full removal from add-on catalog/backup without switching tabs.
- Bumped add-on metadata version to `1.0.0b18`.

## 1.0.0b17 - 2026-02-18

- Startup/ingress reliability:
  - Server now starts listening immediately, while add-on services initialize in background.
  - API endpoints return clear `503` initialization response until backend is ready.
  - Added startup details to `/api/health`.
  - Frontend now retries initial load when backend is still initializing.
- Import reliability:
  - WS import now skips stale automation entity-registry entries when both runtime state and config are missing.
  - This prevents removed automations from reappearing due orphaned registry entries.
- Added HA client test for stale registry entry skipping.
- Bumped add-on metadata version to `1.0.0b17`.

## 1.0.0b16 - 2026-02-18

- Updated dark theme colors to be less purple and much darker.
- Set UI elements/panels to near-black backgrounds.
- Adjusted page background to black with subtle burgundy gradients.
- Bumped add-on metadata version to `1.0.0b16`.

## 1.0.0b15 - 2026-02-18

- UI updates:
  - Changed `Open edit` to `Edit`.
  - Renamed `Raw` actions to `History` in Automations/Devices/Quarantine.
  - Kept only `Import` action in top toolbar (removed `Sync` button).
  - Grouped `Commit` and `Push` into `YAML repository` section.
  - Restyled navigation to true tab-like appearance (`Automations`, `Devices`, `Quarantine`, `History`).
  - Added label chip editor in Automations metadata (labels are no longer plain comma-only text input).
  - Switched theme accents/background from green tint to dark burgundy palette.
- Metadata flow:
  - `Save meta` now tries to synchronize category/labels/room to Home Assistant immediately (with warning when HA mapping fails).
  - Persisted metadata changes to local YAML backup snapshot.
- Git UX:
  - Added repository status endpoint and commit availability state.
  - `Commit` button is disabled when there are no backup changes.
- Toast UX:
  - Popup messages now stay visible at least 15 seconds.
  - Popup will not disappear while mouse cursor is over it.
- Added documentation note how to generate `remote_ssh_key_base64` from private key.
- Bumped add-on metadata version to `1.0.0b15`.

## 1.0.0b14 - 2026-02-18

- Added Home Assistant category registry mapping (`category_id -> category name`) during import.
- Fixed category display where raw IDs like `01K...` were shown instead of names like `alarm`.
- Improved Devices view action layout: per-automation split action with main edit button and highlighted `History` action.
- Renamed device-level `Raw` action to `History`.
- Bumped add-on metadata version to `1.0.0b14`.

## 1.0.0b13 - 2026-02-18

- Added `Devices` filter by device name/ID in UI.
- Added `Automations` filter by status (`active`, `disabled`, `quarantine`).
- Improved device reference extraction from YAML templates, including patterns like `{{ states('input_select.hall_scenes') }}`.
- Added `device_id` UUID resolution to entity IDs via Home Assistant device/entity registry cache.
- Added `Raw configuration` auto-load on automation selection change.
- Added raw YAML validator endpoint and UI action (`Validate YAML`) with basic lint warnings.
- Added `remote_ssh_key_base64` option for environments where multiline key input is not available.
- Bumped add-on metadata version to `1.0.0b13`.

## 1.0.0b12 - 2026-02-18

- Improved Git push error diagnostics for SSH auth failures (`libcrypto`, `publickey`, missing commits).
- Added robust SSH key parsing for push: supports both multiline key and escaped `\\n` single-line format.
- Added documentation note for environments without multiline option textbox support.
- Bumped add-on metadata version to `1.0.0b12`.

## 1.0.0b11 - 2026-02-18

- Added explicit HA runtime state support for automations: UI now shows `disabled` when automation exists but is turned off in Home Assistant.
- Added safer auto-quarantine policy: automation must be missing in consecutive checks before quarantine (prevents false positives).
- Added automation ID normalization to avoid mismatch due hidden/control characters.
- Improved HA classification import source by including entity registry labels/area/category when available.
- Added additional quarantine decision logs for better diagnostics.
- Bumped add-on metadata version to `1.0.0b11`.

## 1.0.0b10 - 2026-02-18

- Added filter suggestions (`datalist`) for automation name, category, label, and room.
- Added quick `Filter` actions from automation row metadata fields (category/label/room).
- Added `Raw configuration` tab with YAML editor, Git history list, history version loading, and save-to-commit flow.
- Added filter by automation name in main view.
- Updated `Open edit` to use HA edit identifier (`edit_id`/`unique_id`) when available, with fallback to entity ID.
- Added warning management: clear single warning or clear all warnings from UI.
- Added safer quarantine logic: verify missing automation in HA before auto-quarantine to prevent false positives.
- Added metadata import from YAML (`category`, `labels`, `room`, including `metadata`/`meta` section).
- Improved Git push diagnostics and branch handling (`HEAD:target_branch`) to avoid `src refspec main does not match any`.
- Bumped add-on metadata version to `1.0.0b10`.

## 1.0.0b9 - 2026-02-18

- Fixed ingress UI API path resolution (no more frontend `404` from Home Assistant root `/api/*` routes).
- Unified automation identity to `entity_id` and added legacy ID migration during import.
- Added cleanup of legacy quarantine entries created by older ID mapping.
- Added add-on icon asset `addon/icon.png` and linked it in `addon/config.yaml`.
- Bumped add-on metadata version to `1.0.0b9`.

## 1.0.0b8 - 2026-02-18

- Added log time prefix (`HH:MM:SS.mmm`, no date) for backend logs.
- Hardened missing-endpoint detection for HA automation config API (`404/405`) to stop per-automation log spam.
- Added resilient import loop: single automation import failure no longer aborts full import.
- Added clear import summary logs and API fields (`discovered`, `changed`, `failed`, `active`, `quarantine`, `tracked`).
- Updated UI sync/import toast messages to show discovered/changed/failed counts.
- Bumped add-on metadata version to `1.0.0b8`.

## 1.0.0b7 - 2026-02-18

- Reworked Home Assistant communication using websocket-first strategy (`/api/websocket`) modeled after `z2m_proxies_checkout`.
- Added fallback chain for automation import: websocket -> REST config endpoints -> `/api/states` + `/config/automations.yaml`.
- Removed repetitive per-automation 404 log spam when config endpoints are unavailable.
- Forced container entrypoint through `bash` in Docker image to avoid shebang-related `s6-envdir` failures.
- Mounted `config:rw` in add-on manifest to allow YAML fallback reads from `/config/automations.yaml`.
- Initialized local backup Git repository with default branch `main` to remove `master` hint noise.
- Bumped add-on metadata version to `1.0.0b7`.

## 1.0.0b6 - 2026-02-18

- Fixed local container startup: entrypoint now works both in HA (`with-contenv`) and plain Docker.
- Implemented functional web UI with three views: `Automations`, `Devices`, and `Quarantine`.
- Added UI actions for metadata updates, quarantine/restore/permanent-delete, import/sync, and manual Git commit/push.
- Added responsive layout, tooltips/hints, warning banner, and disabled-button logic for invalid actions.
- Bumped add-on metadata version to `1.0.0b6`.

## 1.0.0b5 - 2026-02-18

- Added root `repository.yaml` so Home Assistant can validate this GitHub repository as an add-on repository.
- Added required `arch` matrix in `addon/config.yaml`.
- Enabled `homeassistant_api` and `hassio_api` in add-on config for API integration.
- Bumped add-on metadata version to `1.0.0b5`.

## 1.0.0b4 - 2026-02-18

- Added complete example configurations for private GitHub repositories in `addon/DOCS.md`.
- Added both SSH and HTTPS token examples, including custom SSH host alias usage.
- Bumped add-on metadata version to `1.0.0b4`.

## 1.0.0b3 - 2026-02-18

- Added automated test suite for backend services (`store`, `git backup`, `automation service`).
- Added test safety checks to block production-mode test execution.
- Added npm test scripts for local and CI test runs.
- Added configuration option explanations in `addon/config.yaml` and `addon/DOCS.md`.
- Updated add-on version metadata to `1.0.0b3`.

## 1.0.0b2 - 2026-02-18

- Implemented Home Assistant add-on runtime skeleton (`config.yaml`, `Dockerfile`, entrypoint).
- Added backend API for import/sync, metadata updates, quarantine/restore, and Git actions.
- Added local-first Git backup service with automatic repository initialization.
- Added periodic sync and startup import with automatic commit on detected imports.

## 1.0.0b1 - 2026-02-18

- Created initial project scope and architecture documentation.
- Defined data model for categories, labels, rooms, and quarantine.
- Defined local-first Git backup workflow with optional remote push.
- Defined UX requirements for automation/device views and quarantine controls.
- Defined safety constraints, import/sync behavior, and release process.
