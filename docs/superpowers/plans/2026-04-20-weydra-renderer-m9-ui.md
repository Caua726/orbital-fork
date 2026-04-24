# weydra-renderer M9 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Últimos overlays Pixi (minimap, tutorial, painéis, selecao) migram pra weydra, usando Graphics (M7) + Text (M8). Ao fim do M9, `src/ui/` não importa nada de `pixi.js`. Input nesses overlays já está em DOM depois do M7 — este plano é sobre layout/rendering.

**Architecture:** Cada overlay (minimapa, tutorial, painel, selecao) migra de `Pixi.Container` composto com `Graphics + Text + Sprite` pra um agregado equivalente em weydra. API TS de `Graphics.circle().fill()` continua idêntica (M7); `Text.text = ...` continua idêntica (M8). Substituição é mecânica.

## Convenções transversais (aplicam a todos os Tasks)

### Z-order

Weydra renderiza pools em ordem crescente de `z_order: f32`. UI overlays precisam ficar **acima** de tudo do mundo. Criar `src/core/render-order.ts` **neste milestone** (Task 0) — não esperar M10:

```typescript
// src/core/render-order.ts
export const Z = {
  STARFIELD: 0,
  STARFIELD_BRIGHT: 1,
  PLANET_BAKED: 10,
  PLANET_LIVE: 11,
  ORBITS: 20,
  ROUTES: 25,
  SHIP_TRAILS: 28,
  SHIPS: 30,
  BEAMS: 35,
  FOG: 40,
  UI_BACKGROUND: 50,
  UI_GRAPHICS: 51,
  UI_TEXT: 52,
  UI_HOVER: 55,
} as const;
```

Cada arquivo em M9 importa `import { Z } from '../core/render-order'`. M10 reusa o mesmo arquivo e adiciona sprites/planets a ele — não duplica.

### Graphics em screen-space

O shader `graphics.wgsl` (M7) por padrão aplica transform de camera (world-space). UI Graphics não quer isso. M7 já precisa expor uma flag `worldSpace: boolean` no `Graphics` class, ou o engine precisa duas pipelines (world + screen). **Dependência bloqueante pro M9:** se M7 não expôs ainda, adicionar como pré-requisito task:

```typescript
// M7 precisa ter:
const g = r.createGraphics({ worldSpace: false }); // screen-space
```

Se M7 foi merged sem isso, abrir follow-up task antes de começar M9. Text (M8) já tem flag `worldSpace` no `createText`.

### Hit-test e devicePixelRatio

Weydra canvas é desenhado em pixels físicos (`canvas.width = cssWidth * devicePixelRatio`). Graphics coords neste plano são passadas nesse mesmo espaço (ex: `roundRect(MX, MY, MW, MH, ...)` com `MX/MY/MW/MH` em pixel físico). DOM `PointerEvent.clientX/Y` é em CSS pixel. Conversão obrigatória em todo hit-test:

```typescript
function toCanvasXY(ev: PointerEvent, canvas: HTMLCanvasElement): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return [(ev.clientX - rect.left) * dpr, (ev.clientY - rect.top) * dpr];
}
```

Alternativa: armazenar bounds em CSS px e converter para pixel físico só antes do render. Escolha: **bounds em pixel físico** (matches o que o Graphics desenha).

### Listener lifecycle

Todo `canvas.addEventListener` criado por um overlay **precisa ser destruído no `destruir()`** do overlay. Pattern obrigatório:

```typescript
const handlers = {
  onDown: (ev: PointerEvent) => { /* ... */ },
  onMove: (ev: PointerEvent) => { /* ... */ },
};
canvas.addEventListener('pointerdown', handlers.onDown);
canvas.addEventListener('pointermove', handlers.onMove);

return {
  destruir: () => {
    canvas.removeEventListener('pointerdown', handlers.onDown);
    canvas.removeEventListener('pointermove', handlers.onMove);
    // ... destroy all graphics/text nodes
  },
};
```

Leak de listener é bug crítico — overlay fechado continua reagindo a cliques do mundo.

### Overlay tick

Overlays animados (tutorial slide-in, painel fade, etc) expõem `tick(dtSec)`. Ninguém chama isso automaticamente — precisa wiring explícito. Criar `src/ui/overlay-registry.ts`:

```typescript
type Overlay = { tick?: (dtSec: number) => void; destruir: () => void };
const overlays: Set<Overlay> = new Set();

export function registerOverlay(o: Overlay): () => void {
  overlays.add(o);
  return () => { overlays.delete(o); };
}

export function tickOverlays(dtSec: number): void {
  for (const o of overlays) o.tick?.(dtSec);
}
```

O game loop (weydra-loader ou game-tick.ts) chama `tickOverlays(dtSec)` por frame. Cada overlay registra na criação e desregistra no `destruir`.

### Hoisting de estado

Closures de event handler que leem estado compartilhado (ex: minimap lê `estadoAtual`) precisam declaração explícita antes do `addEventListener`. Sempre:

```typescript
let estadoAtual: EstadoMundo | null = null;
const handlers = {
  onDown: (ev: PointerEvent) => {
    if (!estadoAtual) return;
    // ... usa estadoAtual com segurança
  },
};
canvas.addEventListener('pointerdown', handlers.onDown);

return {
  atualizar: (estado) => { estadoAtual = estado; /* redraw */ },
  destruir: () => { /* remove listener */ },
};
```

**Tech Stack:** M7 Graphics + M8 Text + M3 Sprite (para ícones).

**Depends on:** M7 + M8 complete.

---

## File Structure

**Modified (todos no game — nada novo em weydra-renderer):**
- `src/ui/minimapa.ts` — background + dots + viewport rect + título
- `src/ui/tutorial.ts` — frame + text + close button
- `src/ui/painel.ts` — backgrounds + botões + textos (painel lateral + bottom-sheet)
- `src/ui/selecao.ts` — selection cards (bg + text + hover state)
- `src/world/mundo.ts` — remover `addChild` em containers Pixi pra esses objetos quando flag on
- `src/core/config.ts` — `weydra.ui` flag

---

### Task 0: Pré-requisitos compartilhados

**Files:**
- Create: `src/core/render-order.ts` (Z constants)
- Create: `src/ui/overlay-registry.ts`
- Create: `src/ui/_dom-helpers.ts` (toCanvasXY + rgbaWithAlpha)

- [ ] **Step 1: Z constants**

Conforme seção "Convenções transversais". Exporta `Z`.

- [ ] **Step 2: overlay-registry**

Conforme seção "Overlay tick". Exporta `registerOverlay`, `tickOverlays`.

- [ ] **Step 3: dom-helpers**

```typescript
export function toCanvasXY(ev: PointerEvent, canvas: HTMLCanvasElement): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return [(ev.clientX - rect.left) * dpr, (ev.clientY - rect.top) * dpr];
}

export function rgbaWithAlpha(rgb: number, alpha01: number): number {
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  return ((rgb & 0xFFFFFF) << 8) | a;
}
```

- [ ] **Step 4: Wire tickOverlays no game loop**

Em `src/weydra-loader.ts` (ou game-tick.ts do M10):
```typescript
import { tickOverlays } from './ui/overlay-registry';
// No loop: tickOverlays(dtSec); antes de _renderer.render();
```

- [ ] **Step 5: Commit**

```bash
git add src/core/render-order.ts src/ui/overlay-registry.ts src/ui/_dom-helpers.ts src/weydra-loader.ts
git commit -m "feat(ui): shared Z constants + overlay registry + DOM helpers for M9"
```

---

### Task 1: Inventário + plano de migração

**Files:**
- Read only — levantamento.

- [ ] **Step 1: Mapear cada arquivo**

Fazer um `grep -n 'from .pixi.js' src/ui/*.ts` e listar imports atuais. Para cada overlay, mapear:

| Arquivo | Containers | Graphics | Text (M8 já cuida) | Sprites |
|---|---|---|---|---|
| `minimapa.ts` | 1 (root) | ~4 (bg, dots, viewport, título bg) | 1 | 0 |
| `tutorial.ts` | 1 (root) | 1 (frame) | ~8 (título + linhas + close) | 0 |
| `painel.ts` | 1-3 (root + secções) | ~5 (backgrounds de seções) | ~24 | 0 |
| `selecao.ts` | 1 (root) | ~N cards × (bg, hover ring) | ~4 (N cards × labels) | 0 |

- [ ] **Step 2: Sem commit — este step é só planejamento in-conversation**

---

### Task 2: Minimapa via weydra

**Files:**
- Modify: `src/ui/minimapa.ts`

- [ ] **Step 1: Substituir Graphics**

Hoje minimap cria `const g = new Graphics()` e desenha rect + dots + viewport.

```typescript
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { criarText } from './_text-helper'; // M8

export function montarMinimapa(/* args */) {
  if (getConfig().weydra.ui) {
    const r = getWeydraRenderer();
    if (r) {
      const bg = r.createGraphics({ worldSpace: false });       bg.zOrder = Z.UI_BACKGROUND;
      const dots = r.createGraphics({ worldSpace: false });     dots.zOrder = Z.UI_GRAPHICS;
      const viewport = r.createGraphics({ worldSpace: false }); viewport.zOrder = Z.UI_HOVER;
      const titulo = r.createText(FONT_SMALL, 16, false);
      titulo.zOrder = Z.UI_TEXT;
      titulo.text = 'MINIMAP';

      let estadoAtual: any = null;
      const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement;
      const handlers = {
        onDown: (ev: PointerEvent) => {
          if (!estadoAtual) return;
          const [x, y] = toCanvasXY(ev, canvas);
          if (x < MX || x >= MX + MW || y < MY || y >= MY + MH) return;
          const wx = ((x - MX) / MW) * estadoAtual.worldW;
          const wy = ((y - MY) / MH) * estadoAtual.worldH;
          camera.goTo(wx, wy);
        },
      };
      canvas.addEventListener('pointerdown', handlers.onDown);

      const overlay = {
        destruir: () => {
          canvas.removeEventListener('pointerdown', handlers.onDown);
          r.destroyGraphics(bg); r.destroyGraphics(dots); r.destroyGraphics(viewport);
          r.destroyText(titulo);
          desregistrar();
        },
      };
      const desregistrar = registerOverlay(overlay);
      return {
        atualizar: (estado) => {
          estadoAtual = estado;
          bg.clear().roundRect(MX, MY, MW, MH, 4).fill(0x0a0f1c, 0.75).stroke({ width: 1, color: 0x2a3a5a });
          dots.clear();
          for (const p of estado.planetas) {
            const px = MX + (p.x / estado.worldW) * MW;
            const py = MY + (p.y / estado.worldH) * MH;
            dots.circle(px, py, 1.2).fill(corPlaneta(p));
          }
          viewport.clear().rect(viewX, viewY, viewW, viewH).stroke({ width: 1, color: 0x66ccff, alpha: 0.8 });
          titulo.x = MX + 4; titulo.y = MY + 2;
        },
        ...overlay,
      };
    }
  }
  // existing Pixi path
}
```

- [ ] **Step 2: Click handler já é DOM (M7)**

Verificar que `canvas.addEventListener('pointerdown', ...)` feito em M7 funciona igual quando weydra canvas é o topo (M10) ou abaixo (M1-M9). Durante a migração, Pixi canvas está em cima com `pointer-events: none` em áreas transparentes — testar.

- [ ] **Step 3: Commit**

```bash
git add src/ui/minimapa.ts
git commit -m "feat(orbital): minimap via weydra graphics + text"
```

---

### Task 3: Tutorial via weydra

**Files:**
- Modify: `src/ui/tutorial.ts`

- [ ] **Step 1: Substituir graphics frame**

Tutorial tem frame + 1 título + N linhas + close button. Frame é Graphics; título/linhas/close são Text (já M8).

```typescript
if (getConfig().weydra.ui) {
  const r = getWeydraRenderer();
  if (r) {
    const frame = r.createGraphics();  frame.zOrder = Z.UI_BACKGROUND;
    const titulo = r.createText(FONT_LARGE, 64);
    titulo.zOrder = Z.UI_TEXT;
    const linhas = linhasTexto.map(() => {
      const t = r.createText(FONT_MEDIUM, 96);
      t.zOrder = Z.UI_TEXT;
      return t;
    });
    const close = r.createText(FONT_MEDIUM, 8);
    close.zOrder = Z.UI_TEXT;
    close.text = '[X]';

    // Animated state for slide-in / fade-out. Per-frame redraw reads these.
    const anim = { alpha: 0, targetAlpha: 1, offsetY: -40 };
    const closeRect = { x: 0, y: 0, w: 0, h: 0 };

    const redraw = () => {
      const cy = fy + anim.offsetY;
      frame.clear()
        .roundRect(fx, cy, fw, fh, 8)
        .fill(0x0a1020, 0.92 * anim.alpha)
        .stroke({ width: 1, color: 0x3366aa, alpha: anim.alpha });
      titulo.x = fx + 16; titulo.y = cy + 12; titulo.text = tituloStr;
      titulo.color = rgbaWithAlpha(0xffffff, anim.alpha);
      for (let i = 0; i < linhas.length; i++) {
        linhas[i].x = fx + 16;
        linhas[i].y = cy + 48 + i * 20;
        linhas[i].text = `- ${linhasTexto[i]}`;
        linhas[i].color = rgbaWithAlpha(0xcccccc, anim.alpha);
      }
      close.x = fx + fw - 32; close.y = cy + 12;
      close.color = rgbaWithAlpha(0xff6666, anim.alpha);
      closeRect.x = fx + fw - 36; closeRect.y = cy + 8;
      closeRect.w = 28; closeRect.h = 20;
    };

    const tick = (dtSec: number) => {
      anim.alpha += (anim.targetAlpha - anim.alpha) * Math.min(1, dtSec * 10);
      anim.offsetY += (0 - anim.offsetY) * Math.min(1, dtSec * 10);
      redraw();
    };

    const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement;
    const handlers = {
      onDown: (ev: PointerEvent) => {
        const [x, y] = toCanvasXY(ev, canvas);
        if (x >= closeRect.x && x < closeRect.x + closeRect.w &&
            y >= closeRect.y && y < closeRect.y + closeRect.h) {
          onClickClose();
        }
      },
    };
    canvas.addEventListener('pointerdown', handlers.onDown);

    const overlay = {
      tick,
      destruir: () => {
        canvas.removeEventListener('pointerdown', handlers.onDown);
        r.destroyGraphics(frame);
        r.destroyText(titulo);
        for (const l of linhas) r.destroyText(l);
        r.destroyText(close);
        desregistrar();
      },
    };
    const desregistrar = registerOverlay(overlay);
    return { redraw, ...overlay };
  }
}
```

`rgbaWithAlpha` vem de `./_dom-helpers` (criado em Task 0). **Não** redefinir local — a versão canônica faz `& 0xFFFFFF` pra truncar RGBA input pra RGB antes de recombinar:

```typescript
import { rgbaWithAlpha } from './_dom-helpers';
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/tutorial.ts
git commit -m "feat(orbital): tutorial via weydra graphics + text"
```

---

### Task 4: Painel via weydra

**Files:**
- Modify: `src/ui/painel.ts`

- [ ] **Step 1: Migrar estrutura**

Painel é o mais denso. 24 Text (M8 já cuida), ~5 Graphics pra backgrounds de seções (planeta, naves, edifícios, pesquisa, carga), e botões de ação.

Estratégia: preservar a função `montarPainelPlaneta()`, branch no topo pra escolher Pixi vs weydra. Helper `criarText` (M8) já retorna weydra Text quando flag on; só substituir `new Graphics()` por `r.createGraphics({ worldSpace: false })`.

```typescript
import { Z } from '../core/render-order';
import { toCanvasXY } from './_dom-helpers';
import { registerOverlay } from './overlay-registry';

if (getConfig().weydra.ui) {
  const r = getWeydraRenderer();
  if (r) {
    const secaoPlaneta = r.createGraphics({ worldSpace: false }); secaoPlaneta.zOrder = Z.UI_BACKGROUND;
    const secaoNaves = r.createGraphics({ worldSpace: false });   secaoNaves.zOrder = Z.UI_BACKGROUND;
    // ... demais seções
    // Text via criarText helper — zOrder = Z.UI_TEXT aplicado no helper

    // Botões
    const btnConstruir = r.createGraphics({ worldSpace: false }); btnConstruir.zOrder = Z.UI_GRAPHICS;
    const btnPesquisa  = r.createGraphics({ worldSpace: false }); btnPesquisa.zOrder = Z.UI_GRAPHICS;
    const buttons: Array<{ bounds: {x:number;y:number;w:number;h:number}; onClick: () => void }> = [
      { bounds: { x: bcX, y: bcY, w: bcW, h: bcH }, onClick: onConstruirClick },
      { bounds: { x: bpX, y: bpY, w: bpW, h: bpH }, onClick: onPesquisaClick },
    ];

    const redraw = () => {
      secaoPlaneta.clear()
        .roundRect(sx, sy, sw, sh, 4)
        .fill(0x0a1020, 0.85)
        .stroke({ width: 1, color: 0x224466 });
      // ... repetir pra outras seções
      // Textos posicionados:
      txtPlanetas.x = sx + 8; txtPlanetas.y = sy + 20;
      txtPlanetas.text = `Planetas: ${count}`;

      btnConstruir.clear()
        .roundRect(bcX, bcY, bcW, bcH, 3)
        .fill(0x1a3a5a, 0.9)
        .stroke({ width: 1, color: 0x66ccff });
    };

    const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement;
    const handlers = {
      onDown: (ev: PointerEvent) => {
        const [x, y] = toCanvasXY(ev, canvas);
        for (const btn of buttons) {
          if (x >= btn.bounds.x && x < btn.bounds.x + btn.bounds.w &&
              y >= btn.bounds.y && y < btn.bounds.y + btn.bounds.h) {
            btn.onClick();
            return;
          }
        }
      },
    };
    canvas.addEventListener('pointerdown', handlers.onDown);

    const overlay = {
      destruir: () => {
        canvas.removeEventListener('pointerdown', handlers.onDown);
        r.destroyGraphics(secaoPlaneta);
        r.destroyGraphics(secaoNaves);
        r.destroyGraphics(btnConstruir);
        r.destroyGraphics(btnPesquisa);
        // destroy all text nodes via helper
        desregistrar();
      },
    };
    const desregistrar = registerOverlay(overlay);

    return { redraw, ...overlay };
  }
}
```

- [ ] **Step 2: Botões — nota**

Hit-test usa `toCanvasXY(ev, canvas)` (já inclui DPR). Handler armazenado em `handlers.onDown` como property — mesma referência usada no `addEventListener` e `removeEventListener`. Listener leak evitado.

- [ ] **Step 3: Commit**

```bash
git add src/ui/painel.ts
git commit -m "feat(orbital): painel via weydra graphics + text"
```

---

### Task 5: Selecao via weydra

**Files:**
- Modify: `src/ui/selecao.ts`

- [ ] **Step 1: Selection cards**

Cards de seleção (onde jogador escolhe nave/planeta alvo). Cada card = Graphics bg + hover ring + Text label.

```typescript
if (getConfig().weydra.ui) {
  const r = getWeydraRenderer();
  if (r) {
    const cards = candidates.map((c, i) => {
      const cardX = cardStartX + i * (CARD_W + GAP);
      const cardY = cardStartY;
      const bg = r.createGraphics();   bg.zOrder = Z.UI_BACKGROUND;
      const ring = r.createGraphics(); ring.zOrder = Z.UI_HOVER;
      const label = criarText(c.nome, 13, 0xffffff);
      if ((label as any)._weydra) (label as any)._weydra.zOrder = Z.UI_TEXT;
      return { c, bg, ring, label, hovered: false, pressed: false, x: cardX, y: cardY };
    });

    const redraw = () => {
      for (const card of cards) {
        card.bg.clear()
          .roundRect(card.x, card.y, CARD_W, CARD_H, 4)
          .fill(card.pressed ? 0x224477 : 0x0a1020, 0.9)
          .stroke({ width: 1, color: card.hovered ? 0x66ccff : 0x224466 });
        card.ring.clear();
        if (card.hovered) {
          card.ring.rect(card.x - 2, card.y - 2, CARD_W + 4, CARD_H + 4)
            .stroke({ width: 1, color: 0x66ccff, alpha: 0.6 });
        }
        card.label.x = card.x + 8; card.label.y = card.y + 8;
      }
    };

    function cardAt(x: number, y: number): typeof cards[number] | null {
      for (const c of cards) {
        if (x >= c.x && x < c.x + CARD_W && y >= c.y && y < c.y + CARD_H) return c;
      }
      return null;
    }

    const canvas = document.getElementById('weydra-canvas') as HTMLCanvasElement;
    const handlers = {
      onMove: (ev: PointerEvent) => {
        const [x, y] = toCanvasXY(ev, canvas);
        const hit = cardAt(x, y);
        let changed = false;
        for (const c of cards) {
          const h = c === hit;
          if (c.hovered !== h) { c.hovered = h; changed = true; }
        }
        if (changed) redraw();
      },
      onDown: (ev: PointerEvent) => {
        const [x, y] = toCanvasXY(ev, canvas);
        const hit = cardAt(x, y);
        if (hit) { hit.pressed = true; redraw(); }
      },
      onUp: (ev: PointerEvent) => {
        const [x, y] = toCanvasXY(ev, canvas);
        const hit = cardAt(x, y);
        for (const c of cards) c.pressed = false;
        if (hit) onSelectCard(hit.c);
        redraw();
      },
    };
    canvas.addEventListener('pointermove', handlers.onMove);
    canvas.addEventListener('pointerdown', handlers.onDown);
    canvas.addEventListener('pointerup', handlers.onUp);

    const overlay = {
      destruir: () => {
        canvas.removeEventListener('pointermove', handlers.onMove);
        canvas.removeEventListener('pointerdown', handlers.onDown);
        canvas.removeEventListener('pointerup', handlers.onUp);
        for (const card of cards) {
          r.destroyGraphics(card.bg);
          r.destroyGraphics(card.ring);
          if ((card.label as any)._weydra) r.destroyText((card.label as any)._weydra);
        }
        desregistrar();
      },
    };
    const desregistrar = registerOverlay(overlay);
    return { redraw, ...overlay };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/selecao.ts
git commit -m "feat(orbital): selecao cards via weydra graphics + text"
```

---

### Task 6: Config flag + remoção de adição a Pixi containers

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/world/mundo.ts` (ou onde os painéis são adicionados)

- [ ] **Step 1: Add flag**

```typescript
weydra: {
  // ... previous flags
  ui: boolean; // M9
}
```

- [ ] **Step 2: Skip Pixi addChild quando flag on**

Onde `app.stage.addChild(painel)` era chamado, branch:
```typescript
if (!getConfig().weydra.ui) {
  app.stage.addChild(painel);
}
// weydra path: draw é feito pelo render loop do weydra, não precisa stage.addChild
```

- [ ] **Step 3: Validar ausência de imports Pixi**

```bash
grep -rn "from 'pixi.js'" src/ui/
```

Esperado: retorna **vazio** (com flag on, os imports ainda existem pro path Pixi fallback). Sub-objetivo: quando M10 remove Pixi, esses imports somem junto.

- [ ] **Step 4: Commit**

```bash
git add src/core/config.ts src/world/mundo.ts
git commit -m "feat(orbital): weydra.ui flag + skip Pixi stage add when on"
```

---

### Task 7: Validation + M9 complete

- [ ] **Step 1: Visual parity**

Com flag on, comparar lado-a-lado com flag off:
- Minimap: dots em posição idêntica, viewport rect alinhado
- Tutorial: layout de texto, spacing de linhas, close button posicionado
- Painel: backgrounds de seção alinhados com os labels, contadores atualizando
- Selecao: cards com hover/press visual idêntico

Aceitar diff sub-pixel em borda de text (bitmap vs subpixel).

- [ ] **Step 2: Input functional**

Clique em todos os lugares que tinham eventMode Pixi:
- Minimap dot → navegar
- Tutorial close → fechar
- Painel botão pesquisa → abrir tree
- Painel botão construir → iniciar build
- Selecao card → selecionar alvo

Todos devem funcionar via DOM.

- [ ] **Step 3: Performance**

Frame time com painel aberto deve cair vs Pixi (UI overlay consome CPU em Pixi por texto re-rendering). Esperado: 10-30% melhor quando painel aberto.

- [ ] **Step 4: Mark complete**

```markdown
## M9 Status: Complete (YYYY-MM-DD)
UI via weydra. Minimap + tutorial + painel + selecao — todos os overlays Pixi
migrados. src/ui/ usa Pixi só pelo fallback path (removido em M10).
```

```bash
git add docs/superpowers/specs/
git commit -m "docs(weydra-renderer): mark M9 UI complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Minimap migrado
- ✅ Tutorial migrado
- ✅ Painel migrado
- ✅ Selecao migrado
- ✅ Input via DOM funcionando (M7 já fez re-wire)
- ✅ Feature flag

**Deferred:**
- Nenhum overlay Pixi remanescente esperado — se surgir (debug-menu, confirm-dialog, etc), adicionar sub-task aqui
- `Container.sortableChildren` — se algum overlay dependia disso pra z-order, resolver via `zOrder` do weydra

**Risks:**
- Durante coexistência (M9 on mas M10 não), Pixi canvas está por cima. Se overlay weydra estiver abaixo e conflita com hit-test Pixi de outro elemento, usar `pointer-events: none` seletivo no Pixi canvas nas regiões do overlay.
- Se painel usa `mask: Graphics` em Pixi pra scroll, weydra não tem mask primitive ainda. Audit: Pixi audit spec disse "não usa mask" — validar com `grep -n 'mask' src/ui/`.
- Botões quebrados em mobile (touch events). M7 já deveria ter resolvido com `pointerdown/pointerup` — confirmar no device real.
