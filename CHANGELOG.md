# Changelog

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
