# Changelog

## [0.4.1](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.4.0...v0.4.1) (2026-05-05)


### Bug Fixes

* **manifest:** resolve marketplace display metadata ([#41](https://github.com/Vizards/deepseek-v4-for-copilot/issues/41)) ([20b86b7](https://github.com/Vizards/deepseek-v4-for-copilot/commit/20b86b791cbd068477cc46a556e2e061cee581e3))

## [0.4.0](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.3.1...v0.4.0) (2026-05-05)


### Features

* Chinese (zh-cn) i18n support ([#16](https://github.com/Vizards/deepseek-v4-for-copilot/issues/16)) ([72a8a69](https://github.com/Vizards/deepseek-v4-for-copilot/commit/72a8a696419d85aa5f82d1142abbc42ec4b50e9b))
* **diagnostics:** add opt-in cache trace diagnostics ([#35](https://github.com/Vizards/deepseek-v4-for-copilot/issues/35)) ([fa11e5b](https://github.com/Vizards/deepseek-v4-for-copilot/commit/fa11e5bea0ccf4023b9947bba5ab4c333abb3ccb))


### Bug Fixes

* add in-memory LRU cache for vision image descriptions ([#36](https://github.com/Vizards/deepseek-v4-for-copilot/issues/36)) ([05fac93](https://github.com/Vizards/deepseek-v4-for-copilot/commit/05fac9392270e5d58a51769b76f4c5378457b1bc))
* **auth:** allow compatible provider API tokens ([#34](https://github.com/Vizards/deepseek-v4-for-copilot/issues/34)) ([e06c550](https://github.com/Vizards/deepseek-v4-for-copilot/commit/e06c550e2183ec1c143dcaee28c4b4b32f89a3a1))
* **json:** sanitize lone surrogates before serialization ([#40](https://github.com/Vizards/deepseek-v4-for-copilot/issues/40)) ([40a21a4](https://github.com/Vizards/deepseek-v4-for-copilot/commit/40a21a4719edc8c2fe0d2e9d25953244917af8b3))
* **provider:** stabilize reasoning replay across tool turns ([#39](https://github.com/Vizards/deepseek-v4-for-copilot/issues/39)) ([e283bc0](https://github.com/Vizards/deepseek-v4-for-copilot/commit/e283bc014bf8c2e2b4e0ebfd0869be6819a35d46))

## [0.3.1](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.3.0...v0.3.1) (2026-05-02)


### Bug Fixes

* thinking effort dropdown missing on first launch ([#13](https://github.com/Vizards/deepseek-v4-for-copilot/issues/13)) ([27deac1](https://github.com/Vizards/deepseek-v4-for-copilot/commit/27deac14cb69a3e51eaf908919ded9db8fcb1ab6))


### Documentation

* **readme:** document model ID overrides ([#22](https://github.com/Vizards/deepseek-v4-for-copilot/issues/22)) ([7d38322](https://github.com/Vizards/deepseek-v4-for-copilot/commit/7d38322818d15380eba7c28058de45140a7aa73a))

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
