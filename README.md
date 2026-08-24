<h1 align="center">DeepSeek V4 for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/Vizards/deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="Install from Open VSX"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/Vizards/deepseek-v4-for-copilot?style=for-the-badge&label=Version" alt="Version" />
  <img src="https://vsmarketplacebadges.dev/installs-short/Vizards.deepseek-v4-for-copilot.svg?style=for-the-badge" alt="Installs" />
</p>

<p align="center">
  English |
  <a href="https://github.com/Vizards/deepseek-v4-for-copilot/blob/main/README.zh-cn.md">简体中文</a>
</p>

**Pick DeepSeek V4 from the Copilot Chat model picker — and keep everything else Copilot already gives you.**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="DeepSeek V4 Flash, Flash Vision Exp, and Pro in the Copilot Chat model picker, alongside the Thinking Effort menu" width="800">
</p>

Love DeepSeek's price-performance but don't want to give up GitHub Copilot's agent mode, tool calling, and polished UI? This extension adds **DeepSeek V4 Flash, Pro, and Flash Vision Exp** to the Copilot Chat model selector — with **native vision or Vision Proxy**, **thinking mode**, and your own API key.

## Why this extension?

- **Don't replace Copilot — power it up.** No new sidebar, no new chat UI to learn. Just a new model in the picker you already use.
- **Agent mode, tool calling, instructions, MCP, skills — all of it still works.** Copilot's entire stack, now running on DeepSeek.
- **Two ways to work with images.** Flash Vision Exp receives image attachments natively. Flash and Pro keep their existing text context while a configurable Vision Proxy turns images into descriptions.
- **BYOK, pay DeepSeek directly.** Your API key, your bill, your rate limits. Stored in the OS keychain, never on disk.

## Features

### Three DeepSeek V4 models in the model picker
Flash, Pro, and the experimental Flash Vision Exp appear alongside other models in Copilot Chat's model selector. All three support DeepSeek's long context, tool calling, and configurable thinking effort.

### Native Vision and Vision Proxy
Choose the image path that fits the conversation:

- **DeepSeek V4 Flash Vision Exp** handles image attachments as native multimodal input, without Vision Proxy. It is exposed as a separate experimental model and does not silently fall back when the configured API endpoint does not support its model ID.
- **DeepSeek V4 Flash and Pro** use Vision Proxy: an image-capable model first describes each attachment, then the main DeepSeek model receives the description with the conversation. Auto mode selects Flash Vision Exp when available, while an explicitly configured VS Code model or API endpoint remains supported.

Avoid switching models mid-chat just to inspect an image if DeepSeek prefix-cache reuse matters. Start the conversation with Flash Vision Exp for native vision, or stay on Flash/Pro and let Vision Proxy preserve the main model choice.

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="Dropping an image into Copilot Chat and DeepSeek responding to it via the vision proxy" width="800">
</p>

### Thinking Mode with Reasoning Effort Control
Full support for DeepSeek V4's `reasoning_content`. Flash, Pro, and Flash Vision Exp offer `none` (off), `low` (light reasoning), `high` (balanced, default), and `max` (deep reasoning for hard agent tasks), matching the effort levels implemented by the official API.

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
- DeepSeek API key from [platform.deepseek.com](https://platform.deepseek.com), or a compatible provider token when using a custom `deepseek-copilot.baseUrl`

### Installation

Install from the registry used by your editor:

1. **Microsoft VS Code** — install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot).
2. **Editors that use Open VSX** — install from [Open VSX](https://open-vsx.org/extension/Vizards/deepseek-v4-for-copilot).

### Usage

1. Run **DeepSeek: Set API Key** from the Command Palette (`Cmd+Shift+P`)
2. Paste your key or compatible provider token (official DeepSeek keys usually start with `sk-`)
3. Open Copilot Chat, click the model picker, and choose **DeepSeek V4 Flash**, **DeepSeek V4 Pro**, or **DeepSeek V4 Flash Vision Exp**
4. That's it — chat away

## Models

| Model | Image Handling | Thinking Effort | Best For |
|---|---|---|---|
| **DeepSeek V4 Flash** | Vision Proxy | `none` / `low` / `high` / `max` | Fast everyday coding, quick edits, cheap iteration |
| **DeepSeek V4 Pro** | Vision Proxy | `none` / `low` / `high` / `max` | Complex refactors, agent tasks, deep reasoning |
| **DeepSeek V4 Flash Vision Exp** | Native image input | `none` / `low` / `high` / `max` | Direct, experimental image understanding with fast reasoning |

All three support optional thinking mode, tool calling, and 1M token context. Flash Vision Exp is experimental; custom API endpoints and compatible providers must expose its configured model ID to use it directly.

## Settings

| Setting | Default | Description |
|---|---|---|
| `deepseek-copilot.baseUrl` | `https://api.deepseek.com` | API endpoint — change for self-hosted / proxied deployments |
| `deepseek-copilot.maxTokens` | `0` | Max output tokens (`0` = no limit). Useful for cost control |
| `deepseek-copilot.modelIdOverrides` | prefilled official ID map | API model IDs to send for DeepSeek V4 Flash, Pro, and Flash Vision Exp. Change only for compatible third-party APIs with different model names |
| `deepseek-copilot.debugMode` | `minimal` | Diagnostic mode: `minimal` for token usage only, `metadata` for privacy-preserving logs, or `verbose` for full request dumps and pipeline snapshots under extension global storage. Full dumps may include sensitive prompt text, tool schemas, file snippets, and image descriptions. Use `DeepSeek: Open Request Dumps Folder` to open the dump location |
| `deepseek-copilot.visionModel` | *(auto)* | Vision Proxy used by Flash and Pro. Auto mode selects Flash Vision Exp when available; configure another VS Code model or API endpoint with `DeepSeek: Configure Vision Proxy` |
| `deepseek-copilot.visionPrompt` | *(built-in)* | Prompt used by Flash/Pro's Vision Proxy to describe image attachments. It does not affect native Flash Vision Exp requests |
| `deepseek-copilot.experimental.stabilizeToolList` | `false` | Experimental. Tries to pre-activate VS Code/Copilot virtual tools so the DeepSeek API `tools` parameter is more complete and stable across turns. May improve context-cache hit rate when enabled tools change between turns. Can increase input tokens because more function definitions may be included; cache-hit input tokens are cheaper but still count toward usage. Usually leave it off with 64 or fewer enabled tools unless the tool list still changes across turns; do not enable it with more than 128 enabled tools |

Thinking Effort is configured from Copilot Chat's model picker for each DeepSeek model.

Example `settings.json` override for compatible API proxies:

```json
{
  "deepseek-copilot.modelIdOverrides": {
    "deepseek-v4-flash": "your-flash-model-id",
    "deepseek-v4-pro": "your-pro-model-id",
    "deepseek-v4-flash-vision-exp": "your-vision-model-id"
  }
}
```

## Compared to alternatives

| | This extension | Local proxy (e.g. LiteLLM) | Standalone DeepSeek extensions |
|---|---|---|---|
| Works inside Copilot Chat | ✅ | ✅ | ❌ separate UI |
| Agent mode, tools, skills | ✅ | ✅ | ⚠️ reimplemented |
| Vision support | ✅ native + proxied | ❌ | ❌ |
| No extra process to run | ✅ | ❌ | ✅ |
| One-click install | ✅ | ❌ | ✅ |
| API key in OS keychain | ✅ | ❌ | ⚠️ varies |

## License

[MIT](LICENSE)
