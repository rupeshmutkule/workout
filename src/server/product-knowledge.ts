export const productKnowledge = `This local assignment prototype demonstrates AiRA-inspired natural-language interaction. It can interpret a request, adapt the fictional session duration, space context, set count, pace, rest and cue style, respond to interruptions, and remember a setup only after explicit consent in the current browser tab. Effort choices refer only to the fictional sample and are not activity or health measurements. This prototype does not represent or make unsupported claims about the production AiRA product, does not provide exercise or health guidance, and does not track physical activity.`;

export function productAnswer(question:string):string{
  const text=question.toLowerCase();
  if(/\b(weather|forecast|temperature)\b/.test(text))return 'I can’t check weather in this preview. I can help shape the Quiet Momentum simulation whenever you’re ready.';
  if(/\b(code|python|javascript|programming|write (?:me )?(?:some )?code|explain (?:javascript|js))\b/.test(text))return 'I can’t explain or run code in this preview. I can help shape the Quiet Momentum simulation whenever you’re ready.';
  if(/remember|memory|preference/.test(text))return 'I can save this session setup in the current browser tab if you choose Remember. You can forget it at any time; it is not permanent memory.';
  if(/aira|what can|what do|how does|how can|product|website|change my session/.test(text))return 'I can understand what you need, including your time and space, shape a fictional session, and change its next set when you interrupt or choose how the last sample felt. If you choose, I can remember the setup in this tab. This prototype does not track activity or give exercise advice.';
  return 'I can adapt this session and its on-screen pacing when you ask. Try “I’m in a small room”, “make the next part shorter”, “how did that feel?”, or “what can you do?”';
}
