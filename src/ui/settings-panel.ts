import { getConfig, setConfig } from '../core/config';
import { notificarMudancaConfig, trocarModoSave } from '../world/save';
import { toast } from './toast';

export function montarSettingsPanel(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'settings-panel';
  const cfg = getConfig();

  const autosaveRow = document.createElement('div');
  autosaveRow.className = 'settings-row';
  const autosaveLabel = document.createElement('label');
  autosaveLabel.textContent = 'Autosave';
  const autosaveSelect = document.createElement('select');
  const OPTIONS: Array<[string, number]> = [
    ['Desligado', 0],
    ['30s', 30_000],
    ['1min', 60_000],
    ['2min', 120_000],
    ['5min', 300_000],
  ];
  for (const [label, ms] of OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(ms);
    opt.textContent = label;
    if (ms === cfg.autosaveIntervalMs) opt.selected = true;
    autosaveSelect.appendChild(opt);
  }
  autosaveSelect.addEventListener('change', () => {
    setConfig({ autosaveIntervalMs: Number(autosaveSelect.value) });
    notificarMudancaConfig();
  });
  autosaveRow.append(autosaveLabel, autosaveSelect);
  container.appendChild(autosaveRow);

  const expRow = document.createElement('div');
  expRow.className = 'settings-row';
  const expLabel = document.createElement('label');
  expLabel.textContent = 'Save experimental em tempo real (IndexedDB)';
  const expToggle = document.createElement('input');
  expToggle.type = 'checkbox';
  expToggle.checked = cfg.saveMode === 'experimental';
  expToggle.addEventListener('change', () => {
    setConfig({ saveMode: expToggle.checked ? 'experimental' : 'periodic' });
    trocarModoSave();
    toast(
      expToggle.checked ? 'Modo experimental ativado' : 'Modo padrão ativado',
      'info',
    );
  });
  expRow.append(expLabel, expToggle);
  container.appendChild(expRow);

  if (!document.getElementById('settings-panel-styles')) {
    const st = document.createElement('style');
    st.id = 'settings-panel-styles';
    st.textContent = `
      .settings-panel { display: flex; flex-direction: column; gap: calc(var(--hud-unit) * 0.8); min-width: calc(var(--hud-unit) * 20); }
      .settings-row { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.8); background: var(--hud-bg); border: 1px solid var(--hud-border); gap: calc(var(--hud-unit) * 1); }
      .settings-row label { font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.85); color: var(--hud-text); letter-spacing: 0.05em; }
      .settings-row select, .settings-row input[type="checkbox"] { background: rgba(0,0,0,0.4); color: var(--hud-text); border: 1px solid var(--hud-border); font-family: var(--hud-font); }
    `;
    document.head.appendChild(st);
  }

  return container;
}
