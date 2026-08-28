import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { StepOrderingComponent } from './step-ordering.component';

function cena(id: string, connections: string[] = []): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots: [],
    state: 'ready',
    connections,
  };
}

describe('StepOrderingComponent', () => {
  let fixture: ComponentFixture<StepOrderingComponent>;
  let draft: TourDraftStore;

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

    fixture = TestBed.createComponent(StepOrderingComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const botoesAbrir = () =>
    Array.from(el().querySelectorAll('.rc__abrir')) as HTMLButtonElement[];

  it('mostra um card por ambiente, numerados a partir de 1', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')]);

    const nums = Array.from(el().querySelectorAll('.rc__num')).map((n) =>
      n.textContent?.trim(),
    );
    expect(nums).toEqual(['1', '2', '3']);
  });

  it('o titulo diz quantos ambientes foram capturados', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().textContent).toContain('TOUR_WIZARD.STEP_ORDER.TITLE');
  });

  it('o card recolhido resume as conexoes', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);

    const resumos = Array.from(el().querySelectorAll('.rc__resumo')).map((r) =>
      r.textContent?.trim(),
    );
    expect(resumos[0]).toContain('TOUR_WIZARD.STEP_ORDER.SUMMARY_ONE');
  });

  it('sem conexoes, o resumo diz isso', () => {
    montar([cena('sala'), cena('cozinha')]);

    const resumo = el().querySelector('.rc__resumo')?.textContent?.trim();
    expect(resumo).toContain('TOUR_WIZARD.STEP_ORDER.SUMMARY_NONE');
  });

  it('expandir um card abre o seletor de destinos', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().querySelector('app-connection-picker')).toBeNull();

    botoesAbrir()[0].click();
    fixture.detectChanges();

    expect(el().querySelector('app-connection-picker')).not.toBeNull();
  });

  // O ambiente atual nao pode aparecer como destino de si mesmo.
  it('o seletor nao oferece o proprio ambiente', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')]);
    botoesAbrir()[0].click();
    fixture.detectChanges();

    const nomes = Array.from(el().querySelectorAll('.cp__nome')).map((n) =>
      n.textContent?.trim(),
    );
    expect(nomes).toEqual(['cozinha', 'quarto']);
  });

  // Um card aberto por vez: com dois abertos a lista fica alta demais no
  // celular, e o Ionic desloca vizinhos pela altura do card arrastado.
  it('abrir um card fecha o outro', () => {
    montar([cena('sala'), cena('cozinha')]);

    botoesAbrir()[0].click();
    fixture.detectChanges();
    botoesAbrir()[1].click();
    fixture.detectChanges();

    expect(el().querySelectorAll('app-connection-picker').length).toBe(1);
  });

  it('escolher um destino liga os dois ambientes', () => {
    montar([cena('sala'), cena('cozinha')]);
    botoesAbrir()[0].click();
    fixture.detectChanges();

    (el().querySelector('.cp__opcao') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(draft.scenes()[0].connections).toEqual(['cozinha']);
    expect(draft.scenes()[1].connections).toEqual(['sala']);
  });

  it('tocar de novo no destino ja escolhido desliga', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    botoesAbrir()[0].click();
    fixture.detectChanges();

    (el().querySelector('.cp__opcao') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(draft.scenes()[0].connections).toEqual([]);
    expect(draft.scenes()[1].connections).toEqual([]);
  });

  // O `detail.complete(false)` e o que impede o Ionic de mexer no DOM por
  // baixo do @for; quem muda a ordem e o signal.
  it('reordenar chama moveScene e completa sem deixar o Ionic mexer no DOM', () => {
    montar([cena('sala'), cena('cozinha'), cena('quarto')]);
    const mover = spyOn(draft, 'moveScene').and.callThrough();
    const completar = jasmine.createSpy('complete');

    fixture.componentInstance.aoReordenar({
      detail: { from: 0, to: 2, complete: completar },
    } as unknown as CustomEvent);
    fixture.detectChanges();

    expect(mover).toHaveBeenCalledWith(0, 2);
    expect(completar).toHaveBeenCalledWith(false);
    expect(draft.scenes().map((s) => s.id)).toEqual([
      'cozinha',
      'quarto',
      'sala',
    ]);
  });

  it('comecar a arrastar recolhe o card aberto', () => {
    montar([cena('sala'), cena('cozinha')]);
    botoesAbrir()[0].click();
    fixture.detectChanges();

    fixture.componentInstance.aoComecarArraste();
    fixture.detectChanges();

    expect(el().querySelector('app-connection-picker')).toBeNull();
  });

  // O aviso precisa vir ANTES de posicionar ponto nenhum: descobrir que o
  // Banheiro esta ilhado depois de posicionar oito passagens joga fora tudo.
  it('avisa quando um ambiente fica sem ninguem alcancando', () => {
    montar([
      cena('sala', ['cozinha']),
      cena('cozinha', ['sala']),
      cena('varanda'),
    ]);
    expect(el().textContent).toContain('TOUR_WIZARD.STEP_ORDER.UNREACHABLE');
  });

  it('sem ambiente ilhado, nao avisa', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    expect(el().textContent).not.toContain('TOUR_WIZARD.STEP_ORDER.UNREACHABLE');
  });
});
