# Solara AI for AI agents

Let your AI agent turn a talking-head recording into an edited short video with
[Solara AI](https://solaraai.com): cuts, captions, zooms, b-roll and music in a style you choose.
The agent uploads the clip, starts the edit and shows you the result. It exports the video only
after you say yes.

This repository has:

| Path | What it is |
| --- | --- |
| [`skills/solara-video/`](skills/solara-video/) | An [Agent Skill](https://agentskills.io): `SKILL.md`, which teaches the agent Solara's command-line tool, the npm package [`solaraai`](https://www.npmjs.com/package/solaraai). The agent runs it with `npx -y solaraai` (Node.js 20+, nothing else to install) and a Solara API key. |
| [`.claude-plugin/`](.claude-plugin/), [`.mcp.json`](.mcp.json) | A Claude Code plugin and marketplace: installs the skill and connects the Solara AI MCP server. |
| [`.cursor-plugin/`](.cursor-plugin/), [`mcp.json`](mcp.json) | The same plugin for Cursor and Grok Bot: the skill and the Solara AI MCP server. |
| [`assets/`](assets/) | The Solara AI icon. |
| [`cli/`](cli/) | The source of the `solaraai` CLI, its tests and its build, published to npm from this repository with provenance. |

## Two ways to connect

- **Sign in (MCP).** Assistants that use remote MCP servers, such as ChatGPT, Claude, Claude Code,
  Cursor and opencode, connect to `https://api.solaraai.com/mcp` and you sign in to Solara.
  No key to handle, and the assistant can also ask to post a video, which you approve in Solara.
  Guides: [docs.solaraai.com/assistants/connect](https://docs.solaraai.com/assistants/connect).
- **Skill and API key.** For an agent that runs commands on your computer. The CLI
  (`npx -y solaraai`) reads the key from the environment, so it never appears in the chat, and it
  never stores or prints it. An API key can't post.

## What you need

- A Solara account on a **paid plan** (Essential or Premium). See
  [solaraai.com/pricing](https://solaraai.com/pricing).
- For the skill, an **API key**: in Solara, open **Settings → API keys** and choose
  **Create API key** ([app.solaraai.com/settings/api-keys](https://app.solaraai.com/settings/api-keys)).
  Solara shows it once. Give it to your agent as the environment variable `SOLARA_API_KEY`:

  ```bash
  export SOLARA_API_KEY="sol_live_..."
  ```

  Never paste it into a chat or commit it. Delete a key in the same place when you no longer need it.
  `npx -y solaraai login` checks it.
- For the skill, **Node.js 20 or newer** (`npx` comes with it).

## Install

### Claude Code

Install the plugin (the skill plus the Solara AI MCP server):

```text
/plugin marketplace add solaraai-official/solara-agent-skills
/plugin install solara@solaraai
```

Then type `/mcp`, pick **plugin:solara:solara** and sign in to use the MCP server. Only want one
of the two?

```bash
# The MCP server alone
claude mcp add --transport http --scope user solara https://api.solaraai.com/mcp
# The skill alone
npx skills add solaraai-official/solara-agent-skills --skill solara-video -a claude-code -g
```

### Cursor and Grok Bot

The plugin (the skill plus the Solara AI MCP server) is also in Cursor's plugin format, which Grok
Bot reads too. Once **Solara AI** is listed in their marketplaces, install it there (in Cursor:
**Customize**, search for Solara AI, **Install**), and sign in to Solara the first time the agent
uses the server.

Until then, or to try this repository's version: copy it to `~/.cursor/plugins/local/solara`,
then run **Developer: Reload Window**. Only want one of the two?

```bash
# The skill alone
npx skills add solaraai-official/solara-agent-skills --skill solara-video -a cursor -g
```

For the MCP server alone, add it to `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "solara": { "url": "https://api.solaraai.com/mcp" } } }
```

### OpenClaw

```bash
npx skills add solaraai-official/solara-agent-skills --skill solara-video -a openclaw -g
```

Give it the key in `openclaw.json`; OpenClaw passes it to the skill as `SOLARA_API_KEY`:

```json5
{ skills: { entries: { "solara-video": { apiKey: "sol_live_..." } } } }
```

### opencode

```bash
npx skills add solaraai-official/solara-agent-skills --skill solara-video -a opencode -g
```

Or connect the MCP server instead: [docs.solaraai.com/assistants/opencode](https://docs.solaraai.com/assistants/opencode).

### Codex

```bash
npx skills add solaraai-official/solara-agent-skills --skill solara-video -a codex -g
```

### Any other agent

Copy `skills/solara-video/` into the folder your agent loads skills from, or point it at
`skills/solara-video/SKILL.md`. If the agent runs commands in a sandbox, allow it to reach
`api.solaraai.com` and `registry.npmjs.org` (and set `HTTPS_PROXY` if it goes through a proxy).

## Try it

```text
Turn talk.mp4 into a 30-second Reel with Solara, then show me the edit before you export it.
```

## What the agent will and won't do

- It shows you the edit link and waits for your yes before exporting.
- Each export uses one of your plan's videos for the month, so it exports once per approved edit.
- With an API key it never posts, changes billing or touches your account.
- It never prints, logs or commits your key.

Full guide: [docs.solaraai.com/assistants/skill-and-cli](https://docs.solaraai.com/assistants/skill-and-cli).

## Support, privacy and security

- Help: [solaraai.com/contact](https://solaraai.com/contact), or the support chat in the app.
- [Privacy policy](https://solaraai.com/privacy-policy) and [terms](https://solaraai.com/terms-of-service).
- Found a security problem? Report it privately, never in a public issue: see
  [SECURITY.md](SECURITY.md). If a key leaks, delete it in Settings → API keys.

## For maintainers

The CLI in `cli/` and the skill in `skills/solara-video/` are copies: their source is Solara's
private monorepo, which syncs them here (`just solara-cli-sync-public`). Change them there, never
here, or the next sync undoes the change.

This repository runs GitHub Actions on purpose. The monorepo runs none (its CI is elsewhere, by
policy), but npm signs provenance only for a package published from a public repository's cloud CI,
so the `solaraai` package is tested and published here: [`ci.yml`](.github/workflows/ci.yml)
checks every pull request, [`safety.yml`](.github/workflows/safety.yml) scans the whole history for
secrets and internal names and the workflows for unsafe patterns,
[`scorecard.yml`](.github/workflows/scorecard.yml) runs OpenSSF Scorecard weekly, and
[`publish.yml`](.github/workflows/publish.yml) publishes a release tagged `cli-v<version>` through
npm trusted publishing (OIDC, no npm token). Setup and releases: [MAINTAINERS.md](MAINTAINERS.md).

## License

[MIT](LICENSE)
