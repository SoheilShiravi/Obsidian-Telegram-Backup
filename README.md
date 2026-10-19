# Telegram Backup

Back up your Obsidian notes to a Telegram channel (or group, or private chat) with **your own Telegram bot**. Send the current note with one command, type `;;backup` inside a note to push it instantly, or let the plugin back up your whole vault on a schedule. Telegram gives you free, unlimited cloud storage that you can reach from any device, and this plugin turns it into a fast, searchable backup history for your vault.

- [Features](#features)
- [Installation](#installation)
- [Setup: connect your Telegram bot](#setup-connect-your-telegram-bot)
- [Usage](#usage)
- [Settings reference](#settings-reference)
- [Caption template](#caption-template)
- [Limits](#limits)
- [If Telegram is blocked where you live](#if-telegram-is-blocked-where-you-live)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Development](#development)

## Features

- **One-command backup** of the current note: command palette, ribbon icon, file menu or editor menu.
- **Type to back up**: write `;;backup` anywhere in a note and it is sent immediately; the trigger text disappears from the note.
- **Type to send**: end a line with `;;send` to send only that line (a quick message, a reminder, an idea) to your channel.
- **Send selected text** to Telegram.
- **Three formats**: an exact `.md` file (restorable), readable Telegram messages (headings, bold, lists, check boxes, quotes, code blocks…), or automatic (text when short, file when long).
- **Attachments**: images, PDFs and other embedded files are sent with the note, as replies or bundled with the note in a zip archive. Unchanged attachments are not sent again.
- **Vault, folder and selection archives**: zip archives that are split automatically into standalone parts under Telegram's 50 MB limit.
- **Incremental backups**: send only the files that changed since the last vault backup.
- **Automatic backups**: back up a note a few minutes after you stop editing it, and/or back up the whole vault every hour, day or week.
- **Restore from Telegram**: pick an earlier version of a note and save it as a copy or replace the note, directly inside Obsidian.
- **Update in place** (optional): keep one Telegram message per note and update it instead of posting a new one.
- **Backup history** with links to the messages in Telegram, plus a status bar item that shows when the last backup ran.
- **Captions with hashtags**: Obsidian tags become Telegram hashtags (`#project/alpha` → `#project_alpha`), so you can search your channel by tag.
- **Exclusions** by folder or tag for automatic backups and archives.
- **Forum topics**, silent messages, protected content and a custom Bot API server.
- **Command line** handlers for the Obsidian CLI, so backups can be started from a terminal or a task scheduler.
- **Secure token storage**: the bot token lives in Obsidian's secret storage on your device, never in your vault.
- Works on **desktop and mobile**, in any language (including right-to-left scripts such as Persian and Arabic).

## Installation

### From the community directory

1. Open **Settings → Community plugins** and turn off **Restricted mode** if it is on.
2. Select **Browse**, search for **Telegram Backup**, then select **Install** and **Enable**.

### Beta versions with BRAT

1. Install and enable the **BRAT** plugin from the community directory.
2. Run the command **BRAT: Add a beta plugin for testing** and enter this repository's URL: `https://github.com/SoheilShiravi/obsidian-telegram-backup`.
3. Enable **Telegram Backup** in **Settings → Community plugins**.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](https://github.com/SoheilShiravi/obsidian-telegram-backup/releases).
2. Create the folder `<your vault>/.obsidian/plugins/telegram-backup/` and copy the three files into it. (The `.obsidian` folder is hidden on some systems.)
3. Restart Obsidian, then enable **Telegram Backup** in **Settings → Community plugins**.

The plugin needs Obsidian 1.13.2 or newer.

## Setup: connect your Telegram bot

Setting up takes about five minutes. You need the Telegram app on your phone or computer.

### Step 1: Create a bot with BotFather

1. In Telegram, search for **@BotFather** (it has a blue check mark) and open it. Select **Start**.
2. Send the command `/newbot`.
3. Send a **display name** for the bot, for example `My Vault Backup`.
4. Send a **username** for the bot. It must end with `bot`, for example `my_vault_backup_bot`. If the name is taken, try another one.
5. BotFather replies with a **token** that looks like `1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. Copy it.

> [!WARNING]
> **Keep the token secret.** Anyone with the token can control your bot. If it ever leaks, open @BotFather, send `/revoke`, pick your bot, and use the new token.

### Step 2: Create a private channel for your backups

A private channel is the best place for backups: only you can see it, and it can hold an unlimited number of files.

- **Android**: tap the pencil button → **New Channel**.
- **iPhone**: open **Chats**, tap the new message button → **New Channel**.
- **Desktop**: open the menu (☰) → **New Channel**.

Give it a name such as `Obsidian Backups`, choose **Private Channel**, and finish creating it. You can skip adding members.

You can also use a group, a group with topics, or a private chat with your bot. See [Other destinations](#other-destinations).

### Step 3: Make the bot an administrator of the channel

1. Open the channel, then open its info page (tap the channel name).
2. Select **Edit** (or **Manage channel**) → **Administrators** → **Add Admin** (or **Add Administrator**).
3. Search for your bot's username, select it, and make sure **Post messages** is allowed.
4. If you plan to use **Update the previous message**, also allow **Edit messages of others** and **Delete messages of others**.
5. Save.

### Step 4: Connect the plugin

1. In Obsidian, open **Settings → Telegram Backup**.
2. **Bot token**: select **Link…**. In the **Select secret** window, select **Add secret…**, enter a name such as `telegram-backup-token` (lowercase letters, numbers and dashes) and paste the token from BotFather as the value. Then select the new secret and select **Save**.
   - Secrets are kept in Obsidian's keychain on this device and are encrypted by your operating system. They are never written into the vault, so on each device where you use the plugin you add the secret once.
   - You can view, change or delete secrets later in **Settings → Keychain**.
3. **Chat ID**: select **Detect**. The plugin asks Telegram which chats your bot has seen. Choose your channel from the list.
   - If the list is empty, post any message in your channel (or, for a private chat, send `/start` to your bot) and select **Detect** again. Telegram only remembers these updates for 24 hours.
4. Select **Check** next to **Check the connection**. You should see three check marks: the bot, the chat and the permission to post.
5. Select **Send test message**. A confirmation message appears in your channel.

You're done. Open a note and run **Telegram Backup: Back up current note**, or type `;;backup` at the end of the note.

### Finding the chat ID manually

If **Detect** does not work (for example because another app is reading your bot's updates), use one of these:

- **Public channels**: use the channel's username, for example `@my_backups`.
- **Telegram Web**: open your channel at `https://web.telegram.org/a/`. The address ends with the chat ID, for example `#-1001234567890`.
- **Bot API in a browser**: post a message in the channel, then open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser (replace `<YOUR_TOKEN>`). Look for `"chat":{"id":-100…`.

Channel and supergroup IDs start with `-100`.

### Other destinations

- **Private chat with your bot**: open your bot in Telegram and select **Start**. Then select **Detect** in the plugin and choose the private chat with your name. Backups arrive in your chat with the bot.
- **Group**: add the bot to the group (it must be allowed to send messages), then use **Detect**. If BotFather blocks adding the bot to groups, send `/setjoingroups` to BotFather and enable it.
- **Group with topics**: use the group's chat ID, then set **Topic ID** to the topic's number. To find it, copy the link of any message in the topic: in `https://t.me/c/1234567890/42/100`, the topic ID is `42`.

## Usage

All commands are in the command palette (Ctrl/Cmd + P) under **Telegram Backup**. None of them has a default hotkey; you can assign your own in **Settings → Hotkeys**.

### Back up a note

- Run **Back up current note**, select the **paper plane** icon in the ribbon, right-click a file and choose **Back up to Telegram**, or right-click inside the editor and choose **Back up note to Telegram**.
- **Back up current note as a file** and **Back up current note as text messages** override the format setting for one backup.
- Canvases, bases, PDFs, images and any other file can be backed up as files too.

### Type a trigger in the note

With triggers enabled (they are by default):

| Type this | What happens |
| --- | --- |
| `;;backup` | The trigger is removed and the whole note is backed up, including changes that are not saved yet. |
| `Buy milk ;;send` | The trigger is removed and only `Buy milk` is sent as a message, followed by the note name. |
| `;;send` on an empty line | The paragraph above the empty line is sent. |

The trigger fires the moment you type its last character, in both Live Preview and Source mode. Undoing the removal does not send the note again. You can change both triggers in the settings, for example to `/backup` (if you do not use Obsidian's **Slash commands** core plugin) or `!tg`.

### Send selected text

Select text and run **Send selected text**, or right-click the selection and choose **Send selection to Telegram**.

### Archives

| Command or menu | Contents |
| --- | --- |
| **Back up the entire vault as zip archives** | All files (or only notes, see settings) except excluded folders and tags. |
| **Back up files changed since the last vault backup** | Only files modified since the last vault or changes backup. The first one includes everything. |
| **Back up a folder as a zip archive**, or right-click a folder → **Back up folder to Telegram** | One folder and its subfolders. |
| Select several files in the file explorer → right-click → **Back up … items to Telegram** | The selected files and folders. |

Large backups are split into several archives (`MyVault-2026-10-18_2130-part1.zip`, `…-part2.zip`, …). Every part is a complete zip file on its own; extract all parts into the same folder to get everything back. A progress notice with a **Cancel** button is shown while an archive is created and uploaded. Each archive caption has a hashtag (`#vault_backup`, `#changes_backup`, `#folder_backup`, `#files_backup`) so you can find them quickly in Telegram.

### Automatic backups

- **Back up notes when they change**: a note is sent a few minutes after your last edit (1 to 60 minutes). Notes that did not change since their last backup are never sent again. Failed automatic backups are retried every few minutes, for example after you come back online.
- **Scheduled vault backup**: every hour, 6 hours, 12 hours, day or week, either the whole vault or only changed files. Scheduled backups run while Obsidian is open; a missed backup runs shortly after you start Obsidian. They are off on mobile by default because mobile apps are paused in the background.

If you use the plugin on several devices with a synced vault, turn on scheduled backups on one device only.

### Restore

- Run **Restore current note from a backup**, choose a version, then **Save as copy** (keeps the current note) or **Replace note**.
- Or run **Show backup history** and select **Restore** next to a backup. Deleted notes can be restored from the history too.
- Zip archives of up to 20 MB (vault, folder and changed-files archives, and notes bundled with their attachments) can be downloaded into the `Telegram downloads` folder of your vault with **Download**.

Restoring works for notes that were sent as a file (the default format). Telegram only lets bots download files of up to 20 MB, and only backups that are still in the plugin's history can be restored from inside Obsidian. You can always download any file manually in Telegram.

### History and status bar

**Show backup history** lists recent backups with their time, size and format, failures with the reason, links to open each message in Telegram (for channels and groups), and restore buttons. **Show backups of current note** shows only the current note. On desktop the status bar shows when the last backup happened; select it to open the history.

### Command line

Obsidian's command line interface (desktop) can start backups, for example from a cron job or the Windows Task Scheduler. Turn it on in **Settings → General → Command line interface**. If Obsidian is not running, the first command starts it; add `vault="My vault"` to target a specific vault.

```sh
obsidian telegram-backup                                  # status
obsidian telegram-backup:vault                            # back up the whole vault
obsidian telegram-backup:changes                          # back up changed files
obsidian telegram-backup:note path="Inbox/Idea.md"        # back up one note
obsidian telegram-backup:send text="Hello from the terminal"
```

## Settings reference

| Setting | Description | Default |
| --- | --- | --- |
| **Bot token** | Secret that holds the token from BotFather. | — |
| **Chat ID** | Channel, group or chat that receives backups. | — |
| **Topic ID** | Topic in a group with topics. | empty |
| **Send notes as** | File (exact copy), text messages, or text when short and a file when long. | File |
| **Text style** | Formatted, plain text, or a code block that is easy to copy. | Formatted |
| **Leave out properties** | Skip the YAML properties block in text messages. | On |
| **Caption template** | Caption of files and header of text messages. See [Caption template](#caption-template). | see below |
| **Attachments** | Send as separate files, bundle with the note in a zip archive, or do not send. | Separate files |
| **Send unchanged attachments again** | Re-send attachments even if they did not change. | Off |
| **When a note is backed up again** | Post a new message (keep every version) or update the previous message. | New message |
| **Add the note name to sent text** | Selections and `;;send` lines end with the note name. | On |
| **Enable triggers**, **Backup trigger**, **Send trigger** | In-note triggers. | On, `;;backup`, `;;send` |
| **Back up notes when they change**, **Wait after the last change** | Automatic note backups. | Off, 5 min |
| **Scheduled vault backup**, **Frequency**, **What to back up** | Scheduled archives. | Off, every day, whole vault |
| **Skip when nothing changed** | Skip a scheduled full backup when no file changed. | On |
| **Run on mobile devices** | Allow scheduled backups on mobile. | Off |
| **Files in vault archives** | Notes and attachments, or notes, canvases and bases only. | Notes and attachments |
| **Include the configuration folder** | Add `.obsidian` (settings, themes, plugins) to full vault backups. Other plugins' settings can contain passwords and API keys. | Off |
| **Maximum archive size** | Size of each archive part (5–47 MB). | 45 MB |
| **Excluded folders**, **Excluded tags** | Left out of automatic backups and archives. Notes you back up explicitly are always sent. | empty |
| **Send silently** | Notifications without sound. | Off |
| **Protect content** | Prevent forwarding and saving of backup messages in Telegram. | Off |
| **Show status bar item**, **Show success notifications** | Interface options. | On |
| **Bot API server** | Change only for a self-hosted Bot API server or a proxy you trust. | `https://api.telegram.org` |
| **History size** | Number of backups kept in the history (50–1000). | 300 |

All settings appear in Obsidian's settings search.

## Caption template

The caption template is used as the caption of backup files and as the header of text messages. It supports Telegram HTML formatting (`<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<a href="…">`) and these placeholders:

| Placeholder | Value |
| --- | --- |
| `{{title}}` | Note name without extension |
| `{{path}}` | Path in the vault, for example `Projects/Plan.md` |
| `{{folder}}` | Folder of the note (`/` for the vault root) |
| `{{vault}}` | Vault name |
| `{{tags}}` | Tags as Telegram hashtags |
| `{{date}}`, `{{time}}`, `{{datetime}}` | Current date and time |
| `{{created}}`, `{{modified}}` | Creation and modification time of the file |
| `{{words}}`, `{{chars}}` | Word and character count of a note |
| `{{size}}` | File size, for example `12.4 KB` |

Dates accept any [Moment.js format](https://momentjs.com/docs/#/displaying/format/): `{{date:DD MMMM YYYY}}`, `{{modified:HH:mm}}`. A line whose placeholders are all empty is removed, so a tags line disappears for notes without tags.

The default template:

```html
📝 <b>{{title}}</b>
📁 <code>{{path}}</code>
🕒 {{datetime}}
{{tags}}
```

### How notes look as text messages

| In Obsidian | In Telegram |
| --- | --- |
| Headings | Bold lines |
| `**bold**`, `*italic*`, `~~strike~~`, `==highlight==` | Bold, italic, strikethrough, underline |
| `` `code` `` and code blocks | Monospace, code blocks with the language name |
| `- [ ] task`, `- [x] done` | ☐ task, ☑ done |
| Callouts and quotes | Quotes; folded callouts become expandable quotes |
| `[[Note\|alias]]`, `[text](https://…)` | The alias, clickable links |
| `![[image.png]]` | 🖼 image.png (the image itself is sent as an attachment) |
| Tables, math | Monospace blocks |
| `%% comments %%` | Removed |

Long notes are split into several messages (at most 4096 characters each). A note that would need more than 10 messages is sent as a file instead.

## Limits

These limits come from the Telegram Bot API:

| Limit | Value |
| --- | --- |
| Text message | 4096 characters |
| File caption | 1024 characters (longer captions are shortened) |
| File upload | 50 MB per file (larger attachments are skipped and reported) |
| File download (restore) | 20 MB per file |
| Sending speed | About 1 message per second and 20 messages per minute per chat; the plugin waits when Telegram asks it to slow down |

## If Telegram is blocked where you live

The plugin talks to the Telegram Bot API over HTTPS. If Telegram is blocked in your country, choose one of these options:

1. **VPN**: a VPN that routes all traffic of your device works for Obsidian on desktop and mobile without any change in the plugin.
2. **System proxy (desktop)**: Obsidian follows the proxy configured in your operating system's network settings, so a proxy app in "system proxy" mode works too.
3. **Your own Bot API server**: run the official [Telegram Bot API server](https://github.com/tdlib/telegram-bot-api) on a server you control, and set **Bot API server** to its address. A self-hosted server also raises the upload limit to 2000 MB.
4. **Your own reverse proxy**: forward requests to `api.telegram.org` through a server you control, for example a small Cloudflare Worker:

   ```js
   export default {
     async fetch(request) {
       const url = new URL(request.url);
       url.hostname = "api.telegram.org";
       return fetch(new Request(url, request));
     },
   };
   ```

   Then set **Bot API server** to the worker's address, such as `https://my-proxy.example.workers.dev`.

> [!WARNING]
> **Only use servers you trust.** Every request contains your bot token and your notes. Never point the plugin at a proxy run by someone else.

## Privacy and security

- **Network use**: the plugin connects only to the Telegram Bot API server in the settings (`https://api.telegram.org` by default). It sends data only when you start a backup or when you turn on automatic or scheduled backups.
- **What is sent**: the content of the notes and files you back up, embedded attachments, file names and paths, tags, and the vault name (in captions and archive names).
- **No telemetry**: the plugin does not collect analytics and does not contact any other server.
- **Telegram is not end-to-end encrypted for bots**: messages in channels, groups and bot chats are stored on Telegram's servers, and Telegram can technically access them. Do not back up anything you would not store in a regular cloud service, and use **Excluded folders** and **Excluded tags** for sensitive notes.
- **Bot token**: stored in Obsidian's keychain (secret storage), on this device only. It is not written to the vault or to `data.json`, so it is not synced or committed to git with your vault. Obsidian encrypts secrets with your operating system's secret store; on systems without one (some Linux desktops), it shows a warning that secrets are stored without encryption.
- **Local data**: the plugin's `data.json` (in `.obsidian/plugins/telegram-backup/`) keeps the settings and the backup history: note paths, times, message links and Telegram file IDs.
- **Files outside the vault**: the plugin reads and writes only files inside your vault. The configuration folder is read only if you turn on **Include the configuration folder**.

## Troubleshooting

| Message or problem | What to do |
| --- | --- |
| **Telegram rejected the bot token** | Copy the token from BotFather again (send `/mybots` → your bot → **API Token**) and update the secret in **Settings → Keychain**. Make sure the secret is linked in **Bot token**. |
| **Chat not found** | Check the chat ID, make sure the bot was added to the channel or group, and try **Detect**. |
| **The bot is not allowed to post in this chat** | Make the bot an administrator of the channel with **Post messages**. In a group, allow it to send messages. |
| **Open your bot in Telegram and press Start** | For a private chat, open your bot in Telegram and select **Start** once. |
| **Could not reach Telegram** | Check your internet connection. If Telegram is blocked, see [If Telegram is blocked where you live](#if-telegram-is-blocked-where-you-live). Check the **Bot API server** setting. |
| **The file is too large** | Bots can upload up to 50 MB per file. Lower **Maximum archive size**, or exclude folders with large videos. |
| **Detect** finds no chats | Post a message in the channel (or send `/start` to the bot) and try again within 24 hours. If another app uses the same bot, enter the ID manually. |
| A trigger does nothing | Check that triggers are on, that you are in a Markdown note in Live Preview or Source mode, and that you typed the exact trigger text. |
| A scheduled backup did not run | Obsidian must be open. On mobile, turn on **Run on mobile devices**. **Last scheduled backup** in the settings shows when it last ran. |
| **Restore** is missing | Only notes sent as a file, up to 20 MB, and still in the history can be restored. |

## FAQ

**Can I restore my whole vault from Telegram?**
Yes. Download all parts of a vault backup from your channel, extract them into an empty folder, and open that folder as a vault in Obsidian. For a recent state, extract the last full backup first and then the newer "changed files" archives in order.

**Does it work on my phone?**
Yes, on Android and iOS. The status bar item is desktop-only, and scheduled backups are off on mobile unless you turn them on.

**Will my channel fill up with copies?**
Each backup is a new message by default, which gives you a version history. Choose **Update the previous message** to keep one message per note instead. Unchanged notes are never sent automatically, and unchanged attachments are not re-sent.

**Can I use several vaults?**
Yes. Use a separate channel, or one channel for all vaults: captions and archive names include the vault name.

**Why is a note sent as a file even though I chose text messages?**
Notes that would need more than 10 messages are sent as a file so the chat is not flooded.

## Development

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
npm install        # install dependencies
npm run dev        # rebuild main.js on every change
npm run build      # type-check and create a production build
npm run lint       # check the code with eslint-plugin-obsidianmd
npm test           # run the unit tests
```

To try your changes, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/telegram-backup/` (or create a symbolic link to this folder) and reload Obsidian. The [Hot-Reload](https://github.com/pjeby/hot-reload) plugin reloads the plugin automatically after each build.

```
src/
├── main.ts              Plugin lifecycle, settings and state storage
├── settings.ts          Settings, defaults and validation
├── settings-tab.ts      Settings tab (declarative setting definitions)
├── commands.ts          Commands and context menus
├── triggers.ts          ;;backup and ;;send editor triggers (CodeMirror 6)
├── actions.ts           Notices, status bar and error reporting
├── cli.ts               Obsidian command line handlers
├── backup/              Note, archive, automatic and restore logic
├── format/              Markdown → Telegram HTML, message splitting, templates
├── telegram/            Bot API client (requestUrl), multipart uploads, errors
├── zip/                 ZIP writer and archive splitting (deflate by fflate)
├── ui/                  Modals, status bar and progress notice
└── utils/               Small helpers
test/                    Unit tests (Node.js test runner)
docs/                    Publishing guide and plugin development guide
```

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for how releases and the community directory submission work, and [docs/HOW-OBSIDIAN-PLUGINS-WORK.md](docs/HOW-OBSIDIAN-PLUGINS-WORK.md) for an explanation of how this plugin is built.

## Credits

- [fflate](https://github.com/101arrowz/fflate) (MIT) for fast deflate compression.
- Built with the [Obsidian API](https://github.com/obsidianmd/obsidian-api).

## License

[MIT](LICENSE)
