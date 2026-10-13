export interface ErrorScreenAction {
  label: string;
  value: string;
  primary?: boolean;
}

export interface ErrorScreenOptions {
  code: string;
  title: string;
  summary: string;
  error?: unknown;
  actions?: ErrorScreenAction[];
}

let _screen: HTMLDivElement | null = null;

export function fecharTelaErro(): void {
  _screen?.remove();
  _screen = null;
}

export function mostrarTelaErro(opts: ErrorScreenOptions): Promise<string> {
  fecharTelaErro();
  const screen = document.createElement('div');
  screen.className = 'orbital-error-screen';
  screen.setAttribute('role', 'alertdialog');
  screen.setAttribute('aria-modal', 'true');
  screen.style.cssText = 'position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 25%,#17223a,#03050a 70%);color:#eaf3ff;font-family:"Silkscreen","VT323",monospace';

  const card = document.createElement('section');
  card.style.cssText = 'width:min(720px,100%);max-height:90vh;overflow:auto;border:1px solid #ff6b6b;background:rgba(5,9,18,.96);box-shadow:0 24px 80px #000;padding:24px';
  const code = document.createElement('div');
  code.textContent = opts.code;
  code.style.cssText = 'color:#ff8b8b;font-size:12px;letter-spacing:.14em';
  const title = document.createElement('h1');
  title.textContent = opts.title;
  title.style.cssText = 'font-size:24px;margin:14px 0;color:#fff';
  const summary = document.createElement('p');
  summary.textContent = opts.summary;
  summary.style.cssText = 'font-family:system-ui,sans-serif;line-height:1.55;color:#cbd8ea';
  card.append(code, title, summary);

  if (opts.error !== undefined) {
    const details = document.createElement('details');
    details.style.cssText = 'margin:18px 0;font-family:ui-monospace,monospace;font-size:12px;color:#9fb2ca;white-space:pre-wrap';
    const label = document.createElement('summary');
    label.textContent = 'Detalhes técnicos';
    const pre = document.createElement('pre');
    pre.textContent = opts.error instanceof Error
      ? `${opts.error.name}: ${opts.error.message}\n${opts.error.stack ?? ''}`
      : String(opts.error);
    details.append(label, pre);
    card.appendChild(details);
  }

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:20px';
  card.appendChild(actions);
  screen.appendChild(card);
  document.body.appendChild(screen);
  _screen = screen;

  return new Promise((resolve) => {
    for (const action of opts.actions ?? [{ label: 'Recarregar', value: 'reload', primary: true }]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.style.cssText = `padding:11px 16px;border:1px solid ${action.primary ? '#7cc7ff' : '#52647a'};background:${action.primary ? '#173653' : '#111a27'};color:#fff;font:inherit;cursor:pointer`;
      button.addEventListener('click', () => resolve(action.value), { once: true });
      actions.appendChild(button);
    }
    (actions.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
}

export function instalarErrorBoundary(): void {
  window.addEventListener('error', (event) => {
    if (_screen) return;
    void mostrarTelaErro({
      code: 'UNHANDLED_ERROR',
      title: 'O ORBITAL ENCONTROU UM ERRO',
      summary: 'A execução foi interrompida para evitar perda de estado. Você pode recarregar a página.',
      error: event.error ?? event.message,
    }).then((v) => { if (v === 'reload') window.location.reload(); });
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (_screen) return;
    void mostrarTelaErro({
      code: 'UNHANDLED_REJECTION',
      title: 'UMA OPERAÇÃO FALHOU',
      summary: 'Uma operação assíncrona não pôde ser concluída.',
      error: event.reason,
    }).then((v) => { if (v === 'reload') window.location.reload(); });
  });
}
