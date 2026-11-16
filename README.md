# localyhost Easy Install Templates

The install scripts behind **Easy Install** at localyhost.

Our panel shows Minecraft plugins live from Modrinth and SpigotMC. For selected plugins, there is an
**"Easy Install"** button. This repo contains the scripts (templates) behind that button. They do everything beyond
"put the jar into `plugins/`": open ports, install dependencies, set config values and show you a simple form.

Here you can:

- **see** exactly what Easy Install does on your server
- **request** a template for a plugin you'd like ([template request](https://github.com/localyhost/EasyInstall-Templates/issues/new?template=template-request.yml))
- **report** a broken one ([template broken](https://github.com/localyhost/EasyInstall-Templates/issues/new?template=template-broken.yml))
- **submit** your own template as a pull request: our team reviews it and every template is tested on a real server

All templates are tested automatically every day. Broken ones show up as issues titled
"Install script &lt;id&gt; is broken".

📖 **Full documentation: [Wiki](https://github.com/localyhost/EasyInstall-Templates/wiki)** (template format, panel integration, script API, tests)

```
Plugin store (Modrinth / Spiget API)
        │  project ID / resource ID
        ▼
dist/index.json ──► templates/<id>/template.yaml ──► form for the customer ──► steps on the server
 (lookup + sha256)    (options, steps, uninstall)     (switches, sliders …)    (install, config, restart …)
```

## Repository layout

```
templates/<id>/template.yaml   one template per folder (folder name = template ID)
templates/<id>/files/          optional files the template copies to the server
templates/_starter/            commented starter template (not in the index)
schema/template.schema.json    JSON Schema (draft 2020-12) – autocompletion in VS Code
dist/index.json                generated index, do not edit by hand
tools/                         validation and tests only
test/                          unit tests + broken fixtures for every check
```

## Quick tutorial: create a template

**1. Find the plugin IDs**

- Modrinth: open `https://api.modrinth.com/v2/project/<slug>` and copy `"id"` (8 characters, **not** the slug).
- Spigot: the number at the end of the resource URL, e.g. `…/resources/luckperms.28140/` → `28140`.

**2. Copy the starter**

```bash
cp -r templates/_starter templates/my-plugin
```

**3. Fill it in.** Open `templates/my-plugin/template.yaml` in VS Code with the
[YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml). You get autocompletion and
errors right away. A minimal template with one option looks like this:

```yaml
# yaml-language-server: $schema=../../schema/template.schema.json
schema: 1

match:
  modrinth:
    project_id: AbCd1234

meta:
  enabled: true
  maintainer: "your-name"
  tested_with: "1.2.3"
  updated: 2026-11-16

options:
  - key: welcome
    type: text
    label: Welcome message
    default: "Hello!"

steps:
  - action: install
    target: main
  - action: first_start            # start once so the plugin writes its config
    wait_for: plugins/MyPlugin/config.yml
  - action: config
    file: plugins/MyPlugin/config.yml
    mode: merge
    values:
      messages.welcome: "{{ options.welcome }}"
  - action: restart

uninstall:
  - action: delete
    paths: [plugins/MyPlugin]
    ask: true
```

Take the config paths from the plugin's **real default config** (GitHub repo or docs). Don't guess them.

**4. Check it**

```bash
npm ci
npm run validate                    # schema + logic checks
npm run test-install -- my-plugin   # real install on a Paper server (needs Java 25)
npm run build                       # update dist/index.json
npm test
```

**5. Open a pull request.** CI validates the template and installs it on a real Paper server.

## How the panel uses this repo

1. Load `dist/index.json` from a **tag or commit**, never live from `main`:
   `https://raw.githubusercontent.com/localyhost/EasyInstall-Templates/<tag>/dist/index.json`
2. Look up the store entry: `index.modrinth[projectId]` or `index.spigot[resourceId]` → template ID.
3. Load `templates/<id>/template.yaml` from the same tag and **check the `sha256`** from the index.
4. Check `requirements` (software, MC version, Java) against the server.
5. Render the form from `groups` and `options` (respect `show_when` / `enable_when`).
6. Run `steps` in order and roll back on errors (`on_error`). On uninstall, run `uninstall`.

Details, the request format and the rollback rules are in the [wiki](https://github.com/localyhost/EasyInstall-Templates/wiki/Panel-Integration).

## Checks and CI

| Workflow | When | What |
|---|---|---|
| Validate templates | push to `main`, every PR | `npm test`, `npm run validate`, index up to date |
| Install test (PR) | PRs touching templates/tools/schema | installs changed templates on a real Paper server |
| Install test (daily) | every 24 hours | installs all enabled templates; opens an issue **"Install script &lt;id&gt; is broken"** per broken template and closes it once it works again |
| Check plugin IDs | weekly | checks all Modrinth/Spigot IDs against the APIs |

## License

[MIT](LICENSE)
