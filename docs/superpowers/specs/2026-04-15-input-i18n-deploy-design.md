# Input System + i18n + GitHub Pages Deploy — Design

**Data**: 2026-04-15
**Status**: Aprovado, pronto pra plano de implementação
**Projeto**: Orbital Wydra

## Contexto

Spec final do ciclo de fechamento do main menu. Os dois specs anteriores (Save/Load e Settings) criaram a infraestrutura base — `src/core/config.ts` com observer pattern, `src/ui/settings-panel.ts` com abas, `src/ui/toast.ts`, vitest. Este spec entrega os três subsistemas restantes:

1. **Input System + Rebind** — centraliza os listeners de teclado espalhados por 6 arquivos num dispatcher único com ações nomeadas, permitindo rebind pelo jogador.
2. **i18n PT/EN** — extrai todas as strings PT hardcoded pra um dicionário, adiciona traduções EN, permite trocar idioma em runtime com animação de transição.
3. **GitHub Pages Deploy** — configura Vite + GitHub Actions pra deploy automático na main.

Este é o **terceiro e último spec** do ciclo:

1. Save/Load ✅ (implementado)
2. Settings ✅ (spec + plan prontos)
3. Input + i18n + Deploy (este spec)

## Dependências

- Depende de **Settings** (spec 2) implementado: usa a aba Jogabilidade do settings-panel, o observer pattern do config, e o tooltip mechanism.
- Depende de **Save/Load** (spec 1) implementado: usa config.ts, toast.ts, vitest.
- **Nenhuma dependência entre os 3 subsistemas deste spec**: podem ser executados em qualquer ordem. O plan terá fases isoladas por subsistema.

## Fora de escopo (global)

- Gamepad, touch, modificadores compostos (Ctrl+X), sequências multi-tecla
- Idiomas além de PT/EN, pluralização complexa, RTL, lazy loading de dicionário
- Custom domain, CDN, preview deploys por branch, rollback automático
- Tradução do debug menu (interno, fica em PT)

---

# PARTE A — Input System + Rebind

## A.1 Arquitetura

Módulo novo: `src/core/input/`

Três arquivos com responsabilidades claras:

```
src/core/input/
  actions.ts      Constantes de ações + metadata (label, default key, categoria)
  keymap.ts       Mapa actionId → keyCode, lê/escreve no config
  dispatcher.ts   Único listener global, resolve key→action, despacha callbacks
```

O dispatcher substitui os 4 listeners centrais existentes (main.ts, player.ts, debug-menu.ts). Modais (colony-modal, confirm-dialog, colonizer-panel, main-menu Escape) mantêm listeners locais porque são transitórios e tratam Enter/Escape em contexto modal, não como ações globais do jogo.

## A.2 Ações

~13 ações iniciais, agrupadas por categoria:

**Câmera:**

| ID | Label | Default key(s) | Notas |
|----|-------|----------------|-------|
| `zoom_in` | Zoom in | `Equal`, `NumpadAdd` | Migração de `main.ts:78` (que usa `e.key === '+' / '='`) |
| `zoom_out` | Zoom out | `Minus`, `NumpadSubtract` | Idem (usa `e.key === '-' / '_'`) |
| `pan_up` | Câmera cima | `KeyW`, `ArrowUp` | **Feature nova** — hoje pan é só via mouse |
| `pan_down` | Câmera baixo | `KeyS`, `ArrowDown` | Idem |
| `pan_left` | Câmera esquerda | `KeyA`, `ArrowLeft` | Idem |
| `pan_right` | Câmera direita | `KeyD`, `ArrowRight` | Idem |

**Interface:**

| ID | Label | Default key(s) | Notas |
|----|-------|----------------|-------|
| `cancel_or_menu` | Cancelar / Menu | `Escape` | Migração de `player.ts:346` + `main.ts:81`. Ação única com lógica condicional: tenta cancelar `comandoNave` → tenta fechar debug overlay → abre pause menu. |
| `quicksave` | Salvar rápido | `F5` | **Feature nova** — chama `salvarAgora()` |

**Nota sobre Escape — ação única `cancel_or_menu`**: em vez de duas ações separadas com a mesma tecla (que exigiria prioridade no dispatcher), usamos uma ação única cujo callback resolve a prioridade internamente, nesta ordem:

1. Se `comandoNave` ativo → cancela (via `cancelarComandoNaveSeAtivo()` — wrapper novo, ver abaixo)
2. Senão se debug overlay aberto (`_popupVisible || _fastVisible`) → fecha (via `fecharDebugOverlays()`)
3. Senão se jogo rodando e pause menu não tá aberto → abre pause menu

Isso cobre os 3 sites migrados (player.ts Escape, main.ts Escape, debug-menu.ts Escape) numa cadeia de fallback simples.

**`cancelarComandoNaveSeAtivo(): boolean`**: função nova a ser adicionada em `player.ts`. Wraps o check de `comandoNave !== null` + `cancelarComandoNave()` + retorna `true` se havia comando. Hoje `cancelarComandoNave()` existe mas retorna `void` e não checa se há comando ativo.

**`fecharDebugOverlays(): boolean`**: função nova a ser exportada de `debug-menu.ts`. Fecha popup e/ou fast menu se abertos, retorna `true` se havia algo aberto.

**Jogo:**

| ID | Label | Default key(s) | Notas |
|----|-------|----------------|-------|
| `speed_pause` | Pausar | `Space` | **Feature nova** — seta `app.ticker.speed = 0` |
| `speed_1x` | Velocidade 1x | `Digit1` | **Feature nova** |
| `speed_2x` | Velocidade 2x | `Digit2` | **Feature nova** |
| `speed_4x` | Velocidade 4x | `Digit3` | **Feature nova** |

**Debug:**

| ID | Label | Default key(s) | Notas |
|----|-------|----------------|-------|
| `toggle_debug_fast` | Debug menu rápido | `F1` | Migração de `debug-menu.ts:714` (`toggleFastMenu`) |
| `toggle_debug_full` | Debug menu completo | `F3` | Migração de `debug-menu.ts:717` (`togglePopup`) |

**Nota sobre `e.key` vs `e.code`**: os listeners atuais usam `e.key` (ex: `'+', '=', '-', '_'`, `'Escape'`, `'F1'`). O dispatcher usa `e.code` (ex: `Equal`, `Minus`, `Escape`, `F1`). Diferença: `e.key` varia com layout/shift (Shift+Minus = `'_'`), `e.code` é posição física. Migrar pra `e.code` perde a detecção de `'+'` via Shift+Equal e `'_'` via Shift+Minus. **Decisão**: aceitável — o usuário pode pressionar `Equal` sem Shift e o zoom funciona. Se quiser o comportamento antigo, pode rebindar pra teclas adicionais. Documentar como mudança de comportamento menor.

**Suporte a múltiplas keys**: cada ação pode ter 1 ou 2 keys default (ex: `Equal` e `NumpadAdd` ambos disparam `zoom_in`). No keymap, isso é representado como array de keycodes: `{ zoom_in: ['Equal', 'NumpadAdd'] }`. Rebind substitui o array inteiro — o jogador pode setar 1 ou 2 teclas por ação.

## A.3 `actions.ts`

```ts
export interface ActionDef {
  id: string;
  label: string;            // PT label pro settings UI — pra i18n, vira chave t()
  categoria: 'camera' | 'interface' | 'jogo' | 'debug';
  defaultKeys: string[];    // e.code values
}

export const ACTIONS: ActionDef[] = [
  { id: 'zoom_in',      label: 'Zoom in',           categoria: 'camera',    defaultKeys: ['Equal', 'NumpadAdd'] },
  { id: 'zoom_out',     label: 'Zoom out',          categoria: 'camera',    defaultKeys: ['Minus', 'NumpadSubtract'] },
  { id: 'pan_up',       label: 'Câmera cima',       categoria: 'camera',    defaultKeys: ['KeyW', 'ArrowUp'] },
  { id: 'pan_down',     label: 'Câmera baixo',      categoria: 'camera',    defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'pan_left',     label: 'Câmera esquerda',   categoria: 'camera',    defaultKeys: ['KeyA', 'ArrowLeft'] },
  { id: 'pan_right',    label: 'Câmera direita',    categoria: 'camera',    defaultKeys: ['KeyD', 'ArrowRight'] },
  { id: 'cancel_or_menu',     label: 'Cancelar / Menu',        categoria: 'interface', defaultKeys: ['Escape'] },
  { id: 'quicksave',          label: 'Salvar rápido',          categoria: 'interface', defaultKeys: ['F5'] },
  { id: 'speed_pause',        label: 'Pausar',                 categoria: 'jogo',      defaultKeys: ['Space'] },
  { id: 'speed_1x',           label: 'Velocidade 1x',          categoria: 'jogo',      defaultKeys: ['Digit1'] },
  { id: 'speed_2x',           label: 'Velocidade 2x',          categoria: 'jogo',      defaultKeys: ['Digit2'] },
  { id: 'speed_4x',           label: 'Velocidade 4x',          categoria: 'jogo',      defaultKeys: ['Digit3'] },
  { id: 'toggle_debug_fast',  label: 'Debug rápido',            categoria: 'debug',     defaultKeys: ['F1'] },
  { id: 'toggle_debug_full',  label: 'Debug completo',          categoria: 'debug',     defaultKeys: ['F3'] },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
```

## A.4 `keymap.ts`

```ts
import { ACTIONS } from './actions';
import { getConfig } from '../config';

export type KeyBindings = Record<string, string[]>;

/** Retorna o mapa de bindings ativo: config overrides + defaults pra ações não customizadas. */
export function getActiveKeymap(): KeyBindings {
  const custom = getConfig().input?.bindings ?? {};
  const result: KeyBindings = {};
  for (const action of ACTIONS) {
    result[action.id] = custom[action.id] ?? action.defaultKeys;
  }
  return result;
}

/** Dado um e.code, retorna o actionId correspondente (ou null). */
export function resolveKeyToAction(code: string): string | null {
  const keymap = getActiveKeymap();
  for (const [actionId, keys] of Object.entries(keymap)) {
    if (keys.includes(code)) return actionId;
  }
  return null;
}

/** Detecta conflito: retorna o actionId que já usa esse keycode, ou null. */
export function detectarConflito(code: string, ignorarAction?: string): string | null {
  const keymap = getActiveKeymap();
  for (const [actionId, keys] of Object.entries(keymap)) {
    if (actionId === ignorarAction) continue;
    if (keys.includes(code)) return actionId;
  }
  return null;
}
```

## A.5 `dispatcher.ts`

```ts
import { resolveKeyToAction } from './keymap';

type ActionCallback = () => void;
const _listeners = new Map<string, Set<ActionCallback>>();
const _upListeners = new Map<string, Set<ActionCallback>>();
let _installed = false;
let _habilitado = true;

export function setDispatcherHabilitado(val: boolean): void {
  _habilitado = val;
}

export function onAction(actionId: string, callback: ActionCallback): () => void {
  if (!_listeners.has(actionId)) _listeners.set(actionId, new Set());
  _listeners.get(actionId)!.add(callback);
  return () => _listeners.get(actionId)?.delete(callback);
}

export function onActionUp(actionId: string, callback: ActionCallback): () => void {
  if (!_upListeners.has(actionId)) _upListeners.set(actionId, new Set());
  _upListeners.get(actionId)!.add(callback);
  return () => _upListeners.get(actionId)?.delete(callback);
}

export function instalarDispatcher(): void {
  if (_installed) return;
  _installed = true;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!_habilitado) return;

    // Ignorar quando foco está em campos de texto
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

    const actionId = resolveKeyToAction(e.code);
    if (!actionId) return;

    e.preventDefault();
    const cbs = _listeners.get(actionId);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(); } catch (err) { console.error(`[input] action ${actionId} error:`, err); }
    }
  });

  // Keyup listener — necessário pra pan contínuo (keydown inicia, keyup para)
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (!_habilitado) return;
    const actionId = resolveKeyToAction(e.code);
    if (!actionId) return;
    const cbs = _upListeners.get(actionId);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(); } catch (err) { console.error(`[input] actionUp ${actionId} error:`, err); }
    }
  });
}
```

**Guard de contexto**: o dispatcher precisa ser desabilitado quando o settings panel está aberto em modo rebind (capturando a próxima tecla pra reassociar). `setDispatcherHabilitado(false)` é chamado ao entrar em modo rebind, `true` ao sair.

## A.6 Migração dos listeners existentes e features novas

### Migrações (listeners que existem e são deletados)

**`main.ts:78`** — deleta o `window.addEventListener('keydown')` que trata zoom (`e.key === '+'/'-'`) **e** Escape (pause menu). Substitui por:

```ts
import { onAction } from './core/input/dispatcher';
onAction('zoom_in', () => zoomIn());
onAction('zoom_out', () => zoomOut());
onAction('cancel_or_menu', () => {
  // Cadeia de prioridade: cancela comando → fecha debug → abre pause
  if (cancelarComandoNaveSeAtivo()) return;
  if (fecharDebugOverlays()) return;
  if (_gameStarted && !isPauseMenuOpen()) abrirPauseMenu();
});
```

**`player.ts:346`** — deleta o listener de Escape que cancela `comandoNave`. A lógica de cancelamento é absorvida pelo callback de `cancel_command` acima — `player.ts` expõe `cancelarComandoNaveSeAtivo(): boolean` que tenta cancelar e retorna `true` se havia comando ativo.

**`debug-menu.ts:710`** — deleta o listener de F1/F3/Escape. Substitui por:

```ts
onAction('toggle_debug_fast', () => toggleFastMenu());
onAction('toggle_debug_full', () => {
  togglePopup();
  if (_popupVisible) toggleFastMenu(false);
});
// O Escape do debug menu é coberto pelo cancel_command global
// que pode ser estendido pra fechar overlays abertos.
```

### Listeners que ficam locais (NÃO migram)

| Arquivo | Listener | Por que fica local |
|---------|----------|-------------------|
| `main-menu.ts:~515` | Escape volta de sub-screen | Transitório, fluxo de menu |
| `pause-menu.ts:~230` | Escape fecha pause overlay (capture: true) | Transitório, usa capture pra precedência |
| `colony-modal.ts` | Enter confirma, Escape fecha | Transitório, modal |
| `confirm-dialog.ts` | Enter/Escape | Transitório, modal |
| `colonizer-panel.ts` | keydown no input | Transitório, campo de texto |

### Features novas (não são migração)

**Pan por teclado (WASD/arrows)**: hoje **não existe** — câmera só move por mouse (drag + edge-scroll do Settings spec). Esta é uma **feature nova** usando o dispatcher.

O dispatcher precisa de `onActionUp` pra pan contínuo (keydown inicia, keyup para). Implementação:

```ts
// No dispatcher: instala keyup listener também
window.addEventListener('keyup', (e: KeyboardEvent) => {
  const actionId = resolveKeyToAction(e.code);
  if (!actionId) return;
  const cbs = _upListeners.get(actionId);
  if (!cbs) return;
  for (const cb of cbs) { try { cb(); } catch {} }
});

export function onActionUp(actionId: string, callback: ActionCallback): () => void { ... }
```

```ts
// No player.ts ou main.ts:
const _panState = { up: false, down: false, left: false, right: false };
onAction('pan_up', () => { _panState.up = true; });
onActionUp('pan_up', () => { _panState.up = false; });
// ... idem pra down/left/right
// No ticker a cada frame:
if (_panState.up) camera.y -= speed * dt;
```

**Pegadinha de keyup não disparando**: se a window perde foco enquanto uma tecla é pressionada, o browser nunca dispara `keyup`. Solução: listener de `blur` na window zera todos os `_panState` flags:

```ts
window.addEventListener('blur', () => {
  _panState.up = _panState.down = _panState.left = _panState.right = false;
});
```

## A.7 Config

Extensão do `OrbitalConfig`:

```ts
input: {
  bindings: Record<string, string[]>;  // actionId → keyCodes (vazio = usa defaults)
};
```

Default:

```ts
input: {
  bindings: {},
},
```

## A.8 UI — Seção "Controles" na aba Jogabilidade

Adicionada como sub-seção **abaixo** dos toggles existentes (confirmar destrutivo, edge-scroll) e do seletor de idioma (Parte B deste spec).

```
━━━ Controles ━━━

Câmera
  Zoom in              [ = / Num+ ]   [Rebind]
  Zoom out             [ - / Num- ]   [Rebind]
  Câmera cima          [ W / ↑ ]      [Rebind]
  Câmera baixo         [ S / ↓ ]      [Rebind]
  Câmera esquerda      [ A / ← ]      [Rebind]
  Câmera direita       [ D / → ]      [Rebind]

Interface
  Fechar painel        [ Esc ]        [Rebind]
  Salvar rápido        [ F5 ]         [Rebind]

Jogo
  Pausar               [ Space ]      [Rebind]
  Velocidade 1x        [ 1 ]          [Rebind]
  Velocidade 2x        [ 2 ]          [Rebind]
  Velocidade 4x        [ 3 ]          [Rebind]

Debug
  Debug rápido         [ F1 ]         [Rebind]
  Debug completo       [ F3 ]         [Rebind]

[ Resetar controles ]
```

**Fluxo de rebind**:

1. Jogador clica **[Rebind]** de uma ação.
2. Dispatcher é desabilitado (`setDispatcherHabilitado(false)`).
3. Texto do botão muda pra "Pressione tecla...".
4. Próximo `keydown` capturado:
   - Se `Escape` → cancela rebind, restaura botão, reabilita dispatcher.
   - Se a tecla já está em uso por outra ação → mostra inline: "Já usado por 'Zoom in'. Trocar?" com botão [Sim] / [Cancelar].
   - Senão → grava `config.input.bindings[actionId] = [newCode]`, atualiza botão, reabilita dispatcher.
5. **[Resetar controles]** → `setConfig({ input: { bindings: {} } })` → todas as ações voltam aos defaults.

## A.9 Testes (Input)

**Unit tests** (vitest):

1. `keymap.test.ts` — `getActiveKeymap` retorna defaults quando bindings vazio; retorna override quando custom existe; `resolveKeyToAction` resolve corretamente.
2. `dispatcher.test.ts` — mock de KeyboardEvent; `onAction` callback é chamado; callback NÃO é chamado quando target é INPUT; `onActionUp` funciona.
3. `detectarConflito` — detecta quando key já tá em uso, ignora a própria ação.

**Manual playtesting**:

1. W/A/S/D move câmera → funciona como antes.
2. Settings → Jogabilidade → Controles → Rebind "Câmera cima" pra `KeyI` → I agora move pra cima, W não faz nada.
3. Tentar rebindar pra tecla já usada → alerta de conflito.
4. Resetar controles → W volta a funcionar.
5. F5 (quicksave) → toast "Salvo".

## A.10 Arquivos afetados (Input)

**Novos:**

```
src/core/input/actions.ts
src/core/input/keymap.ts
src/core/input/dispatcher.ts
src/core/input/__tests__/keymap.test.ts
src/core/input/__tests__/dispatcher.test.ts
```

**Modificados:**

```
src/core/config.ts          # adiciona input.bindings ao shape + defaults
src/main.ts                 # deleta listener de zoom, usa onAction
src/core/player.ts          # deleta listener de pan/Escape, usa onAction + onActionUp
src/ui/debug-menu.ts        # deleta listener de backtick, usa onAction
src/ui/settings-panel.ts    # adiciona seção Controles na aba Jogabilidade
```

---

# PARTE B — i18n PT/EN

## B.1 Arquitetura

Módulo novo: `src/core/i18n/`

```
src/core/i18n/
  dict.ts       Dicionário flat: Record<string, { pt: string; en: string }>
  t.ts          Função t(key, params?) → string traduzida
  idioma.ts     getIdioma() / setIdioma() — lê/escreve config.language
```

## B.2 Dicionário (`dict.ts`)

Keys namespaced por módulo, snake_case PT:

```ts
export const DICT: Record<string, { pt: string; en: string }> = {
  // Menu
  'menu.novo_jogo': { pt: 'Novo Jogo', en: 'New Game' },
  'menu.mundos_salvos': { pt: 'Mundos Salvos', en: 'Saved Worlds' },
  'menu.configuracoes': { pt: 'Configurações', en: 'Settings' },
  'menu.titulo': { pt: 'Orbital Wydra', en: 'Orbital Wydra' },
  'menu.subtitulo': { pt: 'Expedição Estelar', en: 'Stellar Expedition' },
  'menu.footer': { pt: 'v0.1  ·  protótipo', en: 'v0.1  ·  prototype' },
  'menu.voltar': { pt: '◀ Voltar', en: '◀ Back' },
  'menu.nenhum_save': { pt: 'Nenhum mundo salvo ainda', en: 'No saved worlds yet' },
  'menu.titulo_saves': { pt: 'Mundos Salvos', en: 'Saved Worlds' },
  'menu.titulo_settings': { pt: 'Configurações', en: 'Settings' },
  'menu.apagar_save': { pt: 'Apagar mundo "{nome}" permanentemente?', en: 'Delete world "{nome}" permanently?' },

  // HUD
  'hud.salvar': { pt: 'Salvar', en: 'Save' },
  'hud.configuracoes': { pt: 'Configurações', en: 'Settings' },
  'hud.menu': { pt: 'Menu', en: 'Menu' },
  'hud.salvo': { pt: 'Salvo', en: 'Saved' },
  'hud.erro_salvar': { pt: 'Erro ao salvar: {msg}', en: 'Save error: {msg}' },
  'hud.voltar_menu_confirm': { pt: 'Voltar ao menu? Seu progresso será salvo automaticamente.', en: 'Return to menu? Your progress will be saved automatically.' },

  // Settings
  'settings.titulo': { pt: 'Configurações', en: 'Settings' },
  'settings.aba_audio': { pt: 'Áudio', en: 'Audio' },
  'settings.aba_graficos': { pt: 'Gráficos', en: 'Graphics' },
  'settings.aba_jogabilidade': { pt: 'Jogabilidade', en: 'Gameplay' },
  'settings.resetar_aba': { pt: 'Resetar esta aba', en: 'Reset this tab' },
  'settings.resetar_tudo': { pt: 'Resetar tudo', en: 'Reset all' },
  'settings.audio.master': { pt: 'Master', en: 'Master' },
  'settings.audio.sfx': { pt: 'SFX Jogo', en: 'Game SFX' },
  'settings.audio.ui': { pt: 'SFX UI', en: 'UI SFX' },
  'settings.audio.aviso': { pt: 'Avisos', en: 'Alerts' },
  // ... (settings labels — 20+ keys)

  // Naves
  'nave.colonizadora': { pt: 'Colonizadora', en: 'Colonizer' },
  'nave.cargueira': { pt: 'Cargueira', en: 'Freighter' },
  'nave.batedora': { pt: 'Batedora', en: 'Scout' },
  'nave.torreta': { pt: 'Torreta', en: 'Turret' },
  'nave.sucatear': { pt: 'Sucatear nave "{tipo}"?', en: 'Scrap ship "{tipo}"?' },

  // Planetas (tipos reais do TIPO_PLANETA em planeta.ts)
  'planeta.comum': { pt: 'Comum', en: 'Common' },
  'planeta.marte': { pt: 'Rochoso', en: 'Rocky' },
  'planeta.gasoso': { pt: 'Gasoso', en: 'Gas Giant' },

  // New world modal
  'novo_mundo.titulo': { pt: 'Novo Mundo', en: 'New World' },
  'novo_mundo.nome_label': { pt: 'Nome do mundo', en: 'World name' },
  'novo_mundo.placeholder': { pt: 'Ex: Valoria Prime', en: 'e.g. Valoria Prime' },
  'novo_mundo.criar': { pt: 'Criar', en: 'Create' },
  'novo_mundo.cancelar': { pt: 'Cancelar', en: 'Cancel' },
  'novo_mundo.erro_vazio': { pt: 'Nome é obrigatório', en: 'Name is required' },
  'novo_mundo.erro_longo': { pt: 'Máximo 40 caracteres', en: 'Maximum 40 characters' },
  'novo_mundo.erro_duplicado': { pt: 'Já existe um mundo com esse nome', en: 'A world with this name already exists' },

  // Pause
  'pause.continuar': { pt: 'Continuar', en: 'Continue' },
  'pause.salvar': { pt: 'Salvar', en: 'Save' },
  'pause.sair': { pt: 'Sair', en: 'Exit' },

  // Loading
  'loading.criando': { pt: 'Criando mundo', en: 'Creating world' },
  'loading.carregando': { pt: 'Carregando mundo: {nome}', en: 'Loading world: {nome}' },

  // Toast
  'toast.salvo': { pt: 'Salvo', en: 'Saved' },
  'toast.erro_save': { pt: 'Erro ao salvar: {msg}', en: 'Save error: {msg}' },
  'toast.webgpu_fallback': { pt: 'WebGPU indisponível — usando WebGL', en: 'WebGPU unavailable — using WebGL' },
  'toast.fullscreen_bloqueado': { pt: 'Fullscreen bloqueado pelo navegador', en: 'Fullscreen blocked by browser' },

  // Input / Controles
  'input.titulo_secao': { pt: 'Controles', en: 'Controls' },
  'input.cat_camera': { pt: 'Câmera', en: 'Camera' },
  'input.cat_interface': { pt: 'Interface', en: 'Interface' },
  'input.cat_jogo': { pt: 'Jogo', en: 'Game' },
  'input.cat_debug': { pt: 'Debug', en: 'Debug' },
  'input.rebind': { pt: 'Rebind', en: 'Rebind' },
  'input.pressione': { pt: 'Pressione tecla...', en: 'Press key...' },
  'input.conflito': { pt: 'Já usado por "{acao}". Trocar?', en: 'Already used by "{acao}". Swap?' },
  'input.resetar': { pt: 'Resetar controles', en: 'Reset controls' },

  // Idioma
  'idioma.label': { pt: 'Idioma', en: 'Language' },
  'idioma.pt': { pt: 'Português', en: 'Portuguese' },
  'idioma.en': { pt: 'English', en: 'English' },

  // Renderer info modal
  'renderer.titulo': { pt: 'Informações do Renderer', en: 'Renderer Info' },
  'renderer.motor': { pt: 'Motor', en: 'Engine' },
  'renderer.versao': { pt: 'Versão', en: 'Version' },
  'renderer.gpu': { pt: 'GPU', en: 'GPU' },
  'renderer.vendor': { pt: 'Vendor', en: 'Vendor' },
  'renderer.driver': { pt: 'Driver', en: 'Driver' },
  'renderer.capacidades': { pt: 'Capacidades', en: 'Capabilities' },
  'renderer.fechar': { pt: 'Fechar', en: 'Close' },
  'renderer.bloqueado': { pt: 'bloqueado pelo navegador', en: 'blocked by browser' },
  'renderer.hw_ok': { pt: 'Aceleração por hardware ativa', en: 'Hardware acceleration active' },
  'renderer.sw_warn': { pt: 'Rodando em software — jogo vai travar', en: 'Running in software — game will lag' },

  // Tooltips (valores longos com \n)
  // Estes são incluídos no dicionário como strings multiline.
  // Omitidos aqui por brevidade — o plan inclui a lista completa.
  // Padrão: 'tooltips.gfx.qualidade', 'tooltips.gfx.fullscreen', etc.
};
```

**Estimativa final**: ~180-200 keys no dicionário (revisada pra cima após code review). O sample acima mostra o padrão — o dict completo é escrito durante implementação fase-a-fase.

**Strings adicionais identificadas via code review** (não exaustivo, lista completa descoberta durante implementação por grep):

- **sidebar.ts**: labels em EN hardcoded (`OVERVIEW`, `PLANETS`, `FLEETS`, `RESEARCH`, `CONSTRUCT`, `ALLIANCE`, `INBOX`, `MENU`)
- **notificacao.ts**: `"Planeta colonizado!"`, `"Fabrica T{n} construida!"`, etc.
- **planet-panel.ts**: `"Sob seu controle"`, `"Mundo neutro"`, `"Sem atividade"`, `"Tipo"`, `"Fabrica"`, `"Infra"`, `"Naves"`, `"Producao"`, `"Prox. ciclo"`
- **ship-panel.ts**: `estadoLabel` strings (`"Orbitando"`, `"Viajando"`, `"Parado"`, etc.)
- **colonizer-panel.ts**: `stageLabel` strings
- **empire-badge.ts**: `"LEVEL {n}"`
- **build-panel.ts**: build option labels

Todas essas são cobertas pelas fases de migração abaixo — a lista está organizada pra pegar tudo por módulo.

## B.3 Função `t()`

```ts
import { DICT } from './dict';
import { getConfig } from '../config';

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = DICT[key];
  if (!entry) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  const lang = getConfig().language ?? 'pt';
  let text = entry[lang] ?? entry.pt;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}
```

**Falha suave**: key ausente → retorna a key crua como texto visível + warning em dev. Garante que uma key esquecida não crasha o jogo, só mostra `menu.novo_jogo` literalmente.

## B.4 Config

```ts
language: 'pt' | 'en';  // default 'pt'
```

Extensão do `OrbitalConfig`. Trocar o idioma dispara o observer pattern existente.

## B.5 Reactivity com animação de transição

Quando o idioma muda via Settings:

**Componentes que recriam ao abrir** (planet-panel, ship-panel, build-panel, colonizer-panel, colony-modal, confirm-dialog, new-world-modal, renderer-info-modal, settings-panel): não precisam de listener reativo. A próxima abertura já chama `t()` e pega o novo idioma. **Zero trabalho reativo.**

**Componentes persistentes** que precisam de refresh (sidebar buttons, resource-bar labels, credits-bar, empire-badge, minimap labels, main-menu, pause-menu, loading-screen): registram um `onConfigChange` listener. Quando `config.language` muda, re-setam seus `textContent` via `t()`.

**Animação de transição**:

```
1. User seleciona novo idioma no Settings
2. body.classList.add('lang-transitioning')  →  fade-out 200ms (CSS opacity 0)
3. Após transitionend:
   - setConfig({ language: 'en' })  →  observers atualizam textos
4. body.classList.remove('lang-transitioning')  →  fade-in 200ms
```

CSS adicionado em `hud-layout.ts` (que já injeta CSS vars globais):

```css
.hud-fade-overlay {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 9999;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
.hud-fade-overlay.active {
  opacity: 1;
}
```

**Nota**: o fade usa um **overlay preto sobre tudo** em vez de `body.opacity = 0` — `body.opacity` esconderia o canvas Pixi junto com os textos HUD, causando um "tela preta" visual ruim. O overlay preto fica por cima (z-index 1100), esconde momentaneamente o conteúdo enquanto os textos são trocados, e depois desaparece. O canvas Pixi continua renderizando por baixo (ticker não para) — o jogador só vê o overlay por 400ms total.

**Sequência JS** (`src/core/i18n/idioma.ts`):

```ts
import { setConfig } from '../config';

let _overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'hud-fade-overlay';
  document.body.appendChild(el);
  _overlay = el;
  return el;
}

export function trocarIdioma(lang: 'pt' | 'en'): void {
  const overlay = ensureOverlay();
  overlay.classList.add('active');
  // Aguarda o CSS transition de opacity (200ms)
  overlay.addEventListener('transitionend', function handler() {
    overlay.removeEventListener('transitionend', handler);
    // Textos trocam aqui — invisíveis pro jogador
    setConfig({ language: lang });
    // Fade-in: remove a opacidade, texto novo aparece
    requestAnimationFrame(() => {
      overlay.classList.remove('active');
    });
  }, { once: true });
}
```

## B.6 Migração de strings — fases

Cada fase é um commit atômico que substitui strings hardcoded por `t('key')` em um módulo:

1. **Main menu** (`main-menu.ts`): ~11 strings → `t('menu.*')`
2. **HUD persistente** (sidebar, resource-bar, credits-bar, empire-badge): ~15 strings
3. **New world modal** (`new-world-modal.ts`): ~7 strings
4. **Painéis** (planet-panel, ship-panel, build-panel, colonizer-panel): ~40 strings
5. **Modais** (colony-modal, confirm-dialog, pause-menu): ~15 strings
6. **Settings panel** (settings-panel.ts): ~20 strings de labels + controles
7. **Tooltips de gráficos**: ~13 strings multiline
8. **Loading screen**: ~3 strings
9. **Toast/notificações**: ~5 strings
10. **Naves e planetas** (nomes de tipos): ~10 strings
11. **Input/controles labels**: ~15 strings (da Parte A)

**Nota sobre tipos de nave/planeta**: `nave.tipo` hoje é uma string como `'colonizadora'` usada tanto como ID interno (lógica) quanto como label de display. Pra i18n, o ID permanece PT (`'colonizadora'`), e o display vira `t('nave.colonizadora')`. Sem renomear IDs internos.

## B.7 UI — Seletor de idioma

Dentro da aba **Jogabilidade** do Settings, acima da seção Controles:

```
Idioma                [ Português ▼ ]
                        English

━━━ Controles ━━━
...
```

Dropdown simples. Trocar dispara a animação de fade-out/in + setConfig.

## B.8 Fora de escopo (i18n)

- Idiomas além de PT/EN
- Pluralização (se precisar: `params.count` + lógica manual no template)
- RTL
- Lazy loading de dicionário (o dict inteiro é <50KB — menos que um shader)
- Extração automática via AST
- Tradução do debug menu (fica sempre PT, é interno)
- Tradução dos nomes de planetas gerados proceduralmente (mantêm a lógica atual em `nomes.ts`)

## B.9 Testes (i18n)

**Unit tests** (vitest):

1. `t.test.ts` — `t('menu.novo_jogo')` retorna PT quando `language: 'pt'`, EN quando `language: 'en'`. `t('inexistente')` retorna a key crua. Interpolação `t('key', { nome: 'X' })` substitui `{nome}`.
2. `dict.test.ts` — todas as keys em DICT têm tanto `pt` quanto `en` (não tem entrada com valor faltando). Nenhuma key duplicada. Nenhum `{placeholder}` sem correspondência.

**Manual playtesting**:

1. Settings → Jogabilidade → Idioma → English → fade → todos os textos em EN.
2. Voltar pra PT → fade → tudo em PT.
3. Fechar settings → sidebar shows English labels if EN selected.
4. Reload → idioma persiste.
5. Abrir planet panel, ship panel → labels em EN.
6. Verificar que debug menu continua em PT.

## B.10 Arquivos afetados (i18n)

**Novos:**

```
src/core/i18n/dict.ts
src/core/i18n/t.ts
src/core/i18n/idioma.ts
src/core/i18n/__tests__/t.test.ts
src/core/i18n/__tests__/dict.test.ts
```

**Modificados** (~15):

```
src/core/config.ts             # adiciona language ao shape + defaults
src/ui/hud-layout.ts           # CSS de lang-transitioning
src/ui/main-menu.ts            # textContent → t('menu.*')
src/ui/sidebar.ts              # textContent → t('hud.*')
src/ui/new-world-modal.ts      # textContent → t('novo_mundo.*')
src/ui/planet-panel.ts         # textContent → t(...)
src/ui/ship-panel.ts           # idem
src/ui/build-panel.ts          # idem
src/ui/colonizer-panel.ts      # idem
src/ui/colony-modal.ts         # idem
src/ui/confirm-dialog.ts       # idem
src/ui/loading-screen.ts       # idem
src/ui/settings-panel.ts       # labels + seletor de idioma
src/ui/toast.ts                # mensagens via t()
src/ui/renderer-info-modal.ts  # labels via t()
src/world/planeta.ts           # nomeTipoPlaneta() usa t()
```

---

# PARTE C — GitHub Pages Deploy

## C.1 Mudanças

**`vite.config.ts`** — adiciona `base`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/orbital-fork/',
  server: {
    allowedHosts: true,
  },
});
```

**`.github/workflows/deploy.yml`** — workflow de deploy:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

**`public/.nojekyll`** — arquivo vazio. Impede GitHub Pages de processar como Jekyll (que ignora diretórios com `_` no nome, como `_assets`).

## C.2 Passo manual do usuário

Uma vez só: GitHub → Settings → Pages → Build and deployment → Source → **"GitHub Actions"**.

Documentado no spec e no plan como passo explícito com screenshot mental ("dropdown Source, seleciona GitHub Actions").

## C.3 Verificação

Após push na main e workflow green:

1. Abrir `https://caua726.github.io/orbital-fork/`
2. Jogo carrega → main menu visível
3. "Novo Jogo" → mundo funciona
4. Verificar console: sem erros 404 de assets

## C.4 Considerações técnicas

- Shaders importados como `?raw` (Vite inline no bundle) → nenhum fetch em runtime, base path não interfere.
- `localStorage` e `IndexedDB` na origin `caua726.github.io` → saves persistem entre sessões no mesmo browser.
- HTTPS automático → AudioContext, WebGPU, IndexedDB todos funcionam.
- O workflow roda `npm ci` (respeitando lockfile exato) + `npm run build` (que roda `tsc` via Vite). Se o build falhar, o deploy não acontece — proteção natural.

## C.5 Fora de escopo

- Custom domain, SSL custom, CDN
- Preview deploys por PR
- Rollback automático
- Cache invalidation headers (GH Pages gerencia)

## C.6 Arquivos afetados (Deploy)

**Novos:**

```
.github/workflows/deploy.yml
public/.nojekyll
```

**Modificados:**

```
vite.config.ts      # adiciona base: '/orbital-fork/'
```

---

# Riscos e mitigações (cross-cutting)

| Risco | Mitigação |
|-------|-----------|
| Rebind captura teclas do sistema (Alt+Tab, Ctrl+W) | Ignorar teclas com `e.altKey`, `e.ctrlKey`, `e.metaKey` no modo de captura |
| Pan contínuo (keydown→keyup) não funciona no dispatcher simples | Dispatcher expõe `onActionUp` pra keyup, pan usa estado booleano no ticker |
| i18n key esquecida mostra key crua no jogo | `t()` retorna key + warning em dev; test automatizado verifica que todas as keys em DICT têm pt + en |
| Fade de idioma interrompe gameplay por 400ms | O jogo continua rodando (Pixi ticker não para); só o opacity do body muda. Ações de game permanecem ativas |
| Build falha no workflow mas funciona local | Workflow usa `npm ci` (lockfile exato) + mesmo Node version. Se divergir, fix é atualizar lockfile |
| `base: '/orbital-fork/'` quebra em dev server | Vite ignora `base` no dev server (`/` é usado automaticamente) — sem impacto no desenvolvimento local |
| i18n dict fica enorme | ~160 keys × ~50 chars médio = ~8KB. Desprezível. Não precisa de lazy loading |
| Rebind de F5 impede reload do browser | `e.preventDefault()` no dispatcher bloqueia o comportamento padrão do F5. Documentar que o jogador pode usar Ctrl+R pra reload manual |

---

# Testing strategy (unified)

**Unit tests novos** (vitest):

1. `src/core/input/__tests__/keymap.test.ts` — getActiveKeymap, resolveKeyToAction, detectarConflito
2. `src/core/input/__tests__/dispatcher.test.ts` — mock KeyboardEvent, onAction/onActionUp, filtro de INPUT/TEXTAREA
3. `src/core/i18n/__tests__/t.test.ts` — tradução PT/EN, interpolação, key ausente
4. `src/core/i18n/__tests__/dict.test.ts` — cobertura de keys (todas têm pt+en), sem duplicatas, placeholders válidos

**Manual playtesting checklist**:

*Input:*
1. WASD move câmera (preserva comportamento existente)
2. Rebind "Câmera cima" pra KeyI → I funciona, W para
3. Conflito de tecla → alerta + swap
4. Resetar controles → defaults voltam
5. F5 quicksave → toast "Salvo"
6. Space pausa jogo
7. 1/2/3 mudam velocidade

*i18n:*
8. Idioma → EN → fade → todos os textos em EN
9. Idioma → PT → fade → tudo volta
10. Reload → idioma persiste
11. Painéis em EN (planet, ship, build, colonizer)
12. Debug menu permanece PT
13. Tooltips de gráficos em EN

*Deploy:*
14. Push na main → workflow green
15. `caua726.github.io/orbital-fork/` → jogo carrega
16. Console sem 404s

---

# Dependências entre as 3 partes

```
Input (Parte A)  ←───→  nenhuma dependência
   ↑
   │ as labels dos controles usam t() da Parte B
   │ (se A for implementada antes de B, usa strings PT hardcoded temporárias;
   │  quando B entrar, migra pra t() como parte da fase 11 do B)
   ↓
i18n (Parte B)   ←───→  nenhuma dependência direta com C
   ↑
   │ nenhuma
   ↓
Deploy (Parte C) ←───→  totalmente independente
```

**Ordem de execução recomendada**: C (deploy) primeiro (é 30 minutos de trabalho e destrava o deploy automático pra tudo que vier depois), depois A (input), depois B (i18n — maior, e migra as labels do A também).

Alternativamente: qualquer ordem funciona porque são independentes.
