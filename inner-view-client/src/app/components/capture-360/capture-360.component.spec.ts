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
