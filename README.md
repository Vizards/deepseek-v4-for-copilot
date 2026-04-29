<h1 align="center">DeepSeek V4 for Copilot Chat</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/VS%20Code-Install%20Extension-blue?logo=visualstudiocode&style=for-the-badge" alt="Install in VS Code"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot"><img src="https://vsmarketplacebadges.dev/version-short/Vizards.deepseek-v4-for-copilot.svg?style=for-the-badge" alt="Version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot"><img src="https://vsmarketplacebadges.dev/installs-short/Vizards.deepseek-v4-for-copilot.svg?style=for-the-badge" alt="Installs"></a>
</p>

**Pick DeepSeek V4 from the Copilot Chat model picker — and keep everything else Copilot already gives you.**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="DeepSeek V4 Pro and Flash in the Copilot Chat model picker, with the per-model Thinking Effort dropdown (None / High / Max)" width="800">
</p>

Love DeepSeek's price-performance but don't want to give up GitHub Copilot's agent mode, tool calling, and polished UI? This extension drops **DeepSeek V4 Pro & Flash** straight into the Copilot Chat model selector — with **vision**, **thinking mode**, and your own API key.

## Why this extension?

- **Don't replace Copilot — power it up.** No new sidebar, no new chat UI to learn. Just a new model in the picker you already use.
- **Agent mode, tool calling, instructions, MCP, skills — all of it still works.** Copilot's entire stack, now running on DeepSeek.
- **Vision on a text-only model.** DeepSeek V4 can't see images. This extension proxies any image you drop into chat through another Copilot model you already have, then feeds the description to DeepSeek — transparently.
- **BYOK, pay DeepSeek directly.** Your API key, your bill, your rate limits. Stored in the OS keychain, never on disk.

## Features

### DeepSeek V4 Pro & Flash in the model picker
Both models show up alongside GPT-4o, Claude, and friends in Copilot Chat's model selector. 1M token context on both. Switch models mid-chat without losing history.

### Transparent Vision Proxy
DeepSeek V4 is text-only. Drop a screenshot into chat and this extension automatically hands the image to another installed Copilot model (Claude, GPT-4o, whatever you've got), gets a description, and feeds that back to DeepSeek. **Zero config** — just pick your preferred vision model once.

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="Dropping an image into Copilot Chat and DeepSeek responding to it via the vision proxy" width="800">
</p>

### Thinking Mode with Reasoning Effort Control
Full support for DeepSeek V4's `reasoning_content`. Use Copilot Chat's native model picker menu to choose `none` (off), `high` (balanced, default), or `max` (deep reasoning for hard agent tasks).

### Inherits Every Copilot Capability
Because this plugs into Copilot's native provider API, you get the full stack for free:
- **Agent mode** — autonomous multi-step tasks
- **Tool calling** — file edits, terminal, workspace search, Git, tests
- **Instructions & skills** — all your `.instructions.md`, `AGENTS.md`, and skills just work
- **Prompt caching stats** — DeepSeek's cache hit rate logged in the output channel so you can see the savings

<p align="center">
  <img src="resources/screenshots/04-agent.png" alt="DeepSeek V4 Pro running Copilot's agent mode with tool calls" width="800">
</p>

### Secure by Default
API key lives in VS Code's `SecretStorage` (OS keychain on macOS / Windows / Linux). Never in `settings.json`, never in your Git history.

### Zero Runtime Dependencies
Pure VS Code API + Node.js built-ins. No Python, no Docker, no local proxy server to babysit.

## Getting Started

### Prerequisites

- VS Code 1.116 or later. This extension relies on non-public Copilot Chat APIs that may break on newer VS Code versions — [report an issue](https://github.com/Vizards/deepseek-v4-for-copilot/issues) if you hit one.
- GitHub Copilot subscription (Free / Pro / Enterprise — the free tier works)
- DeepSeek API key from [platform.deepseek.com](https://platform.deepseek.com)

### Usage

1. Install from the VS Code Marketplace
2. Run **DeepSeek: Set API Key** from the Command Palette (`Cmd+Shift+P`)
3. Paste your key (starts with `sk-`)
4. Open Copilot Chat, click the model picker, pick **DeepSeek V4 Pro** or **DeepSeek V4 Flash**
5. That's it — chat away

## Models

| Model | Best For |
|---|---|
| **DeepSeek V4 Flash** | Fast everyday coding, quick edits, cheap iteration |
| **DeepSeek V4 Pro** | Complex refactors, agent tasks, deep reasoning |

Both support optional thinking mode, tool calling, and 1M token context.

## Settings

| Setting | Default | Description |
|---|---|---|
| `deepseek-copilot.baseUrl` | `https://api.deepseek.com` | API endpoint — change for self-hosted / proxied deployments |
| `deepseek-copilot.maxTokens` | `0` | Max output tokens (`0` = no limit). Useful for cost control |
| `deepseek-copilot.visionModel` | *(auto)* | Which Copilot model to proxy images through |
| `deepseek-copilot.visionPrompt` | *(built-in)* | Prompt used to describe image attachments |

Thinking Effort is configured from Copilot Chat's model picker for each DeepSeek model.

## Compared to alternatives

| | This extension | Local proxy (e.g. LiteLLM) | Standalone DeepSeek extensions |
|---|---|---|---|
| Works inside Copilot Chat | ✅ | ✅ | ❌ separate UI |
| Agent mode, tools, skills | ✅ | ✅ | ⚠️ reimplemented |
| Vision support | ✅ proxied | ❌ | ❌ |
| Extra process to run | ❌ | ✅ | ❌ |
| One-click install | ✅ | ❌ | ✅ |
| API key in OS keychain | ✅ | ❌ | ⚠️ varies |

## License

[MIT](LICENSE)
