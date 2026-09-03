import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { DialogoDoWizard } from '../../ui/wizard-dialog/dialogo-do-wizard.service';
import { StepImagesComponent } from './step-images.component';

describe('StepImagesComponent — escolha e galeria', () => {
  let fixture: ComponentFixture<StepImagesComponent>;
  let component: StepImagesComponent;
  let store: TourDraftStore;
  let modalController: jasmine.SpyObj<ModalController>;
  let dialogo: DialogoDoWizard;

  function scene(id: string, over: Partial<WizardScene> = {}): WizardScene {
    return {
      id,
      room: `Ambiente ${id}`,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,SGk=',
      order: 0,
      hotspots: [],
      state: 'ready',
      ...over,
    };
  }

  function render(): void {
    fixture.detectChanges();
  }

  beforeEach(() => {
    modalController = jasmine.createSpyObj<ModalController>('ModalController', [
      'create',
    ]);

    TestBed.configureTestingModule({
      imports: [StepImagesComponent],
      providers: [
        TourDraftStore,
        DialogoDoWizard,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        { provide: ModalController, useValue: modalController },
      ],
    });

    fixture = TestBed.createComponent(StepImagesComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(TourDraftStore);
    dialogo = TestBed.inject(DialogoDoWizard);
    TestBed.inject(TranslateService).setTranslation(
      'pt',
      {
        TOUR_WIZARD: {
          STEP1: {
            NAME_PROMPT: 'Dê nome a esse ambiente',
            NEEDS_NAMES: 'Dê nome a todos os ambiente antes de continuar',
          },
        },
      },
      true,
    );
    render();
  });

  it('começa somente na decisão de origem, sem galeria nem cards', () => {
    expect(fixture.nativeElement.querySelector('.tw-source')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-scenes')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-scene-card')).toBeNull();
    expect(store.step()).toBe(1);
  });

  it('abre o seletor ao clicar no bloco de decisão', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#tw-files');
    spyOn(input, 'click');

    fixture.nativeElement.querySelector('.tw-drop').click();

    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('cancelar o seletor mantém a decisão e limpa o input', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#tw-files');
    Object.defineProperty(input, 'files', { configurable: true, value: [] });

    input.dispatchEvent(new Event('change'));
    render();

    expect(fixture.nativeElement.querySelector('.tw-source')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-scenes')).toBeNull();
    expect(store.scenes()).toEqual([]);
    expect(input.value).toBe('');
  });

  it('selecionar arquivos troca automaticamente para a galeria e mantém a etapa 1', fakeAsync(() => {
    const file = new File(['foto'], 'sala.jpg', { type: 'image/jpeg' });
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#tw-files');
    const addFiles = spyOn(store, 'addFiles').and.callFake(async (files) => {
      store.scenes.set([scene('sala', { fileName: files[0].name, room: '' })]);
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });

    input.dispatchEvent(new Event('change'));
    render();

    expect(fixture.nativeElement.querySelector('.tw-deck__item.is-arriving')).not.toBeNull();
    tick();

    expect(addFiles).toHaveBeenCalledOnceWith([file]);
    expect(fixture.nativeElement.querySelector('.tw-source')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-scenes')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.tw-deck__card').length).toBe(1);
    expect(fixture.nativeElement.querySelector('app-scene-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-deck__rename')).not.toBeNull();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('#tw-scenes-title'),
    );
    expect(store.step()).toBe(1);
  }));

  it('abre a galeria quando um rascunho chega depois da montagem do componente', () => {
    expect(fixture.nativeElement.querySelector('.tw-source')).not.toBeNull();

    store.scenes.set([scene('retomada', { imageData: '' })]);
    render();

    expect(fixture.nativeElement.querySelector('.tw-source')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-scenes')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-deck__item.is-arriving')).toBeNull();
  });

  it('carrega a miniatura do card ativo ao retomar um rascunho', () => {
    const garantirMiniatura = spyOn(store, 'garantirMiniatura').and.resolveTo();

    store.scenes.set([
      scene('retomada', { imageData: '', serverPanoramaId: 'panorama-1' }),
    ]);
    render();

    expect(garantirMiniatura).toHaveBeenCalledOnceWith('retomada');
  });

  it('sincroniza a etapa seguinte quando o card escolhido termina a leitura', () => {
    const anterior = scene('anterior');
    const nova = scene('nova', { state: 'reading', imageData: '' });
    store.scenes.set([anterior, nova]);
    store.selectedSceneId.set(anterior.id);
    render();

    component.selectScene(nova);
    render();

    expect(component.activeScene()?.id).toBe(nova.id);
    expect(store.selectedSceneId()).toBe(anterior.id);

    store.scenes.update((scenes) =>
      scenes.map((item) =>
        item.id === nova.id ? { ...item, state: 'ready', imageData: 'nova' } : item,
      ),
    );
    render();

    expect(store.selectedSceneId()).toBe(nova.id);
  });

  it('traz um novo upload para a frente mesmo quando a pilha já tem quatro cards', fakeAsync(() => {
    const existentes = Array.from({ length: 4 }, (_, index) =>
      scene(String(index + 1), { order: index }),
    );
    store.scenes.set(existentes);
    store.selectedSceneId.set(existentes[0].id);
    render();

    const file = new File(['foto'], 'nova.jpg', { type: 'image/jpeg' });
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#tw-files');
    spyOn(store, 'addFiles').and.callFake(async () => {
      store.scenes.update((scenes) => [
        ...scenes,
        scene('nova', { state: 'reading', imageData: '', order: scenes.length }),
      ]);
    });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    input.dispatchEvent(new Event('change'));
    render();

    expect(component.activeScene()?.id).toBe('nova');
    expect(
      fixture.nativeElement.querySelector('.tw-deck__item.is-arriving')
        .classList,
    ).not.toContain('is-hidden');

    tick(421);
  }));

  it('confirma uma captura, cria o card e traz o novo ambiente para a frente', async () => {
    const modal = {
      present: jasmine.createSpy('present').and.resolveTo(),
      onDidDismiss: jasmine.createSpy('onDidDismiss').and.resolveTo({
        role: 'confirm',
        data: {
          imageData: 'data:image/jpeg;base64,MTIz',
          frames: [],
          geometry: null,
          room: 'Sala',
          serverPanoramaId: null,
          treatedUrl: '',
        },
      }),
    };
    modalController.create.and.resolveTo(modal as never);
    Object.defineProperty(component, 'cameraAvailable', { value: true });

    await component.openCapture();
    render();

    expect(modal.present).toHaveBeenCalled();
    expect(store.scenes().length).toBe(1);
    expect(store.scenes()[0].room).toBe('Sala');
    expect(component.activeScene()?.id).toBe(store.scenes()[0].id);
    expect(fixture.nativeElement.querySelector('.tw-scenes')).not.toBeNull();
    expect(store.step()).toBe(1);
  });

  it('cancelar a captura não cria card nem sai da decisão', async () => {
    const modal = {
      present: jasmine.createSpy('present').and.resolveTo(),
      onDidDismiss: jasmine
        .createSpy('onDidDismiss')
        .and.resolveTo({ role: 'cancel' }),
    };
    modalController.create.and.resolveTo(modal as never);
    Object.defineProperty(component, 'cameraAvailable', { value: true });

    await component.openCapture();
    render();

    expect(store.scenes()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.tw-source')).not.toBeNull();
  });

  it('sem suporte à captura usa o seletor existente e não abre modal', async () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#tw-files');
    spyOn(input, 'click');
    Object.defineProperty(component, 'cameraAvailable', { value: false });

    await component.openCapture();

    expect(input.click).toHaveBeenCalledTimes(1);
    expect(modalController.create).not.toHaveBeenCalled();
  });

  it('mantém todos os ambientes acessíveis e empilha o ativo com até cinco seguintes', () => {
    const scenes = Array.from({ length: 7 }, (_, index) =>
      scene(String(index + 1), { order: index }),
    );
    store.scenes.set(scenes);
    store.selectedSceneId.set(scenes[0].id);
    render();

    const cards: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.tw-deck__item'),
    );
    const selectors: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.tw-deck__pagination button'),
    );
    expect(cards.filter((card) => !card.classList.contains('is-hidden')).length).toBe(6);
    expect(cards.filter((card) => card.getAttribute('aria-hidden') !== 'true').length).toBe(1);
    expect(
      cards.filter(
        (card) =>
          card.querySelector('.tw-deck__card')?.getAttribute('tabindex') !== '-1',
      ).length,
    ).toBe(1);
    expect(selectors.length).toBe(7);

    selectors[6].click();
    render();

    expect(component.activeScene()?.id).toBe('7');
    expect(store.selectedSceneId()).toBe('7');
    expect(
      fixture.nativeElement.querySelector('.tw-deck__rename strong').textContent,
    ).toContain('Ambiente 7');
  });

  it('numera o deck somente entre ambientes válidos', () => {
    const recusada = scene('recusada', {
      room: '',
      state: 'rejected',
      rejectedReason: 'type',
    });
    const valida = scene('valida', { room: '' });
    store.scenes.set([recusada, valida]);
    store.selectedSceneId.set(valida.id);
    render();

    const selectors: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.tw-deck__pagination button'),
    );
    const items = component.deckItems();

    expect(items.find((item) => item.scene.id === valida.id)?.number).toBe(1);
    expect(items.find((item) => item.scene.id === recusada.id)?.number).toBeNull();
    expect(selectors[0].getAttribute('aria-label')).toContain('recusada.jpg');
  });

  it('continua oferecendo upload e captura na galeria sem remontar a decisão', () => {
    store.scenes.set([scene('sala')]);
    render();

    expect(fixture.nativeElement.querySelector('.tw-source')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-scenes__add')).not.toBeNull();
    const actions: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.tw-scene-action'),
    );
    expect(actions.length).toBe(2);
    expect(actions[0].classList).toContain('tw-scene-action--gallery');
    expect(actions[1].classList).toContain('tw-scene-action--camera');
  });

  it('navega pelas setas e pelo teclado mantendo a selecao sincronizada', () => {
    const scenes = [scene('1'), scene('2'), scene('3')];
    store.scenes.set(scenes);
    store.selectedSceneId.set('1');
    render();

    fixture.nativeElement.querySelectorAll('.tw-deck__arrow')[1].click();
    render();
    expect(component.activeScene()?.id).toBe('2');
    expect(store.selectedSceneId()).toBe('2');

    component.onDeckKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    render();
    expect(component.activeScene()?.id).toBe('1');
  });

  it('troca o ambiente ao arrastar com ponteiro para a esquerda', fakeAsync(() => {
    const scenes = [scene('1'), scene('2'), scene('3')];
    store.scenes.set(scenes);
    store.selectedSceneId.set('1');
    render();

    component.onPointerDown(
      new PointerEvent('pointerdown', {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 220,
      }),
    );
    component.onPointerMove(
      new PointerEvent('pointermove', {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 140,
      }),
    );

    expect(component.dragOffset()).toBe(-80);
    expect(component.deckItems()[0].tilt).toBeLessThan(0);
    expect(component.deckItems()[1].liveScale).toBeGreaterThan(0.975);

    component.onPointerEnd(
      new PointerEvent('pointerup', {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 140,
      }),
    );
    render();

    expect(component.activeScene()?.id).toBe('2');
    expect(store.selectedSceneId()).toBe('2');
    expect(component.dragOffset()).toBe(0);
    tick();
  }));

  it('edita o nome diretamente no card pelo botao de lapis', fakeAsync(() => {
    store.scenes.set([scene('sala', { room: '' })]);
    store.selectedSceneId.set('sala');
    render();

    fixture.nativeElement.querySelector('.tw-deck__rename').click();
    render();
    tick();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '.tw-deck__name-input',
    );
    input.value = 'Sala de estar';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    render();

    expect(store.scenes()[0].room).toBe('Sala de estar');
    expect(fixture.nativeElement.querySelector('.tw-deck__name-input')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.tw-deck__rename strong').textContent,
    ).toContain('Sala de estar');
  }));

  it('na criação só remove a foto depois da confirmação', fakeAsync(() => {
    store.scenes.set([scene('capa'), scene('outra')]);
    store.selectedSceneId.set('capa');
    render();

    expect(fixture.nativeElement.querySelector('.tw-deck__cover')).not.toBeNull();
    fixture.nativeElement.querySelector('.tw-deck__remove').click();

    expect(store.scenes().map((item) => item.id)).toEqual(['capa', 'outra']);
    expect(dialogo.pergunta()?.tituloKey).toBe(
      'TOUR_WIZARD.STEP1.DELETE_PHOTO_TITLE',
    );

    dialogo.escolher('excluir-foto');
    tick();
    render();

    expect(store.scenes().map((item) => item.id)).toEqual(['outra']);
    expect(fixture.nativeElement.querySelector('.tw-scenes__editor')).toBeNull();
  }));

  it('na edição mantém ao cancelar e remove somente ao confirmar', fakeAsync(() => {
    store.modo.set('edicao');
    store.scenes.set([scene('capa')]);
    store.selectedSceneId.set('capa');
    render();

    fixture.nativeElement.querySelector('.tw-deck__remove').click();
    dialogo.escolher('manter-foto');
    tick();
    render();

    expect(store.scenes().map((item) => item.id)).toEqual(['capa']);

    fixture.nativeElement.querySelector('.tw-deck__remove').click();
    dialogo.escolher('excluir-foto');
    tick();
    render();

    expect(store.scenes()).toEqual([]);
  }));

  it('deixa explícito e persistente quando há ambientes sem nome', () => {
    store.scenes.set([scene('sala', { room: '' })]);
    store.selectedSceneId.set('sala');
    render();

    expect(
      fixture.nativeElement.querySelector('.tw-deck__rename strong').textContent,
    ).toContain('Dê nome a esse ambiente');
    expect(
      fixture.nativeElement.querySelector('.tw-scenes__names-required').textContent,
    ).toContain('Dê nome a todos os ambiente antes de continuar');

    store.renameScene('sala', 'Sala');
    render();

    expect(fixture.nativeElement.querySelector('.tw-scenes__names-required')).toBeNull();
  });

  it('troca o titulo visivel por um contador discreto de ambientes', () => {
    store.scenes.set([scene('sala'), scene('cozinha')]);
    store.selectedSceneId.set('sala');
    render();

    const title: HTMLElement = fixture.nativeElement.querySelector('#tw-scenes-title');
    expect(title.classList).toContain('tw-visually-hidden');
    expect(component.environmentCountKey()).toBe(
      'TOUR_WIZARD.STEP1.ENVIRONMENTS_COUNT',
    );
    expect(fixture.nativeElement.querySelector('.tw-scenes__count')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-deck__hint')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.tw-deck').getAttribute('aria-label'),
    ).toBeTruthy();
  });

  it('usa o singular no contador quando existe somente um ambiente', () => {
    store.scenes.set([scene('sala')]);
    render();

    expect(component.environmentCountKey()).toBe(
      'TOUR_WIZARD.STEP1.ENVIRONMENTS_COUNT_ONE',
    );
  });

  it('nao exibe o peso do arquivo no card', () => {
    store.scenes.set([scene('sala', { fileSize: 2_200_000 })]);
    store.selectedSceneId.set('sala');
    render();

    expect(fixture.nativeElement.querySelector('.tw-deck__details span')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('2.2 MB');
  });
});
