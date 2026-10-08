import { list, obj, str, valid } from './schema.js';
export const APP_VERSION = '2.0.0';
export const SCHEMA_VERSION = '3';
export const providers = ['mock', 'gemini-api', 'openai-api', 'claude-cli', 'codex-cli'] as const;
export type Provider = typeof providers[number];
export type ProviderStatus = { id: Provider; label: string; enabled: boolean; model: string; message: string };
export const intents = ['START_SESSION','PAUSE','RESUME','SKIP','END_SESSION','MAKE_EASIER','MAKE_HARDER','SHORTEN_SESSION','EXTEND_SESSION','MORE_RECOVERY','QUIETER','MORE_GUIDANCE','SHOW_NEXT','REPEAT','SAVE_PREFERENCE','SET_REMINDER','EXPLAIN_PRODUCT'] as const;
export type Intent = typeof intents[number];
export type AiraAction = { type: Intent; reminderAt: string; sessionType: string };
export type Turn = { reply: string; intent?: Intent; action?: AiraAction; duration?: number; intensity?: 'low'|'medium'|'high'; cueMode?: 'quiet'|'brief'|'guided'; workSeconds?: number; recoverySeconds?: number };
export type GeminiDecision = {
  intent: Intent; goal: 'clear_head'|'energize'|'move'|'push'|'reset'; duration: number;
  intensity: 'low'|'medium'|'high'; cueMode: 'quiet'|'brief'|'guided'; workSeconds: number;
  recoverySeconds: number; response: string; action: AiraAction;
};
export const turnSchema = obj({ reply: str(24000) });
export function isTurn(value: unknown): value is Turn { return valid(turnSchema, value); }
export type ScreenEcho = { ui_state: string; client_events: string[] };
export type Message = { role: 'user' | 'assistant'; content: string };
export type RequestData = { messages: Message[]; state: ScreenEcho; fault: 'none' | 'schema' | 'request' | 'slow'; provider: Provider; consent: boolean };
export const requestSchema = obj({
  provider: { type: 'string', enum: [...providers] }, consent: { type: 'boolean' },
  messages: list({ anyOf: [obj({ role: { type: 'string', enum: ['user'] }, content: str(2000) }), obj({ role: { type: 'string', enum: ['assistant'] }, content: str(24000) })] }, 60),
  state: obj({ ui_state: { type: 'string', maxLength: 40000 }, client_events: list(str(1000), 120) }),
  fault: { type: 'string', enum: ['none', 'schema', 'request', 'slow'] },
});
export function isRequest(value: unknown): value is RequestData { return valid(requestSchema, value) && (value as RequestData).messages.at(-1)?.role === 'user'; }
export type Versions = { app: string; schema: string; skillHash: string; protocolHash: string; mode: 'mock' | 'live'; provider: Provider; model: string; returnedModel: string | null; runtimeVersion: string | null; restrictionProfile: string | null };
export type Result = { turn: Turn; decision?: GeminiDecision; versions: Versions };
