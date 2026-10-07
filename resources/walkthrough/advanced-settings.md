## Stabilize Tool List (Experimental)

First, open VS Code's Tools configuration and check how many tools are enabled for chat.

[Configure Tools](command:workbench.action.chat.configureTools)

- 64 or fewer enabled tools: there is usually no need to turn this on unless the tool list still changes across turns.
- More than 64 enabled tools: consider this setting only if the tools list changes between turns and DeepSeek context-cache hits are poor. Larger tool lists include more function definitions and may increase input tokens.

This setting may improve cache hits by making the DeepSeek API `tools` parameter more complete and stable across turns. It may also increase input tokens because more function definitions can be included in each request.

[Open DeepSeek setting](command:workbench.action.openSettings?%5B%22%40id%3Adeepseek-copilot.experimental.stabilizeToolList%22%5D)
