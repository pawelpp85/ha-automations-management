# UI and UX Specification

## Views

1. Automations View
- Table/cards of all automations with status, category, labels, and room.
- Fast filters by category/label/room.
- Bulk edit panel for metadata assignment.
- Quarantined rows are visually grayed-out.

2. Devices View
- Device list with count of linked automations.
- Expand/click device to view linked automations.
- Clicking automation opens edit page in a new tab.

3. Quarantine View
- Dedicated list of quarantined automations.
- Actions: restore, view YAML, permanently delete.

## Interaction Rules

- Disable buttons when operation is invalid.
- Before deleting from HA, always show confirmation modal.
- Use contextual tooltips/hints on key controls:
  - `Quarantine`: remove from HA and keep backup
  - `Restore`: recreate in HA from backup
  - `Permanent Delete`: remove backup entry forever

## Theming and Accessibility

- Respect Home Assistant system theme automatically.
- Dark mode should be tuned first, light mode supported equally.
- Ensure color contrast for gray quarantine rows remains readable.
- Provide keyboard-focus visibility and mobile-friendly hit targets.

## Responsive Behavior

- Desktop: split panels for filters and list.
- Mobile: stacked layout with sticky action bar.
- Quick actions should require minimal scrolling on mobile.
