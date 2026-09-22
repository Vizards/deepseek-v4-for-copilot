# Request Headers

`deepseek-copilot.requestHeaders` adds or overrides headers for chat completion requests sent to `deepseek-copilot.baseUrl`. Its default value is `{}`.

## Configuration

Add header names and string values in the native VS Code Settings editor, or edit `settings.json`.

Example configuration for [OpenCode Go](https://opencode.ai/docs/go/):

```json
{
  "deepseek-copilot.baseUrl": "https://opencode.ai/zen/go/v1",
  "deepseek-copilot.requestHeaders": {
    "User-Agent": "deepseek-copilot",
    "x-opencode-session": "${conversationId}"
  }
}
```

- Header names are case-insensitive. Configured values override existing headers, including `Authorization` and `Content-Type`.
- The extension adds no custom `User-Agent` by default; you can set one here if needed.
- Header values are stored in VS Code settings.

## Variables

Use `${name}` anywhere in a header value. Each variable is resolved once per provider call and reused for all occurrences and HTTP attempts. Unknown placeholders are passed through unchanged.

| Variable | Value | Fallback order |
|---|---|---|
| `${conversationId}` | Upstream conversation ID | Workspace ID (`workspace-<workspaceId>`) → Copilot request ID (`request-<requestId>`) → generated UUID (`request-<uuid>`) |
