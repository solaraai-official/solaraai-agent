# Solara AI for AI agents

Your AI agent turns a talking-head recording into an edited, captioned short video with
[Solara AI](https://solaraai.com): cuts, captions, zooms, b-roll and music in a style you choose.
It shows you the edit, exports only after your yes, and asks before it posts: you approve every post.

<!-- GIF: agent asks, you approve -->

⭐ **[Star this repo][repo]** to follow new commands and agent features as they ship.

## Install

### Claude Code: the plugin

The plugin adds the Solara AI MCP server and the `solara-video` skill:

```text
/plugin marketplace add solaraai-official/solara-agent-skills
/plugin install solara@solaraai
```

Then type `/mcp`, pick **plugin:solara:solara** and sign in to Solara: click **Allow**.

### Any AI agent that uses MCP

Add the server `https://api.solaraai.com/mcp`, sign in to Solara and click **Allow**. No key to
handle, and the agent can ask to post a video, photos or a text post, which you approve in Solara.
Step-by-step guides for each agent:
[docs.solaraai.com/agents/connect](https://docs.solaraai.com/agents/connect).

```bash
# For example, Claude Code without the plugin
claude mcp add --transport http --scope user solara https://api.solaraai.com/mcp
```

### The skill, for agents that run commands

```bash
npx skills add solaraai-official/solara-agent-skills --skill solara-video -g
```

Add `-a claude-code`, `-a cursor`, `-a opencode`, `-a codex` or `-a openclaw` to pick the agent, or
copy the [`solara-video`][skill] folder to where your agent loads skills.

The skill runs Solara's CLI, the npm package [`solaraai`](https://www.npmjs.com/package/solaraai),
with an API key from **Settings → API keys** in Solara
([app.solaraai.com/settings/api-keys](https://app.solaraai.com/settings/api-keys)). Give it to the
agent as an environment variable, never in a chat:

```bash
export SOLARA_API_KEY="sol_live_..."
npx -y solaraai login      # checks the key (Node.js 20 or newer, nothing to install)
npx -y solaraai --help     # every command
```

The CLI never stores or prints the key. An API key can export but can't post.

## Try it

```text
Turn talk.mp4 into a 30-second Reel with Solara, then show me the edit before you export it.
```

## What the agent will and won't do

- It shows you the edit link and waits for your yes before exporting.
- Each export uses one of your plan's videos for the month, so it exports once per approved edit.
- It never posts by itself: you approve each post in Solara. With an API key it can't post at all.
- It never prints, logs or commits your key, and never touches billing or your account.

## What you need

- A Solara account. API keys need a paid plan, Essential or Premium:
  [solaraai.com/pricing](https://solaraai.com/pricing).
- For the CLI, Node.js 20 or newer.

## In this repository

| Path | What it is |
| --- | --- |
| [skills/solara-video][skill] | The skill: its `SKILL.md` teaches an agent Solara's CLI. |
| [.claude-plugin][claude-plugin], [.mcp.json][claude-mcp] | The Claude Code plugin and marketplace: the skill and the MCP server. |
| [.cursor-plugin][cursor-plugin], [mcp.json][cursor-mcp] | The same plugin in Cursor's format. |
| [cli][cli] | The source of the `solaraai` CLI, published to npm from here with provenance. |

## Support

- Help: [solaraai.com/contact](https://solaraai.com/contact), or the support chat in the app.
- [Privacy policy](https://solaraai.com/privacy-policy) and [terms](https://solaraai.com/terms-of-service).
- A security problem? Report it privately, never in a public issue: see [SECURITY.md][security].
  If a key leaks, delete it in Settings → API keys.

⭐ Found it useful? **[Star this repo][repo]** so other people find it too.

## For maintainers

The CLI, the skill, the plugin manifests and this README are copies: their source is Solara's
private monorepo, which syncs them here. Change them there, never here, or the next sync undoes the
change. Releases and checks: [MAINTAINERS.md][maintainers].

## License

[MIT][license]

[repo]: https://github.com/solaraai-official/solara-agent-skills
[skill]: https://github.com/solaraai-official/solara-agent-skills/tree/main/skills/solara-video
[claude-plugin]: https://github.com/solaraai-official/solara-agent-skills/tree/main/.claude-plugin
[claude-mcp]: https://github.com/solaraai-official/solara-agent-skills/blob/main/.mcp.json
[cursor-plugin]: https://github.com/solaraai-official/solara-agent-skills/tree/main/.cursor-plugin
[cursor-mcp]: https://github.com/solaraai-official/solara-agent-skills/blob/main/mcp.json
[cli]: https://github.com/solaraai-official/solara-agent-skills/tree/main/cli
[security]: https://github.com/solaraai-official/solara-agent-skills/blob/main/SECURITY.md
[maintainers]: https://github.com/solaraai-official/solara-agent-skills/blob/main/MAINTAINERS.md
[license]: https://github.com/solaraai-official/solara-agent-skills/blob/main/LICENSE
