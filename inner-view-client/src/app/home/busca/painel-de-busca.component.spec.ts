import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { PainelDeBuscaComponent } from './painel-de-busca.component';
import { FILTROS_VAZIOS, PropertyFilters } from '../property-filters';

/**
 * Os tres passos da busca.
 *
 * O que estes casos guardam e a MECANICA: qual passo esta aberto, quando ele
 * avanca sozinho, e — o mais importante — que editar nao dispara nada. Antes
 * deste painel, cada mexida num `select` navegava na hora: trocar finalidade e
 * tipo custava duas requisicoes, e a segunda cancelava a primeira pelo
 * `switchMap` da home.
 *
 * Sem dicionario carregado, `TranslatePipe` devolve a propria chave (mesma
 * convencao de `scene-card.component.spec.ts`) — por isso as assercoes de texto
 * procuram `HOME.SEARCH.NEXT`, e nao "Proximo".
 */
describe('PainelDeBuscaComponent', () => {
  let fixture: ComponentFixture<PainelDeBuscaComponent>;
  let componente: PainelDeBuscaComponent;

  function montar(filtros: PropertyFilters = FILTROS_VAZIOS): void {
    TestBed.configureTestingModule({
      imports: [PainelDeBuscaComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    });

    fixture = TestBed.createComponent(PainelDeBuscaComponent);
    componente = fixture.componentInstance;
    fixture.componentRef.setInput('filters', filtros);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** O `data-passo` da secao que esta aberta. Ha sempre exatamente uma. */
  function passoAberto(): string | null {
    return el().querySelector('.passo--aberto')?.getAttribute('data-passo') ?? null;
  }

  function clicar(seletor: string): void {
    el().querySelector<HTMLButtonElement>(seletor)!.click();
    fixture.detectChanges();
  }

  function textoDoSeguir(): string {
    return el().querySelector('[data-acao="seguir"]')!.textContent!.trim();
  }

  function digitar(texto: string): void {
    const campo = el().querySelector<HTMLInputElement>('[data-campo="query"]')!;
    campo.value = texto;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('abre no primeiro passo', () => {
    montar();
    expect(passoAberto()).toBe('query');
  });

  it('tocar num passo fechado abre ele', () => {
    montar();

    clicar('[data-passo="type"] .passo__resumo');

    expect(passoAberto()).toBe('type');
  });

  /**
   * O toque ja disse tudo o que o passo tinha a perguntar. Cobrar um segundo
   * toque em "Proximo" seria cobrar duas vezes pela mesma resposta.
   */
  it('escolher a finalidade grava e avanca', () => {
    montar();
    clicar('[data-passo="purpose"] .passo__resumo');

    clicar('[data-opcao="purpose:RENT"]');

    expect(componente.rascunho().purpose).toBe('RENT');
    expect(passoAberto()).toBe('type');
  });

  /**
   * Tipo e o ultimo: nao ha para onde avancar, e o que vem depois dele e o
   * "Buscar". Mandar embora sozinho tiraria a chance de rever a escolha antes
   * de disparar a consulta.
   */
  it('escolher o tipo nao avanca', () => {
    montar();
    clicar('[data-passo="type"] .passo__resumo');

    clicar('[data-opcao="type:APARTMENT"]');

    expect(componente.rascunho().type).toBe('APARTMENT');
    expect(passoAberto()).toBe('type');
  });

  it('"tanto faz" grava nulo', () => {
    montar({ ...FILTROS_VAZIOS, purpose: 'SALE' });
    clicar('[data-passo="purpose"] .passo__resumo');

    clicar('[data-opcao="purpose:"]');

    expect(componente.rascunho().purpose).toBeNull();
  });

  it('o botao da direita e "proximo" ate o ultimo passo, onde vira "buscar"', () => {
    montar();
    expect(textoDoSeguir()).toContain('HOME.SEARCH.NEXT');

    clicar('[data-acao="seguir"]');
    expect(passoAberto()).toBe('purpose');
    expect(textoDoSeguir()).toContain('HOME.SEARCH.NEXT');

    clicar('[data-acao="seguir"]');
    expect(passoAberto()).toBe('type');
    expect(textoDoSeguir()).toContain('HOME.SEARCH.SUBMIT');
  });

  /**
   * O caso que guarda a requisicao unica: editar os tres passos nao emite nada
   * ate o toque final. E o motivo de o rascunho existir.
   */
  it('editar nao emite nada; o "buscar" emite uma vez, com tudo', () => {
    montar();
    const emitidos: PropertyFilters[] = [];
    componente.buscar.subscribe((f) => emitidos.push(f));

    digitar('Canoas');
    clicar('[data-acao="seguir"]');
    clicar('[data-opcao="purpose:RENT"]');
    clicar('[data-opcao="type:HOUSE"]');

    expect(emitidos).toEqual([]);

    clicar('[data-acao="seguir"]');

    expect(emitidos).toEqual([
      { query: 'Canoas', purpose: 'RENT', type: 'HOUSE' },
    ]);
  });

  /**
   * "Limpar tudo" limpa o RASCUNHO. Nao navega — fechar em seguida deixa a
   * busca de antes intacta, que e o que torna o botao seguro de tocar.
   */
  it('"limpar tudo" zera o rascunho e volta ao comeco, sem emitir', () => {
    montar({ query: 'Canoas', purpose: 'RENT', type: 'HOUSE' });
    const emitidos: PropertyFilters[] = [];
    componente.buscar.subscribe((f) => emitidos.push(f));

    clicar('[data-passo="type"] .passo__resumo');
    clicar('[data-acao="limpar"]');

    expect(componente.rascunho()).toEqual(FILTROS_VAZIOS);
    expect(passoAberto()).toBe('query');
    expect(emitidos).toEqual([]);
  });

  it('o passo fechado mostra o valor, e "qualquer" quando vazio', () => {
    montar({ query: 'Canoas', purpose: 'RENT', type: null });

    // `query` esta aberto, entao os dois visiveis fechados sao finalidade e tipo.
    const valores = Array.from(el().querySelectorAll('.passo__valor')).map((n) =>
      n.textContent!.trim(),
    );

    expect(valores).toEqual(['UPLOAD.PURPOSE.RENT', 'HOME.SEARCH.EMPTY_VALUE']);
  });

  it('o X pede para fechar', () => {
    montar();
    let fechou = 0;
    componente.fechou.subscribe(() => fechou++);

    clicar('[data-acao="fechar"]');

    expect(fechou).toBe(1);
  });
});
