const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');

// The actual HTTP/SSE client only needs VS Code's log channel in this test.
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    env: { language: 'en' },
    window: { createOutputChannel: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  };
  return load.call(this, name, ...args);
};
const { DeepSeekClient } = require('../out/client');
const { ToolCatalog, ToolDiscoveryClient } = require('../out/provider/tools/discovery');
Module._load = load;

for (const mode of ['search', 'direct', 'recover']) test(`real HTTP/SSE transport: ${mode} keeps host calls and bounded schemas`, async t => {
  const received = [], emitted = [];
  const tools = Array.from({ length: 135 }, (_, i) => ({ type: 'function', function: {
    name: `mcp_1c_tool_${i}`, description: `Metadata operation ${i}`,
    parameters: { type: 'object', properties: { value: { type: 'string' } } },
  } }));
  const catalog = new ToolCatalog(tools, [], 64);
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); received.push(payload);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const unavailable = mode === 'recover' && received.length === 1;
    const search = mode !== 'direct' && received.length === (mode === 'recover' ? 2 : 1);
    const name = unavailable ? 'removed_tool' : search ? catalog.searchName : 'mcp_1c_tool_134';
    const args = search ? '{"query":"mcp_1c_tool_134","limit":1}' : '{"value":"original"}';
    const chunk = delta => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n';
    res.write(chunk({ reasoning_content: search ? 'Find the operation.' : 'Use the selected operation.' }));
    res.write(chunk({ tool_calls: [{ index: 0, id: unavailable ? 'missing-1' : search ? 'search-1' : 'real-1', type: 'function',
      function: { name, arguments: args.slice(0, 10) } }] }));
    res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] }));
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) +
      '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new ToolDiscoveryClient(new DeepSeekClient(`http://127.0.0.1:${server.address().port}`, 'test-only'), catalog);
  await client.streamChatCompletion({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'Inspect metadata' }],
    tools: catalog.wireTools, stream: true, thinking: { type: 'enabled' } }, {
    onContent: value => emitted.push(['content', value]), onThinking: value => emitted.push(['thinking', value]),
    onToolCall: call => emitted.push(['call', call]), onDone: () => emitted.push(['done']),
    onError: error => { throw error; },
  }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
  assert.equal(received.length, mode === 'direct' ? 1 : mode === 'recover' ? 3 : 2);
  assert.deepEqual(received.map(req => req.tools.length), mode === 'direct' ? [1] : mode === 'recover' ? [1, 1, 2] : [1, 2]);
  assert.ok(received.every(req => req.tools.length <= 64));
  if (mode !== 'direct') {
    assert.deepEqual(received.at(-1).tools.find(t => t.function.name === 'mcp_1c_tool_134'), tools[134]);
    assert.equal(received.at(-1).messages.at(-2).reasoning_content, 'Find the operation.');
    assert.equal(received.at(-1).messages.at(-1).tool_call_id, 'search-1');
  }
  if (mode === 'recover') {
    assert.equal(received[1].messages.at(-1).tool_call_id, 'missing-1');
    assert.match(JSON.parse(received[1].messages.at(-1).content).error, /not available/);
  }
  assert.deepEqual(emitted.map(item => item[0]), ['thinking', 'call', 'done']);
  assert.equal(emitted[1][1].function.name, 'mcp_1c_tool_134');
  assert.equal(emitted[1][1].function.arguments, '{"value":"original"}');
});
