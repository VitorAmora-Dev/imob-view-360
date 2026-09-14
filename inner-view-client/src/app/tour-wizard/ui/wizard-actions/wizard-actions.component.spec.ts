import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene, WizardStep } from '../../tour-wizard.model';
import { WizardActionsComponent } from './wizard-actions.component';

/**
 * A barra de acao nao tinha spec, e foi exatamente por isso que a renumeracao
 * das etapas passou por ela sem ninguem notar: o rotulo do primario, o "Pular"
 * e o motivo do bloqueio continuaram apontando para os numeros antigos. O
 * corretor via "Publicar tour" numa etapa que so avanca, e um botao apagado
 * sem explicacao nenhuma na etapa seguinte.
 */
describe('WizardActionsComponent', () => {
  function montar() {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    const fixture = TestBed.createComponent(WizardActionsComponent);
    return {
      barra: fixture.componentInstance,
      store: TestBed.inject(TourDraftStore),
      fixture,
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  function ponto(target: string): WizardHotspot {
    return { id: crypto.randomUUID(), u: 0.5, v: 0.5, label: '', target };
  }

  function cena(
    id: string,
    connections: string[] = [],
    hotspots: WizardHotspot[] = [],
  ): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots,
      state: 'ready',
      connections,
    };
  }

  function em(etapa: WizardStep, cenas: WizardScene[]) {
    const { barra, store, fixture } = montar();
    store.scenes.set(cenas);
    store.step.set(etapa);
    return { barra, store, fixture };
  }

  const LIGADAS = () => [cena('sala', ['cozinha']), cena('cozinha', ['sala'])];

  /** Uma cena que já passou (ou está) pela IA. */
  function comIA(id: string, aiState: WizardScene['aiState']): WizardScene {
    return { ...cena(id), aiState };
  }

  /**
   * Carrega só as frases da espera. O resto da suíte compara chaves cruas de
   * propósito; aqui não dá, porque metade do que estes casos guardam é a
   * INTERPOLAÇÃO — "1 de 3" é a informação, e ela não existe na chave.
   */
  function comTextos(): void {
    TestBed.inject(TranslateService).setTranslation(
      'pt',
      {
        TOUR_WIZARD: {
          STEP1: {
            TRATANDO_UM: 'Melhorando sua foto. Leva cerca de 1 minuto.',
            TRATANDO_VARIOS:
              'Melhorando suas fotos — {{prontas}} de {{total}} prontas.',
            TRATANDO_DEMORADO: 'Ainda melhorando. Está demorando mais que o normal.',
          },
        },
      },
      true,
    );
  }

  describe('rotulo do primario', () => {
    it('a galeria da etapa 1 termina com "Pronto"', () => {
      const { barra, fixture } = em(1, [cena('sala')]);
      fixture.detectChanges();

      expect(barra.primaryLabelKey()).toBe('TOUR_WIZARD.COMMON.DONE');
      expect(
        fixture.nativeElement.querySelector('.tw-btn--primary').classList,
      ).toContain('is-compact');
    });

    // O defeito da foto: a etapa 3 anunciava "Publicar tour" e so avancava.
    it('a etapa de passagens ainda e "proximo"', () => {
      const { barra } = em(3, LIGADAS());
      expect(barra.primaryLabelKey()).toBe('TOUR_WIZARD.COMMON.NEXT');
    });

    it('quem publica e a etapa 4', () => {
      const { barra } = em(4, LIGADAS());
      expect(barra.primaryLabelKey()).toBe('TOUR_WIZARD.COMMON.PUBLISH');
    });
  });

  describe('a etapa 1 cobra o fim do tratamento', () => {
    /**
     * Antes do nome de propósito. Nomear é coisa que o corretor resolve num
     * toque; esperar a IA, não. Dizer "faltam nomes" a quem já nomeou tudo e
     * está olhando um selo girando manda procurar o problema no lugar errado.
     */
    it('explica a espera, e não o nome, quando é a espera que segura', () => {
      const emCurso = { ...cena('sala'), aiState: 'treating' as const };
      const { barra } = em(1, [emCurso]);

      expect(barra.primaryDisabled()).toBeTrue();
      expect(barra.motivoBloqueio()).toBe('TOUR_WIZARD.COMMON.NEEDS_TREATMENT');
    });

    it('com a IA terminada, libera', () => {
      const pronta = { ...cena('sala'), aiState: 'done' as const };
      const { barra } = em(1, [pronta]);

      expect(barra.primaryDisabled()).toBeFalse();
      expect(barra.motivoBloqueio()).toBeNull();
    });

    // Terminais no servidor: nunca virarão `done`, e uma trava literal
    // prenderia o corretor aqui já fora do imóvel.
    it('falha e dispensa não seguram a barra', () => {
      const falhou = { ...cena('sala'), aiState: 'failed' as const };
      const dispensada = { ...cena('cozinha'), aiState: 'skipped' as const };
      const { barra } = em(1, [falhou, dispensada]);

      expect(barra.primaryDisabled()).toBeFalse();
      expect(barra.motivoBloqueio()).toBeNull();
    });
  });

  describe('a ordenacao cobra as conexoes', () => {
    // Sem isto o corretor seguia para a etapa 3 e encontrava so um "volte aos
    // ambientes": o wizard deixava entrar num lugar cuja unica instrucao e sair.
    it('sem conexao nenhuma, o primario trava', () => {
      const { barra } = em(2, [cena('sala'), cena('cozinha')]);

      expect(barra.primaryDisabled()).toBeTrue();
      expect(barra.motivoBloqueio()).toBe('TOUR_WIZARD.STEP_ORDER.NEEDS_LINKS');
    });

    it('com o caminho feito, libera', () => {
      const { barra } = em(2, LIGADAS());

      expect(barra.primaryDisabled()).toBeFalse();
      expect(barra.motivoBloqueio()).toBeNull();
    });

    // Um ambiente nao tem para onde ligar: cobrar aqui seria travar a tela por
    // um defeito que nao existe.
    it('com um ambiente so, nao cobra', () => {
      const { barra } = em(2, [cena('sala')]);
      expect(barra.primaryDisabled()).toBeFalse();
    });

    // Meia conexao tambem nao passa: o terceiro ambiente segue sem caminho.
    it('conectar so uma parte nao basta', () => {
      const { barra } = em(2, [
        cena('sala', ['cozinha']),
        cena('cozinha', ['sala']),
        cena('quarto'),
      ]);

      expect(barra.primaryDisabled()).toBeTrue();
    });
  });

  describe('a etapa de passagens explica o proprio bloqueio', () => {
    // Ja travava, mas em silencio: `motivoBloqueio` ainda perguntava pela etapa
    // 2, entao na 3 devolvia null e o botao ficava apagado sem uma palavra.
    it('conexao escolhida e ponto nao posicionado: diz o que falta', () => {
      const { barra } = em(3, LIGADAS());

      expect(barra.primaryDisabled()).toBeTrue();
      expect(barra.motivoBloqueio()).toBe('TOUR_WIZARD.PASSAGES.NEEDS_LINKS');
    });

    it('com as passagens posicionadas, libera e cala', () => {
      const { barra } = em(3, [
        cena('sala', ['cozinha'], [ponto('cozinha')]),
        cena('cozinha', ['sala'], [ponto('sala')]),
      ]);

      expect(barra.primaryDisabled()).toBeFalse();
      expect(barra.motivoBloqueio()).toBeNull();
    });
  });

  it('oculta a explicacao longa na etapa 1 e preserva o motivo no botao', () => {
    const semNome = { ...cena('sala'), room: '' };
    const { barra, fixture } = em(1, [semNome]);

    fixture.detectChanges();

    expect(barra.motivoBloqueio()).toBe('TOUR_WIZARD.STEP1.NEEDS_NAMES');
    expect(fixture.nativeElement.querySelector('.tw-actions__motivo')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.tw-btn--primary').getAttribute('title'),
    ).toBeTruthy();
  });

  it('explica suavemente o bloqueio quando o primario da etapa 1 recebe toque', fakeAsync(() => {
    const semNome = { ...cena('sala'), room: '' };
    const { barra, store, fixture } = em(1, [semNome]);
    fixture.detectChanges();

    const primary: HTMLButtonElement =
      fixture.nativeElement.querySelector('.tw-btn--primary');
    expect(primary.disabled).toBeFalse();
    expect(primary.getAttribute('aria-disabled')).toBe('true');

    primary.click();
    fixture.detectChanges();

    expect(store.step()).toBe(1);
    expect(store.showErrors()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.tw-actions__feedback')).not.toBeNull();

    tick(2800);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tw-actions__feedback')).toBeNull();
    barra.ngOnDestroy();
  }));

  /**
   * A espera da IA na etapa 1.
   *
   * O que estes casos prendem é a INVERSÃO que existia: o estado do LOTE — o
   * que trava o botão — não aparecia em lugar nenhum, enquanto o estado de uma
   * foto aparecia como uma engrenagem de 34px no card. Quem chegava ao rodapé
   * via um "Pronto" apagado e nada mais; a explicação só saía depois de cutucar
   * o botão morto, e sumia em 2,8 segundos.
   */
  describe('espera da IA', () => {
    it('mostra a fração do lote sem ninguém precisar tocar em nada', () => {
      const { fixture, store } = montar();
      comTextos();
      store.scenes.set([
        comIA('a', 'done'),
        comIA('b', 'treating'),
        comIA('c', 'treating'),
      ]);
      store.step.set(1);
      fixture.detectChanges();

      const faixa = fixture.nativeElement.querySelector('.tw-actions__ia');
      expect(faixa).not.toBeNull();
      expect(faixa.textContent.trim()).toBe(
        'Melhorando suas fotos — 1 de 3 prontas.',
      );
    });

    /**
     * Com um cômodo só a fração é inútil: fica em "0 de 1" por um minuto
     * inteiro. Ali o que informa é a expectativa, não a contagem.
     */
    it('com um cômodo só, promete o tempo em vez de contar', () => {
      const { fixture, store } = montar();
      comTextos();
      store.scenes.set([comIA('a', 'treating')]);
      store.step.set(1);
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('.tw-actions__ia').textContent.trim(),
      ).toBe('Melhorando sua foto. Leva cerca de 1 minuto.');
    });

    /**
     * O prêmio da espera: a faixa some e o botão acende no MESMO instante. É
     * essa simultaneidade que ensina, sem texto nenhum, por que ele estava
     * apagado.
     */
    it('a faixa some e o "Pronto" acende quando o último termina', () => {
      const { barra, fixture, store } = montar();
      store.scenes.set([comIA('a', 'done'), comIA('b', 'treating')]);
      store.step.set(1);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.tw-actions__ia')).not.toBeNull();
      expect(barra.primaryDisabled()).toBeTrue();

      store.scenes.update((s) => [s[0], { ...s[1], aiState: 'done' as const }]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.tw-actions__ia')).toBeNull();
      expect(barra.primaryDisabled()).toBeFalse();
    });

    /** Fora da etapa 1 a montagem não trava nada, e a faixa seria ruído. */
    it('não aparece nas etapas que a montagem não bloqueia', () => {
      const { fixture, store } = montar();
      store.scenes.set([comIA('a', 'treating'), ...LIGADAS()]);
      store.step.set(2);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.tw-actions__ia')).toBeNull();
    });

    /**
     * Passado o esperado, a frase muda. Não cancela nada e não manda recarregar
     * — a montagem segue no servidor. O que ela conserta é o silêncio: sem
     * isto, a mesma frase otimista fica na tela enquanto o corretor conclui
     * sozinho que travou.
     */
    it('depois do tempo esperado, admite a demora', () => {
      const { barra, fixture, store } = montar();
      comTextos();
      store.scenes.set([comIA('a', 'treating')]);
      store.step.set(1);
      fixture.detectChanges();

      expect(barra.demorado()).toBeFalse();

      // Cento e oitenta segundos num lote de um cômodo: o dobro do limite.
      store.inicioDoLote.set(Date.now() - 180_000);
      fixture.detectChanges();

      expect(barra.demorado()).toBeTrue();
      expect(
        fixture.nativeElement.querySelector('.tw-actions__ia').textContent.trim(),
      ).toBe('Ainda melhorando. Está demorando mais que o normal.');

      barra.ngOnDestroy();
    });

    /**
     * O limite acompanha o TAMANHO do lote: três cômodos em três minutos é o
     * esperado, não uma anomalia. Sem a multiplicação, todo lote de mais de um
     * cômodo acusaria demora quase sempre — e um aviso que aparece sempre é um
     * aviso que se aprende a ignorar.
     */
    it('o limite cresce com o tamanho do lote', () => {
      const { barra, fixture, store } = montar();
      store.scenes.set([
        comIA('a', 'treating'),
        comIA('b', 'treating'),
        comIA('c', 'treating'),
      ]);
      store.step.set(1);
      // Dois minutos: passou de 90s, mas está longe dos 270s de três cômodos.
      store.inicioDoLote.set(Date.now() - 120_000);
      fixture.detectChanges();

      expect(barra.demorado()).toBeFalse();

      barra.ngOnDestroy();
    });

    /**
     * O balão cala a boca sobre o tratamento.
     *
     * A faixa já diz isso, e fica. Repetir a mesma informação em dois lugares —
     * um deles sumindo em 2,8 segundos — é o que faz o corretor achar que os
     * dois falam de coisas diferentes.
     */
    it('cutucar o botão não abre balão sobre o que a faixa já diz', () => {
      const { fixture, store } = montar();
      store.scenes.set([comIA('a', 'treating')]);
      store.step.set(1);
      fixture.detectChanges();

      const primario: HTMLButtonElement =
        fixture.nativeElement.querySelector('.tw-btn--primary');
      primario.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.tw-actions__feedback')).toBeNull();
      expect(fixture.nativeElement.querySelector('.tw-actions__ia')).not.toBeNull();
    });

    /**
     * LAYOUT, medido a 360px — a largura de um celular de verdade, e não a do
     * navegador do Karma.
     *
     * Este é o caso que faltou da última vez. O balão era `position: absolute`
     * com `bottom: calc(100% + 8px)` dentro de um `:host` `sticky`: absoluto
     * não reserva espaço, então ele subia POR CIMA do que estivesse acima do
     * rodapé — num celular, os dois botões de adicionar cômodo. O texto
     * "Capturar próximo ambiente" ficava coberto pela caixa branca justamente
     * enquanto ela explicava por que não dava para seguir.
     *
     * A invariante não é "não encosta no botão": é que TUDO que o rodapé
     * desenha cabe dentro da caixa do rodapé. Um filho que sai da caixa do pai
     * está, por definição, em cima do conteúdo de outra pessoa.
     */
    it('tudo que o rodapé desenha cabe dentro do rodapé, a 360px', () => {
      const { fixture, store } = montar();
      comTextos();
      fixture.nativeElement.style.width = '360px';
      store.scenes.set([comIA('a', 'treating'), comIA('b', 'treating')]);
      store.step.set(1);
      fixture.detectChanges();

      const rodape = fixture.nativeElement.getBoundingClientRect();
      const faixa = fixture.nativeElement
        .querySelector('.tw-actions__ia')
        .getBoundingClientRect();
      const primario = fixture.nativeElement
        .querySelector('.tw-btn--primary')
        .getBoundingClientRect();

      expect(faixa.top).toBeGreaterThanOrEqual(rodape.top);
      expect(faixa.bottom).toBeLessThanOrEqual(rodape.bottom);
      // Linha própria, acima dos botões — e não sobreposta a eles.
      expect(faixa.bottom).toBeLessThanOrEqual(primario.top);
    });

    /** A mesma invariante para o balão, que é onde o defeito de fato saiu. */
    it('o balão do bloqueio também fica dentro do rodapé, a 360px', () => {
      const { fixture, store } = montar();
      fixture.nativeElement.style.width = '360px';
      store.scenes.set([{ ...cena('sala'), room: '' }]);
      store.step.set(1);
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.tw-btn--primary').click();
      fixture.detectChanges();

      const rodape = fixture.nativeElement.getBoundingClientRect();
      const balao = fixture.nativeElement
        .querySelector('.tw-actions__feedback')
        .getBoundingClientRect();

      expect(balao.top).toBeGreaterThanOrEqual(rodape.top);
      expect(balao.bottom).toBeLessThanOrEqual(rodape.bottom);
    });
  });
});
