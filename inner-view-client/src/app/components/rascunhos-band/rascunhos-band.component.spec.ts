import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Event, NavigationEnd, Router, provideRouter } from '@angular/router';
import { ToastController, provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { RascunhosBandComponent } from './rascunhos-band.component';
import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { PropertyService } from '../../services/property.service';
import { RascunhoResumo, VirtualTourService } from '../../services/virtual-tour.service';
import { DialogoDoWizard } from '../../tour-wizard/ui/wizard-dialog/dialogo-do-wizard.service';
import { PerguntaDoWizard } from '../../tour-wizard/ui/wizard-dialog/wizard-dialog.model';

/**
 * A faixa "Capturas em andamento" da home (Tarefa 13).
 *
 * As outras nove peças do rascunho retomável (salvar, retomar, descartar,
 * salvamento automático) já existem e estão testadas — o que faltava era um
 * jeito de VOLTAR a um rascunho depois de sair. Este componente é esse jeito.
 *
 * Sem dicionário de tradução carregado nos testes, `TranslatePipe` devolve a
 * própria chave (mesma convenção de `scene-card.component.spec.ts` e
 * `property-filters-bar.component.spec.ts`) — por isso as asserções abaixo
 * procuram a CHAVE (`HOME.DRAFTS_ROOMS`, `HOME.DRAFTS_EMPTY_ROOMS`), não o
 * texto interpolado. `{{count}}` só vira número de verdade em produção, com o
 * catálogo de `pt.json`/`en.json` carregado.
 */
describe('RascunhosBandComponent', () => {
  let fixture: ComponentFixture<RascunhosBandComponent>;
  let virtualTourService: VirtualTourService;
  let propertyService: PropertyService;
  let imagens: PanoramaImageCache;
  let router: Router;
  let perguntar: jasmine.Spy;

  function rascunho(over: Partial<RascunhoResumo> = {}): RascunhoResumo {
    return {
      id: 't1',
      propertyId: 'i1',
      updatedAt: '2026-08-26T12:00:00Z',
      ambientes: 3,
      capaPanoramaId: 'p1',
      ...over,
    };
  }

  /**
   * Dubla o diálogo de confirmação inteiro.
   *
   * Dubla o SERVIÇO e não o componente: o que estes casos verificam é a
   * DECISÃO — apagou ou não —, e como o diálogo desenha, prende o foco e
   * responde ao X tem spec próprio, ao lado dele. Um `IonModal` de verdade
   * também não se apresenta num TestBed ("framework delegate is missing").
   *
   * `escolha` é o sufixo da chave de i18n do botão tocado, ou `null` para
   * desistir sem tocar em botão nenhum — que é o que o X, o toque fora e o Esc
   * devolvem.
   *
   * O dublê é instalado no injetor do COMPONENTE (`DialogoDoWizard` é
   * fornecido por ele, não em `root`), por isso vem depois de `montar()`.
   */
  function dublarDialogo(escolha: string | null): void {
    perguntar = spyOn(
      fixture.debugElement.injector.get(DialogoDoWizard),
      'perguntar',
    ).and.callFake(
      async (pergunta: PerguntaDoWizard) =>
        (escolha === null
          ? null
          : (pergunta.acoes.find((acao) => acao.rotuloKey.includes(escolha))?.id ??
            null)),
    );
    spyOn(TestBed.inject(ToastController), 'create').and.resolveTo({
      present: () => Promise.resolve(),
    } as unknown as HTMLIonToastElement);
  }

  function montar(rascunhos: RascunhoResumo[], layout: 'faixa' | 'lista' = 'faixa'): void {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });

    virtualTourService = TestBed.inject(VirtualTourService);
    propertyService = TestBed.inject(PropertyService);
    imagens = TestBed.inject(PanoramaImageCache);
    router = TestBed.inject(Router);

    spyOn(virtualTourService, 'listarRascunhos').and.returnValue(of(rascunhos));
    // O download da miniatura é assunto de outro teste (abaixo). Por padrão
    // ele fica pendurado (nunca resolve), para as asserções de estrutura da
    // faixa não dependerem de uma promise que elas não pediram.
    spyOn(imagens, 'obter').and.returnValue(new Promise(() => {}));

    fixture = TestBed.createComponent(RascunhosBandComponent);
    fixture.componentRef.setInput('layout', layout);
    fixture.detectChanges();
  }

  /**
   * Empurra um `NavigationEnd` pelo stream do `Router`.
   *
   * `router.events` é um Subject por dentro; num TestBed não há navegação de
   * verdade para emiti-lo. É o evento que a faixa escuta para saber que a home
   * voltou à tela — o `ion-router-outlet` mantém a página viva, então o
   * `ngOnInit` não roda de novo.
   */
  function navegarPara(url: string): void {
    (router.events as unknown as Subject<Event>).next(new NavigationEnd(1, url, url));
  }

  afterEach(() => fixture?.destroy());

  it('não desenha nada quando não há rascunho', async () => {
    // A faixa não pode ocupar espaço permanente na home: quem nunca deixou
    // captura pela metade não deve ver um vazio explicando isso. Diferente do
    // `home-no-tour-banner`, ninguém de fora decide isto por ela — ela é quem
    // busca `listarRascunhos()`, então é ela quem sabe se há o que mostrar.
    montar([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.rascunhos')).toBeNull();
  });

  it('desenha um cartão por rascunho, com a contagem de ambientes', async () => {
    montar([
      rascunho({ id: 't1', ambientes: 3 }),
      rascunho({ id: 't2', ambientes: 1, capaPanoramaId: 'p9' }),
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const cartoes = fixture.nativeElement.querySelectorAll('.rascunhos__card');
    expect(cartoes.length).toBe(2);
    expect(cartoes[0].textContent).toContain('HOME.DRAFTS_ROOMS');
    expect(cartoes[0].textContent).not.toContain('HOME.DRAFTS_EMPTY_ROOMS');
  });

  it('desenha o rascunho sem nenhum cômodo, sem miniatura quebrada', async () => {
    // É o estado entre criar o rascunho e a primeira captura terminar. Um
    // <img> com src vazio desenha ícone de imagem quebrada.
    montar([rascunho({ ambientes: 0, capaPanoramaId: null })]);
    await fixture.whenStable();
    fixture.detectChanges();

    const cartao = fixture.nativeElement.querySelector('.rascunhos__card');
    expect(cartao).not.toBeNull();
    expect(cartao.textContent).toContain('HOME.DRAFTS_EMPTY_ROOMS');
    expect(fixture.nativeElement.querySelector('.rascunhos__thumb img')).toBeNull();

    // Sem capa não há o que baixar — pedir mesmo assim desperdiçaria uma
    // requisição que o servidor só devolveria vazia.
    expect(imagens.obter).not.toHaveBeenCalled();
  });

  /**
   * O ponto que mais costuma sair errado nesta tarefa: a rota de preview é
   * autenticada, e uma tag <img src="/api/..."> não passa pelo interceptor —
   * não leva o token. A miniatura só pode chegar pelo `PanoramaImageCache`,
   * que baixa pelo `HttpClient` e devolve `blob:`.
   */
  it('busca a miniatura pelo cache, na variante tratada e REDUZIDA, e não por src direto', async () => {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });
    virtualTourService = TestBed.inject(VirtualTourService);
    imagens = TestBed.inject(PanoramaImageCache);
    spyOn(virtualTourService, 'listarRascunhos').and.returnValue(
      of([rascunho({ capaPanoramaId: 'p1' })]),
    );
    const obter = spyOn(imagens, 'obter').and.resolveTo('blob:xyz');

    fixture = TestBed.createComponent(RascunhosBandComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // A largura é a outra metade do achado: sem ela a faixa dispara um
    // download de equirretangular inteira por rascunho, em paralelo, no
    // `ngOnInit` da home — dezenas de MB para desenhar selos de 196x110.
    expect(obter).toHaveBeenCalledWith('p1', 'treated', 320);
    const img = fixture.nativeElement.querySelector('.rascunhos__thumb img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('blob:xyz');
  });

  it('retomar navega para o wizard com o id do rascunho na query string', async () => {
    montar([rascunho({ id: 't7' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    const navegar = spyOn(router, 'navigate');

    fixture.nativeElement.querySelector('.rascunhos__abrir').click();

    expect(navegar).toHaveBeenCalledWith(['/tour/novo'], {
      queryParams: { rascunho: 't7' },
    });
  });

  /**
   * Apaga o IMÓVEL, não o tour — mesma regra de `descartarRascunho()` no
   * `TourDraftStore`. `VirtualTour.property` é `onDelete: Cascade`: uma
   * chamada derruba tour, panoramas, hotspots e frames de uma vez. Apagar só
   * o tour deixaria um imóvel órfão "Captura em andamento" visível na
   * listagem, que é exatamente a linha vazia que o filtro de lá existe para
   * evitar.
   */
  it('descartar apaga o imóvel, não o tour, e some da faixa', async () => {
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarDialogo('DISCARD_CONFIRM');
    await fixture.whenStable();
    fixture.detectChanges();
    const apagar = spyOn(propertyService, 'deleteProperty').and.returnValue(of(undefined));
    const liberar = spyOn(imagens, 'liberar');

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(apagar).toHaveBeenCalledWith('i1');
    expect(liberar).toHaveBeenCalledWith('p1');
    expect(fixture.nativeElement.querySelector('.rascunhos__card')).toBeNull();
  });

  /**
   * O botão tem 44px, encosta no cartão e vive num carrossel de rolagem
   * horizontal — arrastar a faixa e tocar no botão passam pelo mesmo pixel. E
   * o que ele apaga é o `Property` em cascata: tour, panoramas, hotspots,
   * frames e o tratamento por IA já pago, sem desfazer. O mesmo descarte
   * dentro do wizard passa por um alerta desde a Tarefa 11.
   */
  it('não apaga nada enquanto a pessoa não confirma', async () => {
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarDialogo('DISCARD_CANCEL');
    await fixture.whenStable();
    fixture.detectChanges();
    const apagar = spyOn(propertyService, 'deleteProperty').and.returnValue(of(undefined));

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(perguntar).toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
  });

  it('dispensar o diálogo conta como desistir, não como confirmar', async () => {
    // O X, o toque fora e o Esc chegam como `null`. Só a ação destrutiva
    // confirma — é isso que impede um toque fora de apagar por omissão, ou de
    // deixar a promise pendurada para sempre.
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarDialogo(null);
    await fixture.whenStable();
    fixture.detectChanges();
    const apagar = spyOn(propertyService, 'deleteProperty').and.returnValue(of(undefined));

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(apagar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
  });

  /**
   * A forma da pergunta É a decisão de produto.
   *
   * Duas saídas, a segura primeiro, a destrutiva com a lixeira e peso visual
   * menor — o mesmo diálogo do wizard, para o mesmo gesto não precisar ser
   * aprendido duas vezes. E `dispensavel`, porque desistir é o que o toque
   * errado no botão de 44px do carrossel merece encontrar.
   */
  it('pergunta com duas saídas, a segura à frente, e deixa desistir', async () => {
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarDialogo(null);
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();

    const pergunta = perguntar.calls.mostRecent().args[0] as PerguntaDoWizard;
    expect(pergunta.acoes.map((acao) => acao.rotuloKey)).toEqual([
      'HOME.DRAFTS_DISCARD_CANCEL',
      'HOME.DRAFTS_DISCARD_CONFIRM',
    ]);
    expect(pergunta.acoes.map((acao) => acao.tom)).toEqual(['primario', 'destrutivo']);
    expect(pergunta.acoes[1].icone).toBe('lixeira');
    expect(pergunta.dispensavel).toBeTrue();
    // Sem segundo toque: este diálogo JÁ é a confirmação do "Descartar" do
    // cartão. Confirmação dentro de confirmação vira ruído.
    expect(pergunta.acoes[1].confirmaKey).toBeUndefined();
  });

  it('mantém o cartão quando o DELETE falha, em vez de fingir que apagou', async () => {
    // A remoção otimista com o erro engolido fazia um descarte que não
    // aconteceu parecer concluído: o rascunho reaparecia no carregamento
    // seguinte da home, sem nada explicando.
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarDialogo('DISCARD_CONFIRM');
    await fixture.whenStable();
    fixture.detectChanges();
    spyOn(propertyService, 'deleteProperty').and.returnValue(
      throwError(() => new Error('rede caiu')),
    );
    const liberar = spyOn(imagens, 'liberar');

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
    // Os blobs também ficam: a capa continua na tela.
    expect(liberar).not.toHaveBeenCalled();
    expect(TestBed.inject(ToastController).create).toHaveBeenCalled();
  });

  it('não derruba a home quando listarRascunhos falha — a faixa é um atalho, não o catálogo', async () => {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });
    spyOn(TestBed.inject(VirtualTourService), 'listarRascunhos').and.throwError('rede');

    expect(() => {
      fixture = TestBed.createComponent(RascunhosBandComponent);
      fixture.detectChanges();
    }).not.toThrow();
  });

  /**
   * O app usa `<ion-router-outlet>`, que MANTÉM a página na pilha: voltar do
   * wizard reusa a `HomePage` viva, e o `ngOnInit` da faixa não roda de novo.
   *
   * Sem recarregar, a home mentia: publicar uma captura e voltar deixava o
   * cartão dela ali, dizendo "em andamento" sobre um tour já no ar. E o cartão
   * era CLICÁVEL — retomar um tour publicado punha "Descartar captura" em cima
   * dele, que apaga o imóvel em cascata. O servidor agora recusa (o rascunho
   * só serve `DRAFT`), mas a faixa não pode oferecer o caminho.
   */
  it('recarrega quando a home volta à tela', async () => {
    montar([rascunho({ id: 't1' })]);
    await fixture.whenStable();
    const listar = virtualTourService.listarRascunhos as jasmine.Spy;
    listar.calls.reset();
    listar.and.returnValue(of([]));

    navegarPara('/tour/novo?rascunho=t1');
    navegarPara('/home');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listar).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.rascunhos')).toBeNull();
  });

  it('não busca de novo ao SAIR da home', async () => {
    // A faixa continua viva na página em cache, fora da tela. Recarregar aqui
    // seria uma requisição e uma rajada de miniaturas que ninguém vai ver.
    montar([rascunho({ id: 't1' })]);
    await fixture.whenStable();
    const listar = virtualTourService.listarRascunhos as jasmine.Spy;
    listar.calls.reset();

    navegarPara('/tour/novo?rascunho=t1');
    await fixture.whenStable();

    expect(listar).not.toHaveBeenCalled();
  });

  /**
   * Os filtros da `HomePage` moram na query string: cada troca de filtro, chip
   * removido e busca digitada é uma navegação para `/home`. Comparar só o
   * destino refazia a busca de rascunhos a cada tecla — e foi assim que este
   * caso apareceu, derrubando os testes de filtro da `HomePage` com
   * "Expected no open requests".
   */
  it('não busca de novo quando o corretor só mexe nos filtros da home', async () => {
    montar([rascunho({ id: 't1' })]);
    await fixture.whenStable();
    const listar = virtualTourService.listarRascunhos as jasmine.Spy;
    listar.calls.reset();

    navegarPara('/home?type=HOUSE');
    navegarPara('/home?type=HOUSE&purpose=SALE');
    navegarPara('/home');
    await fixture.whenStable();

    expect(listar).not.toHaveBeenCalled();
  });

  it('a navegação que cria a faixa não vira uma segunda busca', async () => {
    // O componente é criado durante a ativação da rota, e o `NavigationEnd`
    // dessa mesma navegação chega depois. Sem tratá-la, toda abertura da home
    // custaria duas buscas e duas rajadas de miniatura.
    montar([rascunho({ id: 't1' })]);
    await fixture.whenStable();
    const listar = virtualTourService.listarRascunhos as jasmine.Spy;

    navegarPara('/home');
    await fixture.whenStable();

    expect(listar).toHaveBeenCalledTimes(1);
  });

  /**
   * O mesmo componente serve a faixa da home e a aba de Rascunhos.
   *
   * Um input e não dois componentes: buscar, baixar miniatura, retomar e
   * descartar — este último com diálogo de confirmação e a regra de que o
   * cartão só some se o DELETE deu certo — são idênticos nos dois. Duplicar
   * daria duas cópias que divergem na primeira correção.
   */
  describe('layout', () => {
    it('na faixa, lista vazia nao desenha nada', async () => {
      montar([], 'faixa');
      await fixture.whenStable();
      fixture.detectChanges();

      // Na home ela é um empurrão em contexto: uma seção vazia no topo da tela
      // inicial seria ruído.
      expect(fixture.nativeElement.querySelector('.rascunhos')).toBeNull();
    });

    it('na lista, vazia responde em vez de sumir', async () => {
      montar([], 'lista');
      await fixture.whenStable();
      fixture.detectChanges();

      // Quem foi até a aba procurar merece uma resposta, não uma tela branca.
      const vazio = fixture.nativeElement.querySelector('.rascunhos--vazio');
      expect(vazio).not.toBeNull();
      expect(vazio.querySelector('.rascunhos__vazio-cta')).not.toBeNull();
    });

    it('na lista, o titulo da secao sai — quem tem titulo e a pagina', async () => {
      montar([rascunho()], 'lista');
      await fixture.whenStable();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.rascunhos__titulo')).toBeNull();
      expect(el.querySelector('.rascunhos--lista')).not.toBeNull();
      expect(el.querySelectorAll('.rascunhos__card').length).toBe(1);
    });

    it('na faixa, o titulo fica', async () => {
      montar([rascunho()], 'faixa');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rascunhos__titulo')).not.toBeNull();
    });
  });
});
