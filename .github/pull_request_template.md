## What changes?

<!-- New template, template update, or a change to the format / test code? Describe it briefly. -->

## Plugin

- Modrinth project ID: <!-- e.g. Vebnzrzj (not the slug!) -->
- Spigot resource ID: <!-- e.g. 28140 -->
- Tested plugin version (`tested_with`):
- Tested on (software + MC version): <!-- e.g. Paper 1.21.11 -->

## Checklist

- [ ] `npm test` and `npm run validate` pass
- [ ] Ran `npm run build` and committed `dist/index.json`
- [ ] `npm run test-install -- <id>` passes locally (or the PR install test is green)
- [ ] Tested by hand on a real server (install **and** uninstall)
- [ ] Config paths checked against the plugin's default config / docs (source linked below)
- [ ] Only options a regular customer actually wants to change
- [ ] All `config` steps use `mode: merge`
- [ ] Every `allocation` is allocated in `steps` and released in `uninstall`
- [ ] No real secrets, tokens, names or email addresses
- [ ] `script` only where fixed actions can't do it – the reason is a comment in the template

## Sources

<!-- Links to the default config, docs or source code you checked the paths against. -->
