import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourWizardPage } from './tour-wizard.page';
import { PerguntaDoWizard } from './ui/wizard-dialog/wizard-dialog.model';
import { WizardScene } from './tour-wizard.model';

/**
 * O gatilho que faltava para o rascunho retomável.
 *
 * Toda a mecânica de salvar, retomar e descartar já existe e está testada
 * (`TourDraftStore`) — o que faltava era ALGUÉM chamar `salvarRascunho()` fora
 * do publicar. O corretor perdia o trabalho de duas formas: tocando em voltar,
 * e quando o celular manda o app para o fundo (o sistema pode matá-lo a
 * qualquer momento depois disso). Este spec cobre as duas.
 *
 * `aoVoltar()` é chamado pelo `tourWizardLeaveGuard` — um `CanDeactivate` da
 * rota `tour/novo` (`app.routes.ts`), não por um `@Output` do `app-header`.
 * O header é compartilhado por toda a tela (§7 do SPRINT-3-TOUR-WIZARD.md,
 * "consumido como está") e ele mesmo navega via `backHref`, sem emitir
 * evento. Um guard de rota também pega o voltar do navegador e o botão físico
 * do Android, que um `@Output` no header nunca veria — por isso os testes
 * chamam `page.aoVoltar()` diretamente, do jeito que o guard chamaria.
 *
 * Sem `detectChanges()` de propósito — mesma técnica de
 * `inner-view-page/inner-view-page.download.spec.ts`: o `ngOnInit` de cada
 * etapa não roda. O router continua provido porque o header real aparece na
 * tela de escolha inicial e nas demais etapas; ele só some na galeria da
 * etapa 1 para devolver altura ao conteúdo no celular.
 */
describe('TourWizardPage — sair sem perder trabalho', () => {
  function configurarTestBed(): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        // Vazia mesmo: nenhum teste navega de verdade. Só precisa existir
        // para o `routerLink` do logotipo do `app-header` achar um
        // `ActivatedRoute` quando o template for renderizado.
        provideRouter([]),
      ],
    });
  }

  function montarPagina(): TourWizardPage {
    configurarTestBed();
    return TestBed.createComponent(TourWizardPage).componentInstance;
  }

  function cena(id: string): WizardScene {
    return {
      id,
      room: 'Sala',
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
    };
  }

  /** Dá ao rascunho uma cena válida — o que torna "sair" uma pergunta, não um no-op. */
  function comUmaCena(page: TourWizardPage): void {
    page.store.scenes.set([cena('a')]);
  }

  it('oculta o header somente quando a etapa 1 ja mostra a galeria', () => {
    configurarTestBed();
    const fixture = TestBed.createComponent(TourWizardPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-header')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-shell__gallery-back')).toBeNull();

    comUmaCena(fixture.componentInstance);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-header')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-wizard-stepper')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-shell__gallery-back')).not.toBeNull();

    fixture.componentInstance.store.step.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-header')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-shell__gallery-back')).toBeNull();
  });

  it('o voltar compacto da galeria navega para a home pelo guard da rota', () => {
    configurarTestBed();
    const fixture = TestBed.createComponent(TourWizardPage);
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    comUmaCena(fixture.componentInstance);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.tw-shell__gallery-back').click();

    expect(navigate).toHaveBeenCalledOnceWith(['/home']);
  });

  /**
   * Faz o diálogo "aparecer" e o corretor tocar num botão.
   *
   * Dubla o `DialogoDoWizard`, e não o componente: o que interessa testar aqui
   * é a POLÍTICA — que pergunta a página faz e o que ela conclui de cada
   * resposta. Como o diálogo desenha, como ele prende o foco e o que o X faz
   * são do componente, e têm spec próprio.
   *
   * Cada `chave` é o sufixo da chave de i18n de um botão: LEAVE_KEEP,
   * LEAVE_DISCARD, SAVE_RETRY… Procurar pelo RÓTULO, e não pelo `id`, é de
   * propósito: o teste passa a falar do que o corretor lê na tela, e uma troca
   * de rótulo que mude o sentido do botão aparece aqui.
   *
   * Sem chave que case, devolve `null` — que é exatamente o que dispensar o
   * diálogo devolve. Ver `dispensandoODialogo`.
   *
   * Aceita VÁRIAS porque um fluxo pode abrir dois diálogos em sequência — sair
   * pedindo para salvar e, se a rede cair, o que pergunta o que fazer. Os
   * conjuntos de ações são disjuntos, então um dublê só serve aos dois.
   */
  function escolherNoDialogo(page: TourWizardPage, ...chaves: string[]): jasmine.Spy {
    return spyOn(page.dialogo, 'perguntar').and.callFake(
      async (pergunta: PerguntaDoWizard) =>
        pergunta.acoes.find((acao) =>
          chaves.some((chave) => acao.rotuloKey.includes(chave)),
        )?.id ?? null,
    );
  }

  /** O X, o toque fora e o Esc — todos chegam à página como `null`. */
  function dispensandoODialogo(page: TourWizardPage): jasmine.Spy {
    return spyOn(page.dialogo, 'perguntar').and.resolveTo(null);
  }

  /**
   * `ngOnInit()` é síncrono e dispara a retomada com `void`. Um `await` de
   * macrotarefa dá tempo à cadeia inteira — rejeição, alerta, `present()` e o
   * handler do botão — de acontecer antes da asserção.
   */
  async function esperarMicrotarefas(): Promise<void> {
    await new Promise((resolver) => setTimeout(resolver, 0));
  }

  describe('aoVoltar', () => {
    it('não pergunta nada quando não há o que perder', async () => {
      const page = montarPagina();
      const perguntar = spyOn(page.dialogo, 'perguntar');

      const pode = await page.aoVoltar();

      expect(perguntar).not.toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('não pergunta nada depois de publicado — não há mais rascunho para perder', async () => {
      // Sem esta guarda, sair da tela de sucesso (ex.: "Ver tour", que também
      // navega para fora de `tour/novo`) ofereceria "descartar captura" sobre
      // um imóvel que já é público.
      const page = montarPagina();
      comUmaCena(page);
      page.store.published.set(true);
      const perguntar = spyOn(page.dialogo, 'perguntar');

      const pode = await page.aoVoltar();

      expect(perguntar).not.toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('ao escolher "Continuar depois", salva e libera a saída', async () => {
      const page = montarPagina();
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();
      comUmaCena(page);
      escolherNoDialogo(page, 'LEAVE_KEEP');

      const pode = await page.aoVoltar();

      expect(salvar).toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    /**
     * O DEFEITO: `.catch(() => undefined)` e sai. O corretor acabava de ler
     * "as fotos e o tratamento da IA já estão guardados", tocava em continuar
     * depois, a rede caía — e ele saía acreditando, sem os nomes dos
     * ambientes, os hotspots e as conexões. Exatamente o que esta
     * funcionalidade existe para guardar.
     */
    it('quando salvar falha, PERGUNTA em vez de sair calado', async () => {
      const page = montarPagina();
      spyOn(page.store, 'salvarRascunho').and.rejectWith(new Error('rede'));
      comUmaCena(page);
      const perguntar = escolherNoDialogo(page, 'LEAVE_KEEP', 'SAVE_FAILED_LEAVE');

      await page.aoVoltar();

      // Dois diálogos: o de sair, e o que conta que não salvou.
      expect(perguntar.calls.count()).toBe(2);
      expect(perguntar.calls.mostRecent().args[0].tituloKey).toContain(
        'SAVE_FAILED_TITLE',
      );
    });

    it('"sair mesmo assim" continua liberando a saída — agora informado', async () => {
      // Prender alguém no wizard porque a rede caiu é pior. O que deixa de
      // existir é sair sem saber.
      const page = montarPagina();
      spyOn(page.store, 'salvarRascunho').and.rejectWith(new Error('rede'));
      comUmaCena(page);
      escolherNoDialogo(page, 'LEAVE_KEEP', 'SAVE_FAILED_LEAVE');

      const pode = await page.aoVoltar();

      expect(pode).toBe(true);
    });

    it('"tentar de novo" mantém o corretor na tela, com o trabalho', async () => {
      const page = montarPagina();
      spyOn(page.store, 'salvarRascunho').and.rejectWith(new Error('rede'));
      comUmaCena(page);
      escolherNoDialogo(page, 'LEAVE_KEEP', 'SAVE_RETRY');

      const pode = await page.aoVoltar();

      expect(pode).toBe(false);
    });

    it('ao escolher "Descartar captura", descarta e libera a saída', async () => {
      const page = montarPagina();
      const descartar = spyOn(page.store, 'descartarRascunho').and.resolveTo();
      comUmaCena(page);
      escolherNoDialogo(page, 'LEAVE_DISCARD');

      const pode = await page.aoVoltar();

      expect(descartar).toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('sai mesmo quando descartar falha', async () => {
      const page = montarPagina();
      spyOn(page.store, 'descartarRascunho').and.rejectWith(new Error('rede'));
      comUmaCena(page);
      escolherNoDialogo(page, 'LEAVE_DISCARD');

      const pode = await page.aoVoltar();

      expect(pode).toBe(true);
    });

    /**
     * "Ficar aqui" deixou de ser um terceiro botão e virou o X, o toque fora e
     * o Esc — todos chegam aqui como `null`.
     *
     * Este é o caso que motivou a mudança: tocar em voltar sem querer. A saída
     * mais provável do diálogo é a que NÃO decide nada, e ela não precisa
     * disputar espaço com as duas que decidem.
     */
    it('dispensar o diálogo não sai e não mexe no rascunho', async () => {
      const page = montarPagina();
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();
      const descartar = spyOn(page.store, 'descartarRascunho').and.resolveTo();
      comUmaCena(page);
      dispensandoODialogo(page);

      const pode = await page.aoVoltar();

      expect(pode).toBe(false);
      expect(salvar).not.toHaveBeenCalled();
      expect(descartar).not.toHaveBeenCalled();
    });

    /**
     * A forma da pergunta É a decisão de produto, então ela fica travada aqui.
     *
     * Duas ações e não três; a segura PRIMEIRO (é o que o teclado alcança
     * antes e o leitor de tela anuncia antes); a destrutiva com peso visual
     * menor e a lixeira, porque ela é a única que apaga foto. Inverter a ordem
     * ou promover a destrutiva a `primario` passaria despercebido numa
     * revisão e transformaria um toque errado numa exclusão.
     */
    it('a pergunta de saída oferece duas saídas, a segura à frente', async () => {
      const page = montarPagina();
      comUmaCena(page);
      const perguntar = dispensandoODialogo(page);

      await page.aoVoltar();

      const pergunta = perguntar.calls.mostRecent().args[0] as PerguntaDoWizard;
      expect(pergunta.acoes.map((acao) => acao.rotuloKey)).toEqual([
        'TOUR_WIZARD.COMMON.LEAVE_KEEP',
        'TOUR_WIZARD.COMMON.LEAVE_DISCARD',
      ]);
      expect(pergunta.acoes.map((acao) => acao.tom)).toEqual([
        'primario',
        'destrutivo',
      ]);
      expect(pergunta.acoes[1].icone).toBe('lixeira');
      // Sem isto o X some e o toque fora deixa de responder — e a saída do
      // toque em voltar acidental volta a custar uma decisão.
      expect(pergunta.dispensavel).toBeTrue();
    });

    /**
     * Achado da revisão da Tarefa 12: o Router cancela uma navegação em
     * curso quando outra chega e roda o `canDeactivate` de novo — o botão
     * físico do Android, um duplo toque no header ou o voltar do navegador
     * em sequência chamam `aoVoltar()` mais de uma vez antes da primeira
     * responder. Sem a trava, a segunda chamada abriria um SEGUNDO diálogo
     * por cima do primeiro; se as escolhas divergissem ("Descartar" em cima,
     * "Continuar depois" embaixo), `salvarRascunho()` rodaria DEPOIS do
     * `reset()` do descarte e recriaria um imóvel fantasma.
     */
    it('duas solicitações de saída concorrentes não abrem um segundo diálogo', async () => {
      const page = montarPagina();
      comUmaCena(page);
      const descartar = spyOn(page.store, 'descartarRascunho').and.resolveTo();
      const perguntar = escolherNoDialogo(page, 'LEAVE_DISCARD');

      const primeira = page.aoVoltar();
      const segunda = page.aoVoltar();

      // Só um diálogo é aberto — a segunda chamada compartilha a MESMA
      // decisão da primeira, em vez de perguntar de novo.
      expect(perguntar).toHaveBeenCalledTimes(1);
      expect(await primeira).toBe(true);
      expect(await segunda).toBe(true);
      expect(descartar).toHaveBeenCalledTimes(1);
    });

    /**
     * O que sobrou do "sai mesmo quando o próprio alerta falha ao abrir".
     *
     * Aquele teste guardava um `.catch` no fim da cadeia `create().present()`:
     * um `present()` que rejeitasse deixaria a promise do guard pendurada para
     * sempre, e a pessoa não conseguiria mais sair do wizard. A cadeia não
     * existe mais — o diálogo é um componente do template, ligado a um signal,
     * e não há promise de abertura para rejeitar.
     *
     * O que precisa continuar valendo é a regra por trás dele: a decisão em
     * voo é sempre liberada, para uma saída recusada não trancar a próxima.
     */
    it('a decisão de saída não fica presa depois de respondida', async () => {
      const page = montarPagina();
      comUmaCena(page);
      const perguntar = dispensandoODialogo(page);

      expect(await page.aoVoltar()).toBe(false);
      expect(await page.aoVoltar()).toBe(false);

      // Duas perguntas, e não uma decisão velha reaproveitada: o corretor que
      // tocou em voltar de novo tem direito a decidir de novo.
      expect(perguntar).toHaveBeenCalledTimes(2);
    });
  });

  describe('salvamento ao ir para segundo plano', () => {
    // `beforeunload` é ignorado ou limitado nos navegadores de celular, e não
    // dispara quando o SISTEMA mata o app em segundo plano — que são
    // exatamente os dois casos do chamado original. `visibilitychange`
    // dispara nos dois.
    function indoParaSegundoPlano(): void {
      spyOnProperty(document, 'visibilityState', 'get').and.returnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('salva quando o app vai para segundo plano', () => {
      const page = montarPagina();
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();
      comUmaCena(page);

      indoParaSegundoPlano();

      expect(salvar).toHaveBeenCalled();
    });

    it('não salva quando não há cena — não há o que perder', () => {
      const page = montarPagina();
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();

      indoParaSegundoPlano();

      expect(salvar).not.toHaveBeenCalled();
    });

    it('não salva depois de publicado', () => {
      const page = montarPagina();
      comUmaCena(page);
      page.store.published.set(true);
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();

      indoParaSegundoPlano();

      expect(salvar).not.toHaveBeenCalled();
    });

    it('não salva ao voltar a ficar visível — só a ida para segundo plano conta', () => {
      const page = montarPagina();
      comUmaCena(page);
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();
      spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');

      document.dispatchEvent(new Event('visibilitychange'));

      expect(salvar).not.toHaveBeenCalled();
    });

    it('para de escutar quando a página é destruída', () => {
      configurarTestBed();
      const fixture = TestBed.createComponent(TourWizardPage);
      comUmaCena(fixture.componentInstance);
      const salvar = spyOn(fixture.componentInstance.store, 'salvarRascunho').and.resolveTo();

      fixture.destroy();
      indoParaSegundoPlano();

      // Sem isto, o listener do componente anterior seguiria vivo em
      // `document` — cada wizard aberto e fechado empilharia mais um.
      expect(salvar).not.toHaveBeenCalled();
    });
  });

  /**
   * O gatilho da Tarefa 13: a faixa "Capturas em andamento" da home navega
   * para `/tour/novo?rascunho=<tourId>`, e é este `ngOnInit` que fecha o
   * caminho de volta lendo o parâmetro. Sem ele, o link da faixa levaria a um
   * wizard vazio como qualquer outro — a mecânica de `retomarRascunho()` já
   * existe e está testada em `tour-draft.store.spec.ts`; falta só chamá-la.
   */
  describe('retomar pela query string', () => {
    function montarPaginaComQuery(rascunho: string | null): TourWizardPage {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
          provideRouter([]),
          // Dublê mínimo: só precisa devolver
          // o `queryParamMap` que o `ngOnInit` lê no `snapshot`. Navegar de
          // verdade pediria uma rota configurada para `/tour/novo`, que nada
          // aqui além deste parâmetro usa.
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                queryParamMap: convertToParamMap(rascunho ? { rascunho } : {}),
              },
            },
          },
        ],
      });
      return TestBed.createComponent(TourWizardPage).componentInstance;
    }

    it('chama retomarRascunho quando a URL veio da faixa da home', () => {
      const page = montarPaginaComQuery('t1');
      const retomar = spyOn(page.store, 'retomarRascunho').and.resolveTo();

      page.ngOnInit();

      expect(retomar).toHaveBeenCalledWith('t1');
    });

    it('sem o parametro o wizard comeca vazio, como sempre comecou', () => {
      const page = montarPaginaComQuery(null);
      const retomar = spyOn(page.store, 'retomarRascunho').and.resolveTo();

      page.ngOnInit();

      expect(retomar).not.toHaveBeenCalled();
    });

    it('falha ao retomar nao quebra o wizard', () => {
      const page = montarPaginaComQuery('t1');
      spyOn(page.store, 'retomarRascunho').and.rejectWith(new Error('rede'));

      expect(() => page.ngOnInit()).not.toThrow();
    });

    /**
     * O `.catch(() => undefined)` que morava aqui dizia que o pior caso era o
     * wizard abrir vazio, "como se tivesse tocado no FAB". Não era: vazio, mas
     * com `rascunhoTourId` nulo — e a primeira captura chamaria
     * `garantirRascunho()`, que CRIA imóvel e tour DRAFT novos. A home passava
     * a mostrar DOIS cartões para a mesma captura, com as fotos repartidas
     * entre eles, e o corretor tocou na faixa exatamente para não recomeçar.
     */
    it('falha ao retomar PERGUNTA, em vez de virar um tour novo em silêncio', async () => {
      const page = montarPaginaComQuery('t1');
      spyOn(page.store, 'retomarRascunho').and.rejectWith(new Error('rede'));
      const perguntar = spyOn(page.dialogo, 'perguntar').and.resolveTo(null);

      page.ngOnInit();
      await esperarMicrotarefas();

      expect(perguntar).toHaveBeenCalled();
      // Não dispensável: as duas saídas daqui são consequentes, e "nada" não
      // pode ser a resposta que devolve o estado de tour novo.
      expect(perguntar.calls.mostRecent().args[0].dispensavel).toBeFalse();
      // O que o defeito produzia: seguir como captura nova.
      expect(page.store.rascunhoTourId()).toBeNull();
      expect(page.store.scenes().length).toBe(0);
    });

    it('"Tentar de novo" retoma o MESMO rascunho', async () => {
      const page = montarPaginaComQuery('t1');
      const retomar = spyOn(page.store, 'retomarRascunho').and.returnValues(
        Promise.reject(new Error('rede')),
        Promise.resolve(),
      );
      escolherNoDialogo(page, 'RESUME_FAILED_RETRY');

      page.ngOnInit();
      await esperarMicrotarefas();

      expect(retomar.calls.count()).toBe(2);
      // O mesmo id, e não um rascunho novo.
      expect(retomar.calls.allArgs()).toEqual([['t1'], ['t1']]);
    });

    it('"Voltar ao início" tira o corretor da tela quebrada', async () => {
      const page = montarPaginaComQuery('t1');
      spyOn(page.store, 'retomarRascunho').and.rejectWith(new Error('rede'));
      const navegar = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      escolherNoDialogo(page, 'RESUME_FAILED_HOME');

      page.ngOnInit();
      await esperarMicrotarefas();

      expect(navegar).toHaveBeenCalledWith(['/home']);
    });
  });
});

/**
 * O modo imersivo da etapa de passagens.
 *
 * No celular ele esconde o stepper e a barra de acao para a foto ocupar a tela
 * -- e junto com a barra vai embora o UNICO "Continuar". Enquanto ha foto na
 * tela isso e o desejado. Quando a fila acaba (ou nunca teve nada), a etapa
 * mostra so um paragrafo, e ai esconder a barra prende o corretor numa tela
 * quase branca, sem avancar nem voltar. Aconteceu no celular, em producao.
 */
describe('TourWizardPage — modo imersivo da etapa de passagens', () => {
  function montar(): TourWizardPage {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });
    return TestBed.createComponent(TourWizardPage).componentInstance;
  }

  function cenaLigada(
    id: string,
    connections: string[],
    destinosJaMarcados: string[] = [],
  ): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: destinosJaMarcados.map((target, i) => ({
        id: `${id}-${i}`,
        u: 0.5,
        v: 0.5,
        label: '',
        target,
      })),
      state: 'ready',
      connections,
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('com passagem pendente, a foto fica com a tela', () => {
    const page = montar();
    page.store.scenes.set([
      cenaLigada('sala', ['cozinha']),
      cenaLigada('cozinha', ['sala']),
    ]);
    page.store.step.set(3);

    expect(page.imersivo()).toBeTrue();
  });

  // O defeito: com tudo posicionado a etapa vira um paragrafo, e a barra
  // escondida levava junto o unico caminho para a etapa 4.
  it('com a fila acabada, stepper e barra voltam', () => {
    const page = montar();
    page.store.scenes.set([
      cenaLigada('sala', ['cozinha'], ['cozinha']),
      cenaLigada('cozinha', ['sala'], ['sala']),
    ]);
    page.store.step.set(3);

    expect(page.imersivo()).toBeFalse();
  });

  // Mesma armadilha pela outra porta: quem chega sem ter conectado nada le
  // "volte aos ambientes" sem ter com o que voltar.
  it('sem conexao nenhuma, stepper e barra voltam', () => {
    const page = montar();
    page.store.scenes.set([cenaLigada('sala', []), cenaLigada('cozinha', [])]);
    page.store.step.set(3);

    expect(page.imersivo()).toBeFalse();
  });

  it('fora da etapa de passagens nao ha modo imersivo', () => {
    const page = montar();
    page.store.scenes.set([
      cenaLigada('sala', ['cozinha']),
      cenaLigada('cozinha', ['sala']),
    ]);
    page.store.step.set(2);

    expect(page.imersivo()).toBeFalse();
  });

  it('no estado publicado nao ha modo imersivo', () => {
    const page = montar();
    page.store.scenes.set([
      cenaLigada('sala', ['cozinha']),
      cenaLigada('cozinha', ['sala']),
    ]);
    page.store.step.set(3);
    page.store.published.set(true);

    expect(page.imersivo()).toBeFalse();
  });
});
