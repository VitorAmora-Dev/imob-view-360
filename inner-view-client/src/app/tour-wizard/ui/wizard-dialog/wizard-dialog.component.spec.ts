import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';

import { WizardDialogComponent } from './wizard-dialog.component';
import { PerguntaDoWizard } from './wizard-dialog.model';

/**
 * A casca do `IonModal`.
 *
 * O DESENHO tem spec próprio (`wizard-dialog-box.component.spec.ts`), e o
 * comportamento de sobreposição é do Ionic — testá-lo seria testar a
 * biblioteca, como já diz o spec do `hotspot-sheet`. O que se prova aqui é a
 * LIGAÇÃO: quando o modal existe, quando ele aceita ser fechado por fora, e
 * que uma resposta sai uma vez só.
 */
describe('WizardDialogComponent', () => {
  const montados: ComponentFixture<WizardDialogComponent>[] = [];

  function pergunta(extras: Partial<PerguntaDoWizard> = {}): PerguntaDoWizard {
    return {
      tituloKey: 'TITULO',
      mensagemKey: 'MENSAGEM',
      dispensavel: true,
      acoes: [{ id: 'ok', rotuloKey: 'OK', tom: 'primario' }],
      ...extras,
    };
  }

  function montar(p: PerguntaDoWizard | null): ComponentFixture<WizardDialogComponent> {
    const fixture = TestBed.createComponent(WizardDialogComponent);
    montados.push(fixture);
    fixture.componentRef.setInput('pergunta', p);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * As PROPRIEDADES do `<ion-modal>`, e não os atributos `ng-reflect-*`: o
   * wrapper Angular do Ionic escreve as ligações direto no elemento, e
   * `ng-reflect` só existe em modo de desenvolvimento.
   */
  function oModal(
    fixture: ComponentFixture<unknown>,
  ): { isOpen: boolean; backdropDismiss: boolean } {
    return (fixture.nativeElement as HTMLElement).querySelector(
      'ion-modal',
    ) as unknown as { isOpen: boolean; backdropDismiss: boolean };
  }

  /**
   * Um modal apresentado prende o foco no DOCUMENTO, que é um só para a suíte
   * inteira. O levantamento está em `hotspot-sheet.component.spec.ts`.
   *
   * O `await` vem ANTES do `destroy()`, e é a parte que faltava: a apresentação
   * do Ionic é assíncrona, e destruir a fixture no meio dela não a cancela — o
   * `present()` termina depois, devolve o modal ao documento e põe o foco nele,
   * agora fora do alcance da limpeza. Aconteceu uma vez em cinco execuções, e a
   * falha saiu num spec de OUTRO arquivo (`StepImagesComponent`, que confere
   * `document.activeElement`), que é o pior lugar para procurar.
   *
   * O custo só existe quando há mesmo um modal na tela — a maioria dos casos
   * daqui não apresenta nenhum.
   */
  afterEach(async () => {
    if (document.querySelector('ion-modal.tw-dialog')) {
      await new Promise((resolver) => setTimeout(resolver, 400));
    }
    while (montados.length) montados.pop()!.destroy();
    document.querySelectorAll('ion-modal').forEach((modal) => modal.remove());
    (document.activeElement as HTMLElement | null)?.blur();
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  it('fica fechado enquanto não há pergunta', () => {
    expect(oModal(montar(null)).isOpen).toBeFalse();
  });

  it('abre quando uma pergunta chega', () => {
    expect(oModal(montar(pergunta())).isOpen).toBeTrue();
  });

  /**
   * `backdropDismiss` governa o toque fora E o Esc no Ionic. Numa pergunta em
   * que "nada" não é resposta, os dois precisam ficar mudos juntos — deixar o
   * Esc de pé ali devolveria em silêncio o estado que a pergunta existe para
   * impedir.
   */
  it('o toque fora responde pela pergunta, e não por uma constante', () => {
    expect(oModal(montar(pergunta())).backdropDismiss).toBeTrue();
    expect(oModal(montar(pergunta({ dispensavel: false }))).backdropDismiss).toBeFalse();
  });

  it('o X responde pela pergunta que está na tela', () => {
    const p = pergunta();
    const fixture = montar(p);
    const dispensadas: PerguntaDoWizard[] = [];
    fixture.componentInstance.dispensou.subscribe((q) => dispensadas.push(q));

    fixture.componentInstance.fechar();

    expect(dispensadas).toEqual([p]);
  });

  /**
   * Fechar o modal É dispensá-lo, aos olhos do Ionic: o `didDismiss` chega logo
   * atrás de toda resposta. Sem zerar a pergunta em exibição, cada escolha
   * viraria uma escolha MAIS uma dispensa — e a dispensa cancelaria a pergunta
   * seguinte, que é a de "não conseguimos salvar".
   */
  it('escolher não vira também uma dispensa', () => {
    const fixture = montar(pergunta());
    const escolhas: string[] = [];
    const dispensadas: PerguntaDoWizard[] = [];
    fixture.componentInstance.escolheu.subscribe((id) => escolhas.push(id));
    fixture.componentInstance.dispensou.subscribe((q) => dispensadas.push(q));

    fixture.componentInstance.escolher({
      id: 'ok',
      rotuloKey: 'OK',
      tom: 'primario',
    });
    // O `didDismiss` que o Ionic anuncia em seguida.
    fixture.componentInstance.aoDispensar();

    expect(escolhas).toEqual(['ok']);
    expect(dispensadas).toEqual([]);
  });

  it('o X não responde duas vezes', () => {
    const fixture = montar(pergunta());
    const dispensadas: PerguntaDoWizard[] = [];
    fixture.componentInstance.dispensou.subscribe((q) => dispensadas.push(q));

    fixture.componentInstance.fechar();
    fixture.componentInstance.aoDispensar();

    expect(dispensadas.length).toBe(1);
  });

  it('sem pergunta na tela, uma dispensa não responde nada', () => {
    const fixture = montar(null);
    const dispensadas: PerguntaDoWizard[] = [];
    fixture.componentInstance.dispensou.subscribe((q) => dispensadas.push(q));

    fixture.componentInstance.aoDispensar();

    expect(dispensadas).toEqual([]);
  });
});
