import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene, WizardStep } from '../../tour-wizard.model';
import { WizardActionsComponent } from './wizard-actions.component';

/**
 * A barra de acao nao tinha spec, e foi exatamente por isso que a renumeracao
 * das etapas passou por ela sem ninguem notar: o rotulo do primario, o "Pular"
 * e o motivo do bloqueio continuaram apontando para os numeros antigos. O
 * corretor via "Publicar tour" numa etapa que so avanca, e um botao apagado
 * sem explicacao nenhuma na etapa seguinte.
 */
describe('WizardActionsComponent', () => {
  function montar(): { barra: WizardActionsComponent; store: TourDraftStore } {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    const fixture = TestBed.createComponent(WizardActionsComponent);
    return { barra: fixture.componentInstance, store: TestBed.inject(TourDraftStore) };
  }

  afterEach(() => TestBed.resetTestingModule());

  function ponto(target: string): WizardHotspot {
    return { id: crypto.randomUUID(), u: 0.5, v: 0.5, label: '', target };
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

  function em(etapa: WizardStep, cenas: WizardScene[]) {
    const { barra, store } = montar();
    store.scenes.set(cenas);
    store.step.set(etapa);
    return { barra, store };
  }

  const LIGADAS = () => [cena('sala', ['cozinha']), cena('cozinha', ['sala'])];

  describe('rotulo do primario', () => {
    // O defeito da foto: a etapa 3 anunciava "Publicar tour" e so avancava.
    it('a etapa de passagens ainda e "proximo"', () => {
      const { barra } = em(3, LIGADAS());
      expect(barra.primaryLabelKey()).toBe('TOUR_WIZARD.COMMON.NEXT');
    });

    it('quem publica e a etapa 4', () => {
      const { barra } = em(4, LIGADAS());
      expect(barra.primaryLabelKey()).toBe('TOUR_WIZARD.COMMON.PUBLISH');
    });
  });

  describe('a ordenacao cobra as conexoes', () => {
    // Sem isto o corretor seguia para a etapa 3 e encontrava so um "volte aos
    // ambientes": o wizard deixava entrar num lugar cuja unica instrucao e sair.
    it('sem conexao nenhuma, o primario trava', () => {
      const { barra } = em(2, [cena('sala'), cena('cozinha')]);

      expect(barra.primaryDisabled()).toBeTrue();
      expect(barra.motivoBloqueio()).toBe('TOUR_WIZARD.STEP_ORDER.NEEDS_LINKS');
    });

    it('com o caminho feito, libera', () => {
      const { barra } = em(2, LIGADAS());

      expect(barra.primaryDisabled()).toBeFalse();
      expect(barra.motivoBloqueio()).toBeNull();
    });

    // Um ambiente nao tem para onde ligar: cobrar aqui seria travar a tela por
    // um defeito que nao existe.
    it('com um ambiente so, nao cobra', () => {
      const { barra } = em(2, [cena('sala')]);
      expect(barra.primaryDisabled()).toBeFalse();
    });

    // Meia conexao tambem nao passa: o terceiro ambiente segue sem caminho.
    it('conectar so uma parte nao basta', () => {
      const { barra } = em(2, [
        cena('sala', ['cozinha']),
        cena('cozinha', ['sala']),
        cena('quarto'),
      ]);

      expect(barra.primaryDisabled()).toBeTrue();
    });
  });

  describe('a etapa de passagens explica o proprio bloqueio', () => {
    // Ja travava, mas em silencio: `motivoBloqueio` ainda perguntava pela etapa
    // 2, entao na 3 devolvia null e o botao ficava apagado sem uma palavra.
    it('conexao escolhida e ponto nao posicionado: diz o que falta', () => {
      const { barra } = em(3, LIGADAS());

      expect(barra.primaryDisabled()).toBeTrue();
      expect(barra.motivoBloqueio()).toBe('TOUR_WIZARD.PASSAGES.NEEDS_LINKS');
    });

    it('com as passagens posicionadas, libera e cala', () => {
      const { barra } = em(3, [
        cena('sala', ['cozinha'], [ponto('cozinha')]),
        cena('cozinha', ['sala'], [ponto('sala')]),
      ]);

      expect(barra.primaryDisabled()).toBeFalse();
      expect(barra.motivoBloqueio()).toBeNull();
    });
  });

  describe('"Pular"', () => {
    it('aparece na etapa de passagens quando ha um ambiente so', () => {
      const { barra } = em(3, [cena('sala')]);
      expect(barra.showSkip()).toBeTrue();
    });

    it('nao aparece na ordenacao', () => {
      const { barra } = em(2, [cena('sala')]);
      expect(barra.showSkip()).toBeFalse();
    });

    it('some assim que ha um segundo ambiente', () => {
      const { barra } = em(3, LIGADAS());
      expect(barra.showSkip()).toBeFalse();
    });
  });
});
