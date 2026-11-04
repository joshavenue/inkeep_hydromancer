import './embed.js';

const response = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' });
if (!response.ok) throw new Error('The assistant is not ready. Please reload shortly.');
const config = await response.json();
window.Inkeep.ChatButton({
  baseSettings: { shouldBypassCaptcha: true, primaryBrandColor: '#1e3a5f' },
  aiChatSettings: {
    appId: config.appId,
    baseUrl: window.location.origin + '/api',
    aiAssistantName: 'Hydromancer assistant',
    introMessage: 'Ask about the Hydromancer API, Reservoir or the Hyperliquid API. Answers cite the public docs and hydromancer.xyz only.',
    exampleQuestions: [
      'Is Hydromancer a fit for a copy trading bot?',
      'What data does Reservoir contain?',
      'How is Hydromancer different from the Hyperliquid API?',
      'What does the Starter plan include?',
    ],
  },
});
