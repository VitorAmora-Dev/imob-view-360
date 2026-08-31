import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { TourSummaryComponent } from './tour-summary.component';

/**
 * A capa do resumo, na última tela antes de publicar.
 *
 * `coverUrl` lia `scene.imageData` direto, e cena RETOMADA tem esse campo
 * vazio de propósito — a foto chega sob demanda, pelo `PanoramaImageCache`.
 * O retângulo saía hachurado como "sem imagem" justamente onde o corretor
 * confere o que está prestes a mandar para o cliente.
 *
 * Terceiro lugar da mesma família: `scene-card` e `scene-rail` foram
 * corrigidos numa onda anterior e este passou batido.
 */
describe('TourSummaryComponent — a capa de um rascunho retomado', () => {
  let store: TourDraftStore;
  let fixture: ComponentFixture<TourSummaryComponent>;

  function cena(id: string, over: Partial<WizardScene> = {}): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots: [],
      state: 'ready',
      ...over,
    };
  }

  /** Cena como a retomada a entrega: sem foto em memória, com id do servidor. */
  function retomada(id: string, over: Partial<WizardScene> = {}): WizardScene {
    return cena(id, { imageData: '', serverPanoramaId: `p-${id}`, ...over });
  }

  function montar(cenas: WizardScene[]): TourSummaryComponent {
    store.scenes.set(cenas.map((s, i) => ({ ...s, order: i })));
    fixture = TestBed.createComponent(TourSummaryComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
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
    store = TestBed.inject(TourDraftStore);
  });

  it('pede a miniatura da capa quando ela chega sem foto', () => {
    // Ninguém mais pede por ela nesta tela: a etapa 1 pede a dos seus cards e a
    // de passagens a do cômodo à vista — e a capa pode não ser nenhum dos dois.
    const pedir = spyOn(store, 'garantirMiniatura').and.resolveTo('');

    montar([retomada('sala'), retomada('cozinha')]);

    expect(pedir).toHaveBeenCalledWith('sala');
  });

  it('desenha a miniatura assim que ela chega', () => {
    spyOn(store, 'garantirMiniatura').and.resolveTo('');
    const componente = montar([retomada('sala')]);
    expect(componente.coverUrl()).toBeNull();

    store.miniaturas.set({ sala: 'blob:http://localhost/capa' });

    expect(componente.coverUrl()).toBe('blob:http://localhost/capa');
  });

  it('prefere a tratada, que é o que a IA entregou', () => {
    spyOn(store, 'garantirMiniatura').and.resolveTo('');

    const componente = montar([
      retomada('sala', { treatedImageUrl: 'blob:http://localhost/tratada' }),
    ]);

    expect(componente.coverUrl()).toBe('blob:http://localhost/tratada');
  });

  it('não vai à rede quando a capa já tem foto em memória', () => {
    // Captura recém-feita: a dataURL veio do modal e não há o que baixar.
    const pedir = spyOn(store, 'garantirMiniatura');

    const componente = montar([cena('sala')]);

    expect(pedir).not.toHaveBeenCalled();
    expect(componente.coverUrl()).toBe('data:image/jpeg;base64,x');
  });

  /**
   * `null` e não `''`: o template distingue os dois estados — sem capa ele
   * aplica a hachura de "não há nada aqui", e `url('')` desenharia o ícone de
   * imagem quebrada no lugar.
   */
  it('devolve null, e não vazio, quando não há cena nenhuma', () => {
    const componente = montar([]);

    expect(componente.coverUrl()).toBeNull();
  });
});
