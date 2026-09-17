import './embed.js';

const response = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' });
if (!response.ok) throw new Error('The temporary preview is not ready. Please reload shortly.');
const config = await response.json();
window.Inkeep.ChatButton({
  baseSettings: { shouldBypassCaptcha: true, primaryBrandColor: '#1e3a5f' },
  aiChatSettings: {
    appId: config.appId,
    baseUrl: window.location.origin + '/api',
  },
});
