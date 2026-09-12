import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ModalController } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
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
  });

  /**
   * Põe o componente no estado em que a costura já terminou, sem passar pela
   * câmera. Os dois campos são privados porque nada fora daqui os escreve — o
   * acesso por colchetes é o preço de testar o desfecho sem a captura inteira.
   */
  function comCosturaPronta(envio: Promise<EnvioDaCaptura | null> | null): void {
    componente['originalImageData'] = 'data:image/jpeg;base64,x';
    componente['envio'] = envio;
    componente.state.set('preview');
  }

  /**
   * O ciclo do selo, que na primeira versão desta entrega não tinha fim.
   *
   * Ele acendia e NUNCA apagava: "Melhorando com IA…" ficava pulsando sobre o
   * preview para sempre, e a foto tratada nunca chegava a trocar a costurada —
   * a promessa que justifica a entrega inteira não se cumpria. Foi assim que o
   * modal chegou a produção, e foi visto na tela, não em teste.
   */
  describe('o selo tem fim', () => {
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
      componente.state.set('preview');

      await componente['trocarQuandoChegar']();
    }

    /**
     * PELO CAMINHO DE VERDADE, e não chamando a troca à mão.
     *
     * Os casos abaixo provam que `trocarQuandoChegar` funciona. Nenhum deles
     * provava que ALGUÉM a chama — e era exatamente esse o defeito que chegou
     * a produção: o selo acendia em `tratarEEntao` e nada agendava o fim dele.
     * Chamar o privado direto pula a única linha que faltava.
     */
    it('a costura pronta agenda o fim do selo, sem ninguém pedir', async () => {
      componente.enviar = () =>
        Promise.resolve({ panoramaId: 'p1', tratamentoPedido: true });
      componente.aoTratar = () => Promise.resolve('blob:tratada');
      componente['stitchedShots'] = [
        { frame: { blob: new Blob(['f']) }, quaternion: {} },
      ] as never;

      componente['tratarEEntao']('data:image/jpeg;base64,x');

      // O selo acende de imediato: a foto costurada já está na tela.
      expect(componente.tratando()).toBeTrue();
      expect(componente.previewPanoramas()[0].imageUrl).toBe('data:image/jpeg;base64,x');

      // E apaga sozinho, com a tratada no lugar.
      await new Promise((r) => setTimeout(r));

      expect(componente.tratando()).toBeFalse();
      expect(componente.previewPanoramas()[0].imageUrl).toBe('blob:tratada');
    });

    it('apaga o selo e troca a foto quando a tratada chega', async () => {
      await esperarATroca({ panoramaId: 'p1', tratamentoPedido: true }, 'blob:tratada');

      expect(componente.tratando()).toBeFalse();
      expect(componente.naoMelhorou()).toBeFalse();
      expect(componente.previewPanoramas()[0].imageUrl).toBe('blob:tratada');
    });

    it('apaga o selo e avisa quando a IA não melhorou', async () => {
      await esperarATroca({ panoramaId: 'p1', tratamentoPedido: true }, null);

      expect(componente.tratando()).toBeFalse();
      // Uma espera que termina calada não deixa distinguir "a IA não
      // conseguiu" de "a IA nem tentou".
      expect(componente.naoMelhorou()).toBeTrue();
    });

    it('apaga o selo quando não havia montagem a caminho', async () => {
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
  });

  /**
   * O RODAPÉ NÃO PODE SE SOBREPOR.
   *
   * Relatado da tela, em produção: o campo "Que ambiente é este?", os chips de
   * sugestão, "Refazer", "Usar este panorama" e a nota apareceram todos
   * empilhados uns sobre os outros, legíveis ao mesmo tempo e nada clicável.
   *
   * A causa foi número mágico: o campo de nome e a barra de botões eram duas
   * caixas absolutas com `bottom` fixo — 84px e 20px —, e os números descreviam
   * uma barra de DOIS botões numa linha só. Ganhando a nota e o terceiro botão,
   * a barra cresceu para cima e invadiu o campo.
   *
   * Mede caixa contra caixa no navegador, e não a existência das classes: era
   * justamente com todas as classes no lugar que a tela estava quebrada.
   */
  describe('o rodapé do preview', () => {
    /** Largura e altura de um aparelho de 4,7", que é onde o defeito apareceu. */
    const LARGURA_DO_CELULAR = 360;
    const ALTURA_DO_CELULAR = 640;
    let celular: HTMLElement;

    /**
     * Põe o modal dentro de uma caixa do tamanho de um celular.
     *
     * Sem isto o caso não prova nada: o navegador do Karma abre com quase
     * 750px de largura, os três botões cabem lado a lado, e a tela quebrada do
     * corretor não se reproduz. A caixa é `position: relative` porque é ela que
     * precisa ser o bloco de contenção dos absolutos do rodapé.
     */
    function noPreview(comSelo: boolean): void {
      celular = document.createElement('div');
      celular.style.cssText = `position:relative;width:${LARGURA_DO_CELULAR}px;height:${ALTURA_DO_CELULAR}px;overflow:hidden`;
      document.body.appendChild(celular);
      celular.appendChild(fixture.nativeElement);

      componente['originalImageData'] = 'data:image/jpeg;base64,x';
      componente.tratando.set(comSelo);
      componente['mostrarPreview']('data:image/jpeg;base64,x');
      fixture.detectChanges();
    }

    afterEach(() => celular?.remove());

    const caixa = (seletor: string): DOMRect =>
      fixture.nativeElement.querySelector(seletor).getBoundingClientRect();

    it('o campo de nome termina antes de os botões começarem', () => {
      noPreview(true);

      const nome = caixa('.result-name');
      const acoes = caixa('.result-actions');

      expect(nome.bottom)
        .withContext(
          `nome termina em ${nome.bottom.toFixed(0)}px e os botões começam em ${acoes.top.toFixed(0)}px`,
        )
        .toBeLessThanOrEqual(acoes.top);
    });

    it('os chips de sugestão não ficam por baixo dos botões', () => {
      noPreview(true);

      const chips = caixa('.result-name__chips');
      const acoes = caixa('.result-actions');

      expect(chips.bottom).toBeLessThanOrEqual(acoes.top);
    });

    it('a nota não cobre o campo de nome', () => {
      noPreview(true);

      const nome = caixa('.result-name');
      const nota = caixa('.result-actions__nota');

      expect(nota.top).toBeGreaterThanOrEqual(nome.bottom);
    });

    it('o selo fica abaixo da barra de cima, e não em cima dela', () => {
      noPreview(true);

      const selo = caixa('.capture-selo');
      const barra = caixa('.top-bar');

      expect(selo.top)
        .withContext(`selo em ${selo.top.toFixed(0)}px, barra termina em ${barra.bottom.toFixed(0)}px`)
        .toBeGreaterThanOrEqual(barra.bottom);
    });

    /**
     * O que torna a sobreposição IMPOSSÍVEL, e não só improvável nesta largura.
     *
     * Enquanto o campo de nome tiver `bottom` próprio, ele e a barra de botões
     * são duas caixas independentes, e a distância entre elas é uma aposta
     * sobre quantas linhas os botões vão ocupar. Em fluxo, não há aposta.
     */
    it('o campo e os botões fluem na MESMA coluna, sem coordenada própria', () => {
      noPreview(true);

      const nome: HTMLElement = fixture.nativeElement.querySelector('.result-name');
      const acoes: HTMLElement = fixture.nativeElement.querySelector('.result-actions');

      expect(nome.parentElement?.classList).toContain('result-bottom');
      expect(acoes.parentElement).toBe(nome.parentElement);
      expect(getComputedStyle(nome).position).toBe('static');
      expect(getComputedStyle(acoes).position).toBe('static');
    });

    it('o rodapé continua inteiro dentro da tela sem o selo', () => {
      noPreview(false);

      const rodape = caixa('.result-bottom');

      expect(rodape.bottom).toBeLessThanOrEqual(
        celular.getBoundingClientRect().bottom,
      );
    });
  });

  it('confirma com o id que o envio devolveu', async () => {
    comCosturaPronta(Promise.resolve({ panoramaId: 'pan-7', tratamentoPedido: true }));

    await componente.usePanorama();

    expect(modalCtrl.dismiss).toHaveBeenCalledWith(
      jasmine.objectContaining({ serverPanoramaId: 'pan-7', emTratamento: true }),
      'confirm',
    );
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
