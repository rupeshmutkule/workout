export type SessionPlan = {
  intention: 'Clear my head' | 'Wake me up' | 'Start gently';
  minutes: number;
  phaseSeconds: number;
  pauseSeconds: number;
  quietCues: boolean;
};

/** Small deterministic intent adapter for the local Mock, not a live model. */
export function interpretSessionRequest(input: string): SessionPlan {
  const message=input.trim().toLowerCase();
  const intention:SessionPlan['intention']=/\b(wake|energy|energ|momentum|upbeat)\b/.test(message)?'Wake me up':
    /\b(focus|clear|think|head)\b/.test(message)?'Clear my head':'Start gently';
  const match=message.match(/\b(\d{1,2})\s*(?:m|min|mins|minute|minutes)\b/);
  const minutes=match?Math.max(3,Math.min(20,Number(match[1]))):8;
  const gentle=/\b(tired|gentle|easy|easier|light|too much|overwhelmed|low energy|less)\b/.test(message);
  const momentum=/\b(push|harder|more momentum|more energy)\b/.test(message);
  const phaseSeconds=gentle?20:momentum?40:30;
  const pauseSeconds=gentle?40:momentum?20:30;
  const quietCues=/\b(quiet|less talk|less talking|fewer words|shorter cues|don't talk|do not talk)\b/.test(message);
  return {intention,minutes,phaseSeconds,pauseSeconds,quietCues};
}

export function paceFromMessage(input:string,currentPhase=30,currentPause=30):Pick<SessionPlan,'phaseSeconds'|'pauseSeconds'>|undefined {
  const message=input.trim().toLowerCase();
  if(/\b(too much|make it easier|make this easier|gentler|easier|less at once|a little less)\b/.test(message))return {phaseSeconds:Math.max(10,currentPhase-10),pauseSeconds:Math.min(90,currentPause+10)};
  if(/\b(more momentum|make it harder|more energy|push a little)\b/.test(message))return {phaseSeconds:Math.min(60,currentPhase+10),pauseSeconds:Math.max(10,currentPause-10)};
  if(/\b(keep this pace|just right|same pace|steady)\b/.test(message))return {phaseSeconds:currentPhase,pauseSeconds:currentPause};
  return undefined;
}
