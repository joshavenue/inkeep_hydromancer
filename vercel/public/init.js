import './embed.js';

const response = await fetch('/api/config', { cache: 'no-store', credentials: 'same-origin' });
if (!response.ok) throw new Error('The assistant is not ready. Please reload shortly.');
const config = await response.json();
const BASE_URL = window.location.origin + '/api';
window.Inkeep.ChatButton({
  avatar: '/hydromancer-cat-wave.gif',
  label: 'Ask the Hydromancer assistant',
  baseSettings: {
    shouldBypassCaptcha: true,
    primaryBrandColor: '#1e3a5f',
    theme: {
      styles: [{
        key: 'hydromancer-cat-button',
        type: 'style',
        value: `
          .ikp-chat-button__container { filter: none; right: 28px !important; bottom: 28px !important; }
          .ikp-chat-button__button {
            position: relative; width: 64px !important; height: 64px !important; min-width: 64px; padding: 0 !important;
            gap: 0 !important; border-radius: 50% !important; overflow: visible; justify-content: center; align-items: center;
            background: radial-gradient(circle at 50% 35%, #2a5288 0%, #1e3a5f 55%, #132743 100%) !important;
            box-shadow:
              0 0 0 2px rgba(130, 195, 255, 0.45),
              0 0 20px 5px rgba(90, 170, 255, 0.55),
              0 6px 14px rgba(0, 0, 0, 0.5),
              inset 0 -7px 12px rgba(0, 0, 0, 0.5),
              inset 0 3px 6px rgba(255, 255, 255, 0.18) !important;
            transition: transform 160ms ease, box-shadow 160ms ease;
            animation: hm-glow 3.2s ease-in-out infinite;
          }
          .ikp-chat-button__button::after {
            content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
            background: radial-gradient(ellipse 70% 45% at 50% 12%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 70%);
          }
          .ikp-chat-button__button:hover { transform: translateY(-2px) scale(1.04); }
          .ikp-chat-button__text { position: absolute !important; width: 1px; height: 1px; margin: 0; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
          .ikp-chat-button__avatar-content, .ikp-chat-button__avatar-image {
            flex: 0 0 64px !important; width: 64px !important; height: 64px !important; min-width: 64px;
            margin: 0 !important; border-radius: 50% !important; aspect-ratio: 1 / 1; overflow: hidden;
          }
          .ikp-chat-button__avatar-image img, img.ikp-chat-button__avatar-image { width: 100%; height: 100%; object-fit: cover; }
          @keyframes hm-glow {
            0%, 100% { box-shadow: 0 0 0 2px rgba(130,195,255,.40), 0 0 16px 4px rgba(90,170,255,.45), 0 7px 16px rgba(0,0,0,.55), inset 0 -7px 12px rgba(0,0,0,.5), inset 0 3px 6px rgba(255,255,255,.18); }
            50%      { box-shadow: 0 0 0 2px rgba(150,210,255,.60), 0 0 28px 9px rgba(90,170,255,.65), 0 7px 16px rgba(0,0,0,.55), inset 0 -7px 12px rgba(0,0,0,.5), inset 0 3px 6px rgba(255,255,255,.18); }
          }
          @media (prefers-reduced-motion: reduce) { .ikp-chat-button__button { animation: none; } }
        `,
      }],
    },
  },
  aiChatSettings: {
    appId: config.appId,
    baseUrl: BASE_URL,
    aiAssistantName: 'Hydromancer assistant',
    aiAssistantAvatar: '/hydromancer-cat.webp',
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