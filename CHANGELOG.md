# Changelog

## [0.6.2](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.6.1...v0.6.2) (2026-06-16)


### Bug Fixes

* **provider:** mark DeepSeek models as BYOK ([#162](https://github.com/Vizards/deepseek-v4-for-copilot/issues/162)) ([50ff6ba](https://github.com/Vizards/deepseek-v4-for-copilot/commit/50ff6ba85b2c8d7911d7f6dddb6492c2ebdb1b17))
* **vision:** disambiguate VS Code LM model selection ([#161](https://github.com/Vizards/deepseek-v4-for-copilot/issues/161)) ([1d7b668](https://github.com/Vizards/deepseek-v4-for-copilot/commit/1d7b6685649b1ee05f3f49f7cd2008b237734c18)), closes [#149](https://github.com/Vizards/deepseek-v4-for-copilot/issues/149)

## [0.6.1](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.6.0...v0.6.1) (2026-06-12)


### Bug Fixes

* **provider:** dedupe streaming usage reports ([#145](https://github.com/Vizards/deepseek-v4-for-copilot/issues/145)) ([b3cbdfa](https://github.com/Vizards/deepseek-v4-for-copilot/commit/b3cbdfa8be7e3ee2139e2763014cf1b391e7cf80))
* **provider:** disable thinking for internal helper requests ([#137](https://github.com/Vizards/deepseek-v4-for-copilot/issues/137)) ([6809989](https://github.com/Vizards/deepseek-v4-for-copilot/commit/680998971fb01ef9d88f70fa6bdd7709a510095c))

## [0.6.0](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.5.3...v0.6.0) (2026-06-03)


### Features

* **provider:** show DeepSeek pricing in model picker ([#128](https://github.com/Vizards/deepseek-v4-for-copilot/issues/128)) ([959bd0d](https://github.com/Vizards/deepseek-v4-for-copilot/commit/959bd0de3be29cbc5e55540c113d74d09c7cb23c))
* **vision:** add configurable vision proxy ([#127](https://github.com/Vizards/deepseek-v4-for-copilot/issues/127)) ([f5d9b8d](https://github.com/Vizards/deepseek-v4-for-copilot/commit/f5d9b8d35dc50c8c3fba307814d6af682e1ac1b1))


### Bug Fixes

* **client:** improve request failure diagnostics ([#109](https://github.com/Vizards/deepseek-v4-for-copilot/issues/109)) ([40cc542](https://github.com/Vizards/deepseek-v4-for-copilot/commit/40cc542bfc7cdf266f857e30ecb4ad35a2f439f1))

## [0.5.3](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.5.2...v0.5.3) (2026-05-25)


### Bug Fixes

* **provider:** improve DeepSeek request failure handling ([#104](https://github.com/Vizards/deepseek-v4-for-copilot/issues/104)) ([788b1d7](https://github.com/Vizards/deepseek-v4-for-copilot/commit/788b1d7c36aab2d92aeff67412b9ea66ddb5f48c))

## [0.5.2](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.5.1...v0.5.2) (2026-05-22)


### Bug Fixes

* **diagnostics:** classify cache traces by request kind ([#97](https://github.com/Vizards/deepseek-v4-for-copilot/issues/97)) ([7212765](https://github.com/Vizards/deepseek-v4-for-copilot/commit/7212765aaa53a57145fa9d33412bfb453ee7f879))
* **extension:** let VS Code infer extension host ([#78](https://github.com/Vizards/deepseek-v4-for-copilot/issues/78)) ([95e79ab](https://github.com/Vizards/deepseek-v4-for-copilot/commit/95e79ab5e77f2745f1044e25e55a01fe7c7910eb))
* **logger:** diagnostics log visibility ([#89](https://github.com/Vizards/deepseek-v4-for-copilot/issues/89)) ([792691d](https://github.com/Vizards/deepseek-v4-for-copilot/commit/792691d15ca77ecc4a7313d5c9f6ebb3392d5bb7))

## [0.5.1](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.5.0...v0.5.1) (2026-05-18)


### Bug Fixes

* **provider:** make preflight tool call ids provider-safe ([#86](https://github.com/Vizards/deepseek-v4-for-copilot/issues/86)) ([cb91620](https://github.com/Vizards/deepseek-v4-for-copilot/commit/cb916206c1c27795a80c7923d95800e8968530d2))
* **provider:** persist reasoning across reloads ([#79](https://github.com/Vizards/deepseek-v4-for-copilot/issues/79)) ([0605da9](https://github.com/Vizards/deepseek-v4-for-copilot/commit/0605da9af052c9bede99333a39615762ae53ea29))
* **provider:** stabilize DeepSeek tool list handling ([#77](https://github.com/Vizards/deepseek-v4-for-copilot/issues/77)) ([eec6bde](https://github.com/Vizards/deepseek-v4-for-copilot/commit/eec6bdeb11e08f4f77bf4ff11b273a45c635d585))
* **replay:** persist reasoning and vision markers across turns ([#82](https://github.com/Vizards/deepseek-v4-for-copilot/issues/82)) ([30b725b](https://github.com/Vizards/deepseek-v4-for-copilot/commit/30b725b90b43b5165ac6299354e4f5f05381cc54))
* report context window correctly ([#71](https://github.com/Vizards/deepseek-v4-for-copilot/issues/71)) ([d8c9b86](https://github.com/Vizards/deepseek-v4-for-copilot/commit/d8c9b86cfcd62304a9893c77224d8c0275781688))
* **vision:** retain image context in follow-up turns ([#81](https://github.com/Vizards/deepseek-v4-for-copilot/issues/81)) ([797b3d3](https://github.com/Vizards/deepseek-v4-for-copilot/commit/797b3d3f40f1da7c5c64a2f09d273104dcfd094c))


### Documentation

* **readme:** clarify no extra process comparison ([#84](https://github.com/Vizards/deepseek-v4-for-copilot/issues/84)) ([39a1cf6](https://github.com/Vizards/deepseek-v4-for-copilot/commit/39a1cf687be36edc2ba81270b2f14ebe6a39a0d6))

## [0.5.0](https://github.com/Vizards/deepseek-v4-for-copilot/compare/v0.4.1...v0.5.0) (2026-05-13)


### Features

* **provider:** add segment-aware request diagnostics ([#66](https://github.com/Vizards/deepseek-v4-for-copilot/issues/66)) ([c20565a](https://github.com/Vizards/deepseek-v4-for-copilot/commit/c20565a5b9555efc5535fbb7897e69e361af7906))
* report token usage to Copilot context via LanguageModelDataPart ([#60](https://github.com/Vizards/deepseek-v4-for-copilot/issues/60)) ([01ef9e5](https://github.com/Vizards/deepseek-v4-for-copilot/commit/01ef9e5f4134fbb5981a5f2c3dbd75ff6bd8162e))


### Bug Fixes

* **provider:** recursively count all part types in provideTokenCount ([#51](https://github.com/Vizards/deepseek-v4-for-copilot/issues/51)) ([1bd8636](https://github.com/Vizards/deepseek-v4-for-copilot/commit/1bd8636d04e98036b76e74d44abd8ac39ee7af1c))
* remove extensionDependencies on github.copilot-chat for SSH-Remote compatibility ([#45](https://github.com/Vizards/deepseek-v4-for-copilot/issues/45)) ([11d020e](https://github.com/Vizards/deepseek-v4-for-copilot/commit/11d020e196fac5f80b48ae1e2f2314680191f2aa))


### Documentation

* add Simplified Chinese README (zh-cn) ([#46](https://github.com/Vizards/deepseek-v4-for-copilot/issues/46)) ([a477c1e](https://github.com/Vizards/deepseek-v4-for-copilot/commit/a477c1ecc6ea1fde1060d685dfce8dfdb97c8996))

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
