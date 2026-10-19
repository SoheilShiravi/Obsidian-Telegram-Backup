# How an Obsidian plugin is built

This document explains how Obsidian plugins work in general, using Telegram Backup as the running example. It is meant for someone who wants to understand, change or write a plugin.

## 1. What a plugin is

Obsidian is a desktop app built on **Electron** (Chromium + Node.js) and a mobile app built on **Capacitor** (a native app that shows a web view). Both run the same JavaScript code base, and plugins run inside it, in the same JavaScript context as Obsidian itself.

A plugin is therefore a **JavaScript bundle** that Obsidian loads at startup. It gets access to Obsidian's API (the `obsidian` module), the DOM of the app, and standard web APIs. Desktop plugins may also use Node.js and Electron APIs, but then they cannot run on mobile.

This is why plugins cannot be written in Python: there is no Python runtime inside Obsidian, especially not on Android and iOS. Plugins are written in **TypeScript** (or JavaScript) and compiled to one `main.js` file. TypeScript is JavaScript with types, which catches many mistakes at build time, and it is what the official template uses.

## 2. The files Obsidian needs

An installed plugin is a folder inside the vault's configuration folder:

```
<vault>/.obsidian/plugins/telegram-backup/
├── manifest.json   ← metadata: id, name, version, minimum Obsidian version…
├── main.js         ← the compiled plugin code
├── styles.css      ← optional CSS, loaded automatically
└── data.json       ← created by the plugin itself to store settings
```

`manifest.json` of this plugin:

```json
{
	"id": "telegram-backup",
	"name": "Telegram Backup",
	"version": "1.0.0",
	"minAppVersion": "1.13.2",
	"description": "Back up notes, folders and your whole vault to a Telegram channel or chat with your own bot. Type a trigger in a note to send it instantly.",
	"author": "SoheilShiravi",
	"authorUrl": "https://github.com/SoheilShiravi",
	"isDesktopOnly": false
}
```

- `id` must match the folder name and never change after the first release.
- `minAppVersion` is the oldest Obsidian version the plugin supports. Obsidian refuses to load a plugin that needs a newer version, and `versions.json` (in the repository) tells older Obsidian versions which older plugin release they may install instead.
- `isDesktopOnly: true` is required when a plugin uses Node.js or Electron APIs.

## 3. Lifecycle

When the plugin is enabled, Obsidian:

1. reads `manifest.json` and checks `minAppVersion`,
2. evaluates `main.js` as a CommonJS module, providing `require('obsidian')`,
3. creates an instance of the **default export**, a class that extends `Plugin`,
4. calls its `onload()` method.

When the plugin is disabled (or Obsidian closes, or the plugin is updated), Obsidian calls `onunload()` and automatically removes everything the plugin registered through the `register*` helpers.

The smallest possible plugin:

```ts
import { Notice, Plugin } from 'obsidian';

export default class HelloPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'say-hello',
			name: 'Say hello',
			callback: () => new Notice('Hello from my plugin!'),
		});
	}

	onunload() {
		// Commands, events and intervals registered above are cleaned up automatically.
	}
}
```

In Telegram Backup, `src/main.ts` contains the plugin class. Its `onload()`:

1. loads `data.json` and validates it (`loadStoredData`),
2. creates the services: the Telegram client, note backups, archives, restore, automatic backups,
3. adds the settings tab, the commands, the context menus, the command line handlers, the editor extension for triggers, the ribbon icon and the status bar item,
4. after the workspace layout is ready (`app.workspace.onLayoutReady`), starts listening to file changes and starts the scheduler. Waiting avoids reacting to the thousands of file events Obsidian fires while it indexes the vault at startup.

## 4. The API you work with

Everything starts at `this.app`, the `App` object:

| Object | What it is for | Used in this plugin for |
| --- | --- | --- |
| `app.vault` | Reading, creating, modifying and listing files and folders | Reading notes and attachments, restoring backups, listing files for archives |
| `app.vault.adapter` | Low-level file access, including the hidden configuration folder | Optional backup of `.obsidian` |
| `app.workspace` | Panes (leaves), views, the active file and editor, workspace events | Active note, open editors, file and editor context menus |
| `app.metadataCache` | Parsed links, embeds, tags, headings and frontmatter of every note | Finding attachments, tags for hashtags and exclusions |
| `app.fileManager` | Rename-safe operations, frontmatter editing | — |
| `app.secretStorage` | Device-local storage for secrets such as API keys (1.11.4+) | The bot token |

And the `Plugin` class gives you registration helpers that are cleaned up automatically on unload:

| Helper | Purpose |
| --- | --- |
| `addCommand` | A command in the command palette (can use `checkCallback` or `editorCallback` to appear only when it applies) |
| `addRibbonIcon`, `addStatusBarItem` | Ribbon button and status bar element |
| `addSettingTab` | The plugin's page in **Settings** |
| `registerEvent` | Subscribe to vault, workspace or metadata events |
| `registerInterval`, `register` | Timers and any other cleanup function |
| `registerDomEvent` | DOM event listeners |
| `registerEditorExtension` | CodeMirror 6 extensions for the editor |
| `registerCliHandler` | Commands for the Obsidian command line interface (1.12.2+) |
| `loadData`, `saveData` | Read and write the plugin's `data.json` |

UI building blocks come from the same module: `Notice` (toast messages), `Modal`, `SuggestModal` and `FuzzySuggestModal` (pickers), `Setting` (a settings row with controls), `Menu` (context menus) and `setIcon` (Lucide icons). Elements are created with Obsidian's DOM helpers (`createEl`, `createDiv`) instead of `innerHTML`, which keeps plugins safe from script injection.

## 5. Settings

Obsidian 1.13 introduced **declarative settings**: the settings tab returns a list of definitions from `getSettingDefinitions()`, and Obsidian renders them, keeps them in sync and includes them in the global settings search.

```ts
getSettingDefinitions(): SettingDefinitionItem[] {
	return [
		{
			type: 'group',
			heading: 'Connection',
			items: [
				{ name: 'Bot token', control: { type: 'secret', key: 'botTokenSecret' } },
				{ name: 'Chat ID', control: { type: 'text', key: 'chatId', validate: validateChatId } },
				{ name: 'Find the chat ID', render: (setting) => { setting.addButton(/* … */); } },
			],
		},
	];
}
```

- A **control** (`toggle`, `dropdown`, `text`, `textarea`, `slider`, `secret`, …) is bound to a key. Obsidian reads the value with `getControlValue(key)` and writes it with `setControlValue(key, value)`. This plugin overrides both so it can validate each value and save settings and state together.
- A **render** item gives you a `Setting` row for custom controls, such as the **Detect** and **Check** buttons.
- `visible: () => boolean` hides rows that do not apply (for example the delay slider while automatic backups are off), and `refreshDomState()` re-evaluates those predicates after a change.

Settings and other plugin state are stored with `saveData()` in `data.json`. This plugin stores `{ version, settings, state }`, where `state` holds the backup history and what was last sent for each note. On load, everything is validated (`sanitizeSettings`, `sanitizeState`) so an old or damaged file can never break the plugin. `onExternalSettingsChange()` reloads the data when a sync service changes `data.json`.

The bot token is **not** in `data.json`. The `secret` control stores only the *name* of a secret, and the value is read with `app.secretStorage.getSecret(name)`. Secrets are kept in local storage on each device, so the token is never synced or committed with the vault.

## 6. The editor and CodeMirror 6

Obsidian's editor is built on [CodeMirror 6](https://codemirror.net). For simple edits, plugins use Obsidian's `Editor` API (`getSelection`, `replaceRange`, …). For deeper integration they register CodeMirror extensions.

The `;;backup` trigger (`src/triggers.ts`) is a CodeMirror `EditorView.updateListener`. On every document change it:

1. ignores the change unless it came from typing or pasting (`transaction.isUserEvent('input')`), so undo, redo and changes made by other plugins never fire a trigger,
2. checks whether the text before the cursor ends with a trigger,
3. finds the note through `editorInfoField`,
4. removes the trigger in a separate transaction (a document cannot be changed while CodeMirror is still applying an update, hence `window.setTimeout(…, 0)`), and starts the backup with the editor's current text, including unsaved changes.

## 7. Networking

Plugins should use `requestUrl()` from the Obsidian API instead of `fetch`. It is not limited by CORS, and it works the same way on desktop and mobile. Its body must be a string or an `ArrayBuffer`, so file uploads need a hand-made `multipart/form-data` body (`src/telegram/multipart.ts`).

`src/telegram/client.ts` wraps the Telegram Bot API:

- one method per Bot API call (`sendMessage`, `sendDocument`, `editMessageMedia`, `getFile`, …),
- sending calls are queued and spaced at least one second apart, as Telegram asks,
- rate limits (HTTP 429) are retried after Telegram's `retry_after`, server errors and network failures are retried with a delay,
- error descriptions become helpful messages ("The bot is not allowed to post in this chat…"),
- the bot token is removed from every error message.

The client takes the request function as a constructor parameter, so the unit tests can replace the network with fake responses.

## 8. How a backup flows through the code

```
Command / ribbon / menu / ;;backup trigger
        │
        ▼
actions.ts ── status bar, notices, history on failure
        │
        ▼
backup/notes.ts ── reads the note (from the editor when open), hashes it,
        │          renders the caption, chooses file or text, finds attachments
        │
        ├─ format/markdown.ts + format/chunker.ts ── Markdown → Telegram HTML, split ≤ 4096
        ├─ zip/zip-writer.ts ── optional note + attachments archive
        │
        ▼
backup/sender.ts ── chat ID, topic, silent/protected options, plain-text fallback
        │
        ▼
telegram/client.ts ── queue, retries, multipart upload ── requestUrl ──▶ Bot API
```

Archives follow the same path through `backup/archives.ts`, which streams files into `zip/archive-builder.ts`. That builder compresses one file at a time, so it knows the exact archive size and can start a new standalone part before Telegram's 50 MB limit is reached. Only one part is kept in memory, which matters on phones.

## 9. Mobile compatibility

To run on mobile a plugin must avoid Node.js modules (`fs`, `path`, `crypto`, `Buffer`) and Electron. This plugin uses:

- `requestUrl` for HTTP,
- `TextEncoder` / `TextDecoder` for UTF-8,
- `crypto.getRandomValues` (Web Crypto) for multipart boundaries,
- `fflate`, a pure JavaScript compression library, for zip archives,
- `Platform.isMobile` to keep scheduled backups off on mobile by default.

Regular expressions avoid lookbehind, which older iOS versions do not support (`obsidianmd/regex-lookbehind`).

## 10. The build toolchain

| File | Role |
| --- | --- |
| `package.json` | Dependencies and scripts (`dev`, `build`, `lint`, `test`, `version`) |
| `tsconfig.json` | TypeScript options (strict mode) |
| `esbuild.config.mjs` | Bundles `src/main.ts` and its dependencies into one CommonJS file, `main.js`. `obsidian`, `electron` and the CodeMirror packages are marked **external** because Obsidian provides them at runtime. |
| `eslint.config.mts` | Linting with `eslint-plugin-obsidianmd`, Obsidian's official rules. The automated directory review uses the same rules. |
| `test/run-tests.mjs` | Bundles the tests with esbuild and runs them with the Node.js test runner, replacing `obsidian` with a small stub. |
| `version-bump.mjs` | Run by `npm version`: copies the version into `manifest.json` and `versions.json`. |
| `.github/workflows/` | CI on every push, and a release workflow for version tags. |

`npm run build` runs `tsc -noEmit` (type checking only) and then esbuild in production mode (minified, no source maps). `npm run dev` keeps esbuild running and rebuilds `main.js` on every change, with inline source maps for debugging.

## 11. The development loop

1. Create a test vault (never develop in your real vault).
2. Link or copy the project into `<test vault>/.obsidian/plugins/telegram-backup/`.
3. Run `npm run dev`.
4. Enable the plugin in **Settings → Community plugins**. Install the **Hot-Reload** plugin to reload it automatically after each build, or toggle the plugin off and on.
5. Open the developer tools with **Ctrl+Shift+I** (**Cmd+Option+I** on macOS) to see errors, set breakpoints and inspect the DOM.
6. Before releasing: `npm run lint`, `npm test`, `npm run build`, and a test on mobile (BRAT makes installing a development version on a phone easy).

## 12. Quality and policies

The official guidelines and the automated review look for:

- sentence case in UI text, no "settings" in settings headings, no top-level heading,
- no default hotkeys, no plugin ID in command IDs,
- `this.app` instead of the global `app`, `requestUrl` instead of `fetch`, `window.setTimeout` instead of bare `setTimeout`,
- DOM helpers instead of `innerHTML`, CSS classes and Obsidian CSS variables instead of inline styles,
- resources released on unload (`register*` helpers), no detaching of leaves in `onunload`,
- no obfuscated code, no client-side telemetry, no self-updating or remote code,
- disclosure in the README of network use, accounts and payments,
- an accurate `minAppVersion` for the APIs used.

See [PUBLISHING.md](PUBLISHING.md) for how the release and the community directory submission work.

## 13. Where to learn more

- Developer documentation: <https://docs.obsidian.md>
- API type definitions (the most precise reference): `node_modules/obsidian/obsidian.d.ts`, or <https://github.com/obsidianmd/obsidian-api>
- Sample plugin template: <https://github.com/obsidianmd/obsidian-sample-plugin>
- Lint rules: <https://github.com/obsidianmd/eslint-plugin>
- Community help: the `#plugin-dev` channel on the [Obsidian Discord](https://discord.gg/obsidianmd) and the [developer forum](https://forum.obsidian.md/c/developers-api/14)
