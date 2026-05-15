# Tools 列表不稳定

DeepSeek V4 for Copilot Chat 检测到当前会话中的 Tools（工具）列表在不同轮次之间可能不稳定。

## 为什么会发生

DeepSeek Chat Completions API 单次请求最多支持 **128 个 tools**。VS Code 的 Language Model API 也允许模型声明单次请求可接收的最大工具数。

当启用 `deepseek-copilot.experimental.preExpandActivateTools` 时，扩展会尽量提前展开 Copilot 的 `activate_*` 虚拟工具，让 DeepSeek 收到真实工具列表。

如果当前环境中可用工具太多，Copilot 可能会对工具列表进行裁剪、分组或延迟展开。不同轮次得到的 Tools 数组可能不完全一致。

## 影响

DeepSeek 对输入前缀使用上下文 KV 缓存（KVCache）。Tools 数组是请求输入的一部分；如果 Tools 数组变化，缓存可能无法命中。

## 你可以怎么做

1. 移除暂时不需要的 MCP 服务或 Tools。
2. 关闭 `deepseek-copilot.experimental.preExpandActivateTools`。
3. 如果你不介意缓存命中率下降，也可以继续在当前会话发送消息。

如果你有更好的解决方案，欢迎在 [issue #56](https://github.com/Vizards/deepseek-v4-for-copilot/issues/56) 讨论。