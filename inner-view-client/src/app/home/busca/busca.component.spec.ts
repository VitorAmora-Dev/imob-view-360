import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { BuscaComponent } from './busca.component';
import { FILTROS_VAZIOS, PropertyFilters } from '../property-filters';

/**
 * A barra fechada da home — a casca da busca.
 *
 * Ela substituiu tres mecanicas (searchbar, bloco de filtros e chips), e o que
 * estes casos guardam e o que nao pode se perder na troca: o resumo do que
 * esta ativo, e o atalho de limpar sem abrir tela nenhuma.
 *
 * O PAINEL tem spec proprio, ao lado: o conteudo de um `ion-modal` mora num
 * `<ng-template>` e so existe no DOM depois de apresentado, e apresentar um
 * modal de verdade num TestBed falha com "framework delegate is missing".
 */
describe('BuscaComponent', () => {
  let fixture: ComponentFixture<BuscaComponent>;
  let componente: BuscaComponent;

  function montar(filtros: PropertyFilters = FILTROS_VAZIOS): void {
    TestBed.configureTestingModule({
      imports: [BuscaComponent],
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });

    fixture = TestBed.createComponent(BuscaComponent);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('filters', filtros);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(async () => {
    // O `present()` do Ionic e assincrono, e destruir a fixture no meio dele
    // deixa o modal orfao no `document` — que vaza para o proximo spec da
    // rodada. Esperar assentar antes de desmontar e o que impede isso.
    if (componente?.aberta()) await fixture.whenStable();
    fixture?.destroy();
  });

  it('sem criterio, convida a buscar', () => {
    montar();

    expect(el().querySelector('.busca__convite')?.textContent).toContain(
      'HOME.SEARCH_PLACEHOLDER',
    );
    expect(el().querySelector('.busca__resumo')).toBeNull();
  });

  /**
   * A ordem e a dos passos: onde, finalidade, tipo. Ler a barra tem de ser a
   * mesma experiencia de ter preenchido o painel de cima para baixo.
   */
  it('mostra o resumo na ordem dos passos', () => {
    montar({ query: 'Canoas', purpose: 'RENT', type: 'HOUSE' });

    const partes = Array.from(el().querySelectorAll('.busca__parte')).map((n) =>
      n.textContent!.trim(),
    );

    expect(partes).toEqual(['Canoas', 'UPLOAD.PURPOSE.RENT', 'UPLOAD.TYPE.HOUSE']);
    expect(el().querySelector('.busca__convite')).toBeNull();
  });

  it('tocar na barra abre o painel', async () => {
    montar();

    el().querySelector<HTMLButtonElement>('[data-acao="abrir"]')!.click();
    fixture.detectChanges();

    expect(componente.aberta()).toBeTrue();

    const modal = el().querySelector('ion-modal') as unknown as { isOpen: boolean };
    expect(modal.isOpen).toBeTrue();
  });

  /**
   * O atalho que os chips davam: desfazer sem abrir uma tela para isso. Com
   * tres criterios so, limpar TUDO vale mais que a mecanica de um por um.
   */
  it('o X limpa tudo sem abrir o painel', () => {
    montar({ query: 'Canoas', purpose: 'RENT', type: 'HOUSE' });
    const emitidos: PropertyFilters[] = [];
    componente.filtersChange.subscribe((f) => emitidos.push(f));

    el().querySelector<HTMLButtonElement>('[data-acao="limpar"]')!.click();
    fixture.detectChanges();

    expect(emitidos).toEqual([FILTROS_VAZIOS]);
    expect(componente.aberta()).toBeFalse();
  });

  it('sem criterio nao ha o que limpar', () => {
    montar();

    expect(el().querySelector('[data-acao="limpar"]')).toBeNull();
  });

  /** O painel devolve os criterios uma vez; a casca repassa e fecha. */
  it('buscar repassa os criterios e fecha', () => {
    montar();
    const emitidos: PropertyFilters[] = [];
    componente.filtersChange.subscribe((f) => emitidos.push(f));
    componente.aberta.set(true);

    componente.aplicar({ query: 'Canoas', purpose: 'RENT', type: null });

    expect(emitidos).toEqual([{ query: 'Canoas', purpose: 'RENT', type: null }]);
    expect(componente.aberta()).toBeFalse();
  });
});
