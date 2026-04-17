export interface ActionDef {
  id: string;
  label: string;
  categoria: 'camera' | 'interface' | 'jogo' | 'debug';
  defaultKeys: string[];
}

export const ACTIONS: ActionDef[] = [
  // Câmera
  { id: 'zoom_in',            label: 'Zoom in',            categoria: 'camera',    defaultKeys: ['Equal', 'NumpadAdd'] },
  { id: 'zoom_out',           label: 'Zoom out',           categoria: 'camera',    defaultKeys: ['Minus', 'NumpadSubtract'] },
  { id: 'pan_up',             label: 'Câmera cima',        categoria: 'camera',    defaultKeys: ['KeyW', 'ArrowUp'] },
  { id: 'pan_down',           label: 'Câmera baixo',       categoria: 'camera',    defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'pan_left',           label: 'Câmera esquerda',    categoria: 'camera',    defaultKeys: ['KeyA', 'ArrowLeft'] },
  { id: 'pan_right',          label: 'Câmera direita',     categoria: 'camera',    defaultKeys: ['KeyD', 'ArrowRight'] },

  // Interface
  { id: 'cancel_or_menu',     label: 'Cancelar / Menu',    categoria: 'interface', defaultKeys: ['Escape'] },
  { id: 'quicksave',          label: 'Salvar rápido',      categoria: 'interface', defaultKeys: ['F5'] },

  // Jogo
  { id: 'speed_pause',        label: 'Pausar',             categoria: 'jogo',      defaultKeys: ['Space'] },
  { id: 'speed_1x',           label: 'Velocidade 1x',      categoria: 'jogo',      defaultKeys: ['Digit1'] },
  { id: 'speed_2x',           label: 'Velocidade 2x',      categoria: 'jogo',      defaultKeys: ['Digit2'] },
  { id: 'speed_4x',           label: 'Velocidade 4x',      categoria: 'jogo',      defaultKeys: ['Digit3'] },

  // Debug
  { id: 'toggle_debug_fast',  label: 'Debug rápido',       categoria: 'debug',     defaultKeys: ['F1'] },
  { id: 'toggle_debug_full',  label: 'Debug completo',     categoria: 'debug',     defaultKeys: ['F3'] },
];

export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
);

export const CATEGORIAS_ORDEM: ActionDef['categoria'][] = ['camera', 'interface', 'jogo', 'debug'];
