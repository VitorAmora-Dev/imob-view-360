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
  function makeStepper(sceneCount: number): {
    stepper: WizardStepperComponent;
    store: TourDraftStore;
  } {
    const store = TestBed.inject(TourDraftStore);
    if (sceneCount) {
      store.scenes.set(
        Array.from({ length: sceneCount }, (_, index) =>
          scene(String.fromCharCode(97 + index)),
        ),
      );
      store.selectedSceneId.set('a');
    }
    const stepper = Object.create(
      WizardStepperComponent.prototype,
    ) as WizardStepperComponent;
    Object.defineProperty(stepper, 'store', { value: store });
    return { stepper, store };
  }

  function statesOf(stepper: WizardStepperComponent): ChipState[] {
    return [1, 2, 3, 4].map((n) =>
      stepper.stateOf(n as 1 | 2 | 3 | 4),
    );
  }

  it('bloqueia as etapas seguintes enquanto não há imagem', () => {
    const { stepper } = makeStepper(0);

    expect(statesOf(stepper)).toEqual([
      'current',
      'blocked',
      'blocked',
      'blocked',
    ]);
  });

  it('omite passagens e libera as outras etapas quando entra uma imagem', () => {
    const { stepper, store } = makeStepper(1);

    expect(store.etapas()).toEqual([1, 2, 4]);
    expect(statesOf(stepper)).toEqual([
      'current',
      'reachable',
      'blocked',
      'reachable',
    ]);
  });

  it('marca como concluída toda etapa já deixada para trás', () => {
    const { stepper, store } = makeStepper(2);
    store.goTo(3);

    expect(statesOf(stepper)).toEqual([
      'done',
      'done',
      'current',
      'blocked',
    ]);
  });

  it('não navega ao clicar num chip bloqueado', () => {
    const { stepper, store } = makeStepper(0);

    stepper.onChip(3);

    expect(store.step()).toBe(1);
  });

  it('navega ao clicar num chip alcançável', () => {
    const { stepper, store } = makeStepper(1);

    stepper.onChip(2);

    expect(store.step()).toBe(2);
  });

  it('volta à etapa 1 quando a última imagem é removida', () => {
    const { stepper, store } = makeStepper(1);
    store.goTo(2);

    // O corretor apagou a única imagem estando na etapa 2. Ficar ali deixaria
    // o rodapé desabilitado e o conserto duas telas atrás.
    store.removeScene('a');

    expect(store.step()).toBe(1);
    expect(statesOf(stepper)).toEqual([
      'current',
      'blocked',
      'blocked',
      'blocked',
    ]);
  });

  it('deixa voltar a uma etapa já concluída', () => {
    const { stepper, store } = makeStepper(2);
    store.goTo(3);

    expect(stepper.stateOf(1)).toBe('done');

    stepper.onChip(1);

    expect(store.step()).toBe(1);
  });

  it('não renderiza o chip de passagens quando há somente um ambiente', () => {
    makeStepper(1);
    const fixture = TestBed.createComponent(WizardStepperComponent);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const steps = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.tw-chip'),
      (chip) => Number(chip.dataset['step']),
    );
    const dots = Array.from(
      element.querySelectorAll<HTMLElement>('.tw-chip__dot'),
      (dot) => dot.textContent?.trim(),
    );
    expect(steps).toEqual([1, 2, 4]);
    expect(dots).toEqual(['1', '2', '3']);
  });

  it('mantem os metadados textuais ocultos em todas as etapas', () => {
    const { store } = makeStepper(1);
    const fixture = TestBed.createComponent(WizardStepperComponent);

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tw-progress__meta')).toBeNull();

    store.step.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tw-progress__meta')).toBeNull();
  });
});
