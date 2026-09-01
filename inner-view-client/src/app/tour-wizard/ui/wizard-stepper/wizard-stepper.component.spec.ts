import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { ChipState, WizardStepperComponent } from './wizard-stepper.component';

/**
 * O stepper decide o que aparece clicável e o que aparece bloqueado. Errar um
 * estado aqui deixa o corretor preso na etapa 1 sem entender por quê, ou o
 * deixa entrar numa etapa que não tem como funcionar.
 */
describe('WizardStepperComponent', () => {
  function scene(id: string): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  /**
   * Monta só a classe do componente, sem fixture: o stepper não tem estado
   * próprio — tudo que ele decide sai do store — e um fixture aqui testaria o
   * renderizador do Angular, não a regra.
   */
  function makeStepper(withImage: boolean): {
    stepper: WizardStepperComponent;
    store: TourDraftStore;
  } {
    const store = TestBed.inject(TourDraftStore);
    if (withImage) {
      store.scenes.set([scene('a')]);
      store.selectedSceneId.set('a');
    }
    const stepper = Object.create(
      WizardStepperComponent.prototype,
    ) as WizardStepperComponent;
    Object.defineProperty(stepper, 'store', { value: store });
    return { stepper, store };
  }

  function statesOf(stepper: WizardStepperComponent): ChipState[] {
    return [1, 2, 3].map((n) => stepper.stateOf(n as 1 | 2 | 3));
  }

  it('bloqueia as etapas seguintes enquanto não há imagem', () => {
    const { stepper } = makeStepper(false);

    expect(statesOf(stepper)).toEqual(['current', 'blocked', 'blocked']);
  });

  it('libera as etapas seguintes assim que entra uma imagem', () => {
    const { stepper } = makeStepper(true);

    expect(statesOf(stepper)).toEqual(['current', 'reachable', 'reachable']);
  });

  it('marca como concluída toda etapa já deixada para trás', () => {
    const { stepper, store } = makeStepper(true);
    store.goTo(3);

    expect(statesOf(stepper)).toEqual(['done', 'done', 'current']);
  });

  it('não navega ao clicar num chip bloqueado', () => {
    const { stepper, store } = makeStepper(false);

    stepper.onChip(3);

    expect(store.step()).toBe(1);
  });

  it('navega ao clicar num chip alcançável', () => {
    const { stepper, store } = makeStepper(true);

    stepper.onChip(2);

    expect(store.step()).toBe(2);
  });

  it('volta à etapa 1 quando a última imagem é removida', () => {
    const { stepper, store } = makeStepper(true);
    store.goTo(2);

    // O corretor apagou a única imagem estando na etapa 2. Ficar ali deixaria
    // o rodapé desabilitado e o conserto duas telas atrás.
    store.removeScene('a');

    expect(store.step()).toBe(1);
    expect(statesOf(stepper)).toEqual(['current', 'blocked', 'blocked']);
  });

  it('deixa voltar a uma etapa já concluída', () => {
    const { stepper, store } = makeStepper(true);
    store.goTo(3);

    expect(stepper.stateOf(1)).toBe('done');

    stepper.onChip(1);

    expect(store.step()).toBe(1);
  });

  it('mantem os metadados textuais ocultos em todas as etapas', () => {
    const { store } = makeStepper(true);
    const fixture = TestBed.createComponent(WizardStepperComponent);

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tw-progress__meta')).toBeNull();

    store.step.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tw-progress__meta')).toBeNull();
  });
});
