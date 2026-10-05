const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolCatalog, ToolDiscoveryClient } = require('../out/provider/tools/discovery');

const token = () => ({ isCancellationRequested: false });
const tool = (name, description = name) => ({ type: 'function', function: {
  name, description, parameters: { type: 'object', properties: { value: { type: 'string' } } },
} });
const pool = (count = 135) => [tool('grep'), ...Array.from({ length: count - 1 }, (_, i) =>
  tool(`mcp_1c_tool_${String(i).padStart(3, '0')}`, `1C metadata operation ${i}`))];
const call = (name, args = {}, id = 'call-1') => ({ id, type: 'function', function: {
  name, arguments: JSON.stringify(args),
} });
function harness(tools = pool(), budget = 64, messages = []) {
  const catalog = new ToolCatalog(tools, messages, budget);
  const requests = [], output = [], usages = [];
  const steps = [];
  const upstream = { async streamChatCompletion(request, callbacks, cancellation) {
    requests.push(structuredClone(request));
    assert.ok(request.tools.length <= budget && request.tools.length <= 128);
    const step = steps.shift();
    assert.ok(step, 'unexpected additional API round');
    await step(request, callbacks, cancellation);
  } };
  const client = new ToolDiscoveryClient(upstream, catalog);
  const callbacks = {
    onContent: text => output.push(['text', text]), onThinking: text => output.push(['thinking', text]),
    onToolCall: value => output.push(['call', value]), onDone: () => output.push(['done']),
    onError: error => { throw error; }, onUsage: usage => usages.push(usage),
  };
  const request = { model: 'deepseek-flash', stream: true, messages, tools: catalog.wireTools };
  return { catalog, requests, output, steps, usages, request,
    run: (cancel = token()) => client.streamChatCompletion(request, callbacks, cancel) };
}

test('135 tools: discovery activates exact original schema, only real call reaches host', async () => {
  const h = harness();
  h.steps.push((_, cb) => {
    cb.onThinking('Need the metadata capability.');
    cb.onContent('Searching privately.');
    cb.onToolCall(call(h.catalog.searchName, { query: 'mcp_1c_tool_133', limit: 1 }, 'search-1'));
    cb.onUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }); cb.onDone();
  });
  h.steps.push((req, cb) => {
    assert.deepEqual(req.tools.find(t => t.function.name === 'mcp_1c_tool_133'), pool()[134]);
    assert.equal(req.messages.at(-2).reasoning_content, 'Need the metadata capability.');
    assert.equal(req.messages.at(-1).tool_call_id, 'search-1');
    cb.onThinking('Found the operation.');
    cb.onToolCall(call('mcp_1c_tool_133', { value: 'kept' }, 'real-1')); cb.onDone();
  });
  await h.run();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.output, [['thinking', 'Found the operation.'],
    ['call', call('mcp_1c_tool_133', { value: 'kept' }, 'real-1')], ['done']]);
  assert.equal(h.usages.length, 1);
  assert.equal(h.request.messages.length, 0, 'caller history was not mutated');
});

test('500 tools remain reachable through bounded paginated browsing and eviction', () => {
  const tools = pool(500), catalog = new ToolCatalog(tools, [], 16);
  let offset = 0; const names = new Set();
  do {
    const result = JSON.parse(catalog.search(JSON.stringify({ query: '', offset, limit: 12 })));
    for (const item of result.tools) names.add(item.name);
    assert.ok(catalog.wireTools.length <= 16);
    offset = result.nextOffset;
  } while (offset !== null);
  assert.equal(names.size, 500);
  catalog.search(JSON.stringify({ query: 'grep', limit: 1 }));
  assert.ok(catalog.wireTools.some(t => t.function.name === 'grep'));
});

test('Russian descriptions and exact names are searchable, miss does not activate arbitrary tools', () => {
  const catalog = new ToolCatalog([tool('syntaxcheck', 'Проверка синтаксиса модуля'), tool('delete', 'Remove file')], [], 8);
  assert.equal(JSON.parse(catalog.search('{"query":"синтаксиса"}')).tools[0].name, 'syntaxcheck');
  assert.deepEqual(JSON.parse(catalog.search('{"query":"unrelated_missing_word"}')).tools, []);
});

test('mixed discovery and real calls return to host without executing or inventing results', async () => {
  const h = harness();
  h.steps.push((_, cb) => {
    cb.onToolCall(call(h.catalog.searchName, { query: 'metadata' }, 'search'));
    cb.onToolCall(call('grep', { value: 'safe' }, 'real')); cb.onDone();
  });
  await h.run();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.output, [['call', call('grep', { value: 'safe' }, 'real')], ['done']]);
});

test('unselected or invented tool calls fail before emitting any content or calls', async () => {
  for (const name of ['mcp_1c_tool_100', 'not_authorized']) {
    const h = harness();
    h.steps.push((_, cb) => { cb.onContent('not emitted'); cb.onToolCall(call(name)); cb.onDone(); });
    await assert.rejects(h.run(), /outside the active tool selection/);
    assert.deepEqual(h.output, []);
  }
});

test('cancellation during internal search stops continuation and emits no tool calls', async () => {
  const h = harness(), cancellation = token();
  h.steps.push((_, cb) => { cb.onToolCall(call(h.catalog.searchName, { query: '' }));
    cancellation.isCancellationRequested = true; cb.onDone(); });
  await h.run(cancellation);
  assert.equal(h.requests.length, 1); assert.deepEqual(h.output, []);
});

test('already cancelled request makes no API call', async () => {
  const h = harness(); await h.run({ isCancellationRequested: true });
  assert.equal(h.requests.length, 0);
});

test('network errors and incomplete streams propagate without fabricated completion', async () => {
  const h = harness(); h.steps.push(() => { throw new Error('network failed'); });
  await assert.rejects(h.run(), /network failed/); assert.deepEqual(h.output, []);
  const incomplete = harness(); incomplete.steps.push((_, cb) => cb.onContent('partial'));
  await assert.rejects(incomplete.run(), /without completion/); assert.deepEqual(incomplete.output, []);
});

test('search round limit prevents an unbounded model loop', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.steps.push((_, cb) => {
    cb.onToolCall(call(h.catalog.searchName, { query: 'metadata' }, `search-${i}`)); cb.onDone();
  });
  await assert.rejects(h.run(), /four search rounds/);
  assert.equal(h.requests.length, 5); assert.deepEqual(h.output, []);
});

test('Required mode persists across search and requires a real host tool', async () => {
  const h = harness(); h.request.tool_choice = 'required';
  h.steps.push((req, cb) => { assert.equal(req.tool_choice, 'required');
    cb.onToolCall(call(h.catalog.searchName, { query: 'grep' })); cb.onDone(); });
  h.steps.push((req, cb) => { assert.equal(req.tool_choice, 'required'); cb.onContent('done'); cb.onDone(); });
  await assert.rejects(h.run(), /real tool call was required/);
  assert.deepEqual(h.output, []);
});

test('catalogs are isolated and retain only host-approved recent tool names', () => {
  const first = new ToolCatalog(pool(), [{ role: 'assistant', content: '', tool_calls:
    [call('mcp_1c_tool_100'), call('removed_secret_tool')] }], 64);
  const second = new ToolCatalog([tool('grep')], [], 64);
  assert.ok(first.wireTools.some(t => t.function.name === 'mcp_1c_tool_100'));
  assert.ok(!first.wireTools.some(t => t.function.name === 'removed_secret_tool'));
  assert.deepEqual(JSON.parse(second.search('{"query":"mcp_1c_tool_100"}')).tools, []);
});

test('synthetic name cannot collide with a host tool; invalid search input stays bounded', () => {
  const catalog = new ToolCatalog([tool('deepseek_search_tools'), tool('deepseek_search_tools_1')], [], 64);
  assert.equal(catalog.searchName, 'deepseek_search_tools_2');
  for (const input of ['broken', 'null', '[]', '{"query":1}', '{"query":"x","offset":-1}', '{"query":"x","limit":0}']) {
    assert.ok(JSON.parse(catalog.search(input)).error);
  }
  assert.equal(new ToolCatalog(pool(), [], Infinity).budget, 64);
  assert.equal(new ToolCatalog(pool(), [], 1000).budget, 128);
  assert.throws(() => new ToolCatalog([tool('same'), tool('same')], [], 64), /Duplicate/);
});

test('host virtual activation tools are returned unchanged, never handled as internal searches', async () => {
  const h = harness([tool('activate_mcp_group')], 64,
    [{ role: 'assistant', content: '', tool_calls: [call('activate_mcp_group')] }]);
  h.steps.push((_, cb) => { cb.onToolCall(call('activate_mcp_group')); cb.onDone(); });
  await h.run(); assert.deepEqual(h.output, [['call', call('activate_mcp_group')], ['done']]);
});
