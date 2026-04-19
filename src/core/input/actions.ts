export interface ActionDef {
  id: string;
  labelKey: string;
  categoria: 'camera' | 'interface' | 'jogo' | 'debug';
  defaultKeys: string[];
}

export const ACTIONS: ActionDef[] = [
  // Câmera
  { id: 'zoom_in',            labelKey: 'input.action.zoom_in',            categoria: 'camera',    defaultKeys: ['Equal', 'NumpadAdd'] },
  { id: 'zoom_out',           labelKey: 'input.action.zoom_out',           categoria: 'camera',    defaultKeys: ['Minus', 'NumpadSubtract'] },
  { id: 'pan_up',             labelKey: 'input.action.pan_up',             categoria: 'camera',    defaultKeys: ['KeyW', 'ArrowUp'] },
  { id: 'pan_down',           labelKey: 'input.action.pan_down',           categoria: 'camera',    defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'pan_left',           labelKey: 'input.action.pan_left',           categoria: 'camera',    defaultKeys: ['KeyA', 'ArrowLeft'] },
  { id: 'pan_right',          labelKey: 'input.action.pan_right',          categoria: 'camera',    defaultKeys: ['KeyD', 'ArrowRight'] },
  { id: 'focar_alvo',         labelKey: 'input.action.focar_alvo',         categoria: 'camera',    defaultKeys: ['KeyF'] },

  // Interface
  { id: 'cancel_or_menu',     labelKey: 'input.action.cancel_or_menu',     categoria: 'interface', defaultKeys: ['Escape'] },
  { id: 'quicksave',          labelKey: 'input.action.quicksave',          categoria: 'interface', defaultKeys: ['F5'] },

  // Jogo
  { id: 'speed_pause',        labelKey: 'input.action.speed_pause',        categoria: 'jogo',      defaultKeys: ['Space'] },
  { id: 'speed_1x',           labelKey: 'input.action.speed_1x',           categoria: 'jogo',      defaultKeys: ['Digit1'] },
  { id: 'speed_2x',           labelKey: 'input.action.speed_2x',           categoria: 'jogo',      defaultKeys: ['Digit2'] },
  { id: 'speed_4x',           labelKey: 'input.action.speed_4x',           categoria: 'jogo',      defaultKeys: ['Digit3'] },

  // Debug
  { id: 'toggle_debug_fast',  labelKey: 'input.action.toggle_debug_fast',  categoria: 'debug',     defaultKeys: ['F1'] },
  { id: 'toggle_debug_full',  labelKey: 'input.action.toggle_debug_full',  categoria: 'debug',     defaultKeys: ['F3'] },
];

export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
);

export const CATEGORIAS_ORDEM: ActionDef['categoria'][] = ['camera', 'interface', 'jogo', 'debug'];
