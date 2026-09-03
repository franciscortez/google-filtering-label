# clasp Command Reference

This project uses project-local `@google/clasp` 3.4.1. Run commands through
`npx clasp`; no global installation is required.

## Daily workflow

```bash
npm install
npm test
npx clasp status
npx clasp push
npx clasp open-script
```

- `npm install` installs the repository's pinned clasp dependency.
- `npm test` runs local classifier tests.
- `npx clasp status` shows which files will and will not upload.
- `npx clasp push` uploads local Apps Script source.
- `npx clasp open-script` opens the linked project in Apps Script editor.

The existing five-minute trigger uses the latest pushed source. `clasp push`
does not require reinstalling the trigger. A formal deployment is not required
for this Gmail automation.

## Global options

Use global options before the command:

```bash
npx clasp --version
npx clasp --json deployments
npx clasp --user work status
npx clasp --auth /path/to/auth-directory status
npx clasp --project /path/to/project-directory status
```

| Option | Description |
| --- | --- |
| `-v`, `--version` | Print installed clasp version. |
| `-A`, `--auth <file>` | Use an auth file or directory containing `.clasprc.json`. |
| `-u`, `--user <name>` | Use named stored credentials; default name is `default`. |
| `--adc` | Use Google Application Default Credentials. |
| `--json` | Request JSON output when supported. |
| `--allow-symlinks` | Allow linked files and directories during file operations. |
| `-I`, `--ignore <file>` | Use another `.claspignore` file or containing directory. |
| `-P`, `--project <file>` | Use another `.clasp.json` file or containing directory. |
| `-h`, `--help` | Show CLI help. |

## Authentication

| Command | Description |
| --- | --- |
| `npx clasp login` | Sign in and store clasp credentials. |
| `npx clasp login --no-localhost` | Sign in using manual authorization instead of local callback server. |
| `npx clasp login --use-project-scopes` | Authorize scopes declared by current Apps Script manifest for `run`. |
| `npx clasp logout` | Remove current clasp login credentials. |
| `npx clasp show-authorized-user` | Display current authorization state and signed-in user. |
| `npx clasp open-credentials-setup` | Open credential setup page for linked Google Cloud project. |

`login` also supports `--creds <file>`, `--include-clasp-scopes`,
`--extra-scopes <comma-separated-scopes>`, and `--redirect-port <port>`.
Do not commit OAuth credentials or `.clasprc.json`.

## Script projects and source

| Command | Description |
| --- | --- |
| `npx clasp clone <scriptId>` | Clone existing Apps Script project and create `.clasp.json`. |
| `npx clasp clone <scriptId> <versionNumber>` | Clone one immutable project version. |
| `npx clasp clone <scriptId> --rootDir <dir>` | Clone source into selected directory. |
| `npx clasp create --title "Name"` | Create standalone Apps Script project. |
| `npx clasp create --type <type>` | Create standalone, document, spreadsheet, presentation, form, web app, or API project. |
| `npx clasp list` | List Apps Script projects accessible to current account. |
| `npx clasp status` | Show files included and excluded by `.claspignore`. |
| `npx clasp push` | Upload local included files to linked remote project. |
| `npx clasp push --watch` | Watch local included files and upload after changes. |
| `npx clasp push --force` | Force overwrite of remote manifest when normal push rejects it. |
| `npx clasp pull` | Download current remote source into local project. |
| `npx clasp pull --versionNumber <number>` | Download an immutable remote version. |
| `npx clasp open-script` | Open linked project in Apps Script editor. |
| `npx clasp open-script <scriptId>` | Open another Apps Script project by ID. |
| `npx clasp open-container` | Open container-bound document for linked script. |
| `npx clasp delete <scriptId>` | Delete Apps Script project. Destructive. |

Run `status` before `push`. Commit or copy local work before `pull` because
downloaded files can overwrite local source. `pull --deleteUnusedFiles` deletes
local files absent remotely; `pull --force` performs that deletion without a
prompt.

## Versions and deployments

| Command | Description |
| --- | --- |
| `npx clasp version "Description"` | Create immutable version from current remote source. |
| `npx clasp versions` | List versions for linked project. |
| `npx clasp versions <scriptId>` | List versions for another project. |
| `npx clasp deploy --description "Description"` | Create deployment. |
| `npx clasp deploy --versionNumber <number>` | Deploy selected immutable version. |
| `npx clasp deployments` | List deployment IDs for linked project. |
| `npx clasp deployments <scriptId>` | List deployments for another project. |
| `npx clasp redeploy <deploymentId>` | Update existing deployment to latest version. |
| `npx clasp redeploy <deploymentId> --versionNumber <number>` | Update deployment to selected version. |
| `npx clasp undeploy <deploymentId>` | Delete selected deployment. Destructive. |
| `npx clasp undeploy --all` | Delete every deployment. Destructive. |
| `npx clasp open-web-app <deploymentId>` | Open deployed web app. |

`push`, `version`, and `deploy` are different:

- `push` updates editable project source and is enough for installed triggers.
- `version` freezes remote source into numbered snapshot.
- `deploy` publishes a version as web app, executable API, add-on, or another
  deployment type configured in Apps Script.

## Functions, logs, APIs, and tools

| Command | Description |
| --- | --- |
| `npx clasp run <functionName>` | Execute public Apps Script function through Apps Script Execution API. |
| `npx clasp run <functionName> --params '[...]'` | Execute function with JSON-array arguments. |
| `npx clasp run <functionName> --nondev` | Run deployed non-development version. |
| `npx clasp setup-logs` | Configure Cloud Logging for linked project. |
| `npx clasp logs` | Print recent execution logs. |
| `npx clasp logs --watch` | Stream new execution logs. |
| `npx clasp logs --simplified` | Hide log timestamps. |
| `npx clasp open-logs` | Open logs in Google Cloud console. |
| `npx clasp apis` | List enabled Google APIs for linked Cloud project. |
| `npx clasp enable-api <api>` | Enable selected Google API. |
| `npx clasp disable-api <api>` | Disable selected Google API. This can break scripts using it. |
| `npx clasp open-api-console` | Open API console for linked Cloud project. |
| `npx clasp mcp` | Start clasp MCP server for Apps Script tooling. |
| `npx clasp help` | Show top-level command list. |
| `npx clasp help <command>` | Show options for one command. |

`clasp run` requires suitable authorization and an Apps Script API executable
deployment. For this project, functions can always be selected and run directly
in Apps Script editor:

- `previewIncomingMail`: preview messages near processing cursor.
- `processIncomingMail`: run normal label automation immediately.
  It also archives exact `linear-code[bot]` GitHub messages immediately,
  regardless of general archive switch.
- `previewBackfill30Days`: preview 30-day candidates without changing Gmail.
- `backfillLast30Days`: apply labels to reviewed 30-day candidates.
- `previewArchiveBackfill30Days`: preview exact 30-day archive candidates.
- `queueArchiveBackfill30Days`: queue reviewed 30-day candidates; archive mode
  must already be enabled.
- `enableArchiveAutomation`: enable 24-hour delayed archive for eligible mail.
- `disableArchiveAutomation`: disable archive mode and clear pending items.
- `installAutomation`: replace project processor triggers with one five-minute
  trigger.
- `removeAutomation`: remove processor triggers, disable archive mode, and clear
  pending items.

## Aliases

These pairs are equivalent:

- `clone-script`, `clone`
- `create-script`, `create`
- `create-deployment`, `deploy`
- `delete-script`, `delete`
- `delete-deployment`, `undeploy`
- `list-deployments`, `deployments`
- `update-deployment`, `redeploy`
- `list-apis`, `apis`
- `show-file-status`, `status`
- `tail-logs`, `logs`
- `run-function`, `run`
- `list-scripts`, `list`
- `create-version`, `version`
- `list-versions`, `versions`
- `start-mcp-server`, `mcp`
