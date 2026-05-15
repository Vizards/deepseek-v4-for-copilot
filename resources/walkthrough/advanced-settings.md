Try advanced settings that may improve DeepSeek context-cache hit rate:

- `deepseek-copilot.experimental.preExpandActivateTools`: tries to stabilize tool-calling. For chats with many Tools or MCP servers, it may help DeepSeek see a steadier tool list and improve context-cache hit rate. It is experimental; leave it off if your current setup works well.