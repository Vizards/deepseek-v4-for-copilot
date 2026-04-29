# Changelog

## [0.3.0](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.2.0...v0.3.0) (2026-04-29)


### Features

* add configurable API model IDs for DeepSeek V4 Flash and Pro models ([#4](https://github.com/Vizards/deepseek-v4-for-copilot/issues/4)) ([de132ca](https://github.com/Vizards/deepseek-v4-for-copilot/commit/de132ca14f46a03584932e646c76ebe2add01aef))

## 0.2.0

- Show DeepSeek models in the Copilot Chat model picker as soon as the extension is active, even before an API key is configured.
- Add model picker warning state for missing API keys, with guidance to run `DeepSeek: Set API Key`.
- Add a first-run walkthrough with inline actions for getting an API key, setting an API key, and opening VS Code's Language Models manager.
- Move Thinking Effort from extension settings into Copilot Chat's native model picker configuration, with `None`, `High`, and `Max` options. `High` remains the default to match DeepSeek's default behavior.
- Remove the obsolete `deepseek-copilot.thinking` and `deepseek-copilot.thinkingEffort` settings.
- Refresh model metadata after setting or clearing the API key, and refresh provider state during extension deactivation so DeepSeek models are removed when the extension unloads.
- Fix vision proxy lookup so it only starts when actual `image/*` attachments are present, avoiding unnecessary model selection for text-only requests.
- Simplify DeepSeek model descriptions and update README setup/configuration guidance.

## 0.1.1

- Rename display name to `DeepSeek V4 for Copilot Chat` to avoid Marketplace name collision

## 0.1.0

- Initial release
- **DeepSeek V4 Pro & Flash** available in the GitHub Copilot Chat model picker
- **Thinking mode** with `reasoning_content` multi-turn caching
- **Reasoning effort** control (`high` / `max`)
- **Vision proxy** — route image attachments through any other installed Copilot Chat model
- **Tool calling** — full agent-mode support (file edits, terminal, search, Git, tests, MCP, skills)
- **Prompt cache stats** logged to output channel (hit / miss / rate)
- **BYOK** — API key stored in VS Code `SecretStorage` (OS keychain)
- Configurable `baseUrl`, `maxTokens`, `visionModel`, `visionPrompt`
- First-run welcome message to guide API key setup
