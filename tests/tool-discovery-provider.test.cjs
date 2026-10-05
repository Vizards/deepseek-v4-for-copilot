const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const settings = {};
const fakeVSCode = {
  env: { language: 'en' },
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  LanguageModelTextPart: class {}, LanguageModelDataPart: class {},
  LanguageModelToolCallPart: class {}, LanguageModelToolResultPart: class {},
  workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback,
    inspect: () => undefined }) },
  window: { createOutputChannel: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
};
const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? fakeVSCode : load.call(this, name, ...args);
};
const { prepareChatRequest } = require('../out/provider/request');
const { ToolDiscoveryClient } = require('../out/provider/tools/discovery');
Module._load = load;

const input = count => ({
  authManager: { getApiKey: async () => 'test-only' },
  globalStorageUri: { fsPath: 'unused' },
  modelInfo: { id: 'deepseek-flash' }, segment: { segmentId: 'test', reason: 'markerMissing' },
  messages: [], options: { tools: Array.from({ length: count }, (_, i) => ({
    name: `mcp_tool_${i}`, description: `Operation ${i}`, inputSchema: { type: 'object', properties: {} },
  })), toolMode: 2 },
  token: { isCancellationRequested: false }, cacheDiagnostics: { beginRequest: () => ({}) },
  getVisionDescriber: async () => undefined,
});

test('provider opt-in accepts 135 tools and wires the bounded discovery client; opt-out retains guard', async () => {
  settings['experimental.toolDiscovery.enabled'] = false;
  await assert.rejects(prepareChatRequest(input(135)), /at most 128/);
  settings['experimental.toolDiscovery.enabled'] = true;
  settings['experimental.toolDiscovery.maxTools'] = 64;
  const prepared = await prepareChatRequest(input(135));
  assert.ok(prepared.client instanceof ToolDiscoveryClient);
  assert.equal(prepared.request.tools.length, 1);
  assert.equal(prepared.request.tool_choice, 'required');
  const small = await prepareChatRequest(input(5));
  assert.ok(!(small.client instanceof ToolDiscoveryClient));
  assert.equal(small.request.tools.length, 5);
  settings['experimental.toolDiscovery.enabled'] = false;
  const unchanged = await prepareChatRequest(input(5));
  assert.equal(unchanged.request.tool_choice, 'auto');
});
