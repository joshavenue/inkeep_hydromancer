import './embed.js';

const response = await fetch('/config.json', { cache: 'no-store' });
if (!response.ok) throw new Error('The temporary preview is not ready. Please reload shortly.');
const config = await response.json();
window.Inkeep.ChatButton({
  baseSettings: { shouldBypassCaptcha: true },
  aiChatSettings: {
    appId: config.appId,
    baseUrl: window.location.origin,
  },
});
