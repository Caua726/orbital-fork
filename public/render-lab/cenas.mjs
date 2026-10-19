/**
 * Render scenes shared by the headless matrix (tests/render-matrix.mjs) and
 * the interactive render lab (public/render-lab/index.html).
 *
 * Every function here runs INSIDE the game page (Playwright `page.evaluate`
 * in the matrix, `iframe.contentWindow.eval` in the lab), so each one must be
 * self-contained: no closures over this module, only `window` and its args.
 * They drive the game through the dev hooks `window.__mundo`, `__setCam`,
 * `__setZoom`, `__test` and `__render` (src/world/render-matrix.ts).
 *
 * The world only changes through `__render.step(n)` (fixed dt), never wall
 * time, so the same scene is pixel-comparable across engines and backends.
 */

/**
 * Starts a seeded match through the real new-world UI (difficulty
 * "pacifico": no AI ships, no AI randomness) and freezes every clock.
 * Used by the lab; the matrix drives the same clicks through Playwright.
 */
export async function iniciarPartida(nome) {
  const esperar = async (cond, ms) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) throw new Error('tempo esgotado esperando o jogo');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const tela = () => document.querySelector('.orbital-error-screen')?.textContent ?? null;
  await esperar(() => tela() || (window._app && window.__render && document.querySelector('.menu-btn.primary')), 60000);
  if (tela()) throw new Error(tela().slice(0, 300));
  // Freeze BEFORE the world exists: from its first frame the sim only moves
  // through fixed steps, so orbits sit at the same angle in every engine
  // (freezing after load left a frame-count-dependent drift).
  window.__render.freeze(10);
  document.querySelector('.menu-btn.primary').click();
  await esperar(() => document.querySelector('.new-world-modal .nwm-input'), 10000);
  const input = document.querySelector('.new-world-modal .nwm-input');
  input.value = nome;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  for (let passo = 0; passo < 5; passo++) {
    for (const sel of document.querySelectorAll('.new-world-modal select')) {
      if ([...sel.options].some((o) => o.value === 'pacifico') && sel.value !== 'pacifico') {
        sel.value = 'pacifico';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    document.querySelector('.new-world-modal .nwm-btn.primary')?.click();
    await new Promise((r) => setTimeout(r, 60));
  }
  await esperar(() => window.__mundo?.()?.planetas?.length && !document.querySelector('.loading-screen.visible'), 120000);
  window.__render.freeze(10);
}

/** Deterministic world fixtures, computed once per match while frozen. */
export function prepararFixtures() {
  const m = window.__mundo();
  const home = m.planetas.find((p) => p.dados.dono === 'jogador');
  const sistema = m.sistemas.find((s) => s.planetas.includes(home));
  const sol = sistema.sol;
  const outro = m.sistemas
    .filter((s) => s !== sistema)
    .map((s) => ({ s, d: Math.hypot(s.sol.x - sol.x, s.sol.y - sol.y) }))
    .sort((a, b) => a.d - b.d)[0].s;
  // Ships parked in a row next to the home planet (positions pinned).
  const tipos = ['colonizadora', 'cargueira', 'batedora', 'torreta', 'fragata'];
  const frotaIds = tipos.map((t) => window.__test.spawn(t, 1)[0]);
  const fx = home.x + 260, fy = home.y - 160;
  frotaIds.forEach((id, i) => {
    const n = m.naves.find((x) => x.id === id);
    n.x = fx + i * 60; n.y = fy;
    n.estado = 'parado';
  });
  // A ship with a route (frozen, so it never moves).
  const rotaId = window.__test.spawn('batedora', 1)[0];
  const rn = m.naves.find((x) => x.id === rotaId);
  rn.x = home.x - 300; rn.y = home.y + 300;
  window.__test.send(rotaId, home.x - 900, home.y + 700);
  const r = (v) => Math.round(v);
  return {
    homeId: home.id,
    home: { x: r(home.x), y: r(home.y) },
    sol: { x: r(sol.x), y: r(sol.y) },
    vizinho: { x: r(outro.sol.x), y: r(outro.sol.y) },
    frota: { x: r(fx + 120), y: r(fy) },
    frotaIds,
    rota: { x: r(home.x - 600), y: r(home.y + 500) },
    vizinhoPlanetaId: outro.planetas[0]?.id ?? null,
  };
}

/**
 * Moves the camera, applies the layer mask and settles: two fixed sim steps
 * (culling, visibility and selection redraws only run inside the sim update,
 * so a paused world would show state computed for the PREVIOUS camera), then
 * re-pins the planet/sun clocks those steps advanced.
 */
export async function posicionar(cam) {
  window.__setCam(cam.x, cam.y);
  window.__setZoom(cam.zoom);
  window.__render.setLayers(cam.mask);
  // Zoom tweens in real time; let it land before re-pinning the camera.
  await new Promise((r) => setTimeout(r, 900));
  window.__setCam(cam.x, cam.y);
  await window.__render.step(2);
  window.__render.freeze(10);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/**
 * `setup({ L, ctx })` returns the camera `{ x, y, zoom, mask }` (or null when
 * a precondition failed). Dynamic scenes have `prepare({ ctx })` that
 * advances the sim and returns `{ patch, aviso? }` merged into ctx first.
 */
export const SCENES = [
  { id: 'starfield', title: 'Starfield procedural',
    setup: ({ L, ctx }) => ({ x: ctx.home.x, y: ctx.home.y, zoom: 1, mask: L.STARFIELD }) },
  { id: 'starfield-bright', title: 'Estrelas brilhantes (tiles)',
    setup: ({ L, ctx }) => ({ x: ctx.home.x, y: ctx.home.y, zoom: 1, mask: L.STARFIELD_BRIGHT }) },
  { id: 'fundo-completo', title: 'Fundo completo',
    setup: ({ L, ctx }) => ({ x: ctx.home.x, y: ctx.home.y, zoom: 1, mask: L.STARFIELD | L.STARFIELD_BRIGHT }) },
  { id: 'planeta-zoom', title: 'Planeta natal (shader, zoom 2)',
    setup: ({ L, ctx }) => ({ ...ctx.home, zoom: 2, mask: L.PLANETS }) },
  { id: 'planeta-zoom-baixo', title: 'Planeta natal (zoom 0.3)',
    setup: ({ L, ctx }) => ({ ...ctx.home, zoom: 0.3, mask: L.PLANETS }) },
  { id: 'sol', title: 'Sol',
    setup: ({ L, ctx }) => ({ ...ctx.sol, zoom: 1.2, mask: L.PLANETS }) },
  { id: 'sistema', title: 'Sistema (sol + planetas)',
    setup: ({ L, ctx }) => ({ ...ctx.sol, zoom: 0.5, mask: L.PLANETS }) },
  { id: 'orbitas', title: 'Linhas de órbita',
    setup: ({ L, ctx }) => ({ ...ctx.sol, zoom: 0.5, mask: L.ORBITS }) },
  { id: 'anel-planeta', title: 'Anel de seleção do planeta',
    setup: ({ L, ctx }) => {
      const home = window.__mundo().planetas.find((p) => p.id === ctx.homeId);
      home.dados.selecionado = true;
      return { ...ctx.home, zoom: 1, mask: L.PLANETS | L.UI };
    },
    teardown: ({ ctx }) => { window.__mundo().planetas.find((p) => p.id === ctx.homeId).dados.selecionado = false; } },
  { id: 'naves', title: 'Naves (todos os tipos)',
    setup: ({ L, ctx }) => ({ ...ctx.frota, zoom: 2, mask: L.SHIPS }) },
  { id: 'naves-selecionadas', title: 'Naves selecionadas (anel)',
    setup: ({ L, ctx }) => {
      for (const n of window.__mundo().naves) if (ctx.frotaIds.includes(n.id)) n.selecionado = true;
      return { ...ctx.frota, zoom: 2, mask: L.SHIPS };
    },
    teardown: ({ ctx }) => { for (const n of window.__mundo().naves) if (ctx.frotaIds.includes(n.id)) n.selecionado = false; } },
  { id: 'rota', title: 'Linha de rota + waypoint',
    setup: ({ L, ctx }) => ({ ...ctx.rota, zoom: 0.5, mask: L.ROUTES | L.SHIPS }) },
  { id: 'nevoa-so', title: 'Névoa (só a camada)',
    setup: ({ L, ctx }) => ({ ...ctx.home, zoom: 0.3, mask: L.FOG }) },
  { id: 'nevoa-sobre-mundo', title: 'Névoa sobre o mundo',
    setup: ({ L, ctx }) => ({ ...ctx.home, zoom: 0.3, mask: L.STARFIELD | L.STARFIELD_BRIGHT | L.PLANETS | L.FOG }) },
  { id: 'nevoa-sistema-vizinho', title: 'Sistema vizinho sob névoa',
    setup: ({ L, ctx }) => ({ ...ctx.vizinho, zoom: 0.5, mask: L.ALL_BITS }) },
  { id: 'fantasma', title: 'Fantasma da névoa (memória)',
    // Scout a neighbour planet, then lose sight of it → memory ghost.
    prepare: async ({ ctx }) => {
      if (ctx.fantasma !== undefined) return { patch: {} };
      const m = window.__mundo();
      const alvo = m.planetas.find((p) => p.id === ctx.vizinhoPlanetaId);
      if (!alvo) return { patch: { fantasma: null }, aviso: 'fantasma: sem planeta vizinho' };
      const id = window.__test.spawn('batedora', 1)[0];
      const n = m.naves.find((x) => x.id === id);
      n.x = alvo.x + 150; n.y = alvo.y; n.estado = 'parado';
      window.__setCam(alvo.x, alvo.y);
      await window.__render.step(30);
      window.__test.removeShip(id);
      await window.__render.step(30);
      const g = window.__test.ghost(alvo.id);
      return g?.hasMemoria
        ? { patch: { fantasma: { x: Math.round(alvo.x), y: Math.round(alvo.y) } } }
        : { patch: { fantasma: null }, aviso: 'fantasma: memória do planeta não foi criada' };
    },
    setup: ({ L, ctx }) => (ctx.fantasma ? { ...ctx.fantasma, zoom: 1, mask: L.ALL_BITS } : null) },
  { id: 'cena-completa', title: 'Cena completa no planeta natal',
    setup: ({ L, ctx }) => ({ ...ctx.home, zoom: 1, mask: L.ALL_BITS }) },
  { id: 'cena-completa-longe', title: 'Cena completa (zoom 0.3)',
    setup: ({ L, ctx }) => ({ ...ctx.home, zoom: 0.3, mask: L.ALL_BITS }) },
  // Dynamic ones last: they advance the sim (fixed steps).
  { id: 'trilhas', title: 'Trilhas de motor (nave em viagem)',
    prepare: async () => {
      const m = window.__mundo();
      const id = window.__test.spawn('fragata', 1)[0];
      const n = m.naves.find((x) => x.id === id);
      const home = m.planetas.find((p) => p.dados.dono === 'jogador');
      n.x = home.x + 400; n.y = home.y + 400;
      window.__test.send(id, home.x + 4000, home.y + 400);
      await window.__render.step(90);
      return { patch: { trilha: { x: Math.round(n.x - 120), y: Math.round(n.y) } } };
    },
    setup: ({ L, ctx }) => ({ ...ctx.trilha, zoom: 1.5, mask: L.SHIP_TRAILS | L.SHIPS }) },
  { id: 'combate', title: 'Combate (feixes + partículas)',
    prepare: async () => {
      const m = window.__mundo();
      const home = m.planetas.find((p) => p.dados.dono === 'jogador');
      // A turret is the only type that fires while 'parado', so both ships
      // stay put and the beam geometry is the same every run.
      const [a, b] = [window.__test.spawn('torreta', 1)[0], window.__test.spawn('fragata', 1)[0]];
      const na = m.naves.find((x) => x.id === a), nb = m.naves.find((x) => x.id === b);
      nb.dono = 'inimigo1';
      na.x = home.x - 200; na.y = home.y - 400; na.estado = 'parado';
      nb.x = home.x - 50; nb.y = home.y - 400; nb.estado = 'parado';
      for (let i = 0; i < 60 && window.__test.combatBytes() === 0; i++) await window.__render.step(5);
      await window.__render.step(6);
      const live = window.__test.combatBytes() > 0;
      return {
        patch: { combate: { x: Math.round(home.x - 125), y: Math.round(home.y - 400) } },
        aviso: live ? undefined : 'combate: nenhum feixe ativo no momento da captura',
      };
    },
    setup: ({ L, ctx }) => ({ ...ctx.combate, zoom: 1.5, mask: L.BEAMS | L.SHIPS }) },
];
