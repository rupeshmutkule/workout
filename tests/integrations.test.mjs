import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp, readConfig } from '../dist/server/app.js';
import { classifyWithGemini, structuredTurn } from '../dist/server/gemini.js';
import { ScreenDocument } from '../dist/shared/openui/document.js';
const fixture = await readFile(new URL('../examples/wiring.openui', import.meta.url), 'utf8');

const decision = (intent = 'START_SESSION') => ({
  intent, goal: 'clear_head', space: 'tight', effortScore: intent==='REPORT_EFFORT'?2:0, duration: 8, intensity: 'low', cueMode: 'quiet',
  workSeconds: 20, recoverySeconds: 40,
  response: 'I shaped a short, fictional preview you can adjust.',
  action: { type: intent },
});

async function start(config, modelTransport = fetch) {
  const server = createApp(config, modelTransport);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const configResponse = await fetch(`${url}/api/config`);
  const clientConfig = await configResponse.json();
  return { server, url, clientConfig, close: () => new Promise(resolve => server.close(resolve)) };
}

test('Gemini is opt-in, key stays private, latest message is minimized, and action is structured', async () => {
  const config = readConfig({ GEMINI_API_KEY: 'fixture-key-never-used', GEMINI_MODEL: 'gemini-test' }, process.cwd());
  let calls = 0, captured;
  const transport = async (url, options) => {
    calls++;
    captured = { url: String(url), body: JSON.parse(options.body), key: options.headers['x-goog-api-key'] };
    return new Response(JSON.stringify({ modelVersion: 'fixture-model', candidates: [{ content: { parts: [{ text: JSON.stringify(decision()) }] } }] }));
  };
  const app = await start(config, transport);
  try {
    assert.equal(app.clientConfig.providers.find(provider => provider.id === 'gemini-api').enabled, true);
    assert.equal(app.clientConfig.key, undefined);
    const payload = {
      provider: 'gemini-api', consent: false, fault: 'none',
      messages: [{ role: 'assistant', content: 'history-only-sentinel' }, { role: 'user', content: 'Make a preview for +91 98765 43210; no activity to track.' }],
      state: { ui_state: `${fixture}\nhidden_data = Text("ui-state-sentinel", "body")`, client_events: ['event-sentinel'] },
    };
    const post = (body) => fetch(`${app.url}/api/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': app.clientConfig.token }, body: JSON.stringify(body) });
    assert.equal((await post(payload)).status, 403);
    assert.equal(calls, 0);
    const response = await post({ ...payload, consent: true });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.versions.provider, 'gemini-api');
    assert.equal(result.versions.returnedModel, 'fixture-model');
    assert.equal(result.decision.intent, 'START_SESSION');
    assert.match(result.turn.reply, /20s phase · 40s pause/);
    assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    assert.equal(captured.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(captured.body.generationConfig.responseSchema, (await import('../dist/server/gemini.js')).decisionSchema);
    const prompt = captured.body.contents[0].parts[0].text;
    assert.match(prompt, /Make a preview for \[number redacted\]/);
    for (const secret of ['history-only-sentinel', 'ui-state-sentinel', 'event-sentinel', '+91 98765 43210']) assert(!prompt.includes(secret));
    assert.equal(captured.key, 'fixture-key-never-used');
    assert(!JSON.stringify(result).includes('fixture-key-never-used'));
  } finally { await app.close(); }
});

test('Gemini structured effort action passes through the trusted session director',()=>{
  const state=new ScreenDocument();state.apply(`\`\`\`openui\n${fixture}\n\`\`\``);state.move(3);
  state.apply('```openui\nplan_intervals = Keyword("20s phase · 40s pause", "Current simulated shape")\n```');
  const request={provider:'gemini-api',consent:true,fault:'none',messages:[{role:'user',content:'Effort 2'}],state:{ui_state:state.echo(),client_events:[]}};
  const turn=structuredTurn(request,decision('REPORT_EFFORT'),fixture),result=new ScreenDocument();result.apply(`\`\`\`openui\n${state.echo()}\n\`\`\``);result.apply(turn.reply);
  assert.equal(result.cursor,'phase');assert.match(result.echo(),/phase_title = Text\("Set 2 of 3"/);assert.match(result.echo(),/plan_intervals = Keyword\("10s phase · 50s pause"/);
});

test('Gemini reports provider unavailability without exposing raw diagnostics',async()=>{
  const config=readConfig({GEMINI_API_KEY:'fixture-key-never-used',GEMINI_MODEL:'gemini-test'},process.cwd());
  await assert.rejects(classifyWithGemini({provider:'gemini-api',consent:true,fault:'none',messages:[{role:'user',content:'Explain this demo'}],state:{ui_state:'',client_events:[]}},config.gemini,new AbortController().signal,async()=>new Response(JSON.stringify({error:{status:'UNAVAILABLE',message:'private raw provider response'}}),{status:503})),error=>{
    assert.match(error.message,/high demand/i);assert(!error.message.includes('private raw provider response'));return true;
  });
});

