import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { Panorama } from '../../models/virtual-tour.model';
import { TourSheetStore } from '../tour-sheet/tour-sheet.store';
import { CenasSheetComponent } from './cenas-sheet.component';

/**
 * O que se prova aqui NÃO é o desenho do sheet -- arrasto, trap de foco e
 * paradas são do `TourSheetComponent`, e o spec dele já os cobre. O que se
 * prova é o que é DESTE consumidor: a ordem dos cards, a contagem no
 * subtítulo, o marcador da cena vigente, a forma do card, o fechar-ao-escolher
 * e a largura pedida para a miniatura.
 *
 * Convenção da suíte: sem loader HTTP o `translate` devolve a CHAVE, então as
 * asserções são sobre chaves e nunca sobre o texto traduzido -- é o que mantém
 * o teste imune a uma reescrita do pt.json.
 */
function cena(id: string, order: number): Panorama {
  return {
    id,
    roomName: `Ambiente ${id}`,
    imageUrl: `/panoramas/${id}/image`,
    order,
  } as unknown as Panorama;
}

describe('CenasSheetComponent', () => {
  let fixture: ComponentFixture<CenasSheetComponent>;
  let store: TourSheetStore;

  /** Tudo o que foi criado no teste, para o `afterEach` derrubar. */
  const criados: ComponentFixture<unknown>[] = [];

  /**
   * O conteúdo do `<ng-template>` do `IonModal` só entra no DOM quando ele
   * APRESENTA, e apresentar é assíncrono. Sem esperar, uma consulta pelos
   * cards acharia lista vazia e todo teste daqui passaria por vacuidade.
   */
  function apresentado(no: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      no.addEventListener('didPresent', () => resolve(), { once: true });
    });
  }

  /**
   * Monta o sheet já aberto e devolve o nó do `<ion-modal>`.
   *
   * O nó é capturado ANTES da apresentação, e não reconsultado depois: ao
   * apresentar, o Ionic TELEPORTA o `<ion-modal>` para o `<body>`, e
   * `fixture.nativeElement.querySelector('ion-modal')` passa a devolver
   * `null`. Todo o conteúdo do sheet -- a grade, os cards, o subtítulo -- está
   * dentro desse nó teleportado.
   */
  async function abrir(cenas: Panorama[], atualId: string | null = null): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CenasSheetComponent);
    criados.push(fixture);
    fixture.componentRef.setInput('cenas', cenas);
    fixture.componentRef.setInput('atualId', atualId);
    store.abrir('cenas');
    fixture.detectChanges();

    const no = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
    await apresentado(no);
    return no;
  }

  const cards = (no: HTMLElement): HTMLElement[] =>
    Array.from(no.querySelectorAll<HTMLElement>('.cenas-sheet__card'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    }).compileComponents();

    store = TestBed.inject(TourSheetStore);
  });

  /**
   * Um `IonModal` apresentado prende o foco no DOCUMENTO, que é um só para a
   * suíte inteira e sobrevive ao teardown do TestBed. `backdrop-no-scroll` sai
   * junto: é ele quem trava a rolagem da PÁGINA, e um resto dele aqui deixaria
   * as suítes seguintes rodando com `overflow: hidden` no documento.
   */
  afterEach(() => {
    while (criados.length) criados.pop()!.destroy();
    document.querySelectorAll('ion-modal').forEach((m) => m.remove());
    document.body.classList.remove('backdrop-no-scroll');
    (document.activeElement as HTMLElement | null)?.blur();
    store.fechar();
  });

  /**
   * A entrada vem FORA de ordem de propósito: com um array já ordenado o teste
   * passaria mesmo se o componente ignorasse `order` e renderizasse `cenas()`
   * cru.
   */
  it('monta um card por cena, em ordem crescente de order', async () => {
    const no = await abrir([cena('c', 3), cena('a', 1), cena('b', 2)]);

    expect(cards(no).map((b) => b.getAttribute('data-cena'))).toEqual(['a', 'b', 'c']);
  });

  it('mostra o titulo e a contagem no plural quando ha varias cenas', async () => {
    const no = await abrir([cena('a', 1), cena('b', 2), cena('c', 3)]);

    expect(no.querySelector('.tour-sheet__titulo')?.textContent?.trim())
      .toBe('VIEWER.CENAS.TITULO');
    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .toBe('VIEWER.CENAS.CONTAGEM');
  });

  // A chave separada existe porque o ngx-translate nao faz plural sozinho: sem
  // ela o sheet de uma cena so anunciaria "1 cenas".
  it('com uma cena so, usa a chave singular e nao quebra', async () => {
    const no = await abrir([cena('a', 1)]);

    expect(cards(no).length).toBe(1);
    expect(no.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .toBe('VIEWER.CENAS.UMA');
  });

  /**
   * Trinta cenas é o volume que o escopo cita, e o que ele exige é que a grade
   * ROLE em vez de crescer para fora do sheet.
   *
   * `scrollTop` é a asserção que importa: um elemento não rolável IGNORA a
   * atribuição e continua em zero, enquanto `scrollHeight > clientHeight` é
   * verdade até com `overflow: visible` e passaria sem o `overflow-y: auto`.
   */
  it('com trinta cenas, a grade rola em vez de estourar o sheet', async () => {
    const muitas = Array.from({ length: 30 }, (_, i) => cena(`p${i}`, i));
    const no = await abrir(muitas);

    expect(cards(no).length).toBe(30);

    const grade = no.querySelector('.cenas-sheet__grade') as HTMLElement;
    expect(grade.scrollHeight)
      .withContext('trinta cards precisam passar da altura maxima da grade')
      .toBeGreaterThan(grade.clientHeight);

    grade.scrollTop = 200;

    expect(grade.scrollTop)
      .withContext('a grade foi cortada em vez de rolada')
      .toBeGreaterThan(0);
  });

  /**
   * O badge é pílula E `aria-current`: um leitor de tela não vê a pílula, e
   * marcar só visualmente deixaria quem navega por leitor sem saber onde está.
   */
  it('marca so a cena vigente, no visual e no aria-current', async () => {
    const no = await abrir([cena('a', 1), cena('b', 2), cena('c', 3)], 'b');
    const lista = cards(no);

    const comBadge = lista.filter((b) => b.querySelector('.cenas-sheet__badge'));
    expect(comBadge.map((b) => b.getAttribute('data-cena'))).toEqual(['b']);
    expect(comBadge[0].querySelector('.cenas-sheet__badge')?.textContent?.trim())
      .toBe('VIEWER.CENAS.ATUAL');

    const marcados = lista.filter((b) => b.getAttribute('aria-current') === 'true');
    expect(marcados.map((b) => b.getAttribute('data-cena'))).toEqual(['b']);
  });

  // `<button>` e nao `<div (click)>`: o card precisa de foco por teclado e de
  // papel de controle. Uma div com click e' invisivel para o Tab e ainda assim
  // troca de cena.
  it('o card e um botao de verdade', async () => {
    const no = await abrir([cena('a', 1)]);
    const card = cards(no)[0];

    expect(card.tagName).toBe('BUTTON');
    expect(card.getAttribute('type')).toBe('button');
  });

  /**
   * Fechar ao escolher é regra DESTE sheet, e por isso mora aqui: deixá-la com
   * quem escuta `(selecionada)` faria cada consumidor futuro reimplementá-la.
   */
  it('escolher emite a cena e fecha o sheet', async () => {
    const no = await abrir([cena('a', 1), cena('b', 2)], 'a');
    const escolhidas: Panorama[] = [];
    fixture.componentInstance.selecionada.subscribe((c) => escolhidas.push(c));

    cards(no)[1].click();

    expect(escolhidas.map((c) => c.id)).toEqual(['b']);
    expect(store.aberto())
      .withContext('o sheet ficou aberto depois de escolher uma cena')
      .toBeNull();
  });

  /**
   * O `w=320` é o que torna trinta cenas viável: sem esse parâmetro a rota
   * devolve a equirretangular inteira -- dezenas de MB por cômodo.
   */
  it('pede a miniatura tratada com largura de 320', async () => {
    const no = await abrir([cena('a', 1)]);
    const src = no.querySelector('.cenas-sheet__thumb')?.getAttribute('src') ?? '';

    expect(src).toContain('/panoramas/a/preview');
    expect(src).toContain('variant=treated');
    expect(src).toContain('w=320');
  });
});
