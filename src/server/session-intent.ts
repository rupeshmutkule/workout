export type SessionPlan = {
  intention: 'Clear my head' | 'Wake me up' | 'Start gently';
  minutes: number;
  phaseSeconds: number;
  pauseSeconds: number;
  quietCues: boolean;
  space: 'Tight space' | 'Open room' | 'Flexible space';
  sets: number;
};

export function setCountForMinutes(minutes: number): number {
  return Math.max(2, Math.min(6, Math.ceil(minutes / 3)));
}
export function durationFromMessage(input:string,currentMinutes=8):number|undefined {
  const message=input.trim().toLowerCase(),match=message.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(?:m|min|mins|minute|minutes)\b/);
  if(match){const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twelve:12,fifteen:15,twenty:20};const value=Number(match[1])||words[match[1]];return Math.max(3,Math.min(20,value));}
  if(/\b(short on time|not much time|quick session|just a few minutes)\b/.test(message))return Math.min(currentMinutes,5);
  if(/\b(shorten (?:the )?session|make (?:the )?session shorter|cut (?:the )?session short)\b/.test(message))return Math.max(3,currentMinutes-2);
  return undefined;
}

/** Small deterministic intent adapter for the local Mock, not a live model. */
export function interpretSessionRequest(input: string): SessionPlan {
  const message=input.trim().toLowerCase();
  const intention:SessionPlan['intention']=/\b(wake|energ\w*|momentum|upbeat)\b/.test(message)?'Wake me up':
    /\b(focus|clear|think|head)\b/.test(message)?'Clear my head':'Start gently';
  const minutes=durationFromMessage(input,8)??8;
  const beginner=/\b(beginner|beginning|never tried|first time|new to this|not done this before|keep it simple)\b/.test(message);
  const gentle=beginner||/\b(tired|gentle|easy|easier|light|too much|overwhelmed|low energy|less)\b/.test(message);
  const momentum=/\b(push|harder|more momentum|more energy|more energizing|more energising|challenging|exciting|lively|upbeat)\b/.test(message);
  const phaseSeconds=gentle?20:momentum?40:30;
  const pauseSeconds=gentle?40:momentum?20:30;
  const quietCues=gentle||/\b(quiet|less talk|less talking|fewer words|shorter cues|don't talk|do not talk)\b/.test(message);
  const space: SessionPlan['space']=/\b(tiny|small|tight|cramped|little) (?:room|space)\b|\bin a small room\b/.test(message)?'Tight space':
    /\b(open room|open space|plenty of (?:room|space)|lots of (?:room|space)|spacious)\b/.test(message)?'Open room':'Flexible space';
  return {intention,minutes,phaseSeconds,pauseSeconds,quietCues:quietCues||beginner,space,sets:setCountForMinutes(minutes)};
}

export function paceFromMessage(input:string,currentPhase=30,currentPause=30):Pick<SessionPlan,'phaseSeconds'|'pauseSeconds'>|undefined {
  const message=input.trim().toLowerCase();
  if(/\b(more recovery|longer recovery|give me more recovery)\b/.test(message))return {phaseSeconds:currentPhase,pauseSeconds:Math.min(90,currentPause+10)};
  if(/\b(shorten|shorter next|shorter phase|shorter part|shorter interval|next part shorter|make the next (?:part|phase|interval) shorter|less time)\b/.test(message))return {phaseSeconds:Math.max(10,currentPhase-10),pauseSeconds:Math.min(90,currentPause+10)};
  if(/\b(too much|make it easier|make this easier|gentle|gentler|easy|easier|light|less at once|a little less|tired|low energy)\b/.test(message))return {phaseSeconds:Math.max(10,currentPhase-10),pauseSeconds:Math.min(90,currentPause+10)};
  if(/\b(more momentum|make it harder|more energy|more energizing|more energising|push a little|something more challenging|more exciting|make it exciting|lively|upbeat)\b/.test(message))return {phaseSeconds:Math.min(60,currentPhase+10),pauseSeconds:Math.max(10,currentPause-10)};
  if(/\b(keep this pace|just right|same pace|steady)\b/.test(message))return {phaseSeconds:currentPhase,pauseSeconds:currentPause};
  return undefined;
}
