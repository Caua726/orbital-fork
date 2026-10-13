import type { Mundo } from '../types';
import { setupDialog, trapFocusHandler } from './_modal-a11y';

export type MatchResultAction = 'continue' | 'menu' | 'load';

export function abrirMatchResultModal(
  mundo: Mundo,
  result: 'victory' | 'defeat',
): Promise<MatchResultAction> {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.82);color:#edf6ff';
  const card = document.createElement('section');
  card.style.cssText = `width:min(620px,100%);border:1px solid ${result === 'victory' ? '#67d9a3' : '#ff6b6b'};background:#080d17;padding:26px;box-shadow:0 25px 80px #000;font-family:"Silkscreen","VT323",monospace`;
  const titleId = `match-result-${Date.now()}`;
  setupDialog(card, titleId);
  const title = document.createElement('h1');
  title.id = titleId;
  title.textContent = result === 'victory' ? 'VITÓRIA' : 'DERROTA';
  title.style.cssText = `margin:0 0 10px;color:${result === 'victory' ? '#67d9a3' : '#ff7b7b'}`;
  const subtitle = document.createElement('p');
  subtitle.textContent = result === 'victory'
    ? `Objetivo ${mundo.match.objective} concluído.`
    : 'Seu império não possui colônias nem meios de se recuperar.';
  subtitle.style.cssText = 'font-family:system-ui,sans-serif;color:#bdcbe0;line-height:1.5';

  const planets = mundo.planetas.filter((p) => p.dados.dono === 'jogador').length;
  const ships = mundo.naves.filter((n) => n.dono === 'jogador').length;
  const resources = mundo.planetas
    .filter((p) => p.dados.dono === 'jogador')
    .reduce((sum, p) => sum + p.dados.recursos.comum + p.dados.recursos.raro + p.dados.recursos.combustivel, 0);
  const stats = document.createElement('dl');
  stats.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:10px;margin:22px 0;padding:16px;border:1px solid #26364c;background:#0d1522';
  for (const [label, value] of [
    ['Planetas', planets], ['Naves', ships], ['Recursos', Math.floor(resources)],
    ['Tempo de simulação', `${Math.floor(mundo.match.simulationTimeMs / 60000)} min`],
  ] as const) {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = String(value); dd.style.margin = '0';
    stats.append(dt, dd);
  }
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end';
  card.append(title, subtitle, stats, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const choices: Array<{ label: string; value: MatchResultAction; primary?: boolean }> = result === 'victory'
    ? [
      { label: 'Continuar em sandbox', value: 'continue', primary: true },
      { label: 'Terminar e voltar ao menu', value: 'menu' },
    ]
    : [
      { label: 'Carregar último save', value: 'load', primary: true },
      { label: 'Voltar ao menu', value: 'menu' },
    ];

  return new Promise((resolve) => {
    const trap = trapFocusHandler(card);
    card.addEventListener('keydown', trap);
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      button.style.cssText = `padding:12px 15px;border:1px solid ${choice.primary ? '#79caff' : '#52647a'};background:${choice.primary ? '#173653' : '#101927'};color:#fff;font:inherit;cursor:pointer`;
      button.addEventListener('click', () => {
        card.removeEventListener('keydown', trap);
        overlay.remove();
        resolve(choice.value);
      }, { once: true });
      actions.appendChild(button);
    }
    (actions.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
}
