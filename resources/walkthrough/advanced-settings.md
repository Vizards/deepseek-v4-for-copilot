## Stabilize Tool List (Experimental)

First, open VS Code's Tools configuration and check how many tools are enabled for chat.

[Configure Tools](command:workbench.action.chat.configureTools)

- 64 or fewer enabled tools: there is usually no need to turn this on unless the tool list still changes across turns.
- More than 128 enabled tools: not recommended. DeepSeek supports at most 128 functions in one `tools` request, so DeepSeek Copilot cannot guarantee a stable `tools` list above that limit. Disable rarely used tools first, then consider enabling this setting.
- Between 64 and 128 enabled tools: consider this setting only if the tools list changes between turns and DeepSeek context-cache hits are poor.

This setting may improve cache hits by making the DeepSeek API `tools` parameter more complete and stable across turns. It may also increase input tokens because more function definitions can be included in each request.

[Open DeepSeek setting](command:workbench.action.openSettings?%5B%22%40id%3Adeepseek-copilot.experimental.stabilizeToolList%22%5D)
