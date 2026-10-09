import { serializeStatement } from '../shared/openui/serialize.js';
import { callArgsOf, linesById } from '../shared/openui/parse-document.js';
import type { RequestData, Turn } from '../shared/contracts.js';
import { ScreenDocument } from '../shared/openui/document.js';
import { durationFromMessage, interpretSessionRequest, paceFromMessage, setCountForMinutes, type SessionPlan } from './session-intent.js';
import { productAnswer } from './product-knowledge.js';

type DirectedPlan = SessionPlan;
function spaceIn(text:string):DirectedPlan['space']|undefined {
  const s=text.toLowerCase();
  if(/\b(tiny|small|tight|cramped)\s+(?:room|space)\b|\bin a small room\b/.test(s))return 'Tight space';
  if(/\b(open room|open space|plenty of (?:room|space)|lots of (?:room|space)|spacious)\b/.test(s))return 'Open room';
  return undefined;
}
function directedMockTurn(request:RequestData,fixture:string):Turn|undefined {
  const raw=request.messages.at(-1)?.content.trim()??'',last=raw.toLowerCase();
  if(['load wiring sample','start quiet momentum preview','/demo'].includes(last)&&!request.state.ui_state)return undefined;
  if(/what can (?:aira|you) (?:do|help)|how does this work|how can (?:aira|you) help|can you change my session|what can i ask/.test(last))return undefined;
  const fence=(code:string)=>'```openui\n'+code+'\n```';
  const doc=new ScreenDocument();
  if(request.state.ui_state){try{doc.apply(fence(request.state.ui_state));}catch{doc.apply(fence(fixture));}}
  else doc.apply(fence(fixture));
  const screens=doc.screens,index=screens.findIndex(s=>s.key===doc.cursor);
  if(/^(?:make it better|improve this|make this better|make it nicer)[.! ]*$/i.test(raw))return {reply:'What should feel better—the pace, the amount of guidance, or the next set? I’ll keep the current screen as it is until you choose.'};
  if(/\b(weather|forecast|temperature|write (?:me )?(?:some )?code|generate (?:some )?code|explain (?:javascript|js)|javascript promises|python|programming|recipe|stock price|news)\b/i.test(raw))return {reply:productAnswer(raw)};
  const root=(cursor:string)=>`root = Screens([${screens.map(s=>s.key).join(', ')}], ${cursor})`;
  const args=(name:string)=>{const line=linesById(doc.program).get(name);return line?callArgsOf(line)?.args.map(arg=>arg?.k==='null'?null:arg?.v)??[]:[];};
  const current=(name:string,fallback='')=>String(args(name)[0]??fallback);
  const number=(name:string,fallback:number)=>Number(args(name)[0]??fallback);
  const timerSeconds=(name:string,fallback:number)=>Number(args(name)[1]??fallback);
  const intention=(current('plan_goal','Start gently')) as DirectedPlan['intention'];
  const minutes=Number(current('plan_time','8').match(/\d+/)?.[0]??8);
  const intervals=current('plan_intervals','30s phase · 30s pause').match(/\d+/g)??['30','30'];
  const quiet=current('plan_cue_mode','Short cues').toLowerCase().includes('quiet');
  const space=(current('plan_context','Flexible space') as DirectedPlan['space']);
  const sets=Number(current('plan_sets','3 sets').match(/\d+/)?.[0]??3);
  const plan:DirectedPlan={intention,minutes,phaseSeconds:Number(intervals[0]),pauseSeconds:Number(intervals[1]),quietCues:quiet,space,sets};
  const setNow=Math.max(1,number(index===3?'pause_dots':'phase_dots',1));
  const tallyText=current(index===3?'pause_tally':'phase_tally','0 completed · 0 skipped · 3 remaining');
  const tally=tallyText.match(/(\d+) completed · (\d+) skipped · (\d+) remaining/);
  const progress={completed:Number(tally?.[1]??Math.max(0,setNow-1)),skipped:Number(tally?.[2]??0),remaining:Number(tally?.[3]??Math.max(0,sets-setNow+1))};
  const tallyLine=(id:'phase_tally'|'pause_tally'|'closing_tally',value=progress)=>serializeStatement(id,'Keyword',[`${value.completed} completed · ${value.skipped} skipped · ${value.remaining} remaining`,'Simulated sets · nothing is tracked']);
  const adjustmentCount=Number(current('closing_adjustments','0 adjustments').match(/\d+/)?.[0]??0);
  const moveNames:Record<DirectedPlan['space'],string[]>={
    'Tight space':['Pulse','Reset','Flow','Reach','Step','Drift'],
    'Open room':['Flow','Step','Pulse','Reach','Reset','Drift'],
    'Flexible space':['Pulse','Flow','Reach','Reset','Step','Drift'],
  };
  const moveIn=(place:DirectedPlan['space'],set:number,goal=plan.intention)=>{
    const sequence=goal==='Wake me up'?[...moveNames[place]].reverse():moveNames[place];
    return sequence[(set-1)%sequence.length];
  };
  const move=(set:number)=>moveIn(plan.space,set);
  const log=(action:string)=>{
    const prior=current('phase_change1','No adjustments yet.');
    const closePrior=current('closing_change1','No adjustments yet.');
    return [serializeStatement('phase_change2','ListItem',[prior,'plus']),serializeStatement('phase_change1','ListItem',[action,'plus']),serializeStatement('closing_change2','ListItem',[closePrior,'plus']),serializeStatement('closing_change1','ListItem',[action,'plus'])].join('\n');
  };
  const shapePatch=(p:DirectedPlan,summary:string,adjustments=adjustmentCount,set=setNow)=>[
    serializeStatement('plan_summary','Text',[summary,'description']),
    serializeStatement('plan_goal','Keyword',[p.intention,'What I heard in your request']),
    serializeStatement('plan_time','Keyword',[`${p.minutes} minutes`,'Your planned window · demo timers are shorter']),
    serializeStatement('plan_context','Keyword',[p.space,'Context I understood']),
    serializeStatement('plan_sets','Keyword',[`${p.sets} sets`,'Short, simulated rounds']),
    serializeStatement('plan_intervals','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Short on-screen samples · adjustable any time']),
    serializeStatement('plan_cue_mode','Keyword',[p.quietCues?'Quiet cues':'Short cues',p.quietCues?'Aira will keep text cues brief':'Cue style for this session']),
    serializeStatement('phase_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Next set shape · adjustable any time']),
    serializeStatement('phase_next_shape','Text',[`Next: ${moveIn(p.space,set+1,p.intention)} · ${p.phaseSeconds}s set · ${p.pauseSeconds}s rest`,'description']),
    serializeStatement('phase_cue_mode','Keyword',[p.quietCues?'Quiet cues':'Short cues','Cue style for this session']),
    tallyLine('phase_tally',{...progress,remaining:Math.max(0,p.sets-progress.completed-progress.skipped)}),
    tallyLine('pause_tally',{...progress,remaining:Math.max(0,p.sets-progress.completed-progress.skipped)}),
    serializeStatement('pause_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your current session shape']),
    serializeStatement('closing_plan','Keyword',[`${p.intention} · ${p.minutes} min · ${p.phaseSeconds}/${p.pauseSeconds}`, 'The session shape you chose']),
    serializeStatement('closing_sets','Keyword',[`${set} of ${p.sets} sets`,'Simulated sets shown']),
    serializeStatement('closing_adjustments','Keyword',[`${adjustments} ${adjustments===1?'adjustment':'adjustments'}`,'Changes you asked for']),
    serializeStatement('closing_adaptation','Keyword',[p.quietCues?'Quiet cues':`${p.phaseSeconds}s / ${p.pauseSeconds}s`,'Latest session adjustment']),
  ].join('\n');
  const activePatch=(p:DirectedPlan,set:number,currentSeconds=p.phaseSeconds,summary='The next simulated set is ready.',counts=progress)=>[
    serializeStatement('phase_title','Text',[`Set ${set} of ${p.sets}`,'title']),
    serializeStatement('phase_move','Text',[moveIn(p.space,set,p.intention),'subtitle']),
    serializeStatement('timer1','Timer',[`${moveIn(p.space,set,p.intention)} · simulated`,currentSeconds]),
    serializeStatement('phase_dots','SetDots',[set,p.sets]),
    serializeStatement('phase_next_shape','Text',[set<p.sets?`Next: ${moveIn(p.space,set+1,p.intention)} · ${p.phaseSeconds}s set · ${p.pauseSeconds}s rest`:'Next: recap','description']),
    tallyLine('phase_tally',counts),
    serializeStatement('phase_cue','Cue',[p.quietCues?'Steady.':summary]),
  ].join('\n');
  const restPatch=(p:DirectedPlan,set:number,summary='A quiet moment. Choose what happens next.',remainingSeconds=p.pauseSeconds,counts=progress)=>[
    serializeStatement('pause_title','Text',['REST','title']),
    serializeStatement('rest_ring','RestRing',['Rest · simulated',remainingSeconds]),
    serializeStatement('pause_next','Keyword',[set<p.sets?`Next · ${moveIn(p.space,set+1,p.intention)}`:'Next · recap',set<p.sets?`Set ${set+1} of ${p.sets}`:'You can finish whenever you’re ready']),
    serializeStatement('pause_dots','SetDots',[set,p.sets]),
    tallyLine('pause_tally',counts),
    serializeStatement('effort_picker','EffortPicker',[0]),
    serializeStatement('pause_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your current session shape']),
    serializeStatement('pause_copy','Text',[summary,'description']),
  ].join('\n');
  const recapPatch=(p:DirectedPlan,counts:typeof progress,adjustments=adjustmentCount)=>[
    serializeStatement('closing_title','Text',['That’s enough for today.','title']),
    serializeStatement('closing_plan','Keyword',[`${p.intention} · ${p.minutes} min · ${p.phaseSeconds}/${p.pauseSeconds}`,'The session shape you chose']),
    serializeStatement('closing_sets','Keyword',[`${counts.completed} completed · ${p.sets} planned`,'Simulated sets only']),
    tallyLine('closing_tally',{...counts,remaining:Math.max(0,p.sets-counts.completed-counts.skipped)}),
    serializeStatement('closing_adjustments','Keyword',[`${adjustments} ${adjustments===1?'adjustment':'adjustments'}`,'Changes you asked for']),
    serializeStatement('closing_adaptation','Keyword',[p.quietCues?'Quiet cues':'Short cues','Cue style for this session']),
  ].join('\n');
  const answer=(text:string,patch='',cursor?:string):Turn=>({reply:text+'\n'+fence([patch,cursor?root(cursor):''].filter(Boolean).join('\n'))});

  if(index===0){
    if(/\b(weather|forecast|temperature|write (?:me )?(?:some )?code|generate (?:some )?code|python|javascript|recipe|stock price|news)\b/i.test(raw))return {reply:productAnswer(raw)};
    if(/^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b[!. ]*$/i.test(raw))return {reply:'Hi. What would help right now—a reset, a little more energy, or a gentle start?'};
    if(!/\b(need|want|feel|tired|energy|energ\w*|exciting|lively|focus|clear|head|wake|reset|gentle|easy|move|minutes?|time|room|space|beginner|first time|never tried|workout|session|quiet|push myself|short on time|next)\b/i.test(raw))return {reply:'I can shape a short, fictional session around what you need. Would a reset, a little more energy, or a gentle start help?'};
    const p=interpretSessionRequest(raw),summary=`I heard ${p.intention.toLowerCase()} and ${p.minutes} minutes${p.space==='Flexible space'?'':` in a ${p.space==='Tight space'?'tight':'open'} setting`}. I’ve shaped ${p.sets} short sets with ${p.phaseSeconds}/${p.pauseSeconds} second samples${p.quietCues?' and quiet cues':''}. Change anything before we begin.`;
    const patch=shapePatch(p,summary,0,1)+'\n'+serializeStatement('ready_cue','Cue',['I turned your request into a plan. Does this feel right, or should I change it?']);
    const seed=request.state.ui_state?'':`\n${fence(fixture)}`;
    return {reply:`Got it. ${summary}${seed}\n${fence(patch+'\n'+root('ready'))}`};
  }
  if(index===1){
    if(/^(start this session|start|begin|let'?s go|next|continue)$/i.test(raw))return answer('Starting the local session. The timer is simulated; you can interrupt any time.',shapePatch(plan,'Your session is ready.')+'\n'+activePatch(plan,1), 'phase');
    const p={...plan},nextSpace=spaceIn(raw);if(nextSpace)p.space=nextSpace;
    const pace=paceFromMessage(raw,p.phaseSeconds,p.pauseSeconds);
    if(pace){p.phaseSeconds=pace.phaseSeconds;p.pauseSeconds=pace.pauseSeconds;}
    const goalRequested=/\b(clear my head|clear my mind|focus|wake me up|energ\w*|momentum|upbeat|push myself|something challenging|exciting|lively|start gently|reset)\b/i.test(raw);
    if(goalRequested)p.intention=interpretSessionRequest(raw).intention;
    const requestedMinutes=durationFromMessage(raw,p.minutes),durationChanged=requestedMinutes!==undefined&&requestedMinutes!==p.minutes;
    if(durationChanged)p.minutes=requestedMinutes!;
    p.sets=setCountForMinutes(p.minutes);
    const quietRequested=/quiet|shorter cues|less talking|fewer words/i.test(raw);
    if(quietRequested)p.quietCues=true;
    if(!pace&&!nextSpace&&!goalRequested&&!durationChanged&&!quietRequested)return undefined;
    const changes=[
      ...(goalRequested?[p.intention]:[]),
      ...(durationChanged?[`${p.minutes}-minute window`]:[]),
      ...(pace?[`${p.phaseSeconds}/${p.pauseSeconds}s samples`]:[]),
      ...(nextSpace?[p.space.toLowerCase()]:[]),
      ...(quietRequested?['quiet cues']:[]),
    ];
    const summary=`Updated · ${changes.join(' · ')}.`;
    return answer(`Got it. ${summary} You can change it again before starting.`,shapePatch(p,summary,adjustmentCount+1,1)+'\n'+log(summary));
  }
  if(index===2){
    const setMatch=last.match(/^show set ([1-9]\d*)$/);if(setMatch){const target=Math.min(plan.sets,Number(setMatch[1]));return answer(`Showing set ${target} of ${plan.sets}.`,activePatch(plan,target),'phase');}
    if(/\b(pause|hold on|wait a moment)\b/.test(last))return {reply:'Paused the simulated timer. Your place is kept; resume whenever you’re ready.'};
    if(/\b(resume|continue|go on|carry on)\b/.test(last))return {reply:'Resumed the simulated timer. You can interrupt again whenever you like.'};
    if(/^(?:finish(?: now)?|stop|done for now|i'?m done|end session)$/i.test(raw)||/\b(?:i want to stop|i would like to stop|stop now|finish early)\b/i.test(raw))return answer('Of course. Here’s your recap; you can stop here.',recapPatch(plan,progress,adjustmentCount)+`\n${serializeStatement('closing_copy','Text',['You chose to end the simulation. Nothing was physically tracked, and there is no pressure to continue.','description'])}\n${log('You chose to finish early.')}`,'closing');
    if(/\b(skip|skip this set|skip this phase|skip this one)\b/.test(last)){const counts={...progress,skipped:progress.skipped+1,remaining:Math.max(0,progress.remaining-1)};return answer('Skipped that simulated set. It is marked skipped, not completed.',restPatch(plan,setNow,'Skipped · choose your next step.',plan.pauseSeconds,counts),'pause');}
    if(/^(next|continue|set complete|next set)$/.test(last)){const counts={...progress,completed:progress.completed+1,remaining:Math.max(0,progress.remaining-1)};return answer('Set complete. Here’s a quiet rest and a chance to shape what comes next.',restPatch(plan,setNow,'A quiet moment. Choose what happens next.',plan.pauseSeconds,counts),'pause');}
    if(/\b(what'?s next|what is next|what happens next|show next)\b/.test(last)){const upcoming=setNow<plan.sets?move(setNow+1):'recap',description=setNow<plan.sets?`Next is ${upcoming}, a ${plan.phaseSeconds}-second simulated sample, followed by ${plan.pauseSeconds} seconds of rest.`:'The next screen is your recap. You can finish now or continue to the recap when ready.';return answer(`Next: ${upcoming}.`,serializeStatement('phase_next_shape','Text',[description,'description'])+'\n'+serializeStatement('phase_copy','Text',[description,'description']));}
    if(/\b(need a break|give me a break|take a break|pause)\b/.test(last))return answer('Of course. I’ve opened a rest screen; continue whenever you’re ready.',restPatch(plan,setNow,'A pause, on your terms.'),'pause');
    if(/\b(extend (?:the )?session|more session time|add session time)\b/.test(last)){const p={...plan,minutes:Math.min(20,plan.minutes+2)};p.sets=setCountForMinutes(p.minutes);const label=`Session window extended to ${p.minutes} minutes · ${p.sets} sets.`;return answer(`Done. ${label}`,shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+serializeStatement('phase_dots','SetDots',[Math.min(setNow,p.sets),p.sets])+'\n'+log(label));}
    const nextSpace=spaceIn(raw),pace=paceFromMessage(raw,plan.phaseSeconds,plan.pauseSeconds);
    if(pace||nextSpace){
      const lively=/\b(exciting|lively|upbeat|more momentum|more energy|harder|push a little|challenging)\b/.test(last);
      const p={...plan,...pace,space:nextSpace??plan.space,...(lively?{intention:'Wake me up' as const}:{})},label=nextSpace?`Context updated · ${p.space}.`:lively?`You asked for more energy · the next sample is now ${p.phaseSeconds}s with ${p.pauseSeconds}s rest and a brighter sequence.`:`You asked for a shorter next part, so I changed it to ${p.phaseSeconds}s with ${p.pauseSeconds}s recovery.`;
      const nextTimer=timerSeconds('timer1',plan.phaseSeconds);
      const patch=shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+serializeStatement('phase_copy','Text',[`Current sample stays at ${nextTimer}s. Next set: ${p.phaseSeconds}s, then ${p.pauseSeconds}s rest.`,'description'])+'\n'+serializeStatement('phase_next_shape','Text',[`Next: ${moveIn(p.space,setNow+1,p.intention)} · ${p.phaseSeconds}s set · ${p.pauseSeconds}s rest`,'description'])+'\n'+log(label);
      return answer(`Got it. ${label} The current timer keeps its place; the next set will use the updated shape.`,patch);
    }
    const requestedMinutes=durationFromMessage(raw,plan.minutes);if(requestedMinutes!==undefined&&requestedMinutes!==plan.minutes){
      const p={...plan,minutes:requestedMinutes,sets:setCountForMinutes(requestedMinutes)},label=`Planned window shortened to ${p.minutes} minutes · ${p.sets} sets.`;
      const patch=shapePatch(p,label,adjustmentCount+1,Math.min(setNow,p.sets))+'\n'+serializeStatement('phase_dots','SetDots',[Math.min(setNow,p.sets),p.sets])+'\n'+log(label);
      if(setNow>p.sets)return answer(`Got it. ${label} That’s enough for today.`,patch+'\n'+recapPatch(p,{...progress,remaining:Math.max(0,p.sets-progress.completed-progress.skipped)},adjustmentCount+1),'closing');
      return answer(`Got it. ${label} Your current timer keeps its place.`,patch);
    }
    if(/\b(less talking|less talk|quiet|shorter cues|fewer words|stop talking|don't talk)\b/.test(last)){
      const p={...plan,quietCues:true},label='You asked for fewer words → quiet cues on.';
      return answer('Got it. I’ll keep the cues short from here.',shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+serializeStatement('phase_cue','Cue',['Steady.'])+'\n'+serializeStatement('pause_cue','Cue',['Take your time.'])+'\n'+log(label));
    }
    if(/\b(more guidance|guide me more)\b/.test(last)){
      const p={...plan,quietCues:false},label='You asked for a little more on-screen context.';
      return answer('I’ll keep a little more context on the screen. You can ask me to make it quieter again.',shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+serializeStatement('phase_cue','Cue',['Your next set stays on screen.'])+'\n'+log(label));
    }
    if(/\b(repeat|again)\b/.test(last))return answer('Repeating this simulated set. The local timer resets.',serializeStatement('timer1','Timer',[`${move(setNow)} · simulated`,timerSeconds('timer1',plan.phaseSeconds)])+'\n'+serializeStatement('phase_cue','Cue',[plan.quietCues?'Steady.':'Repeating the same on-screen sample.']));
  }
  if(index===3){
    const restRemaining=timerSeconds('rest_ring',plan.pauseSeconds);
    if(/^(?:finish(?: now)?|stop|done for now|end session)$/i.test(raw)||/\b(?:i want to stop|i would like to stop|stop now|finish early)\b/i.test(raw))return answer('Of course. Here’s your recap; you can stop here.',recapPatch(plan,progress,adjustmentCount)+`\n${serializeStatement('closing_copy','Text',['You chose to end the simulation. Nothing was physically tracked, and there is no pressure to continue.','description'])}`,'closing');
    if(/\b(more time|longer pause|extend)\b/.test(last)&&!/\bsession\b/.test(last)){
      const event=[...(request.state.client_events??[])].reverse().find(item=>item.startsWith('Simulated timer rest_ring'));
      const remaining=event?.match(/:\s*(?:running|paused|done),\s*(\d+) of \d+ seconds remaining/)?.[1];
      const p={...plan,pauseSeconds:Math.min(90,(remaining===undefined?plan.pauseSeconds:Number(remaining))+20)},label=`You asked for more time → rest is now ${p.pauseSeconds}s.`;
      return answer(`Added 20 seconds to the simulated rest: now ${p.pauseSeconds} seconds.`,shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+restPatch(p,setNow,label)+'\n'+log(label));
    }
    if(/\b(extend (?:the )?session|more session time|add session time)\b/.test(last)){const p={...plan,minutes:Math.min(20,plan.minutes+2)};p.sets=setCountForMinutes(p.minutes);const label=`Session window extended to ${p.minutes} minutes · ${p.sets} sets.`;return answer(`Done. ${label}`,shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+serializeStatement('pause_dots','SetDots',[setNow,p.sets])+'\n'+restPatch(p,setNow,label,restRemaining)+'\n'+log(label));}
    const requestedMinutes=durationFromMessage(raw,plan.minutes);if(requestedMinutes!==undefined&&requestedMinutes!==plan.minutes){const p={...plan,minutes:requestedMinutes,sets:setCountForMinutes(requestedMinutes)},label=`Planned window shortened to ${p.minutes} minutes · ${p.sets} sets.`;const patch=shapePatch(p,label,adjustmentCount+1,Math.min(setNow,p.sets))+'\n'+serializeStatement('pause_dots','SetDots',[Math.min(setNow,p.sets),p.sets])+'\n'+log(label);if(setNow>=p.sets)return answer(`Got it. ${label} That’s enough for today.`,patch+'\n'+recapPatch(p,{...progress,remaining:Math.max(0,p.sets-progress.completed-progress.skipped)},adjustmentCount+1),'closing');return answer(`Got it. ${label}`,patch+'\n'+restPatch(p,Math.min(setNow,p.sets),label,restRemaining));}
    if(/\b(too much|that was hard|harder than expected|more recovery|too intense)\b/.test(last)){
      const p={...plan,phaseSeconds:Math.max(10,plan.phaseSeconds-10),pauseSeconds:Math.min(90,plan.pauseSeconds+10)};
      const upcoming=setNow+1,note=`You said that felt like too much → next set shortened to ${p.phaseSeconds}s with ${p.pauseSeconds}s rest.`;
      const patch=shapePatch(p,note,adjustmentCount+1,setNow)+'\n'+log(note);
      if(upcoming>p.sets)return answer(`Understood. ${note} That’s enough for today.`,patch+'\n'+recapPatch(p,progress,adjustmentCount+1),'closing');
      return answer(`Understood. ${note}`,patch+'\n'+activePatch(p,upcoming,p.phaseSeconds,'A gentler simulated set is ready.',progress)+'\n'+serializeStatement('phase_copy','Text',[`You asked for a gentler next set. ${p.phaseSeconds}s, then ${p.pauseSeconds}s rest.`,'description']),'phase');
    }
    const nextSpace=spaceIn(raw),pace=paceFromMessage(raw,plan.phaseSeconds,plan.pauseSeconds);if(nextSpace||pace){const p={...plan,...pace,space:nextSpace??plan.space},label=nextSpace?`Context updated · ${p.space}.`:`Next set changed to ${p.phaseSeconds}s with ${p.pauseSeconds}s rest.`;return answer(`Done. ${label}`,shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+restPatch(p,setNow,label,restRemaining)+'\n'+log(label));}
    if(/\b(less talking|less talk|quiet|shorter cues|fewer words|stop talking|don't talk)\b/.test(last)){const p={...plan,quietCues:true},label='You asked for fewer words → quiet cues on.';return answer('Got it. Quiet cues for the next set.',shapePatch(p,label,adjustmentCount+1,setNow)+'\n'+restPatch(p,setNow,label,restRemaining)+'\n'+log(label));}
    const effort=last.match(/^effort ([1-5])$/);if(effort){const score=Number(effort[1]),p={...plan};let note=`Effort ${score} · kept the next set at ${p.phaseSeconds}/${p.pauseSeconds}s.`;
      if(score<=2){p.phaseSeconds=Math.max(10,p.phaseSeconds-10);p.pauseSeconds=Math.min(90,p.pauseSeconds+10);note=`Effort ${score} → next set shortened to ${p.phaseSeconds}s with ${p.pauseSeconds}s rest.`;}
      if(score>=4){p.phaseSeconds=Math.min(60,p.phaseSeconds+5);p.pauseSeconds=Math.max(10,p.pauseSeconds-5);note=`Effort ${score} → next set adjusted to ${p.phaseSeconds}s with ${p.pauseSeconds}s rest.`;}
      const upcoming=setNow+1,counts=progress,patch=shapePatch(p,note,adjustmentCount+(score===3?0:1),setNow)+'\n'+log(note);
      if(upcoming>p.sets)return answer(`Thanks. ${note} That’s enough for today.`,patch+'\n'+recapPatch(p,counts,adjustmentCount+(score===3?0:1)),'closing');
      return answer(`Thanks. ${note}`,patch+'\n'+activePatch(p,upcoming,p.phaseSeconds,'The next simulated set is ready.',counts)+'\n'+serializeStatement('phase_copy','Text',[`Your last effort choice shaped this next set. ${p.phaseSeconds}s, then ${p.pauseSeconds}s rest.`,'description']),'phase');
    }
    if(/\b(skip rest|skip the pause|continue|next|go on)\b/.test(last)){const upcoming=setNow+1;if(upcoming>plan.sets)return answer('That’s the last set. Here’s your recap.',recapPatch(plan,progress,adjustmentCount),'closing');return answer(`Rest skipped. Set ${upcoming} is ready.`,activePatch(plan,upcoming,plan.phaseSeconds,'The next simulated set is ready.',progress),'phase');}
    if(/\bwhat'?s next|what is next|what happens next|show next\b/.test(last)){const upcoming=setNow<plan.sets?move(setNow+1):'recap',description=setNow<plan.sets?`Next is ${upcoming}, a ${plan.phaseSeconds}-second simulated sample. Continue when you’re ready.`:'Your next screen is the recap. Continue when you’re ready.';return answer(`Next: ${upcoming}.`,serializeStatement('pause_next','Keyword',[setNow<plan.sets?`Next · ${upcoming}`:'Next · recap',description])+'\n'+serializeStatement('pause_copy','Text',[description,'description']));}
  }
  if(index===4&&/^(not now|no thanks|finish preview|finish)$/i.test(last))return {reply:'Of course. Nothing was saved. Your choices stay in this demo.'};
  return undefined;
}

export function mockTurn(request: RequestData, fixture: string): Turn {
  const directed=directedMockTurn(request,fixture);if(directed)return directed;
  const raw=request.messages.at(-1)?.content.trim() ?? '';
  const last=raw.toLowerCase();
  const fence=(code:string)=>'```openui\n'+code+'\n```';
  if(['load wiring sample','start quiet momentum preview','/demo'].includes(last))return {reply:'Welcome to Quiet Momentum. Tell me what you need in your own words; this local Mock will turn it into a visible session plan. Timers and actions are simulated, nothing leaves this device, and nothing needs to be performed.\n'+fence('root = Screens([])')+'\n'+fence(fixture)};
  if(/\b(what can (?:aira|you) do|what can (?:aira|you) help|how does this work|how can (?:aira|you) help|what can i ask)\b/.test(last))return {reply:productAnswer(raw)};
  let working=request;
  if(!request.state.ui_state){const initial=new ScreenDocument();initial.apply(fence(fixture));working={...request,state:{...request.state,ui_state:initial.echo()}};}
  const doc=new ScreenDocument();if(working.state.ui_state)doc.apply(fence(working.state.ui_state));
  const screens=doc.screens;const index=screens.findIndex(s=>s.key===doc.cursor);
  const root=(cursor:string)=>`root = Screens([${screens.map(s=>s.key).join(', ')}], ${cursor})`;
  const args=(name:string)=>{const line=linesById(doc.program).get(name);return line?callArgsOf(line)?.args.map(arg=>arg?.k==='null'?null:arg?.v)??[]:[];};
  const current=(name:string,fallback='')=>String(args(name)[0]??fallback);
  const intention=(current('plan_goal','Start gently')) as SessionPlan['intention'];
  const minutes=Number.parseInt(current('plan_time','8'),10)||8;
  const interval=Number.parseInt(current('plan_intervals','30 / 30').match(/\d+/)?.[0]??'30',10);
  const pause=Number.parseInt(current('plan_intervals','30 / 30').match(/\d+\D+(\d+)/)?.[1]??'30',10);
  const quiet=current('plan_cue_mode','Short cues').toLowerCase().includes('quiet');
  const plan:SessionPlan={intention,minutes,phaseSeconds:interval,pauseSeconds:pause,quietCues:quiet,space:current('plan_context','Flexible space') as SessionPlan['space'],sets:Number.parseInt(current('plan_sets','3 sets'),10)||3};
  const log=(action:string)=>{
    const prior=current('phase_change1','No adjustments yet.');const priorClose=current('closing_change1','No adjustments yet.');
    return [serializeStatement('phase_change2','ListItem',[prior,'plus']),serializeStatement('phase_change1','ListItem',[action,'plus']),serializeStatement('closing_change2','ListItem',[priorClose,'plus']),serializeStatement('closing_change1','ListItem',[action,'plus'])].join('\n');
  };
  const planPatch=(p:SessionPlan,summary:string)=>[
    serializeStatement('plan_summary','Text',[summary,'description']),
    serializeStatement('plan_goal','Keyword',[p.intention,'What I heard in your request']),
    serializeStatement('plan_time','Keyword',[`${p.minutes} minutes`,'Your planned window · demo timers are shorter']),
    serializeStatement('plan_intervals','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Short on-screen samples · adjustable any time']),
    serializeStatement('plan_cue_mode','Keyword',[p.quietCues?'Quiet cues':'Short cues',p.quietCues?'Aira will keep text cues brief':'Cue style for this session']),
    serializeStatement('phase_cue_mode','Keyword',[p.quietCues?'Quiet cues':'Short cues',p.quietCues?'Aira will keep text cues brief':'Cue style for this session']),
    serializeStatement('timer1','Timer',[`${p.phaseSeconds}s phase · demo`,p.phaseSeconds]),
    serializeStatement('timer2','Timer',[`${p.pauseSeconds}s pause · demo`,p.pauseSeconds]),
    serializeStatement('phase_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your session shape · short local samples']),
    serializeStatement('pause_shape','Keyword',[`${p.phaseSeconds}s phase · ${p.pauseSeconds}s pause`,'Your current session shape']),
    serializeStatement('closing_plan','Keyword',[`${p.intention} · ${p.minutes} min · ${p.phaseSeconds}/${p.pauseSeconds}`, 'The session shape you chose']),
    serializeStatement('closing_adaptation','Keyword',[`${p.phaseSeconds}s phase / ${p.pauseSeconds}s pause`, 'Latest session adjustment']),
  ].join('\n');
  const answer=(text:string,patch:string,cursor?:string):Turn=>({reply:text+'\n'+fence([patch,cursor?root(cursor):''].filter(Boolean).join('\n'))});

  if(index===0 && !['next','continue','back'].includes(last)){
    const p=interpretSessionRequest(raw);
    const summary=p.quietCues
      ?`I heard ${p.intention.toLowerCase()} and ${p.minutes} minutes. I’ve shaped a gentler ${p.phaseSeconds}/${p.pauseSeconds} sample and will keep cues quiet. Change anything before we begin.`
      :`I heard ${p.intention.toLowerCase()} and ${p.minutes} minutes. Here’s a ${p.phaseSeconds}/${p.pauseSeconds} sample with short cues. Change anything before we begin.`;
    const seed=!request.state.ui_state?`\n${fence(fixture)}`:'';
    return {reply:`Got it. ${summary}${seed}\n${fence(planPatch(p,summary)+'\n'+serializeStatement('ready_cue','Cue',[`I turned your request into a plan. Does this feel right, or should I change it?`])+'\n'+root('ready'))}`};
  }

  if(index===1 && /^(make it gentler|make it easier|less at once|keep cues quiet|shorter cues|start this session|start|begin|let'?s go|next|continue)$/i.test(raw)){
    if(/^(start this session|start|begin|let'?s go|next|continue)$/i.test(raw))return answer('Starting the local session. You can type a change at any time; I’ll update the screen with you.','', 'phase');
    const p={...plan};const quietRequest=/quiet|shorter cues/i.test(raw);
    if(quietRequest)p.quietCues=true;else{p.phaseSeconds=20;p.pauseSeconds=40;}
    const note=quietRequest?'Quiet cues on · I’ll keep the words brief.':'Gentler sample · 20s phase / 40s pause.';
    return answer(`Done. ${note} Here’s the updated plan.`,planPatch(p,note)+'\n'+serializeStatement('ready_cue','Cue',[note+' You can change it again before we start.'])+'\n'+log(quietRequest?'Cue style set to quiet for this session.':'Plan adjusted to a shorter phase and longer pause.'));
  }

  if(index===2){
    const pace=paceFromMessage(raw,plan.phaseSeconds,plan.pauseSeconds);
    if(pace){const p={...plan,...pace};const changed=p.phaseSeconds!==plan.phaseSeconds||p.pauseSeconds!==plan.pauseSeconds;const note=`${p.phaseSeconds}s phase / ${p.pauseSeconds}s pause${changed?' · changed from your words':' · kept at your request'}`;
      const intent=/\b(too much|easier|gentler|less at once)\b/.test(last)?`Too much → phase ${plan.phaseSeconds}s → ${p.phaseSeconds}s; pause ${plan.pauseSeconds}s → ${p.pauseSeconds}s.`:/\b(more momentum|harder|push a little|more energy)\b/.test(last)?`More momentum → phase ${plan.phaseSeconds}s → ${p.phaseSeconds}s; pause ${plan.pauseSeconds}s → ${p.pauseSeconds}s.`:`Kept the ${p.phaseSeconds}s / ${p.pauseSeconds}s pace you asked for.`;
      const timerNote=changed?'The timer reset to the new duration. Start again whenever you’re ready.':'You’re already at this pace; I’ve left the timer as it is.';
      return answer(`Got it. ${intent} The session card now matches.`,planPatch(p,intent)+'\n'+serializeStatement('phase_title','Text',[p.phaseSeconds<30?'A little more room':p.phaseSeconds>30?'More momentum':'Steady pace','title'])+'\n'+serializeStatement('phase_copy','Text',[`${note}. ${timerNote}`,'description'])+'\n'+serializeStatement('phase_cue','Cue',[p.quietCues?'Steady.':intent])+'\n'+log(intent));
    }
    if(/\b(less talking|less talk|quiet|shorter cues|fewer words|stop talking|don't talk)\b/.test(last)){
      return answer('Got it. I’ll keep the cues short from here.',serializeStatement('plan_cue_mode','Keyword',['Quiet cues','I’ll keep text cues brief'])+'\n'+serializeStatement('phase_cue_mode','Keyword',['Quiet cues','I’ll keep text cues brief'])+'\n'+serializeStatement('phase_cue','Cue',['Steady.'])+'\n'+serializeStatement('pause_cue','Cue',['Take the time you need.'])+'\n'+serializeStatement('closing_adaptation','Keyword',['Quiet cues for this session','Changed when you asked'])+'\n'+log('You asked for fewer words → Aira switched to quiet cues.'));
    }
    if(/\b(more guidance|guide me more|a little more guidance)\b/.test(last))return answer('I’ll keep a little more context on the screen. You can ask me to make it quieter again.',serializeStatement('plan_cue_mode','Keyword',['Guided text cues','A little more context on screen'])+'\n'+serializeStatement('phase_cue_mode','Keyword',['Guided text cues','A little more context on screen'])+'\n'+serializeStatement('phase_cue','Cue',['Your next step stays on screen.'])+'\n'+serializeStatement('closing_adaptation','Keyword',['Guided text cues for this session','Changed when you asked'])+'\n'+log('You asked for more guidance → added brief on-screen context.'));
    if(/\b(skip|next phase|what's next|what is next)\b/.test(last))return answer('Skipping the current timer. I’ve moved the next phase onto the screen.',log('You asked to skip → moved to the pause phase.'),'pause');
    if(/\b(finish|stop|done for now|i'm done|end session)\b/.test(last))return answer('We can stop here. Your place is yours; there’s no need to finish the demo.',serializeStatement('closing_copy','Text',['You chose to end the simulation. Aira stopped when you asked; there is no pressure to continue.','description'])+'\n'+log('You chose to finish early.'),'closing');
    if(/\b(repeat|again)\b/.test(last))return answer('Repeating the current on-screen phase. The local timer is reset.',serializeStatement('phase_cue','Cue',[quiet?'Steady.':'Here is that phase again, on screen.']));
  }

  if(index===3){
    if(/\b(less talking|less talk|quiet|shorter cues|fewer words|stop talking|don't talk)\b/.test(last))return answer('Got it. I’ll keep the cues short from here.',serializeStatement('plan_cue_mode','Keyword',['Quiet cues','I’ll keep text cues brief'])+'\n'+serializeStatement('phase_cue_mode','Keyword',['Quiet cues','I’ll keep text cues brief'])+'\n'+serializeStatement('pause_cue','Cue',['Take the time you need.'])+'\n'+serializeStatement('closing_adaptation','Keyword',['Quiet cues for this session','Changed when you asked'])+'\n'+log('You asked for fewer words → Aira switched to quiet cues.'));
    if(/\b(more time|longer pause|extend)\b/.test(last)){const seconds=Math.min(90,pause+20);const p={...plan,pauseSeconds:seconds};return answer(`Added 20 seconds to the on-screen pause: now ${seconds} seconds.`,planPatch(p,`Pause extended to ${seconds} seconds at your request.`)+'\n'+serializeStatement('pause_title','Text',['A longer pause, as you asked','title'])+'\n'+serializeStatement('closing_adaptation','Keyword',[`Pause extended to ${seconds}s`,'Changed when you asked'])+'\n'+log(`You asked for more time → pause extended to ${seconds}s.`));}
    if(/\b(extend the session|more session time|add time)\b/.test(last)){const p={...plan,minutes:Math.min(20,plan.minutes+2)};return answer(`Added two minutes to the planned window: ${p.minutes} minutes.`,planPatch(p,`Session window extended to ${p.minutes} minutes at your request.`)+'\n'+log(`You asked to extend the session → ${p.minutes} minutes planned.`));}
    if(/\b(skip|next|finish|stop|done|end session)\b/.test(last))return answer('That’s the last sample. We can finish here, or you can leave at any time.','', 'closing');
  }

  if(index===4 && /^(not now|no thanks|finish preview|finish)$/i.test(last))return {reply:'Of course. Nothing was saved. Your choices stay in this demo.'};
  if(/\b(pause|hold on)\b/.test(last))return {reply:'Paused the local timer. Take your time; type “resume” whenever you want to continue.'};
  if(/\b(resume|continue|go on)\b/.test(last))return {reply:'Resumed the local timer. You can interrupt again whenever you want.'};
  if(/\b(stop|done for now|finish now)\b/.test(last))return answer('We can stop here. Your place is yours; there’s no need to finish the demo.',serializeStatement('closing_copy','Text',['You chose to end the simulation. Aira stopped when you asked; there is no pressure to continue.','description']),'closing');
  if(['next','continue','back','skip this screen','skip ahead'].includes(last) && screens.length){const back=last==='back';const target=screens[Math.max(0,Math.min(screens.length-1,index+(back?-1:1)))];return {reply:`${back?'Going back':'Moving ahead'} · you’re on ${index+1} of ${screens.length}. You can change pace any time.\n`+fence(root(target.key))};}
  return {reply:'You can change the plan in your own words. During a phase try “too much”, “more momentum”, “less talking”, “pause”, “repeat”, “skip this”, or “finish now”. Each choice changes the local session screen; nothing is sent elsewhere.'};
}
