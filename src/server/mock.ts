import { serializeStatement } from '../shared/openui/serialize.js';
import { callArgsOf, linesById } from '../shared/openui/parse-document.js';
import type { RequestData, Turn } from '../shared/contracts.js';
import { ScreenDocument } from '../shared/openui/document.js';
import { interpretSessionRequest, paceFromMessage, type SessionPlan } from './session-intent.js';

export function mockTurn(request: RequestData, fixture: string): Turn {
  const raw=request.messages.at(-1)?.content.trim() ?? '';
  const last=raw.toLowerCase();
  const fence=(code:string)=>'```openui\n'+code+'\n```';
  if(['load wiring sample','start quiet momentum preview','/demo'].includes(last))return {reply:'Welcome to Quiet Momentum. Tell me what you need in your own words; this local Mock will turn it into a visible session plan. Timers and actions are simulated, nothing leaves this device, and nothing needs to be performed.\n'+fence('root = Screens([])')+'\n'+fence(fixture)};

  const doc=new ScreenDocument();if(request.state.ui_state)doc.apply(fence(request.state.ui_state));
  const screens=doc.screens;const index=screens.findIndex(s=>s.key===doc.cursor);
  const root=(cursor:string)=>`root = Screens([${screens.map(s=>s.key).join(', ')}], ${cursor})`;
  const args=(name:string)=>{const line=linesById(doc.program).get(name);return line?callArgsOf(line)?.args.map(arg=>arg?.k==='null'?null:arg?.v)??[]:[];};
  const current=(name:string,fallback='')=>String(args(name)[0]??fallback);
  const intention=(current('plan_goal','Start gently')) as SessionPlan['intention'];
  const minutes=Number.parseInt(current('plan_time','8'),10)||8;
  const interval=Number.parseInt(current('plan_intervals','30 / 30').match(/\d+/)?.[0]??'30',10);
  const pause=Number.parseInt(current('plan_intervals','30 / 30').match(/\d+\D+(\d+)/)?.[1]??'30',10);
  const quiet=current('plan_cue_mode','Short cues').toLowerCase().includes('quiet');
  const plan:SessionPlan={intention,minutes,phaseSeconds:interval,pauseSeconds:pause,quietCues:quiet};
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
    return answer('Got it. '+summary,planPatch(p,summary)+'\n'+serializeStatement('ready_cue','Cue',[`I turned your request into a plan. Does this feel right, or should I change it?`]),'ready');
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
    if(/\b(skip|next phase|what's next|what is next)\b/.test(last))return answer('Skipping the current timer. I’ve moved the next phase onto the screen.',log('You asked to skip → moved to the pause phase.'),'pause');
    if(/\b(finish|stop|done for now|i'm done|end session)\b/.test(last))return answer('We can stop here. Your place is yours; there’s no need to finish the demo.',serializeStatement('closing_copy','Text',['You chose to end the simulation. Aira stopped when you asked; there is no pressure to continue.','description'])+'\n'+log('You chose to finish early.'),'closing');
    if(/\b(repeat|again)\b/.test(last))return answer('Repeating the current on-screen phase. The local timer is reset.',serializeStatement('phase_cue','Cue',[quiet?'Steady.':'Here is that phase again, on screen.']));
  }

  if(index===3){
    if(/\b(less talking|less talk|quiet|shorter cues|fewer words|stop talking|don't talk)\b/.test(last))return answer('Got it. I’ll keep the cues short from here.',serializeStatement('plan_cue_mode','Keyword',['Quiet cues','I’ll keep text cues brief'])+'\n'+serializeStatement('phase_cue_mode','Keyword',['Quiet cues','I’ll keep text cues brief'])+'\n'+serializeStatement('pause_cue','Cue',['Take the time you need.'])+'\n'+serializeStatement('closing_adaptation','Keyword',['Quiet cues for this session','Changed when you asked'])+'\n'+log('You asked for fewer words → Aira switched to quiet cues.'));
    if(/\b(more time|longer pause|extend)\b/.test(last)){const seconds=Math.min(90,pause+20);const p={...plan,pauseSeconds:seconds};return answer(`Added 20 seconds to the on-screen pause: now ${seconds} seconds.`,planPatch(p,`Pause extended to ${seconds} seconds at your request.`)+'\n'+serializeStatement('pause_title','Text',['A longer pause, as you asked','title'])+'\n'+serializeStatement('closing_adaptation','Keyword',[`Pause extended to ${seconds}s`,'Changed when you asked'])+'\n'+log(`You asked for more time → pause extended to ${seconds}s.`));}
    if(/\b(skip|next|finish|stop|done|end session)\b/.test(last))return answer('That’s the last sample. We can finish here, or you can leave at any time.','', 'closing');
  }

  if(index===4 && /^(not now|no thanks|finish preview|finish)$/i.test(last))return {reply:'Of course. Nothing was saved. Your choices stay in this demo.'};
  if(/\b(pause|hold on)\b/.test(last))return {reply:'Paused the local timer. Take your time; type “resume” whenever you want to continue.'};
  if(/\b(resume|continue|go on)\b/.test(last))return {reply:'Resumed the local timer. You can interrupt again whenever you want.'};
  if(/\b(stop|done for now|finish now)\b/.test(last))return answer('We can stop here. Your place is yours; there’s no need to finish the demo.',serializeStatement('closing_copy','Text',['You chose to end the simulation. Aira stopped when you asked; there is no pressure to continue.','description']),'closing');
  if(['next','continue','back','skip this screen','skip ahead'].includes(last) && screens.length){const back=last==='back';const target=screens[Math.max(0,Math.min(screens.length-1,index+(back?-1:1)))];return {reply:`${back?'Going back':'Moving ahead'} · you’re on ${index+1} of ${screens.length}. You can change pace any time.\n`+fence(root(target.key))};}
  return {reply:'You can change the plan in your own words. During a phase try “too much”, “more momentum”, “less talking”, “pause”, “repeat”, “skip this”, or “finish now”. Each choice changes the local session screen; nothing is sent elsewhere.'};
}
