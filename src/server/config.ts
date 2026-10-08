import { CODEX_BLOCKER, type CliConfig } from './cli.js';
import type { ProviderStatus } from '../shared/contracts.js';

export type Config = {
  root: string; key: string; model: string; allowLive: boolean; claude: CliConfig;
  gemini: { key: string; model: string };
  whatsapp: { authKey: string; integratedNumber: string; templateName: string; templateNamespace: string; templateApproved: boolean; publicSessionUrl: string };
};
function model(value: string | undefined, fallback: string, name: string) {
  const result = value || fallback;
  if (result && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(result)) throw new Error(`${name} must be an exact model ID or supported alias without flags or whitespace.`);
  return result;
}
export function readConfig(env: NodeJS.ProcessEnv, root: string): Config {
  if (env.APP_MODE && !['mock', 'live'].includes(env.APP_MODE)) throw new Error('Legacy APP_MODE must be mock or live; select the provider in the browser.');
  if (env.APP_MODE === 'live' && (env.ALLOW_LIVE_API !== 'true' || !env.OPENAI_API_KEY)) throw new Error('Live mode requires ALLOW_LIVE_API=true and OPENAI_API_KEY in your local environment.');
  const allowLive = env.ALLOW_LIVE_API === 'true';
  const publicSessionUrl = env.PUBLIC_SESSION_URL ?? '';
  if (publicSessionUrl && !/^https:\/\//i.test(publicSessionUrl)) throw new Error('PUBLIC_SESSION_URL must use HTTPS.');
  const integratedNumber = (env.MSG91_INTEGRATED_NUMBER ?? '').replace(/\D/g, '');
  if (integratedNumber && !/^\d{8,15}$/.test(integratedNumber)) throw new Error('MSG91_INTEGRATED_NUMBER must contain 8 to 15 digits with its country code.');
  return { root, key: allowLive ? (env.OPENAI_API_KEY ?? '') : '', model: model(env.OPENAI_MODEL, 'gpt-6-luna', 'OPENAI_MODEL'), allowLive,
    claude: { enabled: env.ALLOW_CLAUDE_CLI === 'true', profileAcknowledged: env.CLI_PROFILE_ACKNOWLEDGED === 'true', binary: env.CLAUDE_CLI_PATH ?? '', model: model(env.CLAUDE_MODEL, '', 'CLAUDE_MODEL'), timeoutMs: 45_000 },
    gemini: { key: env.GEMINI_API_KEY ?? '', model: model(env.GEMINI_MODEL, 'gemini-3.8-flash', 'GEMINI_MODEL') },
    whatsapp: { authKey: env.MSG91_AUTHKEY ?? '', integratedNumber, templateName: env.MSG91_TEMPLATE_NAME || 'aira_workout_reminder', templateNamespace: env.MSG91_TEMPLATE_NAMESPACE ?? '', templateApproved: env.MSG91_TEMPLATE_APPROVED === 'true', publicSessionUrl } };
}
export function providerStatuses(config: Config): ProviderStatus[] {
  const api = config.allowLive && Boolean(config.key);
  const cli = config.claude.enabled && config.claude.profileAcknowledged && Boolean(config.claude.binary);
  return [
    { id: 'mock', label: 'Mock', enabled: true, model: 'quiet-momentum-preview-v1', message: 'Guided local preview. No model calls or account setup.' },
    { id: 'gemini-api', label: 'Gemini', enabled: Boolean(config.gemini.key), model: config.gemini.model, message: config.gemini.key ? 'Gemini runs on the local backend when you send, after you opt in.' : 'Set GEMINI_API_KEY in local .env, then restart. This key stays on the backend.' },
    { id: 'openai-api', label: 'OpenAIAPI', enabled: api, model: config.model, message: api ? 'Uses your API budget when you send. Messages and skill are sent to OpenAI.' : 'Set ALLOW_LIVE_API=true and OPENAI_API_KEY in local .env, then restart. See README.' },
    { id: 'claude-cli', label: 'ClaudeCLI', enabled: cli, model: config.claude.model || 'claude-cli-default (unresolved)', message: cli ? 'Uses your Claude-plan login when you send. Restricted tool profile; managed host hooks may still run. CLI support/login are checked before each request.' : 'Set ALLOW_CLAUDE_CLI, CLAUDE_CLI_PATH and CLI_PROFILE_ACKNOWLEDGED in local .env. See docs/RUNTIMES.md.' },
    { id: 'codex-cli', label: 'CodexCLI', enabled: false, model: 'unresolved · execution blocked', message: CODEX_BLOCKER },
  ];
}

export function integrationStatuses(config: Config) {
  const whatsappEnabled = Boolean(config.whatsapp.authKey && config.whatsapp.integratedNumber && config.whatsapp.templateApproved);
  return {
    whatsappEnabled,
    whatsappMessage: whatsappEnabled
      ? `Ready to schedule ${config.whatsapp.templateName}. Scheduled reminders need this local server to stay running.`
      : 'WhatsApp reminders need MSG91 credentials and a template confirmed approved in MSG91. No message will be sent until this is enabled.',
  };
}
