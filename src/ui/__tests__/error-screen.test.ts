import { afterEach, describe, expect, it } from 'vitest';
import { fecharTelaErro, mostrarTelaErro } from '../error-screen';

describe('error-screen', () => {
  afterEach(() => fecharTelaErro());

  it('renders untrusted messages as text rather than HTML', () => {
    void mostrarTelaErro({
      code: 'TEST',
      title: '<img src=x onerror=alert(1)>',
      summary: '<script>bad()</script>',
      error: '<b>technical</b>',
    });
    expect(document.querySelector('.orbital-error-screen img')).toBeNull();
    expect(document.querySelector('.orbital-error-screen script')).toBeNull();
    expect(document.querySelector('.orbital-error-screen')?.textContent).toContain('<script>bad()</script>');
  });

  it('returns the selected recovery action', async () => {
    const result = mostrarTelaErro({
      code: 'TEST_ACTION',
      title: 'Falha',
      summary: 'Escolha uma recuperação.',
      actions: [{ label: 'Modo seguro', value: 'safe', primary: true }],
    });
    (document.querySelector('.orbital-error-screen button') as HTMLButtonElement).click();
    await expect(result).resolves.toBe('safe');
  });
});
