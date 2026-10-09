import { el, button } from './dom.js';
import type { StatementNode } from '../shared/openui/openui-model.js';
import type { TimerLedger } from '../shared/openui/timer-store.js';
export type Context = { send: (text:string)=>void; timers: TimerLedger; timerAction: (id:string, action:'start'|'pause'|'reset'|'finish')=>void; updates: (()=>void)[]; paused: boolean };
// Trusted DOM ports of the source component signatures; no model-generated code.
export const renderers: Record<string,(node:StatementNode,context:Context)=>HTMLElement> = {
  Text: ({props:p}) => el(p.variant==='title'?'h3':p.variant==='subtitle'?'h4':'p',String(p.text),'block block-'+String(p.variant??'body')),
  Cue: ({props:p}) => el('p',String(p.text),'session-cue'),
  Keyword: ({props:p}) => {const n=el('div','','keyword');n.append(el('strong',String(p.text)));if(p.caption)n.append(el('p',String(p.caption)));return n;},
  Alert: ({props:p}) => el('aside',String(p.text),'block alert'),
  List: ({props:p},c) => {const n=el('ul','','block');for(const row of p.items as StatementNode[])n.append(renderComponent(row,c));return n;},
  ListItem: ({props:p}) => el('li',String(p.text)),
  FollowUps: ({props:p},c) => {const n=el('div','','row');for(const text of p.prompts as string[])n.append(button(text,()=>c.send(text)));return n;},
  Timer: ({key,props:p},c) => {
    const n=el('section','','timer active-timer');n.setAttribute('aria-label',String(p.label));
    n.append(el('p','SIMULATED · LOCAL ONLY','eyebrow'),el('h3',String(p.label)));
    const value=el('strong','','timer-value'),status=el('span','','micro timer-status'),row=el('div','','timer-controls');
    const start=button('Start',()=>c.timerAction(key,'start')),pause=button('Pause',()=>c.timerAction(key,'pause')),reset=button('Reset',()=>c.timerAction(key,'reset'));
    row.append(start,pause,reset);n.append(value,status,row);
    const update=()=>{const entry=c.timers.list().find(t=>t.id===key);if(!entry)return;const seconds=Math.ceil(entry.remaining);value.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;status.textContent=entry.status==='done'?'Sample complete · continue when ready':entry.status==='running'?'On screen · simulated':entry.status;start.hidden=entry.status==='running';start.textContent=entry.status==='done'?'Restart':'Start';pause.hidden=entry.status==='stopped'||entry.status==='done';pause.textContent=entry.status==='paused'?'Resume':'Pause';for(const b of [start,pause,reset])b.disabled=c.paused;};
    if(!c.paused&&c.timers.list().find(t=>t.id===key)?.status==='stopped')c.timerAction(key,'start');
    c.updates.push(update);update();return n;
  },
  SetDots: ({props:p},c) => {
    const current=Number(p.current),total=Number(p.total),n=el('nav','','set-dots');n.setAttribute('aria-label',`Set ${current} of ${total}`);
    for(let i=1;i<=total;i++){const dot=button('',()=>c.send(`show set ${i}`));dot.className='set-dot'+(i<current?' complete':i===current?' current':'');dot.setAttribute('aria-label',`Show set ${i} of ${total}`);dot.title=`Set ${i} of ${total}`;dot.disabled=c.paused||i===current||i>current;n.append(dot);}
    return n;
  },
  EffortPicker: ({props:p},c) => {
    const selected=Number(p.selected),n=el('section','','effort-picker');n.append(el('p','How did that feel?','effort-question'));
    const row=el('div','','effort-options');for(let i=1;i<=5;i++){const choice=button(String(i),()=>c.send(`effort ${i}`));choice.setAttribute('aria-label',`Effort ${i}`);choice.setAttribute('aria-pressed',String(selected===i));choice.disabled=c.paused;row.append(choice);}
    n.append(row,el('p','1 · lighter    3 · steady    5 · more','micro effort-scale'));return n;
  },
  RestRing: ({key,props:p},c) => {
    const n=el('section','','rest-ring');n.setAttribute('aria-label',String(p.label));
    const ring=el('div','','rest-ring-shape'),value=el('strong','','rest-ring-value'),status=el('span','','micro timer-status');ring.append(value);n.append(ring,el('p',String(p.label),'rest-ring-label'),status);
    const controls=el('div','','timer-controls rest-controls');const start=button('Start pause',()=>c.timerAction(key,'start')),pause=button('Pause',()=>c.timerAction(key,'pause')),reset=button('Reset',()=>c.timerAction(key,'reset'));controls.append(start,pause,reset);n.append(controls);
    const update=()=>{const entry=c.timers.list().find(t=>t.id===key);if(!entry)return;const seconds=Math.ceil(entry.remaining);value.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;status.textContent=entry.status==='done'?'Pause sample complete · continue when ready':entry.status==='running'?'A quiet moment · simulated':entry.status;start.hidden=entry.status==='running';pause.hidden=entry.status==='stopped'||entry.status==='done';pause.textContent=entry.status==='paused'?'Resume':'Pause';for(const b of [start,pause,reset])b.disabled=c.paused;};
    if(!c.paused&&c.timers.list().find(t=>t.id===key)?.status==='stopped')c.timerAction(key,'start');
    c.updates.push(update);update();return n;
  },
};
export function renderComponent(node:StatementNode,context:Context):HTMLElement {
  if(!Object.hasOwn(renderers,node.name))throw new Error('No renderer for '+node.name);
  const n=renderers[node.name](node,context);n.dataset.statement=node.key;
  if(typeof node.props.color==='string' && /^#[0-9a-fA-F]{6}$/.test(node.props.color))n.style.color=node.props.color;
  return n;
}
