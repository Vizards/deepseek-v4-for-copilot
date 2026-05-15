# Unstable Tools List

DeepSeek V4 for Copilot Chat detected that the Tools list in the current chat may be unstable across turns.

## Why This Happens

The DeepSeek Chat Completions API supports at most **128 tools** in one request. VS Code's Language Model API also lets a model declare the maximum number of tools it can receive per request.

When `deepseek-copilot.experimental.preExpandActivateTools` is enabled, the extension tries to expand Copilot's `activate_*` virtual tools before sending the request, so DeepSeek receives the real tool list.

If too many tools are available in the current environment, Copilot may trim, group, or defer tool expansion. The resulting Tools array may differ between turns.

## Impact

DeepSeek uses a context KVCache for the input prefix. The Tools array is part of the request input; if it changes, the cache may not hit.

## What You Can Do

1. Remove MCP servers or Tools you do not currently need.
2. Turn off `deepseek-copilot.experimental.preExpandActivateTools`.
3. If a lower cache hit rate is acceptable, you can continue sending messages in this chat.

If you have a better solution, please join the discussion in [issue #56](https://github.com/Vizards/deepseek-v4-for-copilot/issues/56).