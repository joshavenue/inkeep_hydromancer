import './embed.js';

const response = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' });
if (!response.ok) throw new Error('The assistant is not ready. Please reload shortly.');
const config = await response.json();
const BASE_URL = window.location.origin + '/api';
window.Inkeep.ChatButton({
  baseSettings: { shouldBypassCaptcha: true, primaryBrandColor: '#1e3a5f' },
  aiChatSettings: {
    appId: config.appId,
    baseUrl: BASE_URL,
    aiAssistantName: 'Hydromancer assistant',
    chatSubjectName: 'Hydromancer',
    placeholder: 'Ask about the Hydromancer API, Reservoir or the Hyperliquid API',
    introMessage: 'Ask about the Hydromancer API, Reservoir or the Hyperliquid API. Answers cite the public docs and hydromancer.xyz only.',
    exampleQuestionsLabel: 'Try asking',
    exampleQuestions: [
      'Is Hydromancer a fit for a copy trading bot?',
      'What data does Reservoir contain?',
      'How is Hydromancer different from the Hyperliquid API?',
      'What does the Starter plan include?',
    ],
    shouldOpenLinksInNewTab: true,
    disclaimerSettings: {
      isEnabled: true,
      label: 'Answers come from public documentation',
      tooltip: 'Generated from docs.hydromancer.xyz, hydromancer.xyz and the Hyperliquid API docs. Confirm plan limits on the pricing page.',
    },
    getHelpOptions: [
      { icon: { builtIn: 'FaTelegram' }, name: 'Speak to the founder', isPinnedToToolbar: true, action: { type: 'open_link', url: 'https://t.me/xenoflux' } },
    ],
  },
});