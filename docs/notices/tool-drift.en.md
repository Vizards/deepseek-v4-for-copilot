# Unstable Tools List

DeepSeek V4 for Copilot Chat detected that the Tools list in the current chat may be unstable across turns.

## Why This Happens

When the experimental `deepseek-copilot.experimental.stabilizeToolList` setting is enabled, the extension tries to pre-activate VS Code/Copilot `activate_*` virtual tools before sending the request, so the DeepSeek API `tools` parameter is more complete and stable across turns.

If too many tools are available in the current environment, Copilot may trim, group, or defer tool expansion. The resulting Tools array may differ between turns.

## Impact

DeepSeek uses a context KVCache for the input prefix. The Tools array is part of the request input; if it changes, the cache may not hit.

With this experimental setting enabled, each request may include more function definitions (names, descriptions, and JSON schemas), so **input tokens** can increase. Cache-hit input tokens are billed at a lower price but still count toward usage. It is usually unnecessary with fewer than **64 enabled tools**.

## What You Can Do

1. Run the VS Code command `workbench.action.chat.configureTools` and disable tools or MCP tools you do not currently need.
2. Turn off `deepseek-copilot.experimental.stabilizeToolList`.
3. If a lower cache hit rate is acceptable, you can continue sending messages in this chat.

If you have a better solution, please join the discussion in [issue #56](https://github.com/Vizards/deepseek-v4-for-copilot/issues/56).
