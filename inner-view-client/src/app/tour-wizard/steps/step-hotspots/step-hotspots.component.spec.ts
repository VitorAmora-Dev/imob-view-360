import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { StepHotspotsComponent } from './step-hotspots.component';

/**
 * A etapa 2 tem dois modos.
 *
 * O guiado e o padrao porque e o caminho que nao tem como dar errado: um ciclo
 * fechado nunca produz ambiente ilhado, e a etapa 2 bloqueia o "Proximo"
 * enquanto houver um. O livre continua inteiro, para quem tem percurso que nao
 * e um ciclo -- um corredor central com os comodos pendurados nele, por exemplo.
 *
 * Os testes do editor livre em si moram em `free-hotspots.component.spec.ts`,
 * junto do codigo que testam.
 */
describe('StepHotspotsComponent — modos', () => {
  let fixture: ComponentFixture<StepHotspotsComponent>;
  let draft: TourDraftStore;

  function ponto(id: string, target: string | null): WizardHotspot {
    return { id, u: 0.5, v: 0.5, label: '', target };
  }

  function cena(id: string, hotspots: WizardHotspot[] = []): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots,
      state: 'ready',
    };
  }

  function montar(cenas: WizardScene[]) {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    draft.scenes.set(cenas);
    draft.selectedSceneId.set(cenas[0]?.id ?? null);

    fixture = TestBed.createComponent(StepHotspotsComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function linkDeModo(): HTMLButtonElement {
    return el().querySelector('.tw-step2__modo') as HTMLButtonElement;
  }

  it('abre no assistente guiado', () => {
    montar([cena('sala'), cena('cozinha')]);

    expect(el().querySelector('app-guided-hotspots')).not.toBeNull();
    expect(el().querySelector('app-free-hotspots')).toBeNull();
  });

  it('o link troca para o editor livre e de volta', () => {
    montar([cena('sala'), cena('cozinha')]);

    linkDeModo().click();
    fixture.detectChanges();
    expect(el().querySelector('app-free-hotspots')).not.toBeNull();
    expect(el().querySelector('app-guided-hotspots')).toBeNull();

    linkDeModo().click();
    fixture.detectChanges();
    expect(el().querySelector('app-guided-hotspots')).not.toBeNull();
  });

  // Com um ambiente so nao ha percurso a montar, e o assistente nao teria o que
  // pedir. O editor livre continua servindo: e onde se ve a foto.
  it('com um ambiente so, abre no editor livre e nao oferece o link', () => {
    montar([cena('sala')]);

    expect(el().querySelector('app-free-hotspots')).not.toBeNull();
    expect(el().querySelector('app-guided-hotspots')).toBeNull();
    expect(el().querySelector('.tw-step2__modo')).toBeNull();
  });

  // Os avisos de grafo sao o problema que o assistente esta no meio de
  // resolver. Mostra-los durante o roteiro seria apontar o defeito para quem
  // esta seguindo o passo a passo que o conserta.
  it('os avisos de grafo so aparecem no modo livre', () => {
    montar([cena('sala'), cena('cozinha')]);

    expect(el().querySelector('.tw-step2__bloqueio')).toBeNull();

    linkDeModo().click();
    fixture.detectChanges();

    expect(el().querySelector('.tw-step2__bloqueio')).not.toBeNull();
  });

  // O aviso de beco sem saida so fala depois que tudo se alcanca -- e a regra
  // que ja vive em `becosSemSaida`, e o modo livre continua a respeitando.
  it('no modo livre, ciclo fechado nao mostra aviso nenhum', () => {
    montar([
      cena('sala', [ponto('h1', 'cozinha')]),
      cena('cozinha', [ponto('h2', 'sala')]),
    ]);

    linkDeModo().click();
    fixture.detectChanges();

    expect(el().querySelector('.tw-step2__bloqueio')).toBeNull();
    expect(el().querySelector('.tw-step2__aviso')).toBeNull();
  });
});
