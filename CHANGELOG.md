# Changelog

Changes to the **template format** (`schema/template.schema.json`). Template updates are not listed here.

## Format 1 – 2026-11-16

- Initial version: `match`, `meta`, `requirements`, `groups`, `options` (13 field types), `bundle`, `steps`,
  `uninstall`, `variants`, `on_error`.
- Conditions with a fixed structure (`field` + operator, `all` / `any` / `not`).
- Placeholders `{{ options.* }}`, `{{ server.* }}`, `{{ script.* }}`. A string that is exactly one placeholder keeps the
  value's type.
- Optional `test` block (`options`, `software`, `skip`) for the automated install test; panels ignore it.
