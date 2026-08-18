import { TestBed } from '@angular/core/testing';
import { TrashIconComponent } from './trash-icon.component';

/**
 * O ícone existe para ser da cor de quem o hospeda.
 *
 * Este teste guarda exatamente isso, porque o motivo de o emoji 🗑 ter saído
 * daqui é invisível no Chrome do desenvolvedor: emoji ignora `color` e sai
 * sempre no desenho do sistema, então no iPhone o botão vermelho teria um ícone
 * cinza-azulado e a pílula escura da lixeira teria um ícone colorido. Trocar o
 * `stroke="currentColor"` por uma cor fixa — ou voltar ao emoji — passaria
 * despercebido numa revisão e reapareceria só no aparelho de alguém.
 */
describe('TrashIconComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TrashIconComponent] });
  });

  it('pinta o traço com a cor herdada do host', () => {
    const fixture = TestBed.createComponent(TrashIconComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    // O documento de teste não tem a folha do wizard; o valor literal é o
    // --ion-color-danger, e o que se mede é a herança, não o token.
    host.style.color = 'rgb(193, 53, 21)';
    document.body.appendChild(host);

    const svg = host.querySelector('svg')!;
    expect(getComputedStyle(svg).stroke).toBe('rgb(193, 53, 21)');

    host.remove();
  });

  it('não se anuncia sozinho — quem tem rótulo é o botão que o contém', () => {
    const fixture = TestBed.createComponent(TrashIconComponent);
    fixture.detectChanges();

    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // Sem isto o SVG entra na ordem de tabulação no IE/Edge legado e, mais
    // relevante, vira um segundo parador de foco dentro do próprio botão.
    expect(svg.getAttribute('focusable')).toBe('false');
  });
});
