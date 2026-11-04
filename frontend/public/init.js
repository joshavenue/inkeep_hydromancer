import './embed.js';

const response = await fetch('/config.json', { cache: 'no-store' });
if (!response.ok) throw new Error('The assistant is not ready. Please reload shortly.');
const config = await response.json();
const BASE_URL = window.location.origin;
window.Inkeep.ChatButton({
  baseSettings: { shouldBypassCaptcha: true },
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
      { icon: { builtIn: 'FaEnvelope' }, name: 'Contact the team', isPinnedToToolbar: true, action: { type: 'open_link', url: 'https://hydromancer.xyz/contact' } },
      { icon: { builtIn: 'FaDiscord' }, name: 'Hydromancer Discord', action: { type: 'open_link', url: 'https://discord.gg/xfAWcSygQT' } },
    ],
  },
});
