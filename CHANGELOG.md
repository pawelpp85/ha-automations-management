# Changelog

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
