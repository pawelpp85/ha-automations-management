# Repository Guidelines

## Project Structure & Module Organization
This repository is currently in bootstrap state. Use the layout below for all new contributions so the project grows consistently:

- `src/`: automation logic and reusable modules
- `tests/`: unit/integration tests mirroring `src/`
- `scripts/`: local developer utilities (setup, lint, release helpers)
- `docs/`: architecture notes, runbooks, and decision records
- `assets/`: static files used by docs or tooling

Keep modules focused and small. Prefer one responsibility per file.

## Build, Test, and Development Commands
No canonical toolchain is committed yet. Every PR that introduces tooling must also add executable scripts or a `Makefile` target. Recommended baseline:

- `make setup`: install dependencies and local prerequisites
- `make test`: run the full test suite
- `make lint`: run formatters and linters
- `make check`: run lint + tests as a pre-merge gate

If you use language-specific commands (for example `pytest`, `npm test`, or `mvn test`), document them in `README.md` and mirror them in `make` targets.

## Coding Style & Naming Conventions
Use 4 spaces for Python/YAML-heavy files and keep line length near 100 chars unless tooling enforces otherwise.

- Files/modules: `snake_case`
- Classes: `PascalCase`
- Functions/variables: `snake_case`
- Constants/env keys: `UPPER_SNAKE_CASE`

Run formatting/linting before opening a PR. If no formatter exists yet, add one with project defaults and document it.

## Testing Guidelines
Place tests in `tests/` with names like `test_<feature>.py` (or equivalent for your language). Include at least:

- Happy-path behavior
- One failure/edge case per feature
- Regression tests for bug fixes

Treat new features without tests as incomplete.

## Commit & Pull Request Guidelines
Git history is not initialized here yet, so adopt this convention now:

- Commit format: `type(scope): short summary` (for example, `feat(auth): add token refresh`)
- Keep commits atomic and focused
- Reference issue IDs in commit/PR text when applicable

PRs should include: purpose, key changes, test evidence (command + result), and rollback notes for risky changes.
