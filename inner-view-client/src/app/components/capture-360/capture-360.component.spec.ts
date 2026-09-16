import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ModalController } from '@ionic/angular/standalone';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Capture360Component, EnvioDaCaptura } from './capture-360.component';

/**
 * A confirmação da captura, e o que ela espera antes de fechar.
 *
 * Cobre só o desfecho: câmera, giroscópio e costura têm specs próprios, e
 * levantá-los aqui traria a parte frágil do modal para dentro de um caso que
 * não fala dela. O que este arquivo prende é o contrato com o wizard.
 */
describe('Capture360Component — a confirmação', () => {
  let fixture: ComponentFixture<Capture360Component>;
  let componente: Capture360Component;
  let modalCtrl: jasmine.SpyObj<ModalController>;

  beforeEach(() => {
    modalCtrl = jasmine.createSpyObj<ModalController>('ModalController', ['dismiss']);

    TestBed.configureTestingModule({
      imports: [Capture360Component],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        { provide: ModalController, useValue: modalCtrl },
      ],
    });

    fixture = TestBed.createComponent(Capture360Component);
    componente = fixture.componentInstance;

    TestBed.inject(TranslateService).setTranslation('pt', {
      CAPTURE: {
        ROOM_LIVING: 'Sala',
        ROOM_KITCHEN: 'Cozinha',
        ROOM_BEDROOM: 'Quarto',
        ROOM_BATHROOM: 'Banheiro',
      },
    }, true);
  });

  /**
   * Põe o componente no estado em que a costura já terminou, sem passar pela
   * câmera. Os dois campos são privados porque nada fora daqui os escreve — o
   * acesso por colchetes é o preço de testar o desfecho sem a captura inteira.
   */
  function comCosturaPronta(envio: Promise<EnvioDaCaptura | null> | null): void {
    componente['originalImageData'] = 'data:image/jpeg;base64,x';
    componente['envio'] = envio;
    componente.roomName.set('Sala');
    componente.state.set('preview');
  }

  describe('a orientação durante a captura', () => {
    const targets = [
      { yawDeg: 0, pitchDeg: 0 },
      { yawDeg: 90, pitchDeg: 0 },
      { yawDeg: 180, pitchDeg: 0 },
      { yawDeg: 270, pitchDeg: 0 },
    ];

    function capturando(): void {
      componente.captureTargets.set(targets);
      componente.totalCount.set(targets.length);
      componente.capturedCount.set(1);
      componente.state.set('capturing');
      fixture.detectChanges();
    }

    it('mostra no minimapa o que foi concluído e qual é o próximo ponto', () => {
      capturando();

      const points: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.capture-minimap__point'),
      );
      expect(points.length).toBe(4);
      expect(points[0].classList).toContain('is-done');
      expect(points[1].classList).toContain('is-current');
    });

    it('mantém o minimapa separado da dica inferior no celular', () => {
      const phone = document.createElement('div');
      phone.style.cssText = 'position:relative;width:390px;height:760px;overflow:hidden';
      document.body.appendChild(phone);
      phone.appendChild(fixture.nativeElement);
      capturando();

      const minimap = fixture.nativeElement
        .querySelector('app-capture-minimap')
        .getBoundingClientRect();
      const hint = fixture.nativeElement.querySelector('.hint-pill').getBoundingClientRect();

      expect(minimap.bottom).toBeLessThan(hint.top);
      phone.remove();
    });

    it('confirma o ponto com texto e ícone e depois limpa o sinal', fakeAsync(() => {
      capturando();
      componente['showPointCaptured']();
      fixture.detectChanges();

      const success: HTMLElement = fixture.nativeElement.querySelector('.capture-success');
      const reticle: HTMLElement = fixture.nativeElement.querySelector('.reticle');
      expect(success.classList).toContain('is-visible');
      expect(success.querySelector('ion-icon')).not.toBeNull();
      expect(success.textContent).toContain('CAPTURE.POINT_CAPTURED');
      expect(reticle.classList).toContain('reticle--captured');
      expect(reticle.querySelector('ion-icon[name="checkmark"]')).not.toBeNull();

      tick(900);
      fixture.detectChanges();
      expect(success.classList).not.toContain('is-visible');
      expect(reticle.classList).not.toContain('reticle--captured');
      expect(reticle.querySelector('ion-icon')).toBeNull();
    }));

    it('mantém o último sucesso visível antes de iniciar a costura', fakeAsync(() => {
      componente.state.set('capturing');
      const stitch = spyOn(
        componente as unknown as { stitch: () => Promise<void> },
        'stitch',
      ).and.resolveTo();

      componente['scheduleStitchAfterFeedback']();
      tick(899);
      expect(stitch).not.toHaveBeenCalled();

      tick(1);
      expect(stitch).toHaveBeenCalledTimes(1);
    }));
  });

  /**
   * O ciclo do tratamento, que na primeira versão desta entrega não tinha fim.
   *
   * Ele acendia e NUNCA apagava: "Melhorando com IA…" ficava pulsando sobre o
   * preview para sempre, e a foto tratada nunca chegava a trocar a costurada —
   * a promessa que justifica a entrega inteira não se cumpria. Foi assim que o
   * modal chegou a produção, e foi visto na tela, não em teste.
   */
  describe('o tratamento assíncrono tem fim', () => {
    /**
     * Roda o caminho que `tratarEEntao` dispara depois da costura, sem passar
     * pela câmera nem pela costura de verdade.
     */
    async function esperarATroca(
      envio: EnvioDaCaptura | null,
      tratada: string | null,
    ): Promise<void> {
      componente['originalImageData'] = 'data:image/jpeg;base64,x';
      componente['envio'] = Promise.resolve(envio);
      componente.aoTratar = () => Promise.resolve(tratada);
      componente.tratando.set(true);
      componente.roomName.set('Sala');
      componente.state.set('preview');

      await componente['trocarQuandoChegar']();
    }

    /**
     * PELO CAMINHO DE VERDADE, e não chamando a troca à mão.
     *
     * Os casos abaixo provam que `trocarQuandoChegar` funciona. Nenhum deles
     * provava que ALGUÉM a chama — e era exatamente esse o defeito que chegou
     * a produção: o status acendia em `tratarEEntao` e nada agendava o fim dele.
     * Chamar o privado direto pula a única linha que faltava.
     */
    it('a costura pronta agenda o fim do tratamento, sem ninguém pedir', async () => {
      componente.enviar = () =>
        Promise.resolve({ panoramaId: 'p1', tratamentoPedido: true });
      componente.aoTratar = () => Promise.resolve('blob:tratada');
      componente['stitchedShots'] = [
        { frame: { blob: new Blob(['f']) }, quaternion: {} },
      ] as never;

      componente['tratarEEntao']('data:image/jpeg;base64,x');

      // O status acende de imediato: a foto costurada já está na tela.
      expect(componente.tratando()).toBeTrue();
      expect(componente.previewPanoramas()[0].imageUrl).toBe('data:image/jpeg;base64,x');

      // E apaga sozinho, com a tratada no lugar.
      await new Promise((r) => setTimeout(r));

      expect(componente.tratando()).toBeFalse();
      expect(componente.previewPanoramas()[0].imageUrl).toBe('blob:tratada');
    });

    it('encerra o status e troca a foto quando a tratada chega', async () => {
      await esperarATroca({ panoramaId: 'p1', tratamentoPedido: true }, 'blob:tratada');

      expect(componente.tratando()).toBeFalse();
      expect(componente.naoMelhorou()).toBeFalse();
      expect(componente.previewPanoramas()[0].imageUrl).toBe('blob:tratada');
    });

    it('encerra o status e avisa quando a IA não melhorou', async () => {
      await esperarATroca({ panoramaId: 'p1', tratamentoPedido: true }, null);

      expect(componente.tratando()).toBeFalse();
      // Uma espera que termina calada não deixa distinguir "a IA não
      // conseguiu" de "a IA nem tentou".
      expect(componente.naoMelhorou()).toBeTrue();
    });

    it('encerra o status quando não havia montagem a caminho', async () => {
      await esperarATroca({ panoramaId: 'p1', tratamentoPedido: false }, null);

      expect(componente.tratando()).toBeFalse();
      expect(componente.naoMelhorou()).toBeTrue();
    });

    it('a tratada que chegou viaja na confirmação, para a cena nascer pronta', async () => {
      await esperarATroca({ panoramaId: 'p1', tratamentoPedido: true }, 'blob:tratada');

      await componente.usePanorama();

      expect(modalCtrl.dismiss).toHaveBeenCalledWith(
        jasmine.objectContaining({ treatedUrl: 'blob:tratada' }),
        'confirm',
      );
    });

    it('ignora e libera a tratada antiga quando o usuario refaz a captura', async () => {
      let concluirEnvio!: (envio: EnvioDaCaptura) => void;
      let concluirTratamento!: (url: string | null) => void;
      const tratar = jasmine.createSpy('aoTratar').and.returnValue(
        new Promise<string | null>((resolve) => (concluirTratamento = resolve)),
      );
      const revoke = spyOn(URL, 'revokeObjectURL');

      componente.enviar = () =>
        new Promise<EnvioDaCaptura>((resolve) => (concluirEnvio = resolve));
      componente.aoTratar = tratar;
      componente['stitchedShots'] = [
        { frame: { blob: new Blob(['f']) }, quaternion: {} },
      ] as never;

      componente['tratarEEntao']('data:image/jpeg;base64,primeira');
      concluirEnvio({ panoramaId: 'p-antigo', tratamentoPedido: true });
      await Promise.resolve();
      await Promise.resolve();
      expect(tratar).toHaveBeenCalledTimes(1);
      expect(tratar.calls.mostRecent().args[0]).toBe('p-antigo');
      const sinal = tratar.calls.mostRecent().args[1] as AbortSignal;
      expect(sinal.aborted).toBeFalse();

      componente.restart();
      expect(sinal.aborted).toBeTrue();
      concluirTratamento('blob:resultado-antigo');
      await Promise.resolve();
      await Promise.resolve();

      expect(componente.state()).toBe('capturing');
      expect(componente.previewPanoramas()).toEqual([]);
      expect(componente.imagemAprimorada()).toBeFalse();
      expect(revoke).toHaveBeenCalledWith('blob:resultado-antigo');
    });
  });

  /**
   * O TOQUE QUE SUMIA.
   *
   * Relatado como "os botões pararam de funcionar", e não eram os botões:
   * `usePanorama` espera `this.envio`, e esse envio sobe OITO frames, um a um,
   * cada um convertido para base64. No celular do corretor isso leva dezenas
   * de segundos — e durante toda a janela os botões continuavam acesos,
   * tocáveis e calados. Quem apertava via exatamente nada acontecer.
   *
   * A espera em si tem de ficar: é ela que carrega o `serverPanoramaId` para a
   * confirmação, e fechar antes faz o wizard subir o mesmo cômodo de novo no
   * publicar — o defeito de campo de 10/09. O que faltava era a tela dizer que
   * recebeu o toque.
   */
  describe('o toque durante o envio', () => {
    /** Um envio que nunca chega: a janela inteira, congelada. */
    const emVoo = () => new Promise<EnvioDaCaptura | null>(() => undefined);

    const botoes = (): HTMLElement[] =>
      Array.from(fixture.nativeElement.querySelectorAll('.result-actions ion-button'));

    it('acende o botão apertado no mesmo instante do toque', async () => {
      comCosturaPronta(emVoo());
      fixture.detectChanges();

      void componente.usePanorama(true);
      await Promise.resolve();
      fixture.detectChanges();

      const continuar = fixture.nativeElement.querySelector('.result-actions__continue');
      expect(continuar.getAttribute('aria-busy'))
        .withContext('o botão apertado precisa dizer que está ocupado')
        .toBe('true');
      expect(continuar.querySelector('ion-spinner')).not.toBeNull();
    });

    /** Girar os dois leria como a tela inteira travando, não como espera. */
    it('gira só o botão apertado, e desabilita os outros', async () => {
      comCosturaPronta(emVoo());
      fixture.detectChanges();

      void componente.usePanorama(true);
      await Promise.resolve();
      fixture.detectChanges();

      const comFiapo = botoes().filter((b) => b.querySelector('ion-spinner'));
      expect(comFiapo.length).toBe(1);
      // Propriedade e nao atributo: o wrapper do Ionic recebe `[disabled]`
      // como @Input e o repassa ao elemento. Procurar o ATRIBUTO passaria verde
      // com o binding arrancado.
      const desabilitado = (b: HTMLElement) =>
        (b as unknown as { disabled?: boolean }).disabled === true;
      expect(botoes().every(desabilitado)).toBeTrue();
    });

    /**
     * A espera continua existindo — o que mudou foi ela ter voz. Fechar antes
     * de o envio chegar perderia o `serverPanoramaId`, e o cômodo subiria duas
     * vezes.
     */
    it('não fecha antes de o envio chegar', async () => {
      comCosturaPronta(emVoo());

      void componente.usePanorama(true);
      await Promise.resolve();
      await Promise.resolve();

      expect(modalCtrl.dismiss).not.toHaveBeenCalled();
    });

    /**
     * Teclado e leitor de tela chegam ao handler por caminhos que não passam
     * pelo `disabled` visual. Dois `dismiss` com o mesmo panorama são dois
     * cômodos iguais na etapa 1.
     */
    it('o segundo toque não abre uma segunda confirmação', async () => {
      let resolver: (v: EnvioDaCaptura | null) => void = () => undefined;
      comCosturaPronta(new Promise<EnvioDaCaptura | null>((r) => (resolver = r)));

      void componente.usePanorama(true);
      void componente.usePanorama(true);
      resolver({ panoramaId: 'p1', tratamentoPedido: true });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(modalCtrl.dismiss).toHaveBeenCalledTimes(1);
    });

    it('quando o envio chega, a confirmação sai', async () => {
      let resolver: (v: EnvioDaCaptura | null) => void = () => undefined;
      comCosturaPronta(new Promise<EnvioDaCaptura | null>((r) => (resolver = r)));

      void componente.usePanorama(true);
      await Promise.resolve();
      expect(modalCtrl.dismiss).not.toHaveBeenCalled();

      resolver({ panoramaId: 'p1', tratamentoPedido: true });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(modalCtrl.dismiss).toHaveBeenCalledTimes(1);
    });

    /** Um "ocupado" preso desabilitaria as duas ações na próxima passagem. */
    it('refazer devolve os botões', async () => {
      comCosturaPronta(emVoo());
      void componente.usePanorama(true);
      await Promise.resolve();
      expect(componente.confirmando()).toBe('continuar');

      componente.restart();

      expect(componente.confirmando()).toBeNull();
    });
  });

  describe('a folha de decisão do preview', () => {
    const LARGURA_DO_CELULAR = 360;
    const ALTURA_DO_CELULAR = 640;
    let celular: HTMLElement;

    function noPreview(comIa = false): void {
      celular = document.createElement('div');
      celular.style.cssText = `position:relative;width:${LARGURA_DO_CELULAR}px;height:${ALTURA_DO_CELULAR}px;overflow:hidden`;
      document.body.appendChild(celular);
      celular.appendChild(fixture.nativeElement);

      componente['originalImageData'] = 'data:image/jpeg;base64,x';
      componente.tratando.set(comIa);
      componente['mostrarPreview']('data:image/jpeg;base64,x');
      fixture.detectChanges();
    }

    afterEach(() => celular?.remove());

    const botoesDeDecisao = (): HTMLElement[] =>
      Array.from(fixture.nativeElement.querySelectorAll('.result-actions ion-button'));

    it('oferece somente salvar e capturar outro ou salvar e concluir', () => {
      noPreview();

      const botoes = botoesDeDecisao();
      expect(botoes.length).toBe(2);
      expect(botoes[0].textContent).toContain('CAPTURE.SAVE_AND_CAPTURE_ANOTHER');
      expect(botoes[1].textContent).toContain('CAPTURE.SAVE_AND_FINISH');
      expect(fixture.nativeElement.querySelector('.result-actions__nota')).toBeNull();
      expect(fixture.nativeElement.querySelector('.capture-selo')).toBeNull();
      expect(fixture.nativeElement.querySelector('.capture-aviso')).toBeNull();
    });

    it('mantém nome e ações na mesma folha, sem sobreposição', () => {
      noPreview(true);

      const folha: HTMLElement = fixture.nativeElement.querySelector('.result-bottom');
      const nome: HTMLElement = fixture.nativeElement.querySelector('.result-name');
      const acoes: HTMLElement = fixture.nativeElement.querySelector('.result-actions');
      const limite = celular.getBoundingClientRect();
      const caixaDaFolha = folha.getBoundingClientRect();

      expect(nome.parentElement).toBe(folha);
      expect(acoes.parentElement).toBe(folha);
      expect(getComputedStyle(nome).position).toBe('static');
      expect(getComputedStyle(acoes).position).toBe('static');
      expect(caixaDaFolha.bottom).toBeLessThanOrEqual(limite.bottom);
      expect(caixaDaFolha.top).toBeGreaterThan(limite.top);
    });

    it('exige o nome antes de habilitar as duas ações', () => {
      noPreview();

      const desabilitado = (botao: HTMLElement) =>
        (botao as unknown as { disabled?: boolean }).disabled === true;
      expect(botoesDeDecisao().every(desabilitado)).toBeTrue();

      const quarto = Array.from<HTMLElement>(
        fixture.nativeElement.querySelectorAll('.result-name__chip'),
      ).find((chip) => chip.textContent?.trim() === 'Quarto')!;
      quarto.click();
      fixture.detectChanges();

      expect(componente.roomName()).toBe('Quarto');
      expect(botoesDeDecisao().some(desabilitado)).toBeFalse();
    });

    it('sugere um sufixo quando o nome do ambiente já foi usado', () => {
      componente.existingRoomNames = ['quarto', 'Quarto 2'];
      const quarto = componente.roomSuggestions.find((item) => item.id === 'bedroom')!;

      componente.pickRoom(quarto);

      expect(componente.roomName()).toBe('Quarto 3');
      expect(componente.selectedRoomSuggestion()).toBe('bedroom');
    });

    it('só mostra o campo livre ao escolher Outro e volta aos chips comuns', () => {
      noPreview();
      expect(fixture.nativeElement.querySelector('.result-name__input')).toBeNull();

      const chips = Array.from<HTMLElement>(
        fixture.nativeElement.querySelectorAll('.result-name__chip'),
      );
      chips[chips.length - 1].click();
      fixture.detectChanges();

      const input: HTMLInputElement = fixture.nativeElement.querySelector('.result-name__input');
      expect(input).not.toBeNull();
      input.value = 'Varanda gourmet';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(componente.roomName()).toBe('Varanda gourmet');

      chips[chips.length - 1].click();
      fixture.detectChanges();
      expect(componente.roomName()).toBe('Varanda gourmet');

      chips[0].click();
      fixture.detectChanges();
      expect(componente.roomName()).toBe('Sala');
      expect(componente.customRoom()).toBeFalse();
      expect(fixture.nativeElement.querySelector('.result-name__input')).toBeNull();
    });

    it('mostra um único status para processamento, sucesso ou falha da IA', () => {
      noPreview(true);
      let status: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.capture-ai-status'),
      );
      expect(status.length).toBe(1);
      expect(status[0].querySelector('ion-spinner')).not.toBeNull();
      expect(status[0].textContent).toContain('CAPTURE.AI_PROCESSING');

      componente.tratando.set(false);
      componente.imagemAprimorada.set(true);
      fixture.detectChanges();
      status = Array.from(fixture.nativeElement.querySelectorAll('.capture-ai-status'));
      expect(status.length).toBe(1);
      expect(status[0].querySelector('ion-icon[name="checkmark-circle"]')).not.toBeNull();
      expect(status[0].textContent).toContain('CAPTURE.AI_DONE');

      componente.imagemAprimorada.set(false);
      componente.naoMelhorou.set(true);
      fixture.detectChanges();
      status = Array.from(fixture.nativeElement.querySelectorAll('.capture-ai-status'));
      expect(status.length).toBe(1);
      expect(status[0].querySelector('ion-icon[name="information-circle-outline"]')).not.toBeNull();
      expect(status[0].textContent).toContain('CAPTURE.AI_FAILED');
    });
  });

  describe('as confirmações de descarte', () => {
    it('o X pede confirmação e manter preserva o preview', () => {
      comCosturaPronta(Promise.resolve(null));

      componente.requestPreviewCancel();
      expect(componente.discardQuestion()?.tituloKey).toBe('CAPTURE.DISCARD_TITLE');
      expect(modalCtrl.dismiss).not.toHaveBeenCalled();

      componente.resolveDiscardQuestion('keep-capture');
      expect(componente.discardQuestion()).toBeNull();
      expect(componente.state()).toBe('preview');
      expect(modalCtrl.dismiss).not.toHaveBeenCalled();
    });

    it('refazer pede confirmação e preserva o nome escolhido', () => {
      comCosturaPronta(Promise.resolve(null));

      componente.requestPreviewRetake();
      expect(componente.discardQuestion()?.tituloKey).toBe('CAPTURE.RETAKE_TITLE');
      expect(componente.state()).toBe('preview');

      componente.resolveDiscardQuestion('retake-capture');
      expect(componente.state()).toBe('capturing');
      expect(componente.roomName()).toBe('Sala');
      expect(modalCtrl.dismiss).not.toHaveBeenCalled();
    });

    it('ao descartar espera o upload e remove o panorama remoto', async () => {
      let concluirEnvio!: (envio: EnvioDaCaptura) => void;
      const descartar = jasmine.createSpy('aoDescartar').and.resolveTo();
      comCosturaPronta(
        new Promise<EnvioDaCaptura>((resolve) => (concluirEnvio = resolve)),
      );
      componente.aoDescartar = descartar;

      componente.requestPreviewCancel();
      componente.resolveDiscardQuestion('discard-capture');
      expect(modalCtrl.dismiss).toHaveBeenCalledWith(null, 'cancel');
      expect(descartar).not.toHaveBeenCalled();

      concluirEnvio({ panoramaId: 'pan-descartado', tratamentoPedido: true });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(descartar).toHaveBeenCalledOnceWith('pan-descartado');
    });
  });

  it('confirma com o id que o envio devolveu', async () => {
    comCosturaPronta(Promise.resolve({ panoramaId: 'pan-7', tratamentoPedido: true }));

    await componente.usePanorama();

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({
        room: 'Sala',
        serverPanoramaId: 'pan-7',
        emTratamento: true,
      }),
      'confirm',
    );
  });

  it('não confirma sem nome mesmo quando o handler é chamado diretamente', async () => {
    comCosturaPronta(Promise.resolve({ panoramaId: 'pan-7', tratamentoPedido: true }));
    componente.roomName.set('   ');

    await componente.usePanorama();

    expect(modalCtrl.dismiss).not.toHaveBeenCalled();
  });

  /**
   * O DEFEITO QUE ISTO IMPEDE, e que já custou um tour em campo: sair antes de
   * o servidor responder deixa a cena sem `serverPanoramaId`. O salvamento do
   * rascunho cria um panorama para toda cena que não tem um, então o cômodo
   * nasceria DUAS vezes — uma cópia tratada com as fotos, outra crua e sem
   * elas.
   *
   * Na prática o envio termina enquanto a pessoa digita o nome. A espera aqui
   * é a rede ruim, não o caminho comum.
   */
  it('espera o envio antes de fechar, se ele ainda não respondeu', async () => {
    let responder!: (v: EnvioDaCaptura) => void;
    comCosturaPronta(new Promise<EnvioDaCaptura>((r) => (responder = r)));

    const confirmando = componente.usePanorama(true);
    await Promise.resolve();

    expect(modalCtrl.dismiss).not.toHaveBeenCalled();

    responder({ panoramaId: 'pan-9', tratamentoPedido: true });
    await confirmando;

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({ serverPanoramaId: 'pan-9' }),
      'confirm',
    );
  });

  it('o segundo botão confirma E pede a próxima captura', async () => {
    comCosturaPronta(Promise.resolve({ panoramaId: 'pan-1', tratamentoPedido: true }));

    await componente.usePanorama(true);

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({ continuar: true }),
      'confirm',
    );
  });

  it('o botão de sempre confirma sem pedir a próxima', async () => {
    comCosturaPronta(Promise.resolve({ panoramaId: 'pan-1', tratamentoPedido: true }));

    await componente.usePanorama();

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({ continuar: false }),
      'confirm',
    );
  });

  /**
   * Menos fotos de referência que o mínimo e o servidor dispensa sem tratar.
   * Não há montagem a caminho, então o wizard não tem o que acompanhar — e
   * marcar a cena como "tratando" acenderia um selo que nunca se apagaria.
   */
  it('dispensa pelo servidor não anuncia tratamento em curso', async () => {
    comCosturaPronta(Promise.resolve({ panoramaId: 'pan-2', tratamentoPedido: false }));

    await componente.usePanorama();

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({ serverPanoramaId: 'pan-2', emTratamento: false }),
      'confirm',
    );
  });

  it('envio que falhou ainda fecha, sem id e sem tratamento', async () => {
    comCosturaPronta(Promise.resolve(null));

    await componente.usePanorama();

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({ serverPanoramaId: null, emTratamento: false }),
      'confirm',
    );
  });

  it('o selo sai de cena quando ninguém está mais olhando', () => {
    const olhares: boolean[] = [];
    componente.aoOlhar = (v) => olhares.push(v);
    componente.tratando.set(true);

    fixture.destroy();

    // No destroy e não no dismiss: fechar pelo X, pelo gesto de voltar do
    // Android e pelos botões são três caminhos, e só este passa por todos.
    expect(olhares).toEqual([false]);
  });
});
