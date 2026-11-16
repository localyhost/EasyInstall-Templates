# Contributing

Thanks for helping! The quick tutorial for creating a template is in the [README](README.md#quick-tutorial-create-a-template),
and the full format is in the [wiki](https://github.com/localyhost/EasyInstall-Templates/wiki).

## Rules

- **Few options.** Only what a regular customer actually wants to change. Everything else stays at the plugin default.
- **Always `mode: merge`** in `config` steps, so the plugin's other settings and comments are kept.
- **Clean up.** Every `allocation` is released in `uninstall`; deleting plugin data uses `ask: true`.
- **No secrets.** No real tokens, passwords, names or email addresses, not even under `test.options`.
- **`script` only with a reason.** Use fixed actions where possible and add a comment explaining why a script is needed.
- **Honest `tested_with`.** Enter the plugin version you actually tested.
- **Verified paths.** Take config paths from the plugin's default config or source and link the source in the PR.
  If you can't verify something, add `# TODO: verify` and set `enabled: false`.

## Testing a plugin by hand

1. Start a fresh Paper server with the plugin and let it generate its config.
2. Apply the template's config values by hand and restart. Check that the plugin uses them.
3. Run `npm run test-install -- <id>`. It performs the same steps automatically (needs Java 25).

## Updating a template

- Bump `meta.tested_with` and `meta.updated` after re-testing.
- `npm run validate` warns when `meta.updated` is older than 180 days.
- Run `npm run build` and commit `dist/index.json`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) in English, e.g.
`feat(templates): add essentialsx`, `fix(luckperms): correct storage key`, `docs: explain allocations`.
