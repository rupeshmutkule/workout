import { test,expect } from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const shots='evidence/screenshots';
async function send(page,text){await page.locator('#message').fill(text);await page.locator('#send').click();await expect(page.locator('#send')).not.toHaveText('Thinking…',{timeout:10000});}
async function demo(page){await page.locator('#sample').click();await expect(page.locator('#send')).not.toHaveText('Thinking…',{timeout:10000});await expect(page.locator('[data-statement="arrival_title"]')).toContainText('What do you need right now');}
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#mode')).toHaveText('MOCK · NO MODEL CALLS');});
test('a homepage prompt submitted while startup config is loading is not lost',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);await page.unroute('**/api/config');await page.route('**/api/config',async route=>{await gate;await route.continue();});
 await page.goto('/');await page.getByRole('button',{name:'Clear my head'}).click();release();await expect(page.locator('[data-statement="plan_goal"]')).toContainText('Clear my head');
});
test('a failed startup config keeps the prompt and retry sends it after recovery',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({status:503,json:{error:'fixture outage'}}));
 await page.reload();await expect(page.locator('#error')).toBeVisible();await page.getByRole('button',{name:'Wake me up'}).click();await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#pending')).toContainText('queued');
 await page.unroute('**/api/config');await page.locator('#retry').click();await expect(page.locator('[data-statement="plan_goal"]')).toContainText('Wake me up');
});
test('front page leads with AiRA; one natural sentence reveals an editable session',async({page})=>{
 await page.setViewportSize({width:1440,height:960});await expect(page.locator('#hero-title')).toContainText('What do you need');await expect(page.locator('#experience')).toBeHidden();
 const character=await page.locator('#companion-card img').boundingBox();expect(character.width).toBeGreaterThan(250);await expect(page.locator('#companion-card img')).toHaveJSProperty('complete',true);expect(await page.locator('#companion-card img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await expect(page.locator('.context-prompts button')).toHaveCount(3);await mkdir(shots,{recursive:true});await page.screenshot({path:shots+'/00-landing.png',fullPage:true});
 await send(page,'I only have 8 minutes');await expect(page.locator('#hero')).toBeHidden();await expect(page.locator('#experience')).toBeVisible();await expect(page.locator('[data-statement="plan_time"]')).toContainText('8 minutes');
 await expect(page.locator('.session-character')).toHaveJSProperty('complete',true);expect(await page.locator('.session-character').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await page.screenshot({path:shots+'/06-ready-plan.png',fullPage:true});
 await page.locator('#next').click();await expect(page.locator('#position')).toHaveText('3 / 5');await send(page,'I’m more tired than expected. Make the next part shorter.');await expect(page.locator('[data-statement="phase_next_shape"]')).toContainText('20s set · 40s rest');
 await send(page,'stop talking so much');await expect(page.locator('[data-statement="phase_cue"]')).toContainText('Steady.');
});
test('empty submit shows a clear hint and sends no turn request',async({page})=>{
 let turns=0;page.on('request',request=>{if(request.url().endsWith('/api/turn'))turns++;});
 await page.locator('#send').click();await expect(page.locator('#error')).toContainText('Tell me what you need');await expect(page.locator('#message')).toBeFocused();expect(turns).toBe(0);
});
test('ambiguous active-session request asks what to change without mutating the screen',async({page})=>{
 await send(page,'I have 8 minutes');await page.getByRole('button',{name:'Start this session'}).click();await expect(page.locator('#position')).toHaveText('3 / 5');await page.locator('[data-statement="timer1"]').getByRole('button',{name:'Pause'}).click();const before=await page.locator('#screen').innerHTML();
 await send(page,'Make it better');await expect(page.locator('#transcript')).toContainText('What should feel better');expect(await page.locator('#screen').innerHTML()).toBe(before);
});
test('homepage context shortcuts shape the plan and the mode pill opens settings',async({page})=>{
 await page.getByRole('button',{name:'Tight space'}).click();await expect(page.locator('[data-statement="plan_context"]')).toContainText('Tight space');
 await page.locator('#reset').click();await page.locator('#header-mode').click();await expect(page.locator('#runtime-controls')).toHaveJSProperty('open',true);await expect(page.locator('#header-mode')).toHaveAttribute('aria-expanded','true');
});
test('arrival distinguishes a beginner request from off-topic input; natural pause wording preserves the timer',async({page})=>{
 await send(page,'I have never tried this before');await expect(page.locator('[data-statement="plan_intervals"]')).toContainText('20s phase · 40s pause');await expect(page.locator('[data-statement="plan_cue_mode"]')).toContainText('Quiet cues');
 await page.locator('#reset').click();await send(page,'What is the weather?');await expect(page.locator('#hero-response')).toContainText('can’t check weather');await expect(page.locator('#experience')).toBeHidden();
 await page.reload();await send(page,'I have 8 minutes');await page.getByRole('button',{name:'Start this session'}).click();await expect(page.locator('#position')).toHaveText('3 / 5');
 await send(page,'Pause for a moment');await expect(page.locator('.timer-status')).toContainText('paused');const pausedRemaining=Number((await page.locator('[data-statement="timer1"]').textContent()).match(/0:(\d\d)/)?.[1]);await page.locator('#message').fill('Continue');await page.locator('#send').click();await expect(page.locator('.timer-status')).toContainText('On screen');const resumedRemaining=Number((await page.locator('[data-statement="timer1"]').textContent()).match(/0:(\d\d)/)?.[1]);expect(resumedRemaining).toBeLessThanOrEqual(pausedRemaining);
});
test('more exciting changes the upcoming interface and what happens next is shown on screen',async({page})=>{
 await send(page,'I have 8 minutes');await page.getByRole('button',{name:'Start this session'}).click();await expect(page.locator('#position')).toHaveText('3 / 5');
 const current=await page.locator('[data-statement="phase_move"]').textContent();const timerLabel=await page.locator('[data-statement="timer1"] h3').textContent();
 await send(page,'Make it more exciting');await expect(page.locator('[data-statement="phase_next_shape"]')).toContainText('40s set · 20s rest');await expect(page.locator('[data-statement="phase_copy"]')).toContainText('Current sample stays');await expect(page.locator('[data-statement="phase_move"]')).toHaveText(current);await expect(page.locator('[data-statement="timer1"] h3')).toHaveText(timerLabel);
 await send(page,'What happens next?');await expect(page.locator('[data-statement="phase_copy"]')).toContainText('Next is');await expect(page.locator('[data-statement="phase_next_shape"]')).toContainText('simulated sample');
 await send(page,'I want to stop now');await expect(page.locator('#position')).toHaveText('5 / 5');await expect(page.locator('[data-statement="closing_tally"]')).toContainText('0 completed · 0 skipped · 3 remaining');
});
test('skipping is not counted as completion in the recap',async({page})=>{
 await send(page,'I have 8 minutes');await page.getByRole('button',{name:'Start this session'}).click();await send(page,'Skip this one.');await expect(page.locator('[data-statement="pause_tally"]')).toContainText('0 completed · 1 skipped · 2 remaining');
 await send(page,'I want to stop now');await expect(page.locator('[data-statement="closing_tally"]')).toContainText('0 completed · 1 skipped · 2 remaining');
});
test('complete journey: edit plan, start, pause/resume, adapt, rest, skip, and finish early',async({page})=>{
 await send(page,"I'm tired, I only have five minutes, and keep the cues quiet");
 await expect(page.locator('[data-statement="plan_time"]')).toContainText('5 minutes');await expect(page.locator('[data-statement="plan_intervals"]')).toContainText('20s phase · 40s pause');await expect(page.locator('[data-statement="plan_cue_mode"]')).toContainText('Quiet cues');
 await send(page,'I have six minutes now');await expect(page.locator('[data-statement="plan_time"]')).toContainText('6 minutes');
 await page.getByRole('button',{name:'Start this session'}).click();await expect(page.locator('#position')).toHaveText('3 / 5');await expect(page.locator('[data-statement="phase_tally"]')).toContainText('0 completed · 0 skipped · 2 remaining');
 await page.locator('#pause').click();await expect(page.locator('.timer-status')).toContainText('paused');await page.locator('#pause').click();await expect(page.locator('.timer-status')).toContainText('On screen');
 await send(page,'Make the next part shorter');await expect(page.locator('[data-statement="phase_next_shape"]')).toContainText('10s set · 50s rest');
 await page.locator('#next').click();await expect(page.locator('#position')).toHaveText('4 / 5');await expect(page.locator('[data-statement="rest_ring"]')).toBeVisible();
 await send(page,'Skip rest');await expect(page.locator('#position')).toHaveText('3 / 5');await send(page,'Skip this one');await expect(page.locator('[data-statement="pause_tally"]')).toContainText('1 completed · 1 skipped · 0 remaining');
 await send(page,'I want to stop now');await expect(page.locator('#position')).toHaveText('5 / 5');await expect(page.locator('[data-statement="closing_tally"]')).toContainText('1 completed · 1 skipped · 0 remaining');
});
test('space and short-time context shape the plan before the session',async({page})=>{
 await send(page,'I only have three minutes and I’m in an open room');await expect(page.locator('[data-statement="plan_time"]')).toContainText('3 minutes');await expect(page.locator('[data-statement="plan_context"]')).toContainText('Open room');await expect(page.locator('[data-statement="plan_sets"]')).toContainText('2 sets');
 await page.locator('#reset').click();await send(page,'I have 8 minutes and a tiny room');await expect(page.locator('[data-statement="plan_context"]')).toContainText('Tight space');await expect(page.locator('[data-statement="plan_sets"]')).toContainText('3 sets');
});
test('session can still be changed while the preview is paused',async({page})=>{
 await send(page,'I have 8 minutes');await page.getByRole('button',{name:'Start this session'}).click();await expect(page.locator('#position')).toHaveText('3 / 5');
 await page.locator('#pause').click();await expect(page.locator('#paused')).toBeVisible();await expect(page.locator('#send')).toBeEnabled();await expect(page.locator('.timer-status')).toContainText('paused');
 await send(page,'make it easier');await expect(page.locator('[data-statement="phase_next_shape"]')).toContainText('20s set · 40s rest');await expect(page.locator('.timer-status')).toContainText('paused');
 await page.locator('#pause').click();await expect(page.locator('#paused')).toBeHidden();await expect(page.locator('.timer-status')).toContainText('On screen');
});
test('Quiet Momentum adapts the next set, uses effort on Rest, and remembers only by request',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mkdir(shots,{recursive:true});await page.setViewportSize({width:1440,height:1000});await demo(page);await page.screenshot({path:shots+'/01-start.png',fullPage:true});
 await expect(page.locator('#spoken')).toContainText('There’s no perfect way');await send(page,"I have 8 minutes, keep cues quiet");await expect(page.locator('#position')).toHaveText('2 / 5');await expect(page.locator('[data-statement="plan_time"]')).toContainText('8 minutes');await expect(page.locator('[data-statement="plan_intervals"]')).toContainText('30s phase · 30s pause');await expect(page.locator('[data-statement="plan_cue_mode"]')).toContainText('Quiet cues');
 await page.getByRole('button',{name:'Start this session'}).click();await expect(page.locator('#position')).toHaveText('3 / 5');await expect(page.locator('.timer-status')).toHaveText('On screen · simulated');const beforeRemaining=Number((await page.locator('[data-statement="timer1"]').textContent()).match(/0:(\d\d)/)?.[1]);await send(page,'too much');const afterRemaining=Number((await page.locator('[data-statement="timer1"]').textContent()).match(/0:(\d\d)/)?.[1]);expect(afterRemaining).toBeLessThanOrEqual(beforeRemaining);await expect(page.locator('[data-statement="phase_next_shape"]')).toContainText('20s set · 40s rest');await page.screenshot({path:shots+'/02-adaptation.png',fullPage:true});
 await send(page,'pause');await expect(page.locator('.timer-status')).toContainText('paused');await send(page,'resume');await expect(page.locator('.timer-status')).toContainText('On screen');await send(page,'less talking');await expect(page.locator('[data-statement="phase_cue"]')).toContainText('Steady.');
 await page.locator('#next').click();await expect(page.locator('#position')).toHaveText('4 / 5');await expect(page.locator('[data-statement="rest_ring"]')).toContainText('0:40');await send(page,'more time');await expect(page.locator('[data-statement="rest_ring"]')).toContainText('1:00');await page.getByRole('button',{name:'Effort 2'}).click();await expect(page.locator('[data-statement="phase_title"]')).toContainText('Set 2 of 3');await expect(page.locator('[data-statement="timer1"]')).toContainText('0:10');
 await page.locator('#next').click();await page.getByRole('button',{name:'Effort 5'}).click();await expect(page.locator('[data-statement="phase_title"]')).toContainText('Set 3 of 3');await page.locator('#next').click();await page.getByRole('button',{name:'Effort 3'}).click();await expect(page.locator('#position')).toHaveText('5 / 5');await expect(page.locator('[data-statement="closing_title"]')).toContainText('That’s enough for today');await expect(page.locator('[data-statement="closing_plan"]')).toContainText('8 min');await page.screenshot({path:shots+'/03-recap.png',fullPage:true});
 await page.getByRole('button',{name:'Remember this setup'}).click();await expect(page.locator('[data-statement="closing_memory_status"]')).toContainText('Saved for this tab');await page.locator('#reset').click();await demo(page);await expect(page.locator('[data-statement="arrival_memory_status"]')).toContainText('Last time');await page.getByRole('button',{name:'Use my saved setup'}).click();await expect(page.locator('#position')).toHaveText('2 / 5');await expect(page.locator('[data-statement="plan_time"]')).toContainText('8 minutes');expect(errors).toEqual([]);
});
test('repeated sends, interruption, reset while pending and post-reset navigation',async({page})=>{
 await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#fault').selectOption('slow');await page.locator('#message').fill('/demo');await page.locator('#send').click();await page.locator('#message').fill('/demo');await page.locator('#send').click();await expect(page.locator('.message.user')).toHaveCount(1);await page.locator('#reset').click();await page.waitForTimeout(2500);await expect(page.locator('#screen')).toContainText('Your preview starts here');await demo(page);await page.locator('#next').click();await page.locator('#reset').click();await demo(page);await page.locator('#next').click();await expect(page.locator('#position')).toHaveText('2 / 5');
 await page.locator('#fault').selectOption('slow');await page.locator('#message').fill('next');await page.locator('#send').click();await send(page,'back');await expect(page.locator('#position')).toHaveText('1 / 5');
});
for(const fault of ['schema','request'])test(`${fault} failure preserves screen and retry recovers`,async({page})=>{await demo(page);await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#fault').selectOption(fault);await send(page,'next');await expect(page.locator('#error')).toBeVisible();await expect(page.locator('[data-statement="arrival_title"]')).toContainText('What do you need right now');await page.locator('#retry').click();await expect(page.locator('#position')).toHaveText('2 / 5');await expect(page.locator('#error')).toBeHidden();});
test('malformed JSON response is visible and Retry recovers without changing the screen',async({page})=>{
 await demo(page);let first=true;await page.route('**/api/turn',async route=>{if(first){first=false;await route.fulfill({status:200,contentType:'application/json',body:'not-json'});}else await route.continue();});await send(page,'I have five minutes');await expect(page.locator('#error')).toContainText('unreadable data');await expect(page.locator('#message')).toBeEnabled();await expect(page.locator('#position')).toHaveText('1 / 5');await page.locator('#retry').click();await expect(page.locator('[data-statement="plan_time"]')).toContainText('5 minutes');
});
test('local valid/invalid patches are data and candidate component can be registered',async({page})=>{
 await demo(page);await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#patch').fill('arrival_title = Text("<img src=x onerror=alert(1)>", "title")');await page.locator('#apply-patch').click();await expect(page.locator('[data-statement="arrival_title"]')).toContainText('<img src=x');await expect(page.locator('#screen img')).toHaveCount(0);
 await page.locator('#patch').fill('arrival_title = Function("evil")');await page.locator('#apply-patch').click();await expect(page.locator('#patch-status')).toContainText('Invalid patch');
 // Trusted test code registers a candidate component in all three local seams.
 await page.evaluate(async()=>{const {OPENUI_LIBRARY}=await import('/shared/openui/openui-library.js');const {propValidators}=await import('/shared/openui/validate.js');const {renderers}=await import('/web/components.js');OPENUI_LIBRARY.StatusPill={args:['label','value'],required:2};propValidators.StatusPill=p=>typeof p.label==='string'&&typeof p.value==='string';renderers.StatusPill=({props:p})=>{const n=document.createElement('div');n.textContent=p.label+': '+p.value;return n;};});
 await page.locator('#patch').fill('arrival = Screen([arrival_title, custom1, arrival_copy, arrival_note, arrival_options, arrival_cue])\ncustom1 = StatusPill("Preview", "A")');await page.locator('#apply-patch').click();await expect(page.locator('[data-statement="custom1"]')).toHaveText('Preview: A');
});
test('manual export contains screen/events/versions and no token; active layout fits two mobile widths',async({page})=>{
 await page.setViewportSize({width:390,height:844});await demo(page);await send(page,'I only have 3 minutes and I’m in a tight room');await page.locator('#next').click();await expect(page.locator('[data-statement="phase_title"]')).toContainText('Set 1 of 2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:shots+'/04-mobile.png',fullPage:true});await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#note').fill('Tested mock only. TOKEN=do-not-export');const download=page.waitForEvent('download');await page.locator('#export').click();const d=await download;const stream=await d.createReadStream();let content='';for await(const chunk of stream)content+=chunk;const json=JSON.parse(content);expect(json.state.ui_state).toContain('root = Screens');expect(json.events.find(e=>e.result).result.versions.protocolHash).toHaveLength(64);expect(content).not.toContain('do-not-export');expect(content).not.toContain('X-Local-Token');await page.locator('.builder').evaluate(e=>e.open=false);
});
test('runtime starts mock; Codex blocked; selecting never calls model endpoint',async({page})=>{let turns=0;page.on('request',r=>{if(r.url().includes('/api/turn'))turns++;});await page.locator('.runtime-controls').evaluate(e=>e.open=true);await page.locator('#provider').selectOption('codex-cli');await expect(page.locator('#send')).toBeDisabled();await expect(page.locator('#provider-description')).toContainText('no-command/no-private-read');expect(turns).toBe(0);});
test('Gemini consent and disabled-send explanation stay visible outside collapsed settings',async({page})=>{
 await page.route('**/api/config',async route=>{const response=await route.fetch();const cfg=await response.json();cfg.providers.find(p=>p.id==='gemini-api').enabled=true;await route.fulfill({json:cfg});});
 await page.reload();await page.locator('.runtime-controls').evaluate(e=>e.open=true);await page.locator('#provider').selectOption('gemini-api');await page.locator('.runtime-controls').evaluate(e=>e.open=false);
 await expect(page.locator('#consent-wrap')).toBeVisible();await expect(page.locator('.runtime-controls #consent-wrap')).toHaveCount(0);
 await expect(page.locator('#status')).toContainText('Check the consent box above');await expect(page.locator('#send')).toBeDisabled();
 await page.locator('#consent').check();await expect(page.locator('#send')).toBeEnabled();
});
test('configured CLI needs explicit consent and records fake provider identity',async({page})=>{
 await page.route('**/api/config',async route=>{const response=await route.fetch();const cfg=await response.json();cfg.providers.find(p=>p.id==='claude-cli').enabled=true;await route.fulfill({json:cfg});});await page.reload();await page.locator('.runtime-controls').evaluate(e=>e.open=true);await page.locator('#provider').selectOption('claude-cli');await expect(page.locator('#send')).toBeDisabled();await page.locator('#consent').check();await page.route('**/api/turn',route=>route.fulfill({json:{turn:{reply:'Transport fixture, not a live CLI request.'},versions:{provider:'claude-cli',mode:'live',model:'fixture-only'}}}));await send(page,'hello');await expect(page.locator('#spoken')).toContainText('Transport fixture');
});
test('Gemini provider failure switches to the local Mock and still shapes the session',async({page})=>{
 await page.route('**/api/config',async route=>{const response=await route.fetch();const cfg=await response.json();cfg.providers.find(p=>p.id==='gemini-api').enabled=true;await route.fulfill({json:cfg});});
 await page.reload();await page.locator('.runtime-controls').evaluate(e=>e.open=true);await page.locator('#provider').selectOption('gemini-api');await page.locator('#consent').check();
 const providers=[];await page.route('**/api/turn',async route=>{const provider=route.request().postDataJSON().provider;providers.push(provider);if(provider==='gemini-api')await route.fulfill({status:503,json:{error:'fixture outage'}});else await route.fulfill({response:await route.fetch()});});
 await send(page,'I’m tired and I only have 8 minutes');await expect(page.locator('#header-mode')).toHaveText('LOCAL PROTOTYPE · MOCK FALLBACK');await expect(page.locator('#provider')).toHaveValue('mock');await expect(page.locator('[data-statement="plan_intervals"]')).toContainText('20s phase · 40s pause');expect(providers).toEqual(['gemini-api','mock']);
});
