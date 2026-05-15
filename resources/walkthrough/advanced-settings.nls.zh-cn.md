尝试可能提高 DeepSeek 上下文缓存命中比例的高级设置：

- `deepseek-copilot.experimental.preExpandActivateTools`：尝试稳定工具调用。如果会话里启用了很多 Tools 或 MCP 服务，它可能帮助 DeepSeek 看到更稳定的工具列表，并提高上下文缓存命中率。它仍是实验性设置；如果当前使用已经稳定，可以保持关闭。