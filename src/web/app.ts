import { Conversation } from '../shared/controller.js';
import { APP_VERSION, SCHEMA_VERSION, type Provider, type ProviderStatus, type RequestData, type Result } from '../shared/contracts.js';
import { TimerLedger, type TimerListEntry } from '../shared/openui/timer-store.js';
import { activityClientEvents, timerTransitionEvent } from '../shared/openui/activity-client-events.js';
import { createRunNav } from '../shared/openui/run-nav.js';
import { splitReply } from '../shared/openui/document.js';
import { callArgsOf, linesById } from '../shared/openui/parse-document.js';
import { serializeStatement } from '../shared/openui/serialize.js';
import type { StatementNode } from '../shared/openui/openui-model.js';
import { redactValue } from '../shared/redact.js';
import { renderComponent } from './components.js';
import { byId,el } from './dom.js';

type Config={providers:ProviderStatus[];token:string};let config:Config|undefined,localFallback=false,localFallbackReason='',configLoading=false,startupFlushing=false;
type SavedSession={intention:string;minutes:number;phaseSeconds:number;pauseSeconds:number;quietCues:boolean;space:string;sets:number};
let savedSession:SavedSession|undefined,memoryApplied=-1,handledAction=-1;
const startupQueue:string[]=[];
const timers=new TimerLedger();let previousTimers=new Map<string,TimerListEntry>(),updates:(()=>void)[]=[],paused=false,pausedTimers:string[]=[],renderKey='',lastClear=0;
const draft=byId<HTMLTextAreaElement>('message');
const fence=(code:string)=>'```openui\n'+code+'\n```';
function statementArgs(id:string):unknown[]{const line=linesById(c.document.program).get(id);return line?callArgsOf(line)?.args.map(arg=>arg?.k==='null'?null:arg?.v)??[]:[];}
function value(id:string,fallback=''):string{return String(statementArgs(id)[0]??fallback);}
function refreshMemoryDecision(){
  const index=c.events.length-1,event=c.events[index];if(index===handledAction||event?.kind!=='response'||!event.result)return;
  if(event.result.decision?.intent==='SAVE_PREFERENCE'){handledAction=index;queueMicrotask(()=>localMemoryAction('save'));}
}
function memoryFromDocument():SavedSession{
  const intervals=value('plan_intervals','30s phase · 30s pause').match(/\d+/g)??['30','30'];
  const minutes=value('plan_time','8 minutes').match(/\d+/)?.[0]??'8';
  const sets=value('plan_sets','3 sets').match(/\d+/)?.[0]??'3';
  return {intention:value('plan_goal','Start gently'),minutes:Number(minutes),phaseSeconds:Number(intervals[0]),pauseSeconds:Number(intervals[1]),quietCues:value('plan_cue_mode','Short cues').toLowerCase().includes('quiet'),space:value('plan_context','Flexible space'),sets:Number(sets)};
}
function localMemoryAction(action:'save'|'forget'|'use'){
  if(action==='save')savedSession=memoryFromDocument();
  if(action==='forget')savedSession=undefined;
  if(action==='use'&&savedSession){const p=savedSession;const root=`root = Screens([${c.document.screens.map(s=>s.key).join(', ')}], ready)`;const patch=[
    serializeStatement('plan_goal','Keyword',[p.intention,'Restored only after you asked · local tab memory']),
    serializeStatement('plan_time','Keyword',[`${p.minutes} minutes`,'Your planned window · demo timers are shorter']),
    serializeStatement('plan_context','Keyword',[p.space,'Context I understood']),serializeStatement('plan_sets','Keyword',[`${p.sets} sets`,'Short, simulated rounds']),
    serializeStatement('plan_intervals','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your saved session shape · adjustable any time']),
    serializeStatement('plan_cue_mode','Keyword',[p.quietCues?'Quiet cues':'Short cues',p.quietCues?'Aira will keep text cues brief':'Cue style for this session']),
    serializeStatement('timer1','Timer',[`${p.phaseSeconds}s phase · demo`,p.phaseSeconds]),serializeStatement('timer2','Timer',[`${p.pauseSeconds}s pause · demo`,p.pauseSeconds]),
    serializeStatement('phase_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your session shape · short local samples']),
    serializeStatement('pause_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your current session shape']),
    serializeStatement('plan_summary','Text',['I restored the setup you chose to remember. You can still change anything before we start.','description']),
    serializeStatement('closing_plan','Keyword',[`${p.intention} · ${p.minutes} min · ${p.phaseSeconds}/${p.pauseSeconds}`,'The session shape you chose']),root
  ].join('\n');c.document.apply(`Aira used the setup you chose to remember. You can still change every part.\n${fence(patch)}`);c.localEvent('Applied your saved session setup from this tab.');return;
  }
  const content=action==='save'?'Saved in this tab only · clear it whenever you like':'Nothing saved · Aira will ask before remembering anything';
  const options=action==='save'?['Forget my saved setup','Not now']:['Remember this setup','Not now'];
  const prefix=c.document.cursor==='arrival'?'arrival':'closing';
  c.document.apply(fence(serializeStatement(`${prefix}_memory_status`,'Keyword',[action==='save'?'Saved for this tab':'Nothing saved',content])+'\n'+serializeStatement(`${prefix}_memory_options`,'FollowUps',[options])));
  c.localEvent(action==='save'?'You chose to remember this session setup in this tab.': 'Saved session setup forgotten from this tab.');
}
async function postTurn(request:RequestData,signal:AbortSignal):Promise<Result>{
  const response=await fetch('/api/turn',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':config!.token},body:JSON.stringify(request),signal});
  let data:unknown;try{data=await response.json();}catch{throw new Error('The local server returned unreadable data. Your session is unchanged; retry this turn.');}
  if(!response.ok){const message=data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'The local server could not complete this turn. Retry.';throw new Error(message);}
  return data as Result;
}
async function localMockFallback(request:RequestData,signal:AbortSignal):Promise<Result>{
  const fallback=await postTurn({...request,provider:'mock',consent:false,fault:'none'},signal);
  c.provider='mock';c.consent=false;localFallback=true;return fallback;
}
function fallbackReason(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(/rejected the key or access/i.test(message))return 'Gemini rejected the key or model access. Check your local setup.';
  if(/rate or usage limit/i.test(message))return 'Gemini reported a usage limit. Check your Google AI Studio account.';
  if(/could not reach Gemini/i.test(message))return 'Gemini could not be reached. Check your connection.';
  if(/could not complete this turn/i.test(message))return 'Gemini could not complete this turn. Check model access and retry.';
  if(/structured data|decision outside|valid structured/i.test(message))return 'Gemini returned a response the workout screen could not use.';
  return 'Gemini could not complete this request. Check Preview settings and try again.';
}
const c=new Conversation(async(request:RequestData,signal:AbortSignal):Promise<Result>=>{
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,request.provider==='claude-cli'?85000:48000);
  try{return await postTurn(request,controller.signal);}
  catch(error){
    if(request.provider==='gemini-api'&&!signal.aborted){try{localFallbackReason=fallbackReason(error);return await localMockFallback(request,controller.signal);}catch{throw new Error('Gemini is unavailable and the local preview could not start. Try Mock from Preview settings.');}}
    if(error instanceof Error&&error.name==='AbortError')throw new Error('Request cancelled or timed out. Retry when ready.');
    if(error instanceof TypeError)throw new Error('Could not reach the local server. Check that it is running, then retry this turn.');
    throw error;
  }
  finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
},render,()=>[...(paused?['Preview is currently paused.']:[]),...timers.list().map(t=>`Simulated timer ${t.id} (${t.label}): ${t.status}, ${Math.ceil(t.remaining)} of ${t.seconds} seconds remaining.`)]);
function makeNav(){return createRunNav({index:()=>c.document.screens.findIndex(s=>s.key===c.document.cursor),stepCount:()=>c.document.screens.length,isConsumed:()=>false,awaiting:()=>false,leave:()=>{if(c.pending)c.cancel('interrupted');},land:(from,to)=>{c.document.move(to);c.localEvent(to<from?activityClientEvents.wentBack(`step ${from+1}`,`step ${to+1}`):activityClientEvents.nowOnStep(`step ${to+1} of ${c.document.screens.length}`));},phase:()=>{},finish:()=>c.localEvent('Reached the final screen. This is not evidence of physical completion.')},{outMs:30,inMs:30});}
let nav=makeNav();
function send(text:string):boolean{
  const input=text.trim();if(!input){c.error='Tell me what you need, or choose an example to begin.';render();draft.focus();return false;}
  if(input.length>2000){c.error='Keep your message under 2,000 characters.';render();return false;}
  if(!config||startupFlushing){startupQueue.push(input);c.error='';render();if(!config&&!configLoading)void start();return true;}
  const provider=config.providers.find(p=>p.id===c.provider);if(!provider||!provider.enabled||(c.provider!=='mock'&&!c.consent)){c.error='Set up this provider and agree to usage, or select Mock.';render();return false;}
  const phrase=input.toLowerCase();
  if(c.provider==='mock'&&c.document.cursor==='closing'&&phrase==='remember this setup'){localMemoryAction('save');return true;}
  if(c.provider==='mock'&&phrase==='forget my saved setup'){localMemoryAction('forget');return true;}
  if(c.provider==='mock'&&c.document.cursor==='arrival'&&phrase==='use my saved setup'&&savedSession){localMemoryAction('use');return true;}
  if(['phase','pause'].includes(c.document.cursor)){
    const id=c.document.cursor==='phase'?'timer1':'rest_ring';const entry=timers.list().find(timer=>timer.id===id);
    if(/\b(pause|hold on|wait a moment)\b/.test(phrase)){
      if(entry?.status==='running'){timerAction(id,'pause');return true;}
      c.localEvent(entry?.status==='paused'?'That simulated timer is already paused.':'That simulated sample has already ended.');return true;
    }
    if(/\b(resume|continue|go on|carry on)\b/.test(phrase)&&entry?.status==='paused'){
      timerAction(id,'start');
      // Continuing a paused rest resumes that timer; it must not also skip the rest.
      return true;
    }
    if(/^(repeat|again)$/.test(phrase)&&entry)timerAction(id,'reset');
  }
  const f=byId<HTMLSelectElement>('fault');const fault=f.value as RequestData['fault'];f.value='none';void c.send(input,fault);return true;}
function syncTimers(){
  if(lastClear!==c.document.clearVersion){nav.dispose();nav=makeNav();timers.forget();previousTimers.clear();lastClear=c.document.clearVersion;}
  const ids=new Set<string>();for(const s of c.document.screens)for(const node of s.props.children as StatementNode[])if(node.name==='Timer'||node.name==='RestRing'){ids.add(node.key);timers.ensure(node.key,{label:String(node.props.label),seconds:Number(node.props.seconds)});}
  for(const t of timers.list())if(!ids.has(t.id)){timers.forget(t.id);previousTimers.delete(t.id);}
}
function tick(){const snapshot=timers.list();for(const entry of snapshot){const before=previousTimers.get(entry.id);previousTimers.set(entry.id,{...entry});if(before && before.status!=='done'&&entry.status==='done')c.localEvent(activityClientEvents.finishedTimer(entry.label),false);}updates.forEach(fn=>fn());}
function timerAction(id:string,action:'start'|'pause'|'reset'|'finish'){
  const before=timers.list().find(t=>t.id===id);if(!before||paused)return;
  if(action==='start')timers.start(id);if(action==='pause')timers.pause(id);if(action==='reset')timers.reset(id);if(action==='finish')timers.finish(id);
  const after=timers.list().find(t=>t.id===id)!;previousTimers.set(id,{...after});
  const event=action==='reset'?activityClientEvents.resetTimer(after.label,after.seconds):action==='start'&&before.status==='stopped'?activityClientEvents.startedTimer(after.label,after.seconds):timerTransitionEvent(before,after);
  c.localEvent(event??`Simulated ${action} for ${after.label}.`);tick();
}
function render(){
  refreshMemoryDecision();
  if(savedSession&&c.document.cursor==='arrival'&&memoryApplied!==c.document.clearVersion){const p=savedSession;c.document.apply(fence(serializeStatement('arrival_memory_status','Keyword',[`Last time · ${p.intention}`,`${p.minutes} min · ${p.phaseSeconds}/${p.pauseSeconds} · ${p.quietCues?'quiet cues':'short cues'} · saved in this tab`])+'\n'+serializeStatement('arrival_memory_options','FollowUps',[['Use my saved setup','Forget my saved setup']])));memoryApplied=c.document.clearVersion;}
  const cursor=c.document.cursor;
  const hasSession=c.document.screens.length>0;
  const composerArea=byId('composer-area'),composerTarget=byId(hasSession?'active-composer-slot':'hero-composer-slot');
  if(composerArea.parentElement!==composerTarget)composerTarget.append(composerArea);
  byId('hero').hidden=hasSession;byId('experience').hidden=!hasSession;byId('experience').dataset.screen=cursor;
  const heroResponse=byId('hero-response');heroResponse.textContent=c.document.prose;heroResponse.hidden=hasSession||!c.document.prose;
  const focused=!hasSession&&document.activeElement===draft;
  const state=paused?'paused':c.pending?'thinking':focused?'listening':cursor==='closing'?'completed':c.events.at(-1)?.result?.decision&&['MAKE_EASIER','MAKE_HARDER','SHORTEN_SESSION','EXTEND_SESSION','MORE_RECOVERY','QUIETER'].includes(c.events.at(-1)!.result!.decision!.intent)?'adapting':cursor==='phase'||cursor==='pause'?'active':'planning';
  byId('companion-card').dataset.state=state;
  const companionLines:Record<string,string>={planning:'I’m here when you’re ready.',listening:'I’m listening.',thinking:'I’m shaping this around what you said.',adapting:'Making room for your change.',paused:'No rush. We’ll continue when you’re ready.',completed:'That’s enough for today.',active:'You can interrupt with a change at any time.'};byId('companion-note').textContent=companionLines[state];
  byId('quick-prompts').hidden=Boolean(cursor&&cursor!=='arrival');
  byId('context-prompts').hidden=Boolean(cursor&&cursor!=='arrival');
  let consentNeeded=false;
  if(config){
    const selected=config.providers.find(p=>p.id===c.provider)!;
    consentNeeded=c.provider!=='mock'&&selected.enabled&&!c.consent;
    byId<HTMLSelectElement>('provider').value=c.provider;
    byId('mode').textContent=c.provider==='mock'?(localFallback?'MOCK · LOCAL FALLBACK':'MOCK · NO MODEL CALLS'):selected.enabled?c.provider==='gemini-api'?'GEMINI · ON SEND':'LIVE WHEN SENT':'SETUP / BLOCKED';
    byId('provider-description').textContent=selected.message;
    byId('consent-wrap').hidden=c.provider==='mock'||!selected.enabled;
    byId('consent-label').textContent=c.provider==='gemini-api'
      ?'Send this prompt and a compact session summary to Google Gemini. Use my API quota. Phone-like numbers are redacted where recognized.'
      :c.provider==='claude-cli'?'Use my subscription quota on Send/Retry; I reviewed the host-policy limits.':'Use my API budget on Send/Retry.';
    byId<HTMLInputElement>('consent').checked=c.consent;
    byId<HTMLButtonElement>('send').disabled=!selected.enabled||(c.provider!=='mock'&&!c.consent);
    byId('mock-controls').hidden=c.provider!=='mock';byId('sample').hidden=c.provider!=='mock';
    const providerLabel=c.provider==='gemini-api'?'GEMINI':c.provider==='openai-api'?'OPENAI API':c.provider==='claude-cli'?'CLAUDE CLI':'CODEX CLI';
    byId('header-mode').textContent=c.provider==='mock'?(localFallback?'LOCAL PROTOTYPE · MOCK FALLBACK':'LOCAL PROTOTYPE · MOCK AI'):`${providerLabel} · ${c.consent?'CONSENT ON':'CONSENT NEEDED'}`;
  }
  byId('fallback-note').hidden=!localFallback;
  byId('fallback-note').textContent=localFallback?`${localFallbackReason} I switched to the local preview; your request is still here, and you can keep going.`:'Gemini didn’t respond this time, so I switched to the local preview. You can keep going here.';
  const waitingForSetup=startupQueue.length>0;
  byId('send').textContent=c.pending||waitingForSetup?'Thinking…':hasSession?'Send update ↗':'Talk to AiRA ↗';byId<HTMLButtonElement>('cancel').disabled=!c.pending;
  byId('pending').hidden=!c.pending&&!waitingForSetup;byId('pending').textContent=waitingForSetup?'AiRA is starting · your message is queued.':c.pending?'AiRA is shaping the next screen…':'One moment · your place is kept';
  byId('status').textContent=waitingForSetup?'Starting AiRA · your request will send next.':c.pending?'AiRA is shaping the next screen…':c.error?'Needs attention':consentNeeded?'Check the consent box above to enable Send.':hasSession?'Your words change the session':'Ready when you are';byId('error').hidden=!c.error;byId('error-message').textContent=c.error;
  const transcript=byId('transcript');transcript.replaceChildren();if(!c.events.length)transcript.append(el('p','Tell me what you need in your own words. I’ll turn it into a plan you can change.','micro'));
  for(const event of c.events){if(event.kind==='input'||event.kind==='response'){const n=el('div','','message '+(event.kind==='input'?'user':'assistant'));n.append(el('span',event.kind==='input'?'You':'Reply','who'),el('p',event.text??splitReply(event.result!.turn.reply).prose??''));transcript.append(n);}else if(event.text)transcript.append(el('p',event.text,'event'));else if(event.kind==='interrupted'||event.kind==='cancelled')transcript.append(el('p',event.kind==='interrupted'?'Previous reply interrupted. Your messages are kept.':'Reply cancelled.','event'));}
  transcript.scrollTop=transcript.scrollHeight;syncTimers();
  const screens=c.document.screens,index=screens.findIndex(s=>s.key===c.document.cursor),key=c.document.echo()+String(paused);
  if(key!==renderKey || !byId('screen').childNodes.length){renderKey=key;updates=[];const surface=byId('screen');surface.replaceChildren();const current=c.document.current;
    if(!current){const n=el('div','','empty');n.append(el('p','QUIET MOMENTUM · PREVIEW','eyebrow'),el('h3',c.provider==='gemini-api'?'What do you need right now?':'Your preview starts here.'),el('p',c.provider==='gemini-api'?'Choose a starting point or tell AiRA in your own words.':'Choose Begin preview to explore a calm, fictional guided session.'));surface.append(n);}
    else for(const node of current.props.children as StatementNode[])if((node.name!=='Cue'||cursor==='phase'||cursor==='pause')&&!(current.key==='arrival'&&!savedSession&&['arrival_memory_status','arrival_memory_options'].includes(node.key)))surface.append(renderComponent(node,{send,timers,timerAction,updates,paused}));
    const progress=byId('progress');progress.replaceChildren();if(screens.length>1)for(let i=0;i<screens.length;i++){const n=el('span','',''+(i===index?'active':i<index?'past':''));n.setAttribute('aria-label',`Screen ${i+1}${i===index?', current':''}`);progress.append(n);}
  }
  byId('navigation').hidden=screens.length<2;byId('position').textContent=`${index+1} / ${screens.length}`;byId<HTMLButtonElement>('back').disabled=paused||index<=0;byId<HTMLButtonElement>('next').disabled=paused||c.pending;const nextLabels:Record<string,string>={ready:'Begin session →',phase:'Rest →',pause:'Continue →',closing:'Finish preview'};byId('next').textContent=nextLabels[c.document.cursor]??'Next →';
  byId<HTMLButtonElement>('pause').disabled=!screens.length;byId('pause').textContent=paused?'Resume':'Pause';byId('paused').hidden=!paused;
  const cues=(c.document.current?.props.children as StatementNode[]??[]).filter(n=>n.name==='Cue').map(n=>String(n.props.text));byId('spoken').textContent=cues.join(' ')||c.document.prose||'Your cue will appear here when the preview begins.';byId('spoken').hidden=cursor==='phase'||cursor==='pause';
  byId('state-json').textContent=JSON.stringify({ui_state:c.document.echo(),client_events:c.clientEvents,timers:timers.list()},null,2);byId<HTMLButtonElement>('export').disabled=c.pending||!c.events.length;
}
byId<HTMLFormElement>('composer').addEventListener('submit',event=>{event.preventDefault();if(send(draft.value))draft.value='';});
draft.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();byId<HTMLFormElement>('composer').requestSubmit();}});
draft.addEventListener('focus',()=>{if(!c.document.screens.length){byId('companion-card').dataset.state='listening';byId('companion-note').textContent='I’m listening.';}});
draft.addEventListener('blur',()=>{if(!c.pending&&!c.document.screens.length){byId('companion-card').dataset.state='planning';byId('companion-note').textContent='I’m here when you’re ready.';}});
byId('quick-prompts').addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-prompt]');if(button)send(button.dataset.prompt??'');});
byId('context-prompts').addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-prompt]');if(button)send(button.dataset.prompt??'');});
byId<HTMLButtonElement>('header-mode').addEventListener('click',()=>{const panel=byId<HTMLDetailsElement>('runtime-controls');panel.open=!panel.open;byId('header-mode').setAttribute('aria-expanded',String(panel.open));if(panel.open)panel.scrollIntoView({behavior:'smooth',block:'center'});});
byId('sample').addEventListener('click',()=>send('Start Quiet Momentum preview'));byId('cancel').addEventListener('click',()=>c.cancel());byId('retry').addEventListener('click',()=>{if(paused)return;if(!config)void start();else void c.retry();});
byId('reset').addEventListener('click',()=>{nav.dispose();paused=false;pausedTimers=[];timers.forget();previousTimers.clear();draft.value='';c.reset();});
byId('back').addEventListener('click',()=>nav.back());byId('next').addEventListener('click',()=>{if(c.document.cursor==='ready')send('start this session');else if(c.document.cursor==='phase')send('next');else if(c.document.cursor==='pause')send('continue');else nav.next();});
byId('pause').addEventListener('click',()=>{paused=!paused;if(paused){pausedTimers=timers.list().filter(t=>t.status==='running').map(t=>t.id);for(const id of pausedTimers)timers.pause(id);}else{for(const id of pausedTimers)timers.start(id);pausedTimers=[];}c.localEvent(paused?'User paused the preview.':'User resumed the preview.');tick();});
byId<HTMLSelectElement>('provider').addEventListener('change',event=>{localFallback=false;localFallbackReason='';c.selectProvider((event.target as HTMLSelectElement).value as Provider);});
byId<HTMLInputElement>('consent').addEventListener('change',event=>{c.consent=(event.target as HTMLInputElement).checked;if(!c.consent)c.cancel();render();});
byId('apply-patch').addEventListener('click',()=>{try{const raw=byId<HTMLTextAreaElement>('patch').value;c.document.apply(raw.includes('```')?raw:'```openui\n'+raw+'\n```');c.localEvent('Builder applied local OpenUI data: '+raw);byId('patch-status').textContent='Patch accepted. This is local fixture evidence, not a model run.';}catch{byId('patch-status').textContent='Invalid patch. Previous screen kept. Check names, arguments and catalog.';}});
byId('export').addEventListener('click',()=>{const label=byId<HTMLSelectElement>('run-label').value;const payload={format:'aira-workout-run-v1',label,appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,selectedProvider:c.provider,note:byId<HTMLTextAreaElement>('note').value,events:c.events,state:{ui_state:c.document.echo(),client_events:c.clientEvents},timers:timers.list()};const url=URL.createObjectURL(new Blob([JSON.stringify(redactValue(payload),null,2)],{type:'application/json'}));const link=el('a');link.href=url;link.download=label+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);byId('export-status').textContent=`Downloaded ${label}.json. Review and move it into runs/.`;});
async function start(){
  if(configLoading)return;configLoading=true;render();
  try{
    const response=await fetch('/api/config');if(!response.ok)throw new Error('Configuration request failed.');
    const loaded=await response.json() as Config;if(!loaded||!Array.isArray(loaded.providers)||typeof loaded.token!=='string')throw new Error('Configuration response was invalid.');
    config=loaded;const select=byId<HTMLSelectElement>('provider');select.replaceChildren();
    for(const p of config.providers){const option=el('option',p.label+(p.enabled?'':' · setup / blocked'));option.value=p.id;select.append(option);}
    select.value='mock';select.disabled=false;c.error='';render();startupFlushing=true;
    while(startupQueue.length){const prompt=startupQueue.shift()!;await c.send(prompt);}
  }catch{
    c.error='Could not connect to AiRA. Your queued message is kept; check the local server and select Retry.';render();
  }finally{startupFlushing=false;configLoading=false;render();}
}
setInterval(tick,250);void start();
