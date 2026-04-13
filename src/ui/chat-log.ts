import { registerChatLog, unregisterChatLog } from './hud-layout';

let _container: HTMLDivElement | null = null;
let _messagesEl: HTMLDivElement | null = null;
let _activeTab = 'alliance';
let _styleInjected = false;

interface LogMessage {
  time: string;
  channel: string;
  text: string;
}

const _messages: LogMessage[] = [
  { time: '12:45', channel: 'ALLIANCE', text: 'COMMANDER: Rally at Sector 7B, enemy fleet spotted.' },
  { time: '12:45', channel: 'SYSTEM', text: 'Research completed: Plasma Weapons' },
];

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .chat-log {
      /* Chat log owns its own type tokens so the fonts can be tuned
         independently of the global HUD unit. */
      --cl-font: "VT323", "Silkscreen", monospace;
      --cl-font-label: "Silkscreen", "VT323", monospace;
      --cl-font-size: clamp(13px, 1.3vmin, 16px);
      --cl-font-size-sm: clamp(9px, 0.9vmin, 11px);
      --cl-line-height: 1.25;
      --cl-pad: clamp(10px, 1.2vmin, 16px);
      --cl-gap: clamp(6px, 0.7vmin, 10px);

      left: var(--hud-margin);
      bottom: var(--hud-margin);
      width: clamp(260px, 28vw, 460px);
      display: flex;
      flex-direction: column;
      padding: var(--cl-pad);
      font-family: var(--cl-font);
    }

    .chat-tabs {
      display: flex;
      gap: calc(var(--cl-gap) * 0.4);
      border-bottom: 1px solid var(--hud-line);
      margin-bottom: var(--cl-pad);
    }

    .chat-tab {
      flex: 1;
      text-align: center;
      padding: calc(var(--cl-pad) * 0.55) 0;
      font-size: var(--cl-font-size-sm);
      font-family: var(--cl-font-label);
      font-weight: 400;
      color: var(--hud-text-faint);
      cursor: pointer;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      border-bottom: 2px solid transparent;
      transition: all 150ms ease;
      line-height: 1;
      user-select: none;
    }

    .chat-tab:hover:not(.active) {
      color: rgba(255,255,255,0.7);
    }

    .chat-tab.active {
      color: var(--hud-text);
      border-bottom-color: rgba(255,255,255,0.85);
      font-weight: 700;
      font-family: var(--cl-font-label);
    }

    .chat-messages {
      display: flex;
      flex-direction: column;
      gap: var(--cl-gap);
      max-height: clamp(100px, 14vh, 180px);
      overflow-y: auto;
      margin-bottom: var(--cl-pad);
      padding-right: 4px;
    }

    .chat-messages::-webkit-scrollbar { width: 3px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.15);
      border-radius: 2px;
    }

    .chat-line {
      font-size: var(--cl-font-size);
      color: rgba(255,255,255,0.78);
      line-height: var(--cl-line-height);
      font-family: var(--cl-font);
      font-weight: 400;
      word-wrap: break-word;
    }

    .chat-line .ts {
      color: rgba(255,255,255,0.35);
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }

    .chat-line .ch {
      color: rgba(255,255,255,0.55);
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .chat-input-row {
      display: flex;
      align-items: center;
      gap: var(--cl-gap);
      border-top: 1px solid rgba(255,255,255,0.12);
      padding-top: calc(var(--cl-pad) * 0.65);
    }

    .chat-input {
      flex: 1;
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.85);
      font-family: var(--cl-font);
      font-size: var(--cl-font-size);
      outline: none;
      letter-spacing: 0.02em;
      padding: 0;
    }

    .chat-input::placeholder {
      color: rgba(255,255,255,0.3);
      font-weight: 400;
    }

    .chat-send {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: clamp(18px, 1.8vmin, 24px);
      height: clamp(18px, 1.8vmin, 24px);
      opacity: 0.4;
      transition: opacity 150ms;
    }

    .chat-send:hover { opacity: 0.85; }

    .chat-send svg {
      width: 100%;
      height: 100%;
    }
  `;
  document.head.appendChild(style);
}

function renderMessages(): void {
  if (!_messagesEl) return;
  while (_messagesEl.firstChild) _messagesEl.removeChild(_messagesEl.firstChild);

  for (const msg of _messages) {
    const line = document.createElement('div');
    line.className = 'chat-line';

    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = `[${msg.time}] `;
    line.appendChild(ts);

    const ch = document.createElement('span');
    ch.className = 'ch';
    ch.textContent = `[${msg.channel}] `;
    line.appendChild(ch);

    line.appendChild(document.createTextNode(msg.text));
    _messagesEl.appendChild(line);
  }
  _messagesEl.scrollTop = _messagesEl.scrollHeight;
}

function updateTabs(): void {
  if (!_container) return;
  _container.querySelectorAll<HTMLDivElement>('.chat-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.chatTab === _activeTab);
  });
}

export function criarChatLog(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();

  const panel = document.createElement('div');
  panel.className = 'hud-panel chat-log';

  // Tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'chat-tabs';
  for (const name of ['ALLIANCE', 'SECTOR', 'PRIVATE']) {
    const tab = document.createElement('div');
    tab.className = 'chat-tab';
    tab.dataset.chatTab = name.toLowerCase();
    tab.textContent = name;
    tab.addEventListener('click', () => {
      _activeTab = tab.dataset.chatTab!;
      updateTabs();
    });
    tabBar.appendChild(tab);
  }
  panel.appendChild(tabBar);

  // Messages
  const messages = document.createElement('div');
  messages.className = 'chat-messages';
  _messagesEl = messages;
  panel.appendChild(messages);

  // Input row
  const inputRow = document.createElement('div');
  inputRow.className = 'chat-input-row';

  const input = document.createElement('input');
  input.className = 'chat-input';
  input.placeholder = 'Type message...';
  inputRow.appendChild(input);

  const sendBtn = document.createElement('div');
  sendBtn.className = 'chat-send';
  const sendSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sendSvg.setAttribute('viewBox', '0 0 24 24');
  sendSvg.setAttribute('fill', 'none');
  sendSvg.setAttribute('stroke', 'white');
  sendSvg.setAttribute('stroke-width', '2');
  const sendPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  sendPath.setAttribute('d', 'M5 12h14m-7-7l7 7-7 7');
  sendSvg.appendChild(sendPath);
  sendBtn.appendChild(sendSvg);
  inputRow.appendChild(sendBtn);

  panel.appendChild(inputRow);

  _container = panel;
  document.body.appendChild(panel);
  registerChatLog(panel);

  renderMessages();
  updateTabs();

  return panel;
}

export function adicionarMensagem(time: string, channel: string, text: string): void {
  _messages.push({ time, channel, text });
  if (_messages.length > 50) _messages.shift();
  renderMessages();
}

export function destruirChatLog(): void {
  if (_container) {
    unregisterChatLog();
    _container.remove();
    _container = null;
    _messagesEl = null;
  }
}
