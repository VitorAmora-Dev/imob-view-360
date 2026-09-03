import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import {
  CenaDaFaixa,
  PassagesSceneStripComponent,
} from './passages-scene-strip.component';

const CENAS: CenaDaFaixa[] = [
  { id: 'sala', nome: 'Sala', thumb: 'blob:sala' },
  { id: 'cozinha', nome: 'Cozinha', thumb: 'blob:cozinha' },
  { id: 'quarto', nome: 'Quarto', thumb: '' },
];

describe('PassagesSceneStripComponent', () => {
  let fixture: ComponentFixture<PassagesSceneStripComponent>;
  let componente: PassagesSceneStripComponent;

  function montar(atualId: string | null = 'sala') {
    fixture = TestBed.createComponent(PassagesSceneStripComponent);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('cenas', CENAS);
    fixture.componentRef.setInput('atualId', atualId);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  const abas = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[role="tab"]')) as HTMLElement[];

  it('desenha uma aba por cena, na ordem recebida', () => {
    const host = montar();

    expect(abas(host).map((a) => a.getAttribute('data-cena'))).toEqual([
      'sala',
      'cozinha',
      'quarto',
    ]);
  });

  it('marca a cena que está na tela, e só ela recebe Tab', () => {
    const host = montar('cozinha');

    expect(abas(host).map((a) => a.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(abas(host).map((a) => a.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
    ]);
  });

  /**
   * Sem cena na tela — o primeiro frame da revisão, antes de a textura chegar —
   * o Tab precisa ter onde pousar. Sem isto a faixa inteira sai da ordem de
   * tabulação e o teclado não a alcança.
   */
  it('sem cena na tela, o Tab pousa na primeira', () => {
    const host = montar(null);

    expect(abas(host).map((a) => a.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);
  });

  /**
   * `<img>` sempre no DOM, e sem `src` enquanto o `blob:` não chega: com
   * `src=""` o navegador desenha o ícone de imagem quebrada, e o que se quer
   * ali é o fundo do botão, que é o estado de carregando.
   */
  it('a miniatura que não chegou não vira imagem quebrada', () => {
    const host = montar();
    const imagens = Array.from(host.querySelectorAll('img'));

    expect(imagens[0].getAttribute('src')).toBe('blob:sala');
    expect(imagens[2].hasAttribute('src')).toBeFalse();
    expect(abas(host)[2].classList).toContain('is-carregando');
  });

  it('tocar numa cena a devolve para quem escuta', () => {
    const host = montar();
    const escolhida = spyOn(componente.escolhida, 'emit');

    abas(host)[1].click();

    expect(escolhida).toHaveBeenCalledOnceWith('cozinha');
  });

  describe('o teclado', () => {
    /**
     * O foco é verificado por espião, e não por `document.activeElement`: a
     * suíte deixa `<ion-modal>` de outros specs pendurado no `<body>`, e o foco
     * do documento pode estar dentro dele. O que interessa aqui é que a faixa
     * chamou `focus()` na aba certa.
     */
    it('as setas percorrem, dão a volta e levam o foco junto', () => {
      const host = montar();
      const escolhida = spyOn(componente.escolhida, 'emit');
      const focoNaCozinha = spyOn(abas(host)[1], 'focus');

      abas(host)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(escolhida).toHaveBeenCalledWith('cozinha');
      expect(focoNaCozinha).toHaveBeenCalled();

      abas(host)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(escolhida).toHaveBeenCalledWith('quarto');
    });

    it('Home e End vão aos extremos', () => {
      const host = montar();
      const escolhida = spyOn(componente.escolhida, 'emit');

      abas(host)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      expect(escolhida).toHaveBeenCalledWith('quarto');

      abas(host)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
      expect(escolhida).toHaveBeenCalledWith('sala');
    });

    it('uma tecla que não é de navegação não troca de cena', () => {
      const host = montar();
      const escolhida = spyOn(componente.escolhida, 'emit');

      abas(host)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(escolhida).not.toHaveBeenCalled();
    });
  });

  /**
   * O ARRASTO que gira a foto é o gesto principal do palco, e a faixa cai em
   * cima dele. Um retângulo transparente com `pointer-events: auto` engole o
   * arrasto igual a um opaco — transparência não conta para hit test.
   */
  it('só o trilho intercepta o toque; a faixa em volta, não', () => {
    const host = montar();
    const trilho = host.querySelector('.pf__trilho') as HTMLElement;

    expect(getComputedStyle(host).pointerEvents).toBe('none');
    expect(getComputedStyle(trilho).pointerEvents).toBe('auto');
  });
});
