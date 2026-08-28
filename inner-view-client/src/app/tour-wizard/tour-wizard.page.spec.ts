import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourWizardPage } from './tour-wizard.page';
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
 * etapa não roda, e o `@switch`/`@if` que decide qual etapa aparecer nunca
 * chega a avaliar. O `<app-header>`, porém, é filho ESTÁTICO do template (não
 * mora dentro de `@if`), e o Ivy monta a árvore estática de um componente já
 * na criação da fixture, antes de qualquer `detectChanges()` — por isso ele é
 * construído de verdade, e com ele o `routerLink` do logotipo. É o mesmo
 * motivo pelo qual `inner-view-page.download.spec.ts` dubla `Router` e
 * `ActivatedRoute`; aqui basta uma rota vazia de verdade (`provideRouter([])`)
 * porque `AppHeaderComponent` não é dublado, é o real.
 */
describe('TourWizardPage — sair sem perder trabalho', () => {
  function configurarTestBed(): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        // Vazia mesmo: nenhum teste navega de verdade. Só precisa existir
        // para o `routerLink` do logotipo do `app-header` (filho estático,
        // montado já na criação da fixture) achar um `ActivatedRoute`.
        provideRouter([]),
        // Dublê mínimo: só precisa existir como função para o `spyOn` de cada
        // teste assumir o controle — mesmo padrão do `ToastController` em
        // `inner-view-page.download.spec.ts` (`{ create: umaFn }`), e não o
        // objeto vazio usado ali para o `AlertController`, que nunca chega a
        // ser chamado naquele spec.
        {
          provide: AlertController,
          useValue: {
            create: () => Promise.resolve({ present: () => Promise.resolve() }),
          },
        },
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

  /**
   * Faz o `AlertController` "abrir" e o usuário tocar num botão.
   *
   * O `AlertController` real monta um overlay fora da árvore do componente e
   * não termina dentro de um `whenStable`. O que interessa testar é o que
   * acontece DEPOIS da escolha, então o dublê devolve um alerta cujo
   * `present()` resolve e já dispara o handler do botão pedido.
   *
   * `chave` é o sufixo da chave de i18n do botão: LEAVE_KEEP, LEAVE_DISCARD,
   * LEAVE_CANCEL. O texto vem traduzido; o `TranslateService` nos testes
   * devolve a própria chave (sem loader configurado), então basta procurar o
   * sufixo dentro dela.
   */
  function escolherNoAlerta(chave: string): void {
    spyOn(TestBed.inject(AlertController), 'create').and.callFake(
      async (opts: { buttons?: unknown[] } = {}) => {
        const botoes = (opts.buttons ?? []) as Array<{
          text?: string;
          handler?: () => void;
        }>;
        return {
          present: async () => {
            const alvo = botoes.find((b) => (b.text ?? '').includes(chave));
            alvo?.handler?.();
          },
        } as never;
      },
    );
  }

  describe('aoVoltar', () => {
    it('não pergunta nada quando não há o que perder', async () => {
      const page = montarPagina();
      const alerta = spyOn(TestBed.inject(AlertController), 'create');

      const pode = await page.aoVoltar();

      expect(alerta).not.toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('não pergunta nada depois de publicado — não há mais rascunho para perder', async () => {
      // Sem esta guarda, sair da tela de sucesso (ex.: "Ver tour", que também
      // navega para fora de `tour/novo`) ofereceria "descartar captura" sobre
      // um imóvel que já é público.
      const page = montarPagina();
      comUmaCena(page);
      page.store.published.set(true);
      const alerta = spyOn(TestBed.inject(AlertController), 'create');

      const pode = await page.aoVoltar();

      expect(alerta).not.toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('ao escolher "Continuar depois", salva e libera a saída', async () => {
      const page = montarPagina();
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();
      comUmaCena(page);
      escolherNoAlerta('LEAVE_KEEP');

      const pode = await page.aoVoltar();

      expect(salvar).toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('sai mesmo quando salvar falha', async () => {
      // Segurar alguém dentro do wizard porque a rede caiu é pior que perder
      // as edições da última etapa: as fotos e a IA já estão no servidor de
      // qualquer forma.
      const page = montarPagina();
      spyOn(page.store, 'salvarRascunho').and.rejectWith(new Error('rede'));
      comUmaCena(page);
      escolherNoAlerta('LEAVE_KEEP');

      const pode = await page.aoVoltar();

      expect(pode).toBe(true);
    });

    it('ao escolher "Descartar captura", descarta e libera a saída', async () => {
      const page = montarPagina();
      const descartar = spyOn(page.store, 'descartarRascunho').and.resolveTo();
      comUmaCena(page);
      escolherNoAlerta('LEAVE_DISCARD');

      const pode = await page.aoVoltar();

      expect(descartar).toHaveBeenCalled();
      expect(pode).toBe(true);
    });

    it('sai mesmo quando descartar falha', async () => {
      const page = montarPagina();
      spyOn(page.store, 'descartarRascunho').and.rejectWith(new Error('rede'));
      comUmaCena(page);
      escolherNoAlerta('LEAVE_DISCARD');

      const pode = await page.aoVoltar();

      expect(pode).toBe(true);
    });

    it('ao escolher "Ficar aqui", não sai e não mexe no rascunho', async () => {
      const page = montarPagina();
      const salvar = spyOn(page.store, 'salvarRascunho').and.resolveTo();
      const descartar = spyOn(page.store, 'descartarRascunho').and.resolveTo();
      comUmaCena(page);
      escolherNoAlerta('LEAVE_CANCEL');

      const pode = await page.aoVoltar();

      expect(pode).toBe(false);
      expect(salvar).not.toHaveBeenCalled();
      expect(descartar).not.toHaveBeenCalled();
    });

    /**
     * Achado da revisão da Tarefa 12: o Router cancela uma navegação em
     * curso quando outra chega e roda o `canDeactivate` de novo — o botão
     * físico do Android, um duplo toque no header ou o voltar do navegador
     * em sequência chamam `aoVoltar()` mais de uma vez antes da primeira
     * responder. Sem a trava, a segunda chamada abriria um SEGUNDO alerta
     * por cima do primeiro; se as escolhas divergissem ("Descartar" em cima,
     * "Continuar depois" embaixo), `salvarRascunho()` rodaria DEPOIS do
     * `reset()` do descarte e recriaria um imóvel fantasma.
     */
    it('duas solicitações de saída concorrentes não abrem um segundo alerta', async () => {
      const page = montarPagina();
      comUmaCena(page);
      const descartar = spyOn(page.store, 'descartarRascunho').and.resolveTo();
      escolherNoAlerta('LEAVE_DISCARD');
      const create = TestBed.inject(AlertController).create as jasmine.Spy;

      const primeira = page.aoVoltar();
      const segunda = page.aoVoltar();

      // Só um alerta é aberto — a segunda chamada compartilha a MESMA
      // decisão da primeira, em vez de perguntar de novo.
      expect(create).toHaveBeenCalledTimes(1);
      expect(await primeira).toBe(true);
      expect(await segunda).toBe(true);
      expect(descartar).toHaveBeenCalledTimes(1);
    });

    it('sai mesmo quando o próprio alerta falha ao abrir', async () => {
      // Mesma regra de "sair não pode travar" que já vale para a rede: sem
      // o `.catch` no fim da cadeia do alerta, um `present()` que rejeita
      // deixaria a promise do guard pendurada para sempre, e a pessoa não
      // conseguiria mais sair do wizard.
      const page = montarPagina();
      comUmaCena(page);
      spyOn(TestBed.inject(AlertController), 'create').and.resolveTo({
        present: () => Promise.reject(new Error('sem overlay')),
      } as never);

      const pode = await page.aoVoltar();

      expect(pode).toBe(true);
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
          {
            provide: AlertController,
            useValue: {
              create: () => Promise.resolve({ present: () => Promise.resolve() }),
            },
          },
          // Dublê mínimo, como o `AlertController` acima: só precisa devolver
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
      // Mesma regra de "sair nao pode travar" que vale em `aoVoltar()`: uma
      // falha de rede aqui deixa o wizard vazio, nao a tela inteira presa.
      const page = montarPaginaComQuery('t1');
      spyOn(page.store, 'retomarRascunho').and.rejectWith(new Error('rede'));

      expect(() => page.ngOnInit()).not.toThrow();
    });
  });
});
