# Maintaining solara-agent-skills

This repository is private until launch day, then public. It holds the Solara AI skill and the
plugin (for Claude Code, Cursor and Grok Bot), and it is where the npm package `solaraai` (the CLI
in `cli/`) is published from, with provenance. The CLI's and the
skill's source is Solara's private monorepo (`packages/node/solara-cli`), copied here by
`just solara-cli-sync-public <checkout>`: change them there, never here.

How a release reaches npm: a GitHub release tagged `cli-v<version>` runs
[`publish.yml`](.github/workflows/publish.yml), which waits for a reviewer's approval on the `npm`
environment, tests and builds the CLI, and runs `npm publish --provenance`. npm accepts it because
of the trusted publisher set up below: GitHub gives the job a short-lived OIDC token, and no npm
token exists anywhere.

## One-time setup (the owner)

Do steps 4 and 5 within two days of each other: npm expires a trusted publisher that has not
published within two days of being created.

### 1. npm: the account and the package

- An npm account with two-factor authentication on, owning the package `solaraai`.
- The package must already exist before a trusted publisher can be added to it (npm's rule). If
  the name was claimed by publishing a placeholder (say `0.0.0`) by hand, that is enough. The
  placeholder is deprecated in step 6.

### 2. GitHub: the repository, private until launch day

Done on 2026-10-27: the repository exists, **private**, with GitHub Actions turned off so a private
repository's minutes are not billed. No secrets, environments or releases are set up on it yet.

```bash
# In the platform monorepo, on an up-to-date master: refresh the copies first.
just solara-cli-sync-public <path to this folder>

cd <path to this folder>
git init -b main
# The commit's name and email are public once the repository is: never a personal address.
git config user.name "Solara AI"
git config user.email contact@solaraai.com
git add .
git commit -m "Solara AI skill, plugin and the solaraai CLI"

gh repo create solaraai-official/solara-agent-skills --private --source . --push \
  --description "Solara AI for AI agents: the skill, the plugin and the solaraai CLI"
gh api -X PUT repos/solaraai-official/solara-agent-skills/actions/permissions -F enabled=false
```

**Before every push and before it goes public, run every check on your machine**, over the whole
history. Going public can't be taken back: anything in any commit is public for good. Use the
versions the workflows pin (gitleaks 8.30.1, trufflehog 3.99.7, actionlint 1.7.12, zizmor 1.31.1;
their release pages publish checksums), from the folder:

```bash
gitleaks git --redact --no-banner --verbose .                            # every commit, every pattern
trufflehog git "file://$PWD" --results=verified --fail --no-update       # live secrets
bun scripts/check-no-internal.ts --self-test                             # the denylist works
bun scripts/check-no-internal.ts                                         # every file
bun scripts/check-no-internal.ts --history                               # every commit and message
bun scripts/check-no-internal.ts --authors                               # every commit's email address
actionlint -color                                                        # the workflows
GH_TOKEN="$(gh auth token)" uvx zizmor@1.31.1 .github/workflows          # unsafe workflow patterns
(cd cli && bun install --frozen-lockfile && bun run typecheck && bun test && npm pack --dry-run)
npx -y @anthropic-ai/claude-code@2.1.310 plugin validate . --strict      # the Claude Code plugin
```

And the Cursor plugin against Cursor's schemas (see [Cursor and Grok Bot](#cursor-and-grok-bot)).
Every one must end with exit code 0. If one finds something while the repository is still
private, fix it and rewrite the history before it goes public (`rm -rf .git`, `git init` as above,
then `git push --force`).

**On launch day**, after a fresh sync and the checks above:

```bash
gh repo edit solaraai-official/solara-agent-skills --visibility public \
  --accept-visibility-change-consequences
gh api -X PUT repos/solaraai-official/solara-agent-skills/actions/permissions -F enabled=true
```

`.gitignore` keeps `node_modules/`, `dist/` and packed tarballs out. The workflows run on the next
push to `main` or pull request: check that `CI` and `Safety` are green (Actions tab).

### 3. GitHub: security settings and the release path

In the repository's **Settings**:

1. **Security and quality → Advanced Security** (free on a public repository): turn on **Private
   vulnerability reporting** (`SECURITY.md` sends reporters there), **Secret Protection** (secret
   scanning and push protection), **Dependabot alerts** and **Dependabot security updates**.
2. **Environments → New environment** `npm`:
   - **Required reviewers**: the owner (and anyone else allowed to release).
   - **Deployment branches and tags → Selected branches and tags → Add rule**: tag, `cli-v*`.
3. **Rules → Rulesets → New tag ruleset** `release tags`: target tags matching `cli-v*`, restrict
   creations, updates and deletions, with only repository admins in the bypass list.
4. **Rules → Rulesets → New branch ruleset** `main`: require a pull request and the status checks
   `CLI (Node 20)`, `CLI (Node 22)`, `CLI (Node 24)`, `Plugin and skill`, `Secrets (gitleaks,
   trufflehog)`, `No internal names` and `Workflows (zizmor, actionlint)`; block force pushes.
5. **Actions → General**: workflow permissions "Read repository contents and packages
   permissions" (the default), and "Require approval for all external contributors" for fork
   pull requests.

### 4. npm: add the trusted publisher

On npmjs.com: **solaraai → Settings → Trusted publishing → GitHub Actions**, then exactly (every
field is case-sensitive, and npm does not check them until a publish):

| Field | Value |
| --- | --- |
| Organization or user | `solaraai-official` |
| Repository | `solara-agent-skills` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed actions | tick **npm publish** (`npm stage publish` is always allowed) |

Or from a terminal, signed in to npm (npm 11.15.0 or newer, two-factor authentication):

```bash
npm trust github solaraai --repo solaraai-official/solara-agent-skills \
  --file publish.yml --env npm --allow-publish
npm trust list solaraai
```

`cli/package.json`'s `repository.url` already names this repository, which npm requires.

### 5. The first release

```bash
grep '"version"' cli/package.json        # 0.1.0
gh release create cli-v0.1.0 --repo solaraai-official/solara-agent-skills --target main \
  --title "solaraai 0.1.0" --notes "The first release of the Solara CLI: npx -y solaraai --help"
```

(Or **Releases → Draft a new release**, tag `cli-v0.1.0` on `main`, **Publish release**.) Then, in
**Actions → Publish the CLI to npm**, approve the `npm` deployment. The job fails before publishing
if the tag is not `cli-v` + the version in `cli/package.json`.

Check it:

```bash
npm view solaraai version                # 0.1.0
npx -y solaraai@0.1.0 --version          # solaraai 0.1.0
```

npmjs.com/package/solaraai shows the version with a provenance badge linking to this repository's
workflow run.

### 6. Lock it down

- npm: **solaraai → Settings → Publishing access → Require two-factor authentication and disallow
  tokens**. The trusted publisher keeps working; tokens no longer can publish.
- Revoke any npm token made for the name claim (**Access Tokens**).
- Deprecate the placeholder, if there was one: `npm deprecate solaraai@0.0.0 "placeholder: use the latest version"`.

## Every later release

1. In the monorepo: bump `version` in `packages/node/solara-cli/package.json` and merge (semver: a
   changed command, flag or exit code is a major bump).
2. `just solara-cli-sync-public <checkout of this repository>`, then a pull request here with the
   diff. The sync runs this repository's `scripts/check-no-internal.ts` on the monorepo's files
   first and copies nothing when it finds an internal name. Merge once CI and Safety are green.
3. `gh release create cli-v<version> --target main ...` and approve the `npm` deployment.

A release marked as a pre-release publishes under the npm tag `next`, so `npx -y solaraai` keeps
the last full release. A failed run publishes nothing: fix the cause, delete the release and its
tag, and release again (npm never accepts the same version twice).

## The skill and the plugin

Changes to `skills/solara-video/SKILL.md` also come from the monorepo (`just
solara-cli-sync-public`). The plugin and marketplace manifests live only here: `.claude-plugin/`
with `.mcp.json` for Claude Code, `.cursor-plugin/` with `mcp.json` for Cursor and Grok Bot. Both
plugins are named `solara` (an id: never rename it) and shown as **Solara AI**, and both connect
the remote server `https://api.solaraai.com/mcp` (streamable HTTP, the person signs in with OAuth;
nothing runs locally). Keep `version` the same in both `plugin.json` files: Cursor's validator
fails when they differ. CI runs `claude plugin validate . --strict` on the Claude Code manifests and
the skill.

The icon in `assets/` is the one the Solara AI MCP server itself shows
(`https://app.solaraai.com/solara-connector-icon.svg` and `-512.png`): a black ring on a white
rounded tile, readable on light and dark. Replace both files together if it changes.

## Cursor and Grok Bot

Grok Bot and Cursor read the same plugin format, and one submission lists the plugin in both.

**The format**, checked on 2026-10-27 against Cursor's
[Plugins reference](https://cursor.com/docs/reference/plugins) and the JSON schemas Cursor's own
marketplace validates with, [`cursor/plugins/schemas`](https://github.com/cursor/plugins/tree/9f844cdaac06aeaa1b2d17fbcb57e078979c6f99/schemas):

- `.cursor-plugin/plugin.json`: only `name` is required (lowercase, kebab-case). The schema allows
  no field it does not list: `author` takes `name` and `email` only (no `url`, unlike Claude
  Code's). `logo` is a path in this repository, resolved to a `raw.githubusercontent.com` URL, so
  the logo only shows once the repository is public. `skills` and `mcpServers` name `./skills/`
  and `./mcp.json`.
- `mcp.json` at the root: Cursor's MCP format (see [MCP](https://cursor.com/docs/context/mcp)). A
  server with a `url` is remote; Cursor signs in with OAuth (PKCE, dynamic client registration),
  using the redirect addresses Cursor documents, which Solara's sign-in already accepts.
- `.cursor-plugin/marketplace.json`: optional for one plugin; it lists `solara` at `./`, as the
  Claude Code marketplace does. Plugin entries take `name`, `source`, `description` and
  `minClientVersions` only.

Check both files with Cursor's own validator, from a copy of this folder (it reads the schemas
next to it):

```bash
SHA=9f844cdaac06aeaa1b2d17fbcb57e078979c6f99   # cursor/plugins; move it on purpose, after reading the diff
tmp="$(mktemp -d)" && rsync -a --exclude cli --exclude scripts --exclude .git ./ "$tmp/"
mkdir -p "$tmp/schemas" "$tmp/scripts"
for f in schemas/plugin.schema.json schemas/marketplace.schema.json scripts/validate-plugins.mjs; do
  curl -fsSL -o "$tmp/$f" "https://raw.githubusercontent.com/cursor/plugins/$SHA/$f"
done
(cd "$tmp" && echo '{"type":"module"}' > package.json && npm i -s ajv@8 ajv-formats@3 \
  && node scripts/validate-plugins.mjs)   # All plugins validated successfully.
```

Then test it in Cursor before submitting (Cursor's checklist asks for it): copy this folder to
`~/.cursor/plugins/local/solara`, run **Developer: Reload Window**, and check in **Customize** that
the `solara-video` skill and the `plugin-solara-solara` MCP server are there; sign in and make one
edit.

**Launch day: submit it** (not before: both need the repository public, and Cursor lists only
open-source plugins it has reviewed):

1. Make the repository public (step 2 above) and run the checks.
2. Submit once for Grok Bot and Cursor (and Grok, once it opens) at
   [x.ai/bot/marketplace/submit-a-plugin](https://x.ai/bot/marketplace/submit-a-plugin). The form
   asks for: a work email (`contact@solaraai.com`), the organization name (Solara AI) and handle
   (`solaraai`), the website (`https://solaraai.com`), a logotype URL, 1:1 SVG or PNG with a
   background plate (`https://app.solaraai.com/solara-connector-icon-512.png`), where to list it
   (tick Grok Bot and Cursor, and Grok), the MCP server URL or public GitHub repository (the
   repository, `https://github.com/solaraai-official/solara-agent-skills`, so the skill is
   included), a brief description, and testing instructions. Reviewers need a Solara account on a
   paid plan to test: give them one in the testing instructions, never in this repository.
3. Or, for Cursor alone, submit the repository at
   [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish); questions to
   marketplace-publishing@cursor.com. <!-- no-internal: allow -->
4. When it is listed, drop "Once Solara AI is listed in their marketplaces" from the README's
   Cursor section.

## What runs here

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` | pull requests, `main` | the CLI's typecheck, tests and `npm pack` on Node 20, 22 and 24; `claude plugin validate` |
| `safety.yml` | pull requests, `main` | gitleaks and trufflehog over the whole history; the internal-names denylist on every file, commit and message; zizmor and actionlint on the workflows |
| `scorecard.yml` | weekly, `main` | OpenSSF Scorecard, findings in the Security tab |
| `publish.yml` | a release tagged `cli-v*` | checks Node 22.14+ and npm 11.5.1+, tests, `npm publish --provenance` |

Every action is pinned by commit SHA, every downloaded scanner by version and SHA-256. To update
one, read its release notes, then change the SHA and the version comment together.

The denylist (`scripts/check-no-internal.ts`) matches shapes, never names, because it is public
too. A line that must show one of those shapes as a documented example carries the marker
`no-internal: allow`.
