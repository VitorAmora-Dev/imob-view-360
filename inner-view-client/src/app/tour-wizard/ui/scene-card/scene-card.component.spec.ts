import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { SceneCardComponent } from './scene-card.component';

/**
 * O rótulo do card sai de `readyScenes()`, não da posição na lista.
 *
 * Esta distinção só aparece quando existe uma cena recusada ANTES de uma
 * válida — que é o caso que o card errava: mostrava "Capa" no arquivo que nem
 * ia subir, enquanto o resumo e o payload apontavam para outro. Era divergência
 * entre o que a tela dizia e o que o tour publicado fazia, e nenhum teste pegava
 * porque a verificação era a olho, sempre com fotos boas.
 */
describe('SceneCardComponent — capa e numeração', () => {
  let store: TourDraftStore;

  function scene(id: string, over: Partial<WizardScene> = {}): WizardScene {
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

  function monta(alvo: WizardScene, lista: WizardScene[]): ComponentFixture<SceneCardComponent> {
    store.scenes.set(lista.map((s, i) => ({ ...s, order: i })));
    const fixture = TestBed.createComponent(SceneCardComponent);
    fixture.componentRef.setInput('scene', alvo);
    fixture.detectChanges();
    return fixture;
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

  it('dá a capa à primeira cena válida, não à primeira da lista', () => {
    const recusada = scene('ruim', { state: 'rejected', rejectedReason: 'type' });
    const boa = scene('boa');
    const lista = [recusada, boa];

    expect(monta(recusada, lista).componentInstance.isCover()).toBe(false);
    expect(monta(boa, lista).componentInstance.isCover()).toBe(true);
    // O card e o resumo têm que contar a mesma história.
    expect(store.coverScene()?.id).toBe('boa');
  });

  it('numera só os ambientes válidos', () => {
    const lista = [
      scene('a'),
      scene('ruim', { state: 'rejected', rejectedReason: 'size' }),
      scene('c'),
    ];

    // 'c' é o SEGUNDO ambiente do tour, ainda que seja o terceiro card.
    expect(monta(lista[2], lista).componentInstance.roomNumber()).toBe(2);
  });

  it('não dá número a cena recusada — o card mostra o motivo no lugar', () => {
    const recusada = scene('ruim', { state: 'rejected', rejectedReason: 'size' });
    const fixture = monta(recusada, [scene('a'), recusada]);

    expect(fixture.componentInstance.roomNumber()).toBe(0);
    expect(fixture.nativeElement.querySelector('.tw-badge')).toBeNull();
  });

  /**
   * O botão de excluir é ícone puro: se o desenho voltar a ser um glifo de
   * texto, o `aria-label` continua lá e nada quebra — mas o teste morre aqui,
   * que é onde a decisão está escrita.
   */
  it('exclui por lixeira, com nome acessível e sem glifo de texto', () => {
    const alvo = scene('sala');
    const fixture = monta(alvo, [alvo]);

    const botao = fixture.nativeElement.querySelector('.tw-scene__remove');
    // Sem dicionário carregado o pipe devolve a chave; o que importa aqui é que
    // o botão TENHA nome acessível, já que ele não tem texto nenhum.
    expect(botao.getAttribute('aria-label')).toBeTruthy();
    expect(botao.querySelector('app-tw-trash-icon svg')).not.toBeNull();
    expect(botao.textContent.trim()).toBe('');
  });

  it('usa o arquivo no nome acessível da lixeira enquanto o ambiente está sem nome', () => {
    const alvo = scene('sala', { room: '', fileName: 'sala-360.jpg' });
    const fixture = monta(alvo, [alvo]);

    expect(fixture.componentInstance.accessibleName()).toBe('sala-360.jpg');
  });

  it('mostra o tamanho em unidade legível', () => {
    const fixture = monta(
      scene('a', { fileSize: 9_400_000 }),
      [scene('a', { fileSize: 9_400_000 })],
    );

    expect(fixture.componentInstance.sizeLabel()).toBe('9.4 MB');
  });

  /**
   * A miniatura de uma cena retomada (Tarefa 10).
   *
   * `retomarRascunho()` (Tarefa 9) devolve a cena sem foto de propósito — ver
   * o comentário de `imageData` em `tour-wizard.model.ts`. O card é quem
   * primeiro mostra essa cena na tela, então é ele quem tem que pedi-la.
   */
  describe('foto de uma cena retomada', () => {
    /**
     * MINIATURA, e não a foto cheia.
     *
     * O card desenha 196x110. `garantirImagem` baixa a equirretangular
     * inteira — dezenas de MB — e ainda a deixa em `treatedImageUrl`, que é
     * de onde o viewer da etapa 2 tira a textura da esfera. A foto grande é
     * assunto de quem vai mostrá-la grande.
     */
    it('pede a MINIATURA quando a cena chega sem imagem, não a foto cheia', async () => {
      const retomada = scene('retomada', { imageData: '', serverPanoramaId: 'p1' });
      const miniatura = spyOn(store, 'garantirMiniatura').and.resolveTo('blob:x');
      const cheia = spyOn(store, 'garantirImagem').and.resolveTo('blob:grande');

      const fixture = monta(retomada, [retomada]);
      await fixture.whenStable();

      expect(miniatura).toHaveBeenCalledWith('retomada');
      expect(cheia).not.toHaveBeenCalled();
    });

    it('desenha a miniatura assim que ela chega', async () => {
      const retomada = scene('retomada', { imageData: '', serverPanoramaId: 'p1' });
      spyOn(store, 'garantirMiniatura').and.callFake(async (id: string) => {
        store.miniaturas.update((m) => ({ ...m, [id]: 'blob:mini' }));
        return 'blob:mini';
      });

      const fixture = monta(retomada, [retomada]);
      await fixture.whenStable();
      fixture.detectChanges();

      const thumb: HTMLElement = fixture.nativeElement.querySelector('.tw-scene__thumb');
      expect(thumb.style.backgroundImage).toContain('blob:mini');
    });

    it('não desenha background-image enquanto a foto não chega — url(\'\') mostra ícone quebrado', () => {
      const retomada = scene('retomada', { imageData: '', serverPanoramaId: 'p1' });
      // Sem o dublê, o efeito do construtor chamaria a implementação de
      // verdade e cairia na rede de teste sem ninguém para responder.
      spyOn(store, 'garantirMiniatura').and.resolveTo('');

      const fixture = monta(retomada, [retomada]);

      const thumb: HTMLElement = fixture.nativeElement.querySelector('.tw-scene__thumb');
      expect(thumb.style.backgroundImage).toBe('');
    });

    it('não pede nada quando a cena já tem foto', async () => {
      const comFoto = scene('a');
      const garantir = spyOn(store, 'garantirMiniatura');

      const fixture = monta(comFoto, [comFoto]);
      await fixture.whenStable();

      expect(garantir).not.toHaveBeenCalled();
    });
  });
});
