import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ModalController } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { StepImagesComponent } from './step-images.component';

describe('StepImagesComponent — escolha e galeria', () => {
  let fixture: ComponentFixture<StepImagesComponent>;
  let component: StepImagesComponent;
  let store: TourDraftStore;
  let modalController: jasmine.SpyObj<ModalController>;

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
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        { provide: ModalController, useValue: modalController },
      ],
    });

    fixture = TestBed.createComponent(StepImagesComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(TourDraftStore);
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
    expect(fixture.nativeElement.querySelector('app-scene-card')).not.toBeNull();
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

  it('mantém todos os ambientes acessíveis pela paginação e só expõe quatro cards sobrepostos', () => {
    const scenes = Array.from({ length: 5 }, (_, index) =>
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
    expect(cards.filter((card) => !card.classList.contains('is-hidden')).length).toBe(4);
    expect(cards.filter((card) => card.getAttribute('aria-hidden') !== 'true').length).toBe(1);
    expect(
      cards.filter(
        (card) =>
          card.querySelector('.tw-deck__card')?.getAttribute('tabindex') !== '-1',
      ).length,
    ).toBe(1);
    expect(selectors.length).toBe(5);

    selectors[4].click();
    render();

    expect(component.activeScene()?.id).toBe('5');
    expect(store.selectedSceneId()).toBe('5');
    expect(
      fixture.nativeElement.querySelector('.tw-deck__card.is-active strong').textContent,
    ).toContain('Ambiente 5');
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
    expect(fixture.nativeElement.querySelector('label[for="tw-files"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tw-scenes__actions button')).not.toBeNull();
  });
});
