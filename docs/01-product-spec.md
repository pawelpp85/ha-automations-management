# Product Specification

## Purpose

The add-on provides a structured management layer for Home Assistant automations, with strong backup capabilities and safe lifecycle controls.

## Main User Outcomes

- Users can quickly organize automations by `category`, `labels`, and `room`.
- Users can identify device-to-automation relationships.
- Users can quarantine automations (remove from HA, keep restorable backup).
- Users can restore quarantined automations or permanently delete them.

## Functional Requirements

1. Automation Overview
- Display all imported automations.
- Allow filtering and grouping by category, labels, and room.
- Allow bulk assignment of category, labels, and room.

2. Device Relationship View
- Display devices used by automations.
- Show many-to-many mapping (one device in many automations and reverse).
- Clicking automation opens edit page in a new browser tab.
- Editing view supports quick assignment of category, labels, and room.

3. Quarantine
- Available from all views.
- Quarantine action removes automation from Home Assistant only after confirmation.
- Quarantined automations stay in backup repository and are displayed as grayed-out.
- Restore action re-creates automation in Home Assistant from stored YAML.
- Permanent delete removes the quarantined record after explicit confirmation.

4. Import and Sync
- Import all existing automations at onboarding.
- Automatically detect newly created HA automations and import them.
- Run periodic sync as fallback if event-based detection misses updates.
- If an imported automation is removed from HA outside the add-on, move it to quarantine automatically and display a warning banner.
- Perform an automatic Git commit after successful auto-import.

5. Git History
- Keep history in a dedicated local repository separate from this project repository.
- Ensure local repository is initialized during add-on setup.
- Commit and push are user-triggered for manual operations.
- Optional remote sync fields in config: remote URL (SSH/HTTPS), key/material, auth fields.
- Remote push is optional and disabled by default.

## Non-Functional Requirements

- English language for code and docs.
- YAML persistence must preserve valid encoding and indentation.
- Use Home Assistant system theme (light/dark), with dark as preferred default styling.
- Disable action buttons when action is not valid.
- Responsive UI for desktop and mobile.
- Include button hints/tooltips with clear usage guidance.
- Add-on startup must not require Home Assistant restart prompts.

## Safety Rules

- Ask for explicit confirmation before any deletion from Home Assistant.
- Every destructive operation must include warning text and undo guidance when available.
