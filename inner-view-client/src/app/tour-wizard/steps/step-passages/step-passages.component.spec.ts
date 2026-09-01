import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { PassagensStore } from '../../passagens/passagens.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { StepPassagesComponent } from './step-passages.component';

function ponto(id: string, target: string | null): WizardHotspot {
  return { id, u: 0.5, v: 0.5, label: '', target };
}

function cena(
  id: string,
  connections: string[] = [],
  hotspots: WizardHotspot[] = [],
): WizardScene {
  return {
    id,
    room: id,
    fileName: `${id}.jpg`,
    fileSize: 1024,
    imageData: 'data:image/jpeg;base64,x',
    order: 0,
    hotspots,
    state: 'ready',
    connections,
  };
}

describe('StepPassagesComponent', () => {
  let fixture: ComponentFixture<StepPassagesComponent>;
  let draft: TourDraftStore;
  let passagens: PassagensStore;

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

    fixture = TestBed.createComponent(StepPassagesComponent);
    fixture.detectChanges();
    passagens = fixture.debugElement.injector.get(PassagensStore);
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const botao = () => el().querySelector('.ps__acao') as HTMLButtonElement | null;

  function espiaoDoReset(): jasmine.Spy {
    TestBed.tick();
    const viewer = fixture.debugElement.query(
      By.directive(PanoramicViewerComponent),
    ).componentInstance as PanoramicViewerComponent;
    return spyOn(viewer, 'resetView');
  }

  it('mostra o painel com o destino atual', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);

    expect(el().querySelector('app-passagens-sheet')).not.toBeNull();
    expect(el().textContent).toContain('cozinha');
  });

  it('sem ponto, o primario fica travado', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    expect(botao()?.disabled).toBeTrue();
  });

  it('marcar libera o primario', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.5 });
    fixture.detectChanges();

    expect(botao()?.disabled).toBeFalse();
  });

  it('a lista de pendentes mostra os outros destinos da mesma foto', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    const chips = Array.from(el().querySelectorAll('.ps__chip')).map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toEqual(['quarto']);
  });

  // Todos os pontos ja confirmados do ambiente aparecem: esconde-los faria o
  // corretor empilhar duas portas no mesmo lugar da esfera sem perceber.
  it('mostra os pontos ja confirmados do ambiente', () => {
    montar([
      cena('sala', ['cozinha', 'quarto'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);

    expect(el().querySelectorAll('.tw-pin').length).toBe(1);
  });

  // O defeito que chegou a producao no PR #19, na forma nova.
  it('marcar NAO reseta a camera', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    const reset = espiaoDoReset();

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.5 });
    TestBed.tick();

    expect(reset).not.toHaveBeenCalled();
  });

  // Trocar de destino DENTRO da mesma foto tambem nao pode resetar: a foto e a
  // mesma, e o corretor esta olhando para onde ele girou.
  it('trocar de destino na mesma foto NAO reseta a camera', () => {
    montar([
      cena('sala', ['cozinha', 'quarto']),
      cena('cozinha', ['sala']),
      cena('quarto', ['sala']),
    ]);
    const reset = espiaoDoReset();

    passagens.marcar(0.3, 0.5);
    passagens.confirmar();
    TestBed.tick();

    expect(passagens.atual()?.origem.id).toBe('sala');
    expect(reset).not.toHaveBeenCalled();
  });

  it('trocar de FOTO reseta a camera', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);
    const reset = espiaoDoReset();

    passagens.marcar(0.3, 0.5);
    passagens.confirmar();
    TestBed.tick();

    expect(reset).toHaveBeenCalled();
  });

  it('com a fila acabada, o painel some', () => {
    montar([
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ]);

    expect(el().querySelector('app-passagens-sheet')).toBeNull();
    expect(el().textContent).toContain('TOUR_WIZARD.PASSAGES.DONE');
  });

  // A tela do fim nao e um aviso: e a revisao. O corretor marcou os pontos as
  // cegas, e andar pelo resultado e a unica forma de descobrir que um deles
  // caiu na parede antes de o cliente descobrir.
  describe('a revisao do fim', () => {
    function visor(): PanoramicViewerComponent | null {
      const de = fixture.debugElement.query(By.directive(PanoramicViewerComponent));
      return de ? (de.componentInstance as PanoramicViewerComponent) : null;
    }

    const acabado = () => [
      cena('sala', ['cozinha'], [ponto('h1', 'cozinha')]),
      cena('cozinha', ['sala'], [ponto('h2', 'sala')]),
    ];

    it('mostra o tour inteiro, e nao so a foto do ultimo passo', () => {
      montar(acabado());
      expect(visor()?.panoramas.map((p) => p.id)).toEqual(['sala', 'cozinha']);
    });

    // Sem `originHotspots` o viewer nao desenha esfera nenhuma, e nao ha o
    // que clicar: a revisao viraria uma foto parada.
    it('os pontos viram destinos clicaveis', () => {
      montar(acabado());

      const sala = visor()!.panoramas[0];
      expect(sala.originHotspots.length).toBe(1);
      expect(sala.originHotspots[0].targetId).toBe('cozinha');
      expect(sala.originHotspots[0].positionX).toBe(0.5);
    });

    // Em edicao um toque na foto CRIA ponto. Na revisao isso seria sabotagem.
    it('nao esta em modo de edicao', () => {
      montar(acabado());
      expect(visor()?.editMode).toBeFalse();
    });

    // O `ngOnChanges` do viewer volta ao ambiente inicial a cada mudanca de
    // `panoramas`. Montando antes de todas as fotos chegarem, a que chegasse
    // enquanto o corretor esta no terceiro comodo o jogaria de volta ao
    // primeiro, sem explicacao.
    it('espera as fotos chegarem antes de montar', () => {
      const semFoto = acabado();
      semFoto[1] = { ...semFoto[1], imageData: '' };
      montar(semFoto);

      expect(visor()).toBeNull();
      expect(el().textContent).toContain('TOUR_WIZARD.PASSAGES.DONE');
    });
  });

  it('sem conexao nenhuma, manda voltar e conectar', () => {
    montar([cena('sala'), cena('cozinha')]);
    expect(el().textContent).toContain('TOUR_WIZARD.PASSAGES.EMPTY');
  });

  // Em tela cheia a barra do wizard some, e com ela o "Voltar". Sem este botao
  // o corretor fica preso na etapa sem caminho de volta a ordenacao.
  it('a gaveta oferece voltar para a ordenacao', () => {
    montar([cena('sala', ['cozinha']), cena('cozinha', ['sala'])]);

    const voltar = el().querySelector('.ps__voltar') as HTMLButtonElement;
    const acoes = el().querySelector('.ps__acoes') as HTMLElement;
    expect(voltar).not.toBeNull();
    expect(acoes).not.toBeNull();
    expect(acoes.querySelector('.ps__voltar')).toBe(voltar);
    expect(acoes.querySelector('.ps__acao')).toBe(botao());

    voltar.click();
    expect(draft.step()).toBe(2);
  });
});
