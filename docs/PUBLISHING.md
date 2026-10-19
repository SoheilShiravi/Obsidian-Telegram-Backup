# Publishing Telegram Backup

This guide takes the plugin from this folder to the Obsidian community directory, where anyone can install it from **Settings → Community plugins → Browse**.

> [!NOTE]
> **The process changed in May 2026.** Plugins used to be submitted with a pull request to the `obsidianmd/obsidian-releases` repository on GitHub. Since May 2026, you submit through the **Obsidian Community** site at <https://community.obsidian.md>. Every version, not only the first one, is reviewed automatically within minutes. Obsidian still downloads the plugin files from your **GitHub releases**, so GitHub remains part of the process.

The overall flow:

```
your computer ──git push──▶ GitHub repository ──tag──▶ GitHub release (main.js, manifest.json, styles.css)
                                                               │
                         community.obsidian.md ◀──submit──────┘
                         (automated review, listing page)
                                   │
                                   ▼
                     Obsidian app: Community plugins → Browse → Install
```

## 1. Check the project

Run these from the project folder. All three must succeed:

```sh
npm install
npm run lint     # official Obsidian lint rules (eslint-plugin-obsidianmd)
npm test         # unit tests
npm run build    # type check + production build of main.js
```

Then review these files:

| File | What to check |
| --- | --- |
| `manifest.json` | `id` is `telegram-backup`. **Never change the ID after the first release.** `author` and `authorUrl` are yours. `version` is `1.0.0`. `minAppVersion` is `1.13.2`. `isDesktopOnly` is `false`. Add `fundingUrl` only if you accept donations. |
| `manifest.json` → `description` | Starts with a verb, has no emoji, ends with a period, is at most 250 characters and does not contain "Obsidian". |
| `versions.json` | Maps every plugin version to its minimum Obsidian version: `"1.0.0": "1.13.2"`. |
| `LICENSE` | Your name and the current year. |
| `README.md` | Explains setup and discloses network use (required by the developer policies). |
| `package.json` | `name`, `description` and `author` are up to date. |

The plugin ID `telegram-backup` was not used by any other plugin when this project was created (October 2026). The directory checks this again when you submit.

Before publishing, also test the plugin in a real vault: copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/telegram-backup/`, enable it, and go through the setup in the README with a real bot and channel. If you can, test on a phone as well (see [Beta testing with BRAT](#4-optional-beta-testing-with-brat)).

## 2. Put the code on GitHub

The community directory only accepts open-source plugins hosted on GitHub.

1. Create a GitHub account at <https://github.com/signup> if you do not have one.
2. On GitHub, select **New repository**. Name it `obsidian-telegram-backup`, make it **Public**, and do **not** add a README, license or `.gitignore` (the project already has them).
3. In the project folder, run:

   ```sh
   git init
   git add .
   git commit -m "Telegram Backup 1.0.0"
   git branch -M main
   git remote add origin https://github.com/SoheilShiravi/obsidian-telegram-backup.git
   git push -u origin main
   ```

   Replace `SoheilShiravi` with your GitHub username if it is different, and update `authorUrl` in `manifest.json` and the links in `README.md` to match.

`main.js` and `node_modules/` are listed in `.gitignore`: build output belongs in releases, not in the repository.

After the first push, open the **Actions** tab of the repository. The **CI** workflow lints, tests and builds every push.

## 3. Create a release

Obsidian installs a plugin by downloading three files from a GitHub release: `main.js`, `manifest.json` and `styles.css`. The release **tag must be exactly the version in `manifest.json`**, for example `1.0.0`, with no `v` in front.

### Option A: automatic release with GitHub Actions (recommended)

The workflow in `.github/workflows/release.yml` runs when you push a version tag. It checks that the tag matches `manifest.json`, lints, tests, builds, attests the build provenance, and creates a **draft** release with the three files attached.

First release:

```sh
git tag 1.0.0
git push origin 1.0.0
```

Wait for the **Release** workflow to finish in the **Actions** tab, open **Releases**, check the draft, and select **Publish release**.

If the workflow fails with a permission error, open the repository's **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**.

Later releases:

```sh
npm version patch    # 1.0.0 → 1.0.1 (use "minor" or "major" for bigger changes)
git push
git push --tags
```

`npm version` updates `package.json`, copies the version into `manifest.json`, adds it to `versions.json` (through `version-bump.mjs`), commits and creates the tag. The `.npmrc` file makes sure the tag has no `v` prefix. If a release needs a newer Obsidian version, update `minAppVersion` in `manifest.json` **before** running `npm version`.

### Option B: manual release

1. Run `npm run build`.
2. On GitHub, open **Releases → Draft a new release**.
3. In **Choose a tag**, type `1.0.0` and create the tag.
4. Use any title, for example `1.0.0`, and describe the changes.
5. Attach `main.js`, `manifest.json` and `styles.css` from the project folder as individual files (not in a zip).
6. Select **Publish release**.

## 4. (Optional) Beta testing with BRAT

Before or after submitting, testers can install the plugin straight from your GitHub releases with the BRAT plugin:

1. Install **BRAT** from the community directory.
2. Run **BRAT: Add a beta plugin for testing** and enter `https://github.com/SoheilShiravi/obsidian-telegram-backup`.

This works on mobile too, which makes it the easiest way to test on a phone.

## 5. Submit to the community directory

1. Create a free Obsidian account at <https://obsidian.md/account> if you do not have one.
2. Sign in at <https://community.obsidian.md>. This opens the developer dashboard.
3. Connect your **GitHub account**. The directory uses it to verify that you own the repository. Only the owner of a repository can submit it.
4. Select **Add** (or **Submit**) a plugin and choose the `obsidian-telegram-backup` repository. The directory reads `manifest.json` from the latest commit of your default branch, so make sure it is pushed, and it needs the published release from step 3.
5. Complete the steps in the dashboard: listing title and description, screenshots, categories (for example **Integrations**), and the payment label (**Free**).
6. The **automated review** starts right away and usually finishes within a few minutes. It checks:
   - adherence to the [developer policies](https://docs.obsidian.md/Community+directory/Developer+policies) and [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
   - code quality, based on the same rules as `npm run lint`,
   - known vulnerabilities and malware.
7. If the review reports errors, fix them, publish a new release with a higher version (step 3), and the new version is reviewed automatically. A **preview scan** in the dashboard can check any branch, tag or commit before you release.
8. Once the review passes, the plugin becomes searchable and installable in Obsidian within 24 hours.

The listing page shows a **scorecard** with the results of the automated checks. Obsidian plans to add capability disclosures (for example network access) and artifact attestation to the scorecards; the release workflow already attests the build provenance of the release files.

## 6. After publishing

- Announce the plugin in the **Share & showcase** section of the [Obsidian forum](https://forum.obsidian.md/c/share-showcase/9) and in the `#updates` channel on the [Obsidian Discord](https://discord.gg/obsidianmd) (posting in `#updates` requires the developer role).
- Keep `minAppVersion` accurate when you use newer APIs; the lint rule `obsidianmd/no-unsupported-api` warns you.
- Every update is reviewed automatically. A failed update shows the details in the dashboard.
- Answer issues on GitHub. Unmaintained plugins that break on newer Obsidian versions can be removed from the directory.

## 7. What the review looks for, and how this project handles it

| Requirement | In this project |
| --- | --- |
| No sample code left from the template | Written from scratch. |
| No `innerHTML` / `outerHTML` with user content | All UI is built with `createEl`, `createDiv` and `Setting`. |
| No default hotkeys; command IDs without the plugin ID | 12 commands, none with a hotkey. |
| Settings headings: sentence case, no "settings", no plugin name, no HTML headings | Declarative groups: "Connection", "Note backups", and so on. |
| Settings searchable in Obsidian 1.13+ | `getSettingDefinitions()` instead of the deprecated `display()`. |
| No Node.js or Electron APIs in a mobile plugin | Only Obsidian and web APIs (`requestUrl`, `TextEncoder`, `crypto.getRandomValues`). |
| Use `requestUrl` instead of `fetch` | The Telegram client is built on `requestUrl`. |
| Clean up on unload | Everything goes through `registerEvent`, `registerInterval`, `registerDomEvent` and `register`. |
| No unnecessary console logging | Only `console.error` / `console.warn` for unexpected errors. |
| API use matches `minAppVersion` | `npm run lint` checks it (`obsidianmd/no-unsupported-api`). |
| Network use disclosed in the README | See **Privacy and security** in the README. |
| No client-side telemetry, no self-updating, no remote code | None. |
| LICENSE and attribution | MIT license; fflate (MIT) is credited in the README. |

## Release checklist

Copy this list for every release:

- [ ] `npm run lint`, `npm test` and `npm run build` pass.
- [ ] Tested in a vault on desktop (and on mobile when the change affects it).
- [ ] `minAppVersion` updated if a newer API is used.
- [ ] `npm version patch|minor|major`, then `git push` and `git push --tags`.
- [ ] Release workflow succeeded; draft release checked and published.
- [ ] Automated review in the community dashboard passed.
