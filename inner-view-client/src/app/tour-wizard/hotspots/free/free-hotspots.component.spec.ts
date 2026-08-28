import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { VirtualTourService } from '../../../services/virtual-tour.service';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { FreeHotspotsComponent } from './free-hotspots.component';

/**
 * O clique no pin (B4).
 *
 * "Clicar num pin com destino NAVEGA e nunca abre editor" é regra dura do DoD
 * da frente, e a razão é de produto: a etapa 2 é o único lugar onde o corretor
 * confere o que o visitante vai viver. Se clicar num ponto abrisse formulário,
 * ele nunca veria o tour funcionando enquanto o monta.
 */
describe('FreeHotspotsComponent — clique no pin', () => {
  let draft: TourDraftStore;
  let fixture: ComponentFixture<FreeHotspotsComponent>;
  let editor: HotspotEditorStore;

  function scene(id: string, hotspots: WizardHotspot[] = []): WizardScene {
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

  function hotspot(id: string, target: string | null): WizardHotspot {
    return { id, u: 0.5, v: 0.5, label: '', target };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        // Na aplicação quem fornece o editor é a ETAPA, para os dois modos
        // dela compartilharem a instância. Aqui a etapa não está montada, então
        // ele entra pelo módulo — mesma instância única, um nível acima.
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        // O editor livre monta o bottom sheet (B8), que é um `IonModal`.
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
  });

  function monta(): void {
    fixture = TestBed.createComponent(FreeHotspotsComponent);
    fixture.detectChanges();
    editor = fixture.debugElement.injector.get(HotspotEditorStore);
  }

  it('navega para o ambiente de destino, sem abrir o editor', () => {
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPinActivated('h1');

    expect(draft.selectedSceneId()).toBe('b');
    expect(editor.sheet()).toBeNull();
  });

  it('fecha o sheet ao navegar — ele mostraria a lista do ambiente anterior', () => {
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    editor.openList();

    fixture.componentInstance.onPinActivated('h1');

    expect(editor.sheet()).toBeNull();
  });

  it('abre o editor quando o ponto não tem destino', () => {
    draft.scenes.set([scene('a', [hotspot('h1', null)]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPinActivated('h1');

    expect(editor.sheet()).toEqual({ mode: 'editor', hotspotId: 'h1' });
    // E não saiu do lugar: não há para onde ir.
    expect(draft.selectedSceneId()).toBe('a');
  });

  it('ignora um id que não existe mais', () => {
    // O ponto pode ter sido excluído entre o toque e o handler.
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPinActivated('fantasma');

    expect(draft.selectedSceneId()).toBe('a');
    expect(editor.sheet()).toBeNull();
  });

  it('mexer num hotspot não troca o array que vai para o viewer', () => {
    // O viewer recarrega a foto inteira quando a referência de `panoramas`
    // muda — ele não distingue "trocou a imagem" de "mexeu num ponto". Como
    // `patchScene` cria cena nova a cada mutação, sem o `equal` do computed
    // isto virava uma decodificação de equirretangular por tecla digitada e
    // por `pointermove` de arraste. Medido no navegador: 5 teclas = 5
    // recargas, um arraste = mais 18.
    //
    // O teste é de IDENTIDADE de propósito. Comparar valores é o que a suíte
    // já fazia, e foi exatamente por isso que ela não viu nada.
    draft.scenes.set([scene('a', [hotspot('h1', null)]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    const antes = fixture.componentInstance.viewerPanoramas();

    editor.update('h1', { label: 'Cozinha' });
    expect(fixture.componentInstance.viewerPanoramas()).toBe(antes);

    editor.startDrag('h1');
    editor.dragTo(0.2, 0.3);
    expect(fixture.componentInstance.viewerPanoramas()).toBe(antes);

    editor.add(0.6, 0.6);
    expect(fixture.componentInstance.viewerPanoramas()).toBe(antes);
  });

  it('trocar de ambiente troca o array, senão a foto não mudaria', () => {
    // O outro lado da moeda: o `equal` não pode segurar a mudança que importa.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    const antes = fixture.componentInstance.viewerPanoramas();
    draft.selectScene('b');

    expect(fixture.componentInstance.viewerPanoramas()).not.toBe(antes);
    expect(fixture.componentInstance.viewerPanoramas()[0].id).toBe('b');
  });

  it('não manda ao viewer os hotspots da cena', () => {
    // Quem desenha os pins é o overlay HTML; deixar a lista cheia faria o
    // viewer desenhar os sprites dele também, e apareceriam dois por ponto.
    draft.scenes.set([scene('a', [hotspot('h1', 'b')]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    expect(fixture.componentInstance.viewerPanoramas()[0].originHotspots).toEqual([]);
  });

  it('liga o arraste à lixeira, sem que um saiba do outro', () => {
    // O overlay não sabe que existe lixeira; a lixeira não sabe que existe
    // arraste. Quem junta as duas pontas é a etapa, e é isso que se prova aqui.
    draft.scenes.set([scene('a', [hotspot('h1', null)]), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    editor.startDrag('h1');
    fixture.detectChanges();

    const alvo: HTMLElement = fixture.nativeElement.querySelector('app-hotspot-trash');
    const r = alvo.getBoundingClientRect();

    fixture.componentInstance.onPinDragMoved({
      u: 0.4,
      v: 0.4,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    });
    expect(editor.pinDrag()?.overTrash).toBeTrue();

    fixture.componentInstance.onPinDragMoved({
      u: 0.4,
      v: 0.1,
      clientX: r.left + r.width / 2,
      clientY: r.top - 200,
    });
    expect(editor.pinDrag()?.overTrash).toBeFalse();
    // E o ponto seguiu o ponteiro nos dois casos.
    expect(editor.hotspots()[0].v).toBe(0.1);
  });

  it('criar um ponto já pergunta para onde ele leva', () => {
    // Antes eram dois cliques: um para criar, outro no pin para nomear. O
    // segundo não decidia nada e nada na tela contava que ele existia — dava
    // para criar cinco pontos e nunca descobrir como nomeá-los.
    //
    // E o que abre é o SELETOR, não o editor: no instante da criação a única
    // coisa obrigatória é o destino.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });

    expect(editor.picker()).toBe(editor.hotspots()[0].id);
    // O sheet NÃO abre: ele cobre metade da tela, e com o toque na metade de
    // baixo da foto cobriria o próprio ponto recém-criado.
    expect(editor.sheet()).toBeNull();
  });

  it('escolher o destino grava e fecha o seletor', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });
    const criado = editor.hotspots()[0].id;

    editor.pickTarget(criado, 'b');

    expect(editor.hotspots()[0].target).toBe('b');
    expect(editor.picker()).toBeNull();
  });

  it('com o seletor aberto, tocar na foto fecha em vez de criar outro ponto', () => {
    // Sem isto não haveria como dispensá-lo tocando fora: o toque criaria um
    // segundo ponto e um segundo seletor, e quem quisesse sair ganharia um
    // ponto órfão a cada tentativa.
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });

    fixture.componentInstance.onPlaced({ positionX: 0.7, positionY: 0.6 });

    expect(editor.hotspots().length).toBe(1);
    expect(editor.picker()).toBeNull();
  });

  it('não pergunta nada quando não há segundo ambiente', () => {
    // O seletor só saberia aparecer vazio, e apareceria a cada clique na foto.
    draft.scenes.set([scene('a')]);
    draft.selectedSceneId.set('a');
    monta();

    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });

    expect(editor.hotspots().length).toBe(1);
    expect(editor.picker()).toBeNull();
    expect(editor.sheet()).toBeNull();
  });

  it('arrastar o ponto fecha o seletor — ele está grudado no pin', () => {
    draft.scenes.set([scene('a'), scene('b')]);
    draft.selectedSceneId.set('a');
    monta();
    fixture.componentInstance.onPlaced({ positionX: 0.3, positionY: 0.4 });
    const criado = editor.hotspots()[0].id;

    editor.startDrag(criado);

    expect(editor.picker()).toBeNull();
  });

  it('não monta o viewer para cena recusada', () => {
    draft.scenes.set([
      { ...scene('a'), state: 'rejected', rejectedReason: 'type' },
    ]);
    draft.selectedSceneId.set('a');
    monta();

    expect(fixture.componentInstance.viewerPanoramas()).toEqual([]);
  });
});

/**
 * O antes e depois da montagem por IA (C3).
 *
 * A etapa 2 é onde o corretor vê o que a IA fez: o cômodo já está na tela,
 * costurado, e a versão tratada chega segundos depois e dissolve por cima. É o
 * único momento do produto em que o trabalho que justifica o preço fica
 * visível — antes disso ele acontecia depois do publicar, atrás de um spinner,
 * e morria numa linha de log.
 */
describe('FreeHotspotsComponent — revelação da imagem tratada', () => {
  let draft: TourDraftStore;
  let fixture: ComponentFixture<FreeHotspotsComponent>;
  let editor: HotspotEditorStore;

  function scene(id: string, over: Partial<WizardScene> = {}): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: `data:image/jpeg;base64,${id}`,
      order: 0,
      hotspots: [],
      state: 'ready',
      ...over,
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        // Na aplicação quem fornece o editor é a ETAPA, para os dois modos
        // dela compartilharem a instância. Aqui a etapa não está montada, então
        // ele entra pelo módulo — mesma instância única, um nível acima.
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
  });

  function monta(): void {
    fixture = TestBed.createComponent(FreeHotspotsComponent);
    fixture.detectChanges();
    editor = fixture.debugElement.injector.get(HotspotEditorStore);
  }

  /**
   * Devolve o contexto WebGL na hora, em vez de esperar o TestBed.
   *
   * Cada caso aqui monta o visualizador de verdade, e ele agora carrega duas
   * esferas — a da foto e a da dissolvência. O navegador mantém ~16 contextos
   * vivos, o mesmo limite que o `ngOnDestroy` do viewer existe para respeitar.
   * Sem destruir explicitamente, estes seis casos somavam-se ao resto da suíte
   * e derrubavam, de vez em quando, quem tentasse criar um contexto depois —
   * apareceu como o spec do owl-loader falhando em uma execução a cada cinco,
   * num arquivo que não tem nada a ver com este.
   */
  afterEach(() => {
    fixture?.destroy();
  });

  /**
   * Deixa o `effect` que baixa a tratada rodar.
   *
   * `setTimeout` e não `whenStable()`: o viewer mantém um `requestAnimationFrame`
   * dentro da zona do Angular, então a zona nunca fica estável e `whenStable()`
   * pendura o teste até o timeout do Jasmine. É o mesmo motivo do `frames()` do
   * spec do overlay.
   */
  async function assenta(): Promise<void> {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();
  }

  it('não oferece comparação para cena que nunca passou pela IA', async () => {
    // Foto vinda de arquivo: não tem fotos originais, logo não tem tratada, e
    // um botão de comparar ali sugeriria que algo deixou de funcionar.
    draft.scenes.set([scene('a', { serverPanoramaId: 'pan-0' })]);
    draft.selectedSceneId.set('a');
    monta();
    await assenta();

    expect(fixture.componentInstance.revealUrl()).toBeNull();
    expect(fixture.componentInstance.temComparacao()).toBe(false);
  });

  it('revela a tratada quando o ambiente à vista fica pronto', async () => {
    draft.scenes.set([scene('a', { treatedImageUrl: 'blob:tratada', serverPanoramaId: 'pan-0' })]);
    draft.selectedSceneId.set('a');
    monta();
    await assenta();

    expect(fixture.componentInstance.revealUrl()).toBe('blob:tratada');
    expect(fixture.componentInstance.temComparacao()).toBe(true);
  });

  /**
   * A trava que impede a troca no meio de um gesto.
   *
   * Trocar a imagem debaixo do dedo de quem está posicionando um ponto é
   * desorientador, e o seletor de destino é medido uma vez na abertura —
   * recarregar por baixo dele o deixa fora do lugar. `pinDrag` é o sinal
   * canônico de arraste, e mora no editor porque a lixeira precisa do mesmo
   * dado.
   */
  it('adia a revelação enquanto um pin está sendo arrastado', async () => {
    draft.scenes.set([scene('a', { treatedImageUrl: 'blob:tratada', serverPanoramaId: 'pan-0' })]);
    draft.selectedSceneId.set('a');
    monta();
    await assenta();

    editor.startDrag('h1');
    await assenta();
    expect(fixture.componentInstance.revealUrl()).toBeNull();

    editor.endDrag();
    await assenta();
    expect(fixture.componentInstance.revealUrl()).toBe('blob:tratada');
  });

  it('adia a revelação enquanto o seletor de destino está aberto', async () => {
    draft.scenes.set([scene('a', { treatedImageUrl: 'blob:tratada', serverPanoramaId: 'pan-0' })]);
    draft.selectedSceneId.set('a');
    monta();
    await assenta();

    editor.picker.set('h1');
    await assenta();
    expect(fixture.componentInstance.revealUrl()).toBeNull();
  });

  /**
   * Voltar à original é outra revelação, não o desfazer da primeira.
   *
   * Terminada a dissolvência, a tratada passa a ser a imagem da esfera
   * principal. Devolver `null` aqui deixaria a tratada na tela com o botão
   * dizendo o contrário.
   */
  it('dissolve de volta para a foto de câmera ao pedir o original', async () => {
    draft.scenes.set([scene('a', { treatedImageUrl: 'blob:tratada', serverPanoramaId: 'pan-0' })]);
    draft.selectedSceneId.set('a');
    monta();
    await assenta();

    fixture.componentInstance.alternarOriginal();
    await assenta();
    expect(fixture.componentInstance.revealUrl()).toBe('data:image/jpeg;base64,a');

    fixture.componentInstance.alternarOriginal();
    await assenta();
    expect(fixture.componentInstance.revealUrl()).toBe('blob:tratada');
  });

  it('não revela nada ao trocar para um ambiente sem tratamento', async () => {
    draft.scenes.set([
      scene('a', { treatedImageUrl: 'blob:tratada', serverPanoramaId: 'pan-0' }),
      scene('b', { serverPanoramaId: 'pan-1' }),
    ]);
    draft.selectedSceneId.set('a');
    monta();
    await assenta();
    expect(fixture.componentInstance.revealUrl()).toBe('blob:tratada');

    draft.selectScene('b');
    await assenta();

    expect(fixture.componentInstance.revealUrl()).toBeNull();
  });
});

/**
 * A foto de uma cena retomada (Tarefa 10).
 *
 * A Tarefa 9 devolve o rascunho retomado sem foto nenhuma, de propósito — ver
 * o comentário de `imageData` em `tour-wizard.model.ts`. Esta etapa é quem
 * primeiro precisa da foto: é ela que abre com a cena selecionada.
 */
describe('FreeHotspotsComponent — foto de uma cena retomada', () => {
  let fixture: ComponentFixture<FreeHotspotsComponent>;

  /**
   * Monta o editor livre com uma única cena retomada — `imageData` vazio e
   * `serverPanoramaId` preenchido, o par que `retomarRascunho()` deixa. Não
   * chama `detectChanges()`: quem chama precisa instalar o `spyOn` em
   * `garantirImagem` ANTES da primeira rodada, senão o efeito chamaria a
   * implementação de verdade e pediria ao `PanoramaImageCache`.
   */
  function montarComCenaRetomada(): {
    fixture: ComponentFixture<FreeHotspotsComponent>;
    store: TourDraftStore;
  } {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        // Na aplicação quem fornece o editor é a ETAPA, para os dois modos
        // compartilharem a instância. Aqui a etapa não está montada.
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    const store = TestBed.inject(TourDraftStore);
    store.scenes.set([
      {
        id: 's1',
        room: 'Sala',
        fileName: 'Sala',
        fileSize: 0,
        imageData: '',
        order: 0,
        hotspots: [],
        state: 'ready',
        serverPanoramaId: 'p1',
      },
    ]);
    store.selectedSceneId.set('s1');
    return { fixture: TestBed.createComponent(FreeHotspotsComponent), store };
  }

  // Mesmo motivo do describe de revelação acima: a cena 'ready' monta o
  // visualizador de verdade, e o navegador só aguenta ~16 contextos WebGL
  // vivos ao mesmo tempo.
  afterEach(() => {
    fixture?.destroy();
  });

  it('pede a foto ao abrir uma cena retomada', async () => {
    // Sem isto, a etapa 2 de um rascunho retomado abre com a esfera branca:
    // `imageUrl` vazio faz o TextureLoader falhar calado e o material fica
    // sem mapa. É o mesmo sintoma corrigido em 036b4ac, por outra causa.
    const montado = montarComCenaRetomada();
    fixture = montado.fixture;
    const garantir = spyOn(montado.store, 'garantirImagem')
      .and.resolveTo('blob:http://localhost/abc');

    fixture.detectChanges();
    // `whenStable()` e não aqui: o viewer mantém um `requestAnimationFrame`
    // dentro da zona do Angular, que nunca fica estável. Mesmo truque de
    // `assenta()`, no describe acima.
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    expect(garantir).toHaveBeenCalledWith(jasmine.any(String), 'treated');
  });

  it('não pede nada quando a cena já tem foto', async () => {
    const montado = montarComCenaRetomada();
    fixture = montado.fixture;
    montado.store.patchScene('s1', (s) => ({
      ...s,
      imageData: 'data:image/jpeg;base64,x',
    }));
    const garantir = spyOn(montado.store, 'garantirImagem');

    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    expect(garantir).not.toHaveBeenCalled();
  });

  it('não estoura quando o download da foto falha', async () => {
    // O effect reroda a cada mutação da cena — uma tecla no nome de um ponto
    // basta. Sem `.catch`, cada rerodada de uma cena sem foto deixava uma
    // promise rejeitada sem dono.
    const montado = montarComCenaRetomada();
    fixture = montado.fixture;
    spyOn(montado.store, 'garantirImagem').and.rejectWith(new Error('rede caiu'));

    expect(() => fixture.detectChanges()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  /**
   * O "ver original" numa cena retomada.
   *
   * `temComparacao` fica verdadeiro assim que a tratada chega, então o botão é
   * OFERECIDO — mas `revealUrl` devolvia `scene.imageData`, que numa cena
   * retomada é a string vazia. O botão aparecia e não fazia nada, e a variante
   * `'original'` de `garantirImagem`, criada na Tarefa 10, não tinha um único
   * chamador em todo o cliente.
   */
  describe('comparar com a original', () => {
    /** Responde os dois downloads como o store de verdade responderia. */
    function dublarDownloads(store: TourDraftStore): jasmine.Spy {
      return spyOn(store, 'garantirImagem').and.callFake(
        async (id: string, variante: 'treated' | 'original') => {
          const url = `blob:${variante}`;
          store.patchScene(id, (s) =>
            variante === 'treated'
              ? { ...s, treatedImageUrl: url }
              : { ...s, imageData: url },
          );
          return url;
        },
      );
    }

    async function assenta(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 30));
      fixture.detectChanges();
    }

    it('baixa a original antes de revelar', async () => {
      const montado = montarComCenaRetomada();
      fixture = montado.fixture;
      const garantir = dublarDownloads(montado.store);

      fixture.detectChanges();
      await assenta();
      expect(fixture.componentInstance.temComparacao()).toBe(true);

      fixture.componentInstance.alternarOriginal();
      await assenta();

      expect(garantir).toHaveBeenCalledWith('s1', 'original');
      expect(fixture.componentInstance.vendoOriginal()).toBe(true);
      expect(fixture.componentInstance.revealUrl()).toBe('blob:original');
    });

    it('não troca de imagem quando a original não vem — o botão não pode mentir', async () => {
      const montado = montarComCenaRetomada();
      fixture = montado.fixture;
      spyOn(montado.store, 'garantirImagem').and.callFake(
        async (id: string, variante: 'treated' | 'original') => {
          if (variante === 'original') throw new Error('rede caiu');
          montado.store.patchScene(id, (s) => ({ ...s, treatedImageUrl: 'blob:treated' }));
          return 'blob:treated';
        },
      );

      fixture.detectChanges();
      await assenta();

      fixture.componentInstance.alternarOriginal();
      await assenta();

      expect(fixture.componentInstance.vendoOriginal()).toBe(false);
      expect(fixture.componentInstance.revealUrl()).toBe('blob:treated');
    });

    it('volta para a tratada sem baixar nada de novo', async () => {
      const montado = montarComCenaRetomada();
      fixture = montado.fixture;
      const garantir = dublarDownloads(montado.store);

      fixture.detectChanges();
      await assenta();
      fixture.componentInstance.alternarOriginal();
      await assenta();
      const antes = garantir.calls.count();

      fixture.componentInstance.alternarOriginal();
      await assenta();

      expect(fixture.componentInstance.vendoOriginal()).toBe(false);
      expect(garantir.calls.count()).toBe(antes);
    });
  });
});
