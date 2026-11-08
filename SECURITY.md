# Security policy

## Reporting a vulnerability

Please report security problems privately, never in a public issue, pull request or discussion.

- **GitHub:** this repository's **Security** tab → **Report a vulnerability**
  ([direct link](https://github.com/solaraai-official/solaraai-agent/security/advisories/new)).
  Only Solara's maintainers see the report.
- **Email:** [contact@solaraai.com](mailto:contact@solaraai.com), with "Security" in the subject.

Tell us what is affected (the `solaraai` CLI and its version, the skill, the plugin, or Solara's
service itself), how to reproduce it, and what an attacker could do with it. We confirm that we got
your report, keep you updated while we fix it, and credit you in the advisory if you want.

## What is covered

- The `solaraai` npm package (the CLI in `cli/`): the latest release.
- The `solara-video` skill and the Claude Code plugin and marketplace manifests on `main`.
- Solara's API and app, when you reached them through any of the above.

## A leaked API key

If a Solara API key was exposed (pasted in a chat, committed, logged), delete it in Solara under
**Settings → API keys** and create a new one. That stops the old key at once. The CLI never prints,
logs or stores the key: if you saw it do so, that is a vulnerability, so please report it.

A sign-in from `solaraai login` is stored only in `~/.config/solaraai/credentials.json`, readable by
your user alone. If that file was exposed, run `solaraai logout`, or disconnect **Solara CLI** in
Solara under **Settings → Connected apps**: either ends the sign-in. The CLI never prints or logs
it either.

## How releases are protected

The CLI is published only from this repository's [`publish.yml`](https://github.com/solaraai-official/solaraai-agent/blob/main/.github/workflows/publish.yml),
through npm trusted publishing (no npm token exists) and with provenance: on
[npmjs.com/package/solaraai](https://www.npmjs.com/package/solaraai), each version links to the
workflow run that built it. `npm audit signatures` verifies it in a project that installs it.
