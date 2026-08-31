import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { from, of, throwError } from 'rxjs';
import { PropertyService } from '../services/property.service';
import { VirtualTourService } from '../services/virtual-tour.service';
import { PanoramaImageCache } from '../services/panorama-image-cache.service';
import { TourDraftStore } from './tour-draft.store';
import { CaptureFrameUpload } from '../services/virtual-tour.service';
import { TOTAL_ETAPAS, WizardScene } from './tour-wizard.model';

/**
 * Testa o CONTRATO do store, não a implementação.
 *
 * Estas regras são o que a Frente B assume ao construir a etapa 2 e o que a
 * Frente A assume ao construir o rodapé e o stepper. Quebrar uma delas quebra
 * a outra frente silenciosamente — daí valerem um teste já no commit-zero,
 * antes de existir uma linha de UI.
 */
describe('TourDraftStore (contrato)', () => {
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

  // O store injeta PropertyService e VirtualTourService para publicar, então
  // precisa de contexto de injeção. HttpClient entra na versão de teste: nenhum
  // teste aqui chega a fazer requisição, e o testing backend garante isso —
  // uma chamada de rede não anunciada falharia em vez de sair pela placa.
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TourDraftStore, provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function newStore(): TourDraftStore {
    return TestBed.inject(TourDraftStore);
  }

  function storeWith(...scenes: WizardScene[]): TourDraftStore {
    const store = newStore();
    store.scenes.set(scenes.map((s, i) => ({ ...s, order: i })));
    store.selectedSceneId.set(scenes[0]?.id ?? null);
    return store;
  }

  /**
   * Preenche os ids do rascunho à mão, como se `garantirRascunho()` já tivesse
   * criado o imóvel e o tour.
   *
   * Os casos de `salvarRascunho` testam o salvamento em si, não a criação do
   * rascunho — passar por `garantirRascunho()` de verdade obrigaria a mockar
   * `createProperty` e `createTour` em cada um deles.
   */
  function comRascunhoCriado(store: TourDraftStore): void {
    store.rascunhoTourId.set('tour-1');
    store.rascunhoPropertyId.set('imovel-1');
  }

  /**
   * Liga `origem` a `destino`, como o clique do editor de hotspots faz.
   * Devolve o id LOCAL do ponto criado — quem for removê-lo depois (ver
   * `removerHotspot`) precisa dele, e o id do servidor só existe depois de
   * `salvarRascunho()`.
   */
  function ligarHotspot(
    store: TourDraftStore,
    origemId: string,
    destinoId: string,
  ): string {
    const id = `h-${origemId}-${destinoId}`;
    store.patchScene(origemId, (s) => ({
      ...s,
      hotspots: [
        ...s.hotspots,
        { id, u: 0.5, v: 0.5, label: '', target: destinoId },
      ],
    }));
    return id;
  }

  /** Move um ponto, como o arraste no editor de hotspots faz. */
  function moverHotspot(
    store: TourDraftStore,
    sceneId: string,
    pos: { u: number; v: number },
  ): void {
    store.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: s.hotspots.map((h) => ({ ...h, ...pos })),
    }));
  }

  /**
   * Remove um ponto pelo id local, como `HotspotEditorStore.remove()` faz —
   * via `patchScene`, filtrando o ponto para fora da lista da cena.
   */
  function removerHotspot(
    store: TourDraftStore,
    sceneId: string,
    hotspotId: string,
  ): void {
    store.patchScene(sceneId, (s) => ({
      ...s,
      hotspots: s.hotspots.filter((h) => h.id !== hotspotId),
    }));
  }

  describe('a regra bloqueante da etapa 1', () => {
    it('não avança sem nenhuma imagem', () => {
      const store = newStore();
      expect(store.canAdvance()).toBe(false);

      store.next();

      expect(store.step()).toBe(1);
    });

    it('não conta imagem recusada na validação', () => {
      const store = storeWith(
        scene('a', { state: 'rejected', rejectedReason: 'size' }),
      );

      expect(store.canAdvance()).toBe(false);
    });

    it('avança com ao menos uma imagem válida', () => {
      const store = storeWith(scene('a'));

      store.next();

      expect(store.step()).toBe(2);
    });
  });

  describe('alcançabilidade das etapas pelo stepper', () => {
    it('deixa voltar a qualquer etapa já visitada', () => {
      const store = storeWith(scene('a'));
      store.goTo(3);

      expect(store.canReach(1)).toBe(true);
      expect(store.canReach(2)).toBe(true);
    });

    it('bloqueia 2 e 3 enquanto não há imagem', () => {
      const store = newStore();

      expect(store.canReach(2)).toBe(false);
      expect(store.canReach(3)).toBe(false);

      store.goTo(3);

      expect(store.step()).toBe(1);
    });
  });

  describe('remoção de ambiente', () => {
    it('zera o destino dos hotspots que apontavam para ele', () => {
      const store = storeWith(
        scene('a', {
          hotspots: [{ id: 'h1', u: 0.5, v: 0.5, label: 'Porta', target: 'b' }],
        }),
        scene('b'),
      );

      store.removeScene('b');

      expect(store.scenes()[0].hotspots[0].target).toBeNull();
    });

    it('reordena as cenas restantes, para a capa continuar sendo a primeira', () => {
      const store = storeWith(scene('a'), scene('b'), scene('c'));

      store.removeScene('a');

      expect(store.scenes().map((s) => s.order)).toEqual([0, 1]);
      expect(store.coverScene()?.id).toBe('b');
    });

    it('seleciona a primeira restante quando remove a que estava aberta', () => {
      const store = storeWith(scene('a'), scene('b'));
      store.selectScene('a');

      store.removeScene('a');

      expect(store.selectedSceneId()).toBe('b');
    });
  });

  describe('a regra bloqueante da etapa 1', () => {
    // Nomear é cobrado AQUI, junto da foto, porque a foto é a única coisa que
    // diz como chamar o ambiente. Cobrar na etapa 2, olhando uma lista de
    // destinos, seria nomear de memória.

    it('não avança com ambiente sem nome', () => {
      const store = storeWith(scene('a', { room: '' }));

      expect(store.canAdvance()).toBe(false);
      expect(store.ambientesSemNome().map((s) => s.id)).toEqual(['a']);
    });

    it('espaço em branco não conta como nome', () => {
      const store = storeWith(scene('a', { room: '   ' }));

      expect(store.canAdvance()).toBe(false);
    });

    it('avança quando todos têm nome', () => {
      const store = storeWith(scene('a', { room: 'Sala' }), scene('b', { room: 'Cozinha' }));

      expect(store.canAdvance()).toBe(true);
    });

    it('não cobra nome de cena recusada — ela não vira ambiente', () => {
      const store = storeWith(
        scene('a', { room: 'Sala' }),
        scene('b', { room: '', state: 'rejected', rejectedReason: 'type' }),
      );

      expect(store.canAdvance()).toBe(true);
    });

    it('só marca os campos depois de a pessoa tentar avançar', () => {
      // O card nasce sem nome de propósito: vermelho antes da tentativa é
      // repreensão, não ajuda.
      const store = storeWith(scene('a', { room: '' }));
      expect(store.showErrors()).toBe(false);

      store.next();

      expect(store.showErrors()).toBe(true);
      expect(store.step()).toBe(1);
    });

    it('trocar de etapa apaga as marcas de erro', () => {
      // Senão a etapa 3 abriria com campos em vermelho antes de qualquer
      // tentativa — o oposto do que `showErrors` existe para fazer.
      const store = storeWith(scene('a', { room: '' }));
      store.next();
      expect(store.showErrors()).toBe(true);

      store.renameScene('a', 'Sala');
      store.next();

      expect(store.step()).toBe(2);
      expect(store.showErrors()).toBe(false);
    });
  });

  describe('a regra bloqueante da etapa de passagens', () => {
    // A etapa deixou de ser opcional, e o motivo é da tela do VISITANTE: o
    // `embed` é só o viewer, e o viewer não tem lista de ambientes nem menu —
    // clicar num ponto é a única forma de trocar de ambiente. Publicar sem
    // ligação entrega ambientes pagos e invisíveis.
    const ponto = (id: string, target: string | null) => ({
      id,
      u: 0.5,
      v: 0.5,
      label: '',
      target,
    });

    it('com um ambiente só, segue opcional', () => {
      // Não há destino possível: cobrar ligação seria cobrar o impossível.
      const store = storeWith(scene('a'));
      store.goTo(3);

      expect(store.canAdvance()).toBe(true);
      expect(store.etapaPassagensOpcional()).toBe(true);
    });

    it('trava com dois ambientes sem ligação', () => {
      const store = storeWith(scene('a'), scene('b'));
      store.goTo(3);

      expect(store.canAdvance()).toBe(false);
      expect(store.ambientesIlhados().map((s) => s.id)).toEqual(['b']);
    });

    it('libera quando todo ambiente é alcançável', () => {
      const store = storeWith(
        scene('a', { hotspots: [ponto('h1', 'b')] }),
        scene('b'),
      );
      store.goTo(3);

      expect(store.canAdvance()).toBe(true);
    });

    it('um ponto sem destino não conta como ligação', () => {
      // Órfão é descartado na publicação. Se contasse, o wizard liberaria um
      // tour que o servidor recebe quebrado — que é o defeito inteiro.
      const store = storeWith(
        scene('a', { hotspots: [ponto('h1', null)] }),
        scene('b'),
      );
      store.goTo(3);

      expect(store.canAdvance()).toBe(false);
    });

    it('não trava as outras etapas', () => {
      // A regra é da etapa de passagens. Nas outras o mesmo rascunho anda.
      const store = storeWith(scene('a'), scene('b'));

      expect(store.canAdvance()).toBe(true);
    });

    it('remover um ambiente não joga o corretor de volta à etapa 1', () => {
      // `removeScene` devolve à etapa 1 quando some a última imagem. Se essa
      // guarda olhasse `canAdvance`, ilhar um ambiente na etapa de passagens arrastaria o
      // corretor duas telas atrás — para consertar algo que se conserta ali
      // mesmo.
      const store = storeWith(
        scene('a', { hotspots: [ponto('h1', 'b')] }),
        scene('b'),
        scene('c', { hotspots: [ponto('h2', 'a')] }),
      );
      store.goTo(3);

      store.removeScene('a');

      // A etapa NAO mudou: e isso que o teste protege. O numero acompanhou a
      // renumeracao, a assercao continua sendo "ficou onde estava".
      expect(store.step()).toBe(3);
      expect(store.canAdvance()).toBe(false);
    });
  });

  describe('patchScene — a porta da Frente B', () => {
    it('altera só a cena alvo', () => {
      const store = storeWith(scene('a'), scene('b'));

      store.patchScene('a', (s) => ({
        ...s,
        hotspots: [{ id: 'h1', u: 0.1, v: 0.2, label: '', target: null }],
      }));

      expect(store.scenes()[0].hotspots.length).toBe(1);
      expect(store.scenes()[1].hotspots.length).toBe(0);
    });
  });

  describe('derivados que o resumo e o rodapé leem', () => {
    it('soma os hotspots de TODOS os ambientes, não só o selecionado', () => {
      const store = storeWith(
        scene('a', {
          hotspots: [{ id: 'h1', u: 0, v: 0, label: '', target: null }],
        }),
        scene('b', {
          hotspots: [
            { id: 'h2', u: 0, v: 0, label: '', target: null },
            { id: 'h3', u: 0, v: 0, label: '', target: null },
          ],
        }),
      );

      expect(store.totalHotspots()).toBe(3);
    });

    it('vai a 100% no estado publicado, seja qual for a etapa', () => {
      const store = storeWith(scene('a'));
      store.published.set(true);

      expect(store.progressPct()).toBe(100);
    });
  });

  describe('validação de arquivo', () => {
    /**
     * PNG 2x1 real, em base64 — a validação de proporção decodifica a imagem,
     * então um dataURL falso não serve.
     */
    const PNG_2x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP8z4AATEQyAAAJAgHz2AsvpAAAAABJRU5ErkJggg==';
    const PNG_1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

    async function fileFrom(dataUrl: string, name: string, type: string): Promise<File> {
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], name, { type });
    }

    it('recusa o que não é imagem, sem tentar decodificar', async () => {
      const store = newStore();

      await store.addFiles([
        new File(['isto não é uma foto'], 'contrato.pdf', { type: 'application/pdf' }),
      ]);

      expect(store.scenes()[0].state).toBe('rejected');
      expect(store.scenes()[0].rejectedReason).toBe('type');
      expect(store.canAdvance()).toBe(false);
    });

    it('recusa acima de 25 MB', async () => {
      const store = newStore();
      const huge = new File([], 'panorama.jpg', { type: 'image/jpeg' });
      Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 });

      await store.addFiles([huge]);

      expect(store.scenes()[0].rejectedReason).toBe('size');
    });

    it('aceita um equirretangular 2:1 sem ressalva', async () => {
      const store = newStore();

      await store.addFiles([await fileFrom(PNG_2x1, 'sala.png', 'image/png')]);

      expect(store.scenes()[0].state).toBe('ready');
      expect(store.scenes()[0].warning).toBeUndefined();
      // `temImagem` e não `canAdvance`: o assunto aqui é o arquivo ter sido
      // aceito. Avançar da etapa 1 passou a exigir também o nome do ambiente,
      // que é outra regra e tem os próprios testes.
      expect(store.temImagem()).toBe(true);
    });

    it('AVISA sobre proporção fora de 2:1, mas aceita a imagem', async () => {
      const store = newStore();

      await store.addFiles([await fileFrom(PNG_1x1, 'quadrada.png', 'image/png')]);

      // O ponto do teste: segue publicável. Recusar bloquearia foto legítima
      // de câmera que corta alguns pixels — quem decide é o corretor.
      expect(store.scenes()[0].state).toBe('ready');
      expect(store.scenes()[0].warning).toBe('ratio');
      expect(store.temImagem()).toBe(true);
      expect(store.warnedScenes().length).toBe(1);
    });

    it('o ambiente nasce SEM nome, e não com o nome do arquivo', async () => {
      // Vinha "Sala de estar" — o arquivo sem extensão. Parece inofensivo até a
      // pessoa subir IMG_2841.jpg: o campo lê como já preenchido, ninguém mexe,
      // e duas telas adiante o seletor de destino oferece "IMG_2841, IMG_2843,
      // IMG_2847". Campo vazio pede para ser preenchido; campo com lixo, não.
      const store = newStore();

      await store.addFiles([await fileFrom(PNG_2x1, 'IMG_2841.png', 'image/png')]);

      expect(store.scenes()[0].room).toBe('');
      // O arquivo continua guardado: é a reserva do publicar.
      expect(store.scenes()[0].fileName).toBe('IMG_2841.png');
    });
  });

  describe('validação antes de publicar', () => {
    function preenchido(store: TourDraftStore): void {
      store.patchProperty({ name: 'Apartamento Vila Mariana', type: 'APARTMENT', purpose: 'SALE' });
    }

    it('exige nome, tipo e finalidade — a API não aceita sem eles', () => {
      const store = storeWith(scene('a'));

      expect(store.invalidFields()).toEqual(['name', 'type', 'purpose']);

      preenchido(store);

      expect(store.invalidFields()).toEqual([]);
    });

    it('não cobra endereço enquanto ninguém o tocou', () => {
      const store = storeWith(scene('a'));
      preenchido(store);

      expect(store.addressTouched()).toBe(false);
      expect(store.invalidFields()).toEqual([]);
    });

    it('cobra o endereço inteiro depois que um campo é preenchido', () => {
      const store = storeWith(scene('a'));
      preenchido(store);

      // Meio endereço passa na API e some da busca por bairro — que é
      // justamente para o que ele serve.
      store.patchAddress({ street: 'Avenida Paulista' });

      expect(store.invalidFields()).toEqual(['city', 'state']);
    });

    it('só mostra erro depois da primeira tentativa de publicar', async () => {
      const store = storeWith(scene('a'));

      expect(store.hasError('name')).toBe(false);

      await store.publish();

      expect(store.showErrors()).toBe(true);
      expect(store.hasError('name')).toBe(true);
      // Não publicou: continua no wizard.
      expect(store.published()).toBe(false);
    });
  });

  describe('voltar', () => {
    it('não desce abaixo da etapa 1', () => {
      const store = newStore();

      store.back();

      expect(store.step()).toBe(1);
    });
  });

  describe('seleção e cena recusada', () => {
    it('não cai numa cena recusada ao remover a selecionada', () => {
      const store = storeWith(
        scene('ruim', { state: 'rejected', rejectedReason: 'type' }),
        scene('boa'),
      );
      store.selectedSceneId.set('boa');

      store.removeScene('boa');

      // A etapa 2 abre o editor sobre a cena selecionada; uma recusada não tem
      // imagem para abrir.
      expect(store.selectedSceneId()).toBeNull();
    });

    it('a capa é a primeira cena válida, não a primeira da lista', () => {
      const store = storeWith(
        scene('ruim', { state: 'rejected', rejectedReason: 'size' }),
        scene('boa'),
      );

      expect(store.coverScene()?.id).toBe('boa');
    });
  });

  describe('captura guiada', () => {
    it('mede o tamanho em bytes, não em caracteres da dataURL', () => {
      const store = newStore();
      // 9 bytes viram 12 caracteres de base64: usar o comprimento da string
      // inflava o tamanho exibido em ~33%.
      const nove = btoa('123456789');
      expect(nove.length).toBe(12);

      store.addCapturedScene({
        room: 'Sala',
        fileName: 'captura-360-1.jpg',
        imageData: `data:image/jpeg;base64,${nove}`,
      });

      expect(store.scenes()[0].fileSize).toBe(9);
      expect(store.scenes()[0].state).toBe('ready');
    });

    it('cena capturada sem nome é cobrada como qualquer outra', () => {
      // O nome agora vem da tela de preview da captura, e pode vir vazio: lá
      // ele é oportunidade, não cobrança — quem acabou de girar um minuto com o
      // telefone na mão não deve ser parado por um formulário. Quem segura é a
      // etapa 1, igual para foto enviada e foto capturada.
      const store = newStore();

      store.addCapturedScene({
        room: '',
        fileName: 'captura-360-1.jpg',
        imageData: `data:image/jpeg;base64,${btoa('123456789')}`,
      });

      expect(store.canAdvance()).toBe(false);
      expect(store.ambientesSemNome().length).toBe(1);
    });
  });

  describe('tamanho total da publicação', () => {
    it('avisa quando as imagens somam mais do que cabe numa requisição', () => {
      const store = storeWith(
        scene('a', { fileSize: 20 * 1024 * 1024 }),
        scene('b', { fileSize: 20 * 1024 * 1024 }),
      );

      // Duas fotos que passam no teto de 25 MB por arquivo e ainda assim
      // estouram o corpo de 50 MB do servidor depois do base64.
      expect(store.oversized()).toBe(true);
    });

    it('não avisa quando cabe', () => {
      const store = storeWith(scene('a', { fileSize: 8 * 1024 * 1024 }));

      expect(store.oversized()).toBe(false);
    });

    it('ignora cena recusada na conta — ela não sobe', () => {
      const store = storeWith(
        scene('a', { fileSize: 8 * 1024 * 1024 }),
        scene('b', {
          fileSize: 40 * 1024 * 1024,
          state: 'rejected',
          rejectedReason: 'size',
        }),
      );

      expect(store.oversized()).toBe(false);
    });
  });

  /**
   * O que acontece quando publicar dá errado.
   *
   * Nenhum destes existia, e é exatamente por isso que os três defeitos abaixo
   * passaram: o caminho feliz foi conferido contra a API real, o infeliz nunca
   * foi exercitado.
   */
  /**
   * A montagem por IA passou a rodar DURANTE a captura, não depois do publicar.
   *
   * O ganho inteiro depende de duas coisas que só um teste segura: a confirmação
   * da captura não pode esperar a rede, e o disparo tem que vir depois de as
   * fotos originais subirem. Invertida, a ordem faz o servidor dispensar o
   * panorama na hora e ainda prender o id na guarda de idempotência, o que
   * transforma a chamada seguinte num no-op silencioso.
   */
  /**
   * A montagem por IA acontece DENTRO do modal de captura, com o corretor
   * esperando, antes de ele dar nome ao cômodo.
   *
   * O ganho inteiro depende da ordem: o servidor dispensa o panorama que chega
   * com menos de quatro fotos originais e ainda prende o id na guarda de
   * idempotência, o que transforma a chamada seguinte num no-op silencioso.
   */
  describe('tratarCaptura', () => {
    interface Dublês {
      tours: VirtualTourService;
      chamadas: string[];
    }

    function comRede(over: { status?: string } = {}): Dublês {
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const chamadas: string[] = [];

      spyOn(property, 'createProperty').and.callFake(() => {
        chamadas.push('createProperty');
        return of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>;
      });
      spyOn(tours, 'createTour').and.callFake(() => {
        chamadas.push('createTour');
        return of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >;
      });
      spyOn(tours, 'addPanorama').and.callFake(() => {
        chamadas.push('addPanorama');
        return of({ id: 'pan-0' } as unknown) as ReturnType<
          VirtualTourService['addPanorama']
        >;
      });
      spyOn(tours, 'uploadCaptureFrames').and.callFake(async () => {
        chamadas.push('uploadCaptureFrames');
        return { uploaded: 8, total: 8 };
      });
      spyOn(tours, 'montarTour').and.callFake(() => {
        chamadas.push('montarTour');
        return of({ total: 1 } as unknown) as ReturnType<
          VirtualTourService['montarTour']
        >;
      });
      // Entrega o estado terminal na primeira volta do polling.
      spyOn(tours, 'acompanharMontagem').and.callFake(
        async (_id: string, aoAvancar: (a: never) => void) => {
          aoAvancar({
            total: 1, prontos: 1, falhas: 0, dispensados: 0, terminado: true,
            panoramas: [{ id: 'pan-0', status: over.status ?? 'DONE' }],
          } as never);
          return null as never;
        },
      );
      spyOn(tours, 'baixarPreview').and.callFake(() => {
        chamadas.push('baixarPreview');
        return of(new Blob(['tratada'])) as ReturnType<
          VirtualTourService['baixarPreview']
        >;
      });
      return { tours, chamadas };
    }

    const captura = () => ({
      imageData: 'data:image/jpeg;base64,x',
      frames: [{ index: 0 }] as unknown as CaptureFrameUpload[],
      geometry: null,
    });

    beforeEach(() => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:tratada');
    });

    it('sobe as fotos ANTES de pedir a montagem', async () => {
      const store = newStore();
      const { chamadas } = comRede();

      const r = await store.tratarCaptura(captura());

      expect(chamadas).toEqual([
        'createProperty',
        'createTour',
        'addPanorama',
        'uploadCaptureFrames',
        'montarTour',
        'baixarPreview',
      ]);
      expect(r).toEqual({ panoramaId: 'pan-0', treatedUrl: 'blob:tratada' });
    });

    it('cria um rascunho só, para quantos cômodos forem', async () => {
      const store = newStore();
      const { chamadas } = comRede();

      await store.tratarCaptura(captura());
      await store.tratarCaptura(captura());
      await store.tratarCaptura(captura());

      expect(chamadas.filter((c) => c === 'createProperty')).toHaveSize(1);
      expect(chamadas.filter((c) => c === 'createTour')).toHaveSize(1);
      expect(chamadas.filter((c) => c === 'addPanorama')).toHaveSize(3);
    });

    it('não pede montagem quando quase nenhuma foto subiu', async () => {
      const store = newStore();
      const { tours, chamadas } = comRede();
      (tours.uploadCaptureFrames as jasmine.Spy).and.resolveTo({
        uploaded: 2,
        total: 8,
      });

      const r = await store.tratarCaptura(captura());

      // O servidor exige quatro referências; abaixo disso ele dispensaria, e a
      // ida à rede só serviria para receber um SKIPPED.
      expect(chamadas).not.toContain('montarTour');
      // O cômodo existe no servidor, mas sem versão tratada: o modal mostra o
      // costurado e avisa.
      expect(r).toEqual({ panoramaId: 'pan-0', treatedUrl: '' });
    });

    it('devolve o cômodo sem tratamento quando a IA dispensa', async () => {
      const store = newStore();
      comRede({ status: 'SKIPPED' });

      const r = await store.tratarCaptura(captura());

      expect(r?.treatedUrl).toBe('');
    });

    it('devolve null quando a rede falha, sem derrubar a captura', async () => {
      const store = newStore();
      const { tours } = comRede();
      (tours.addPanorama as jasmine.Spy).and.returnValue(
        throwError(() => new Error('rede caiu')),
      );

      // `null` e não exceção: quem chama é o modal, que precisa mostrar o
      // panorama costurado e seguir. Falhar aqui degrada a qualidade do tour,
      // nunca impede a captura.
      await expectAsync(store.tratarCaptura(captura())).toBeResolvedTo(null);
    });

    it('para de esperar assim que ESTE cômodo termina', async () => {
      // O andamento é por tour. Sem olhar a entrada deste id, o laço esperaria
      // os cômodos anteriores terminarem de novo, a cada captura.
      const store = newStore();
      const { tours } = comRede();
      (tours.acompanharMontagem as jasmine.Spy).and.callFake(
        async (_id: string, aoAvancar: (a: never) => void) => {
          aoAvancar({
            total: 2, prontos: 1, falhas: 0, dispensados: 0,
            // O tour NÃO terminou — mas o cômodo desta captura, sim.
            terminado: false,
            panoramas: [
              { id: 'pan-0', status: 'DONE' },
              { id: 'pan-9', status: 'PROCESSING' },
            ],
          } as never);
          return null as never;
        },
      );

      const r = await store.tratarCaptura(captura());
      expect(r?.treatedUrl).toBe('blob:tratada');
    });
  });

  describe('salvarRascunho', () => {
    it('grava nome, ordem e capa sem publicar', async () => {
      const store = storeWith(scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }));
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const patch = spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      // Precisa de dublê mesmo sem ser o alvo do teste: sem ele a chamada real
      // cairia no `provideHttpClientTesting()` e o teste travaria até estourar
      // o tempo, em vez de falhar pela asserção.
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      const publicar = spyOn(tours, 'publicarTour').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['publicarTour']>,
      );

      await store.salvarRascunho();

      expect(patch).toHaveBeenCalledWith('p1', {
        roomName: 'Sala',
        order: 0,
        initialPanorama: true,
        draftConnections: [],
      });
      // O que separa salvar de publicar é exatamente esta linha.
      expect(publicar).not.toHaveBeenCalled();
    });

    /**
     * A conexão escolhida e ainda não posicionada é a ÚNICA parte do wizard
     * que não se deduz do resto — nome, ordem e capa são colunas, e a passagem
     * já posicionada é um `Hotspot`. Sem esta gravação, retomar depois da
     * etapa de ordenação devolvia a fila da etapa de passagens VAZIA, com
     * metade dos cômodos por ligar e nenhum aviso.
     */
    it('grava as conexões escolhidas, traduzidas para ids de panorama', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala', connections: ['s2'] }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Cozinha', connections: ['s1'] }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const patch = spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      await store.salvarRascunho();

      const daSala = patch.calls.all().find((c) => c.args[0] === 'p1');
      expect(daSala?.args[1].draftConnections).toEqual(['p2']);
    });

    /**
     * Lista inteira e sempre, inclusive vazia: desligar o último ambiente
     * precisa chegar ao banco. Omitir o campo faria o servidor manter a
     * conexão que o corretor acabou de desfazer.
     */
    it('manda lista vazia quando o corretor desligou tudo', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala', connections: [] }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const patch = spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      await store.salvarRascunho();

      expect(patch.calls.mostRecent().args[1].draftConnections).toEqual([]);
    });

    /**
     * O salvamento de rascunho roda por caminhos que NÃO passam por
     * `canAdvance` — o `visibilitychange` dispara com o app indo para segundo
     * plano, a qualquer momento. Gravar `fileName` como `roomName` fazia
     * "captura-360-1.jpg" voltar como nome de verdade na retomada:
     * `ambientesSemNome` ficava vazio e o portão da etapa 1 parava de proteger
     * justamente quem mais precisava dele.
     */
    it('não grava o nome do arquivo como nome do cômodo', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: '', fileName: 'captura-360-1.jpg' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const patch = spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      await store.salvarRascunho();

      expect(patch).toHaveBeenCalledWith('p1', {
        order: 0,
        initialPanorama: true,
        draftConnections: [],
      });
    });

    it('também não manda o nome do arquivo no cômodo que sobe agora', async () => {
      const store = storeWith(scene('s1', { room: '', fileName: 'captura-360-1.jpg' }));
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const subir = spyOn(tours, 'addPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['addPanorama']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      await store.salvarRascunho();

      expect(subir.calls.mostRecent().args[1].roomName).toBe('Ambiente 1');
    });

    it('grava o nome digitado, quando existe um', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: '  Cozinha  ', fileName: 'x.jpg' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const patch = spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      await store.salvarRascunho();

      expect(patch.calls.mostRecent().args[1]).toEqual(
        jasmine.objectContaining({ roomName: 'Cozinha' }),
      );
    });

    /**
     * O laço de hotspots itera o SNAPSHOT `cenasFinais`, e o corretor continua
     * editando durante os `await`. Um ponto sem `serverId` apagado nesse
     * meio-tempo ainda chegava ao `createHotspot`; o `patchScene` seguinte não
     * encontrava onde gravar o id, e a captura de diff do `patchScene` não via
     * `serverId` nenhum sumir (nunca houve um). O hotspot ficava no servidor
     * para sempre e reaparecia na próxima retomada.
     */
    it('apaga o hotspot criado para um ponto que sumiu durante a gravação', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      const idLocal = ligarHotspot(store, 's1', 's2');
      const tours = TestBed.inject(VirtualTourService);
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      // O corretor apaga o ponto EXATAMENTE enquanto o POST está em voo.
      spyOn(tours, 'createHotspot').and.callFake(() => {
        removerHotspot(store, 's1', idLocal);
        return of({ id: 'h-orfao' } as unknown) as ReturnType<
          VirtualTourService['createHotspot']
        >;
      });
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );

      await store.salvarRascunho();

      expect(apagar).toHaveBeenCalledWith('h-orfao');
    });

    it('não apaga o hotspot criado para um ponto que continua na tela', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      ligarHotspot(store, 's1', 's2');
      const tours = TestBed.inject(VirtualTourService);
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      spyOn(tours, 'createHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );

      await store.salvarRascunho();

      expect(apagar).not.toHaveBeenCalled();
      expect(store.scenes()[0].hotspots[0].serverId).toBe('h-srv');
    });

    it('não chama o PATCH do imóvel quando a etapa 3 está em branco', async () => {
      // `PATCH /properties/:id` tem `.refine()` recusando corpo vazio, para
      // que um PATCH sem campo nenhum não passe por sucesso. Salvar um
      // rascunho recém-começado não tem o que mandar — e engolir o 400
      // esconderia falha de rede real no mesmo silêncio.
      const store = storeWith(scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }));
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const update = spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      // property() continua em EMPTY_PROPERTY.

      await store.salvarRascunho();

      expect(update).not.toHaveBeenCalled();
    });

    it('chama o PATCH do imóvel assim que houver um campo preenchido', async () => {
      const store = storeWith(scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }));
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const update = spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      store.property.update((p) => ({ ...p, name: 'Casa na praia' }));

      await store.salvarRascunho();

      expect(update).toHaveBeenCalled();
      expect(update.calls.mostRecent().args[1]).toEqual(
        jasmine.objectContaining({ title: 'Casa na praia' }),
      );
    });

    /**
     * `publish()` passou a chamar `salvarRascunho()` por dentro. Este caso
     * prova que a composição dos dois não inventou um caminho novo: chamar
     * `salvarRascunho()` e depois `publish()` sincroniza os hotspots duas
     * vezes — uma em cada chamada —, e a segunda encontra o ponto já com
     * `serverId` (gravado pela primeira) e só o atualiza. O servidor nunca
     * chega a ter mais de um hotspot ativo para a mesma ligação — antes essa
     * garantia vinha de apagar tudo e recriar; agora vem de nunca criar em
     * dobro.
     */
    it('publicar depois de salvar não deixa hotspot duplicado no servidor', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      ligarHotspot(store, 's1', 's2');
      store.patchProperty({
        name: 'Apartamento Vila Mariana',
        type: 'APARTMENT',
        purpose: 'SALE',
      });
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      const criar = spyOn(tours, 'createHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      const mover = spyOn(tours, 'atualizarHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['atualizarHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      spyOn(tours, 'publicarTour').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['publicarTour']>,
      );

      await store.salvarRascunho();
      expect(criar).toHaveBeenCalledTimes(1);

      await store.publish();

      // A segunda sincronização reconhece o `serverId` já gravado e faz um
      // PATCH; não cria de novo, e por isso não precisa apagar nada.
      expect(mover).toHaveBeenCalledTimes(1);
      expect(criar).toHaveBeenCalledTimes(1);
      expect(apagar).not.toHaveBeenCalled();
      expect(store.published()).toBe(true);
    });

    it('mover um ponto vira PATCH, não apagar e recriar', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const criar = spyOn(tours, 'createHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      const mover = spyOn(tours, 'atualizarHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['atualizarHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      ligarHotspot(store, 's1', 's2');

      await store.salvarRascunho();
      expect(criar).toHaveBeenCalledTimes(1);

      moverHotspot(store, 's1', { u: 0.8, v: 0.4 });
      await store.salvarRascunho();

      expect(mover).toHaveBeenCalledTimes(1);
      expect(criar).toHaveBeenCalledTimes(1);
      expect(apagar).not.toHaveBeenCalled();
    });

    it('remover um ponto apaga só ele', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      spyOn(tours, 'createHotspot').and.returnValues(
        of({ id: 'h-a' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
        of({ id: 'h-b' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      // O ponto de s2 para s1 sobrevive à remoção e já tem `serverId` na
      // segunda chamada — sem este dublê, o PATCH dele cairia na rede de
      // teste de verdade e travaria até estourar o tempo.
      spyOn(tours, 'atualizarHotspot').and.returnValue(
        of({ id: 'h-b' } as unknown) as ReturnType<VirtualTourService['atualizarHotspot']>,
      );
      const a = ligarHotspot(store, 's1', 's2');
      ligarHotspot(store, 's2', 's1');

      await store.salvarRascunho();
      removerHotspot(store, 's1', a);
      await store.salvarRascunho();

      expect(apagar).toHaveBeenCalledTimes(1);
      expect(apagar).toHaveBeenCalledWith('h-a');
    });

    it('guarda o id do servidor em cada ponto, e não numa lista solta', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      spyOn(tours, 'createHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      ligarHotspot(store, 's1', 's2');

      await store.salvarRascunho();

      const ponto = store.scenes().find((s) => s.id === 's1')!.hotspots[0];
      expect(ponto.serverId).toBe('h-srv');
    });

    /**
     * A cena de origem some inteira — junto com o array de hotspots que
     * nasceram nela. O laço de exclusão de `salvarRascunho` só percorre
     * `scenes()`; sem `removeScene` empilhar o `serverId` órfão em
     * `hotspotsParaApagar`, este ponto nunca mais seria alcançado.
     */
    it('remover a cena de origem apaga os hotspots que nasceram nela', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      spyOn(tours, 'createHotspot').and.returnValue(
        of({ id: 'h-srv' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(tours, 'deletePanorama').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deletePanorama']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      ligarHotspot(store, 's1', 's2');
      await store.salvarRascunho();

      store.removeScene('s1');
      await store.salvarRascunho();

      expect(apagar).toHaveBeenCalledWith('h-srv');
    });

    /**
     * Achado da revisão da Tarefa 7: o corretor apaga o ambiente de
     * destino — `removeScene` zera o `target` do ponto de origem, mas o
     * ponto CONTINUA na tela com o `serverId` antigo. Sem limpar esse
     * campo, o ponto reconectado num salvamento seguinte chegaria com um id
     * que o servidor já esqueceu, e o PATCH em cima dele falharia para
     * sempre — o rascunho ficava impossível de salvar ou publicar.
     */
    it('ponto que perde o destino é apagado, tem o serverId limpo, e pode ser reconectado', async () => {
      const store = storeWith(
        scene('s1', { serverPanoramaId: 'p1', room: 'Sala' }),
        scene('s2', { serverPanoramaId: 'p2', room: 'Quarto' }),
        scene('s3', { serverPanoramaId: 'p3', room: 'Varanda' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const criar = spyOn(tours, 'createHotspot').and.returnValues(
        of({ id: 'h-x' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
        of({ id: 'h-y' } as unknown) as ReturnType<VirtualTourService['createHotspot']>,
      );
      const mover = spyOn(tours, 'atualizarHotspot').and.returnValue(
        of({ id: 'h-y' } as unknown) as ReturnType<VirtualTourService['atualizarHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(tours, 'deletePanorama').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deletePanorama']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      ligarHotspot(store, 's1', 's2');

      await store.salvarRascunho();
      expect(criar).toHaveBeenCalledTimes(1);

      // 1. O ambiente de destino some. `removeScene` zera o `target`, mas o
      // ponto continua em `s1` com o `serverId` de antes.
      store.removeScene('s2');
      await store.salvarRascunho();

      expect(apagar).toHaveBeenCalledWith('h-x');
      expect(apagar).toHaveBeenCalledTimes(1);
      const semDestino = store.scenes().find((s) => s.id === 's1')!.hotspots[0];
      expect(semDestino.serverId).toBeUndefined();

      // 2. Reconectado a outro ambiente: sem `serverId`, vira criação — não
      // um PATCH sobre um id que o servidor já esqueceu.
      store.patchScene('s1', (s) => ({
        ...s,
        hotspots: s.hotspots.map((h) => ({ ...h, target: 's3' })),
      }));
      await store.salvarRascunho();

      expect(criar).toHaveBeenCalledTimes(2);
      expect(mover).not.toHaveBeenCalled();

      // 3. Uma gravação a mais, sem nada de novo: a pilha de exclusão já foi
      // drenada na chamada anterior, e não reenvia o que já apagou.
      await store.salvarRascunho();

      expect(apagar).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Achado da revisão da Tarefa 12: `salvarRascunho()` não tinha trava de
   * reentrância — só o botão "Publicar" chamava este método, e o próprio
   * `publishing()` já impedia um segundo clique. A Tarefa 12 passou a chamá-lo
   * sozinho, sem gesto nenhum do corretor: a cada troca de etapa e quando o
   * app vai para segundo plano. Isso abre uma janela que não existia antes —
   * trocar de etapa e minimizar o app quase ao mesmo tempo dispara as duas
   * chamadas antes da primeira terminar, e cada uma lê `rascunhoTourId()` e
   * `serverPanoramaId` no mesmo estado "antes", criando imóvel, tour ou
   * panorama em dobro.
   *
   * Segunda rodada de revisão: a primeira versão da trava devolvia a MESMA
   * promise da gravação em voo para quem chamasse durante ela — o que é
   * regressão, não conserto. Aquela gravação já tinha fotografado
   * `readyScenes()`/`property()` ANTES da chamada nova, então o segundo
   * chamador saía informado "salvei" sem a edição que motivou a própria
   * chamada. O teste "borda de saída" abaixo é o que essa segunda rodada
   * pegou.
   */
  describe('salvarRascunho — reentrância', () => {
    function comRede() {
      const property = TestBed.inject(PropertyService);
      const tours = TestBed.inject(VirtualTourService);
      const createProperty = spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      const createTour = spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      const addPanorama = spyOn(tours, 'addPanorama').and.returnValue(
        of({ id: 'pan-0' } as unknown) as ReturnType<VirtualTourService['addPanorama']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      return { createProperty, createTour, addPanorama };
    }

    it('duas chamadas concorrentes não duplicam imóvel, tour nem panorama', async () => {
      const store = storeWith(scene('a', { room: 'Sala' }));
      const { createProperty, createTour, addPanorama } = comRede();

      // O cenário do achado: nenhuma das duas espera a outra terminar. A
      // segunda chamada encadeia uma rodada seguinte (ver describe acima),
      // mas essa rodada é um no-op de rede: os ids e o `serverPanoramaId` já
      // existem quando ela roda, então nada é recriado.
      await Promise.all([store.salvarRascunho(), store.salvarRascunho()]);

      expect(createProperty).toHaveBeenCalledTimes(1);
      expect(createTour).toHaveBeenCalledTimes(1);
      expect(addPanorama).toHaveBeenCalledTimes(1);
    });

    /**
     * A regressão que a revisão pegou: uma edição feita DURANTE a gravação em
     * voo tem que entrar numa passada seguinte, e não ser perdida porque
     * chegou tarde demais para a que já estava rodando.
     *
     * O truque do teste é travar o PATCH do panorama (que só roda depois de
     * `cenasFinais = this.readyScenes()` já ter sido lido) para garantir que
     * a rodada 1 já fotografou o nome antigo antes de renomear — exatamente
     * o ponto em que a implementação antiga informava "salvei" sem ter
     * salvo.
     */
    it('uma edição feita durante o voo entra numa segunda passada, não é perdida', async () => {
      const store = storeWith(scene('a', { serverPanoramaId: 'p1', room: 'Sala' }));
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      let liberar!: () => void;
      const presa = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      const atualizarPanorama = spyOn(tours, 'atualizarPanorama').and.callFake(
        () =>
          from(presa.then(() => ({ id: 'p1' }))) as ReturnType<
            VirtualTourService['atualizarPanorama']
          >,
      );

      const primeira = store.salvarRascunho();
      // Deixa a rodada 1 avançar até travar no PATCH do panorama — ela já
      // leu `cenasFinais` com o nome "Sala" neste ponto. `setTimeout` drena
      // toda a fila de microtasks pendente antes de rodar, o que garante que
      // a rodada 1 chegou o mais longe que consegue sem a nossa liberação.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A edição que chega tarde demais para a rodada 1.
      store.renameScene('a', 'Quarto');
      const segunda = store.salvarRascunho();

      liberar();
      await Promise.all([primeira, segunda]);

      expect(atualizarPanorama).toHaveBeenCalledTimes(2);
      expect(atualizarPanorama.calls.argsFor(0)[1]).toEqual(
        jasmine.objectContaining({ roomName: 'Sala' }),
      );
      // A garantia da borda de saída: a ÚLTIMA passada lê o nome atualizado.
      expect(atualizarPanorama.calls.mostRecent().args[1]).toEqual(
        jasmine.objectContaining({ roomName: 'Quarto' }),
      );
    });

    /**
     * O descarte tem que matar a rodada JÁ ENFILEIRADA.
     *
     * Sequência do achado: uma troca de etapa dispara a rodada A; uma segunda
     * troca (ou o `visibilitychange`) enfileira a B; o corretor toca em voltar
     * e escolhe "Descartar", que apaga o `Property` e chama `reset()`, zerando
     * `rascunhoTourId`/`rascunhoPropertyId`; a rodada A settla, o `finally`
     * dispara a B, ela chama `garantirRascunho()`, vê os ids nulos e CRIA um
     * `Property` "Captura em andamento" + `VirtualTour` DRAFT novos — que
     * reaparecem na faixa da home. É o mesmo desfecho que a trava de
     * reentrância da página existe para impedir, por outra porta.
     */
    it('descartar cancela a gravação enfileirada, em vez de recriar o imóvel', async () => {
      const store = storeWith(scene('a', { serverPanoramaId: 'p1', room: 'Sala' }));
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      const property = TestBed.inject(PropertyService);
      const criarImovel = spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-2' }) as ReturnType<PropertyService['createProperty']>,
      );
      const criarTour = spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-2', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      spyOn(property, 'deleteProperty').and.returnValue(
        of(undefined) as ReturnType<PropertyService['deleteProperty']>,
      );

      // Trava a rodada A no PATCH do panorama, como no caso da borda de saída
      // acima: é o ponto em que ela já leu as cenas e ainda não terminou.
      let liberar!: () => void;
      const presa = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      spyOn(tours, 'atualizarPanorama').and.callFake(
        () =>
          from(presa.then(() => ({ id: 'p1' }))) as ReturnType<
            VirtualTourService['atualizarPanorama']
          >,
      );

      const primeira = store.salvarRascunho();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const segunda = store.salvarRascunho();

      await store.descartarRascunho();

      liberar();
      await Promise.all([primeira, segunda]);

      expect(criarImovel).not.toHaveBeenCalled();
      expect(criarTour).not.toHaveBeenCalled();
      expect(store.rascunhoTourId()).toBeNull();
      expect(store.rascunhoPropertyId()).toBeNull();
    });

    it('depois de um descarte, uma captura NOVA volta a criar rascunho', async () => {
      // A geração invalida o que foi pedido ANTES do descarte, e só isso: quem
      // recomeça depois precisa de imóvel e tour novos.
      const store = storeWith(scene('a', { serverPanoramaId: 'p1', room: 'Sala' }));
      comRascunhoCriado(store);
      const property = TestBed.inject(PropertyService);
      const tours = TestBed.inject(VirtualTourService);
      spyOn(property, 'deleteProperty').and.returnValue(
        of(undefined) as ReturnType<PropertyService['deleteProperty']>,
      );
      const criarImovel = spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-2' }) as ReturnType<PropertyService['createProperty']>,
      );
      spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-2', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      spyOn(tours, 'addPanorama').and.returnValue(
        of({ id: 'pan-0' } as unknown) as ReturnType<VirtualTourService['addPanorama']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'pan-0' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );

      await store.descartarRascunho();
      store.scenes.set([scene('nova', { room: 'Sala' })]);
      await store.salvarRascunho();

      expect(criarImovel).toHaveBeenCalledTimes(1);
    });

    it('depois de terminar (com sucesso ou não), a próxima chamada tenta de novo', async () => {
      // A trava é só para o que está EM VOO — sem isto, uma falha deixaria
      // `salvarRascunho()` preso numa promise rejeitada para sempre, e nem
      // publicar nem sair do wizard conseguiriam mais salvar nada.
      const store = storeWith(scene('a', { room: 'Sala' }));
      const property = TestBed.inject(PropertyService);
      const createProperty = spyOn(property, 'createProperty').and.returnValues(
        throwError(() => new Error('rede caiu')),
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      const tours = TestBed.inject(VirtualTourService);
      spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      spyOn(tours, 'addPanorama').and.returnValue(
        of({ id: 'pan-0' } as unknown) as ReturnType<VirtualTourService['addPanorama']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );

      await expectAsync(store.salvarRascunho()).toBeRejected();
      await store.salvarRascunho();

      expect(createProperty).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * A Tarefa 12 passou a chamar `salvarRascunho()` também ao trocar de etapa
   * — é o "bloco de trabalho" de cada tela (nomes, hotspots, dados do imóvel)
   * sendo fechado no ponto em que há mais a perder. `irPara()` é o funil dos
   * três caminhos que trocam de etapa: `next()`, `back()` e os chips do
   * stepper via `goTo()`. Achado da revisão: a primeira versão só cobria
   * `next()` — os outros dois terços das transições ficavam sem gravar.
   */
  describe('salva ao trocar de etapa (irPara — funil de next/back/goTo)', () => {
    it('salva ao avançar com next()', () => {
      const store = storeWith(scene('a', { room: 'Sala' }));
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.next();

      expect(salvar).toHaveBeenCalled();
      expect(store.step()).toBe(2);
    });

    it('não salva quando o avanço é bloqueado', () => {
      // Nada mudou desde o último salvamento — não há bloco de trabalho novo
      // para fechar.
      const store = storeWith(scene('a', { room: '' }));
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.next();

      expect(salvar).not.toHaveBeenCalled();
      expect(store.step()).toBe(1);
    });

    // A ULTIMA etapa, que virou a 4 quando a ordenacao entrou entre a 1 e a 2.
    // O comportamento nao mudou: no fim, quem salva e o publish().
    it('na ultima etapa, quem salva é o publish() — next() não dispara uma segunda gravação', () => {
      const store = storeWith(scene('a', { room: 'Sala' }));
      store.goTo(4);
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();
      const publicar = spyOn(store, 'publish').and.resolveTo();

      store.next();

      expect(publicar).toHaveBeenCalled();
      expect(salvar).not.toHaveBeenCalled();
    });

    it('salva ao voltar com back()', () => {
      const store = storeWith(scene('a', { room: 'Sala' }));
      store.goTo(2);
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.back();

      expect(salvar).toHaveBeenCalled();
      expect(store.step()).toBe(1);
    });

    it('não salva quando back() não sai da etapa 1', () => {
      const store = storeWith(scene('a', { room: 'Sala' }));
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.back();

      expect(salvar).not.toHaveBeenCalled();
    });

    it('salva ao pular direto pelo chip do stepper com goTo()', () => {
      const store = storeWith(scene('a', { room: 'Sala' }));
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.goTo(2);

      expect(salvar).toHaveBeenCalled();
      expect(store.step()).toBe(2);
    });

    it('não salva quando goTo() é bloqueado por etapa inalcançável', () => {
      const store = newStore();
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.goTo(3);

      expect(salvar).not.toHaveBeenCalled();
      expect(store.step()).toBe(1);
    });

    /**
     * O chip da etapa ATUAL, sem nenhum cômodo, criava rascunho fantasma.
     *
     * `canReach(1)` é `1 <= 1` — trivialmente verdadeiro —, então tocar no
     * chip onde já se está chegava em `irPara()`, que salvava sem checar se
     * havia o que salvar. `salvarRascunhoAgora()` começa por
     * `garantirRascunho()`, que CRIA `Property` + `VirtualTour`: cada toque
     * perdido virava um cartão "Nenhum ambiente ainda" na home, que só some
     * em 30 dias. As outras duas portas de auto-save já tinham esta guarda.
     */
    it('não salva ao tocar no chip da etapa atual sem nenhum cômodo', () => {
      const store = newStore();
      const salvar = spyOn(store, 'salvarRascunho').and.resolveTo();

      store.goTo(1);

      expect(salvar).not.toHaveBeenCalled();
    });
  });

  describe('falha ao publicar', () => {
    /** Deixa o formulário válido para o publicar chegar até a rede. */
    function pronto(store: TourDraftStore): void {
      store.patchProperty({
        name: 'Apartamento Vila Mariana',
        type: 'APARTMENT',
        purpose: 'SALE',
      });
    }

    it('registra o erro sem marcar como publicado', async () => {
      const store = storeWith(scene('a'));
      pronto(store);
      const property = TestBed.inject(PropertyService);
      spyOn(property, 'createProperty').and.returnValue(
        throwError(() => new Error('rede caiu')),
      );

      await store.publish();

      // As duas coisas juntas: sem `published`, a tela de sucesso não monta —
      // então o erro TEM que estar num lugar que apareça sem ela.
      expect(store.published()).toBe(false);
      expect(store.publishError()).toBe('TOUR_WIZARD.SUCCESS.PUBLISH_ERROR');
      // E o botão volta a ficar clicável, senão o corretor fica preso.
      expect(store.publishing()).toBe(false);
    });

    it('não cria um segundo imóvel quando a tentativa se repete', async () => {
      const store = storeWith(scene('a'));
      pronto(store);
      const property = TestBed.inject(PropertyService);
      const tours = TestBed.inject(VirtualTourService);
      // Só o `id` interessa; o resto do Property não é lido no publicar.
      const create = spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      spyOn(tours, 'addPanorama').and.returnValue(
        of({ id: 'pan-0' } as unknown) as ReturnType<VirtualTourService['addPanorama']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(property, 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      // O rascunho sobe inteiro e a publicação falha no último passo: é o
      // buraco por onde a duplicata nascia quando o imóvel era criado aqui.
      const publicar = spyOn(tours, 'publicarTour').and.returnValue(
        throwError(() => new Error('rede caiu')),
      );

      await store.publish();
      expect(store.published()).toBe(false);
      // O rascunho sobreviveu à falha: é ele que o retry reaproveita.
      expect(store.rascunhoPropertyId()).toBe('imovel-1');
      expect(store.rascunhoTourId()).toBe('tour-1');

      publicar.and.returnValue(
        of({ id: 'tour-1' } as unknown) as ReturnType<
          VirtualTourService['publicarTour']
        >,
      );
      await store.publish();

      expect(create).toHaveBeenCalledTimes(1);
      expect(store.published()).toBe(true);
      expect(store.publishedTourId()).toBe('tour-1');
    });

    /**
     * A duplicata que o teste de retry acima NÃO pegava.
     *
     * `createHotspot` insere uma linha por chamada. Os passos depois dele —
     * dados do imóvel e publicar — podem falhar, e aí o botão volta a ficar
     * clicável. Antes da reconciliação incremental (Tarefa 7), o segundo
     * clique publicava o tour com cada ponto de passagem em dobro, e o
     * conserto era apagar o de antes e recriar. Agora o ponto já sai da
     * primeira tentativa com `serverId` gravado — a segunda o reconhece e só
     * atualiza, sem criar nem apagar de novo. O caso acima (retry de imóvel)
     * passava mesmo assim porque só conferia `createProperty`, que é
     * idempotente por outro motivo.
     */
    it('não duplica os pontos de passagem quando a tentativa se repete', async () => {
      const store = storeWith(
        scene('a', { hotspots: [{ id: 'h1', u: 0.5, v: 0.5, label: '', target: 'b' }] }),
        scene('b'),
      );
      pronto(store);
      const property = TestBed.inject(PropertyService);
      const tours = TestBed.inject(VirtualTourService);

      spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      let n = 0;
      spyOn(tours, 'addPanorama').and.callFake(
        () =>
          of({ id: `pan-${n++}` } as unknown) as ReturnType<
            VirtualTourService['addPanorama']
          >,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      let criados = 0;
      const criar = spyOn(tours, 'createHotspot').and.callFake(
        () =>
          of({ id: `hot-${criados++}` } as unknown) as ReturnType<
            VirtualTourService['createHotspot']
          >,
      );
      const mover = spyOn(tours, 'atualizarHotspot').and.returnValue(
        of({ id: 'hot-0' } as unknown) as ReturnType<VirtualTourService['atualizarHotspot']>,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      // Falha DEPOIS dos hotspots já terem entrado: é a janela exata do bug.
      const atualizar = spyOn(property, 'updateProperty').and.returnValue(
        throwError(() => new Error('rede caiu')),
      );
      spyOn(tours, 'publicarTour').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['publicarTour']>,
      );

      await store.publish();
      expect(store.published()).toBe(false);
      expect(criar).toHaveBeenCalledTimes(1);

      atualizar.and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      await store.publish();

      expect(store.published()).toBe(true);
      // A segunda tentativa reconhece o `serverId` da primeira e só faz PATCH.
      expect(mover).toHaveBeenCalledWith('hot-0', jasmine.any(Object));
      // ...então nunca houve uma segunda criação, e nada para apagar.
      expect(criar).toHaveBeenCalledTimes(1);
      expect(apagar).not.toHaveBeenCalled();
    });

    /**
     * O corretor apagou um ponto entre a falha e o retry.
     *
     * Com a reconciliação incremental (Tarefa 7), o ponto some de
     * `scene.hotspots` por `patchScene`, que nota o `serverId` desaparecido e
     * o empilha em `hotspotsParaApagar` — sem isso, o laço de exclusão de
     * `salvarRascunho()`, que só percorre `scenes()`, nunca o alcançaria, e o
     * ponto removido na tela continuaria vivo no tour publicado.
     */
    it('não republica o ponto que o corretor apagou depois da falha', async () => {
      const store = storeWith(
        scene('a', { hotspots: [{ id: 'h1', u: 0.5, v: 0.5, label: '', target: 'b' }] }),
        scene('b'),
      );
      pronto(store);
      const property = TestBed.inject(PropertyService);
      const tours = TestBed.inject(VirtualTourService);

      spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      let n = 0;
      spyOn(tours, 'addPanorama').and.callFake(
        () =>
          of({ id: `pan-${n++}` } as unknown) as ReturnType<
            VirtualTourService['addPanorama']
          >,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      const criar = spyOn(tours, 'createHotspot').and.returnValue(
        of({ id: 'hot-0' } as unknown) as ReturnType<
          VirtualTourService['createHotspot']
        >,
      );
      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      const atualizar = spyOn(property, 'updateProperty').and.returnValue(
        throwError(() => new Error('rede caiu')),
      );
      spyOn(tours, 'publicarTour').and.returnValue(
        of({} as unknown) as ReturnType<VirtualTourService['publicarTour']>,
      );

      await store.publish();
      expect(criar).toHaveBeenCalledTimes(1);

      // Voltou à etapa 2 e removeu o ponto antes de tentar de novo.
      store.patchScene('a', (sc) => ({ ...sc, hotspots: [] }));
      atualizar.and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );
      await store.publish();

      expect(apagar).toHaveBeenCalledWith('hot-0');
      // Nenhuma criação nova: o tour publicado sai sem ponto nenhum.
      expect(criar).toHaveBeenCalledTimes(1);
    });

    it('acusa erro dentro do bloco de endereço, que é colapsável', async () => {
      const store = storeWith(scene('a'));
      pronto(store);
      store.patchAddress({ street: 'Avenida Paulista' });

      await store.publish();

      // Sem isto o acordeão fica fechado sobre os campos culpados e o botão
      // "Publicar" não faz nada nem explica por quê.
      expect(store.addressHasError()).toBe(true);
      expect(store.hasError('city')).toBe(true);
      expect(store.hasError('state')).toBe(true);
    });

    /**
     * O caso que a busca por nome errava.
     *
     * Dois ambientes com o MESMO nome mandavam as fotos originais das duas
     * cenas para o primeiro panorama: a segunda ficava sem nenhuma, e a
     * montagem por IA a dispensava por falta de verdade de campo.
     *
     * O casamento por nome — e depois por ordem — deixou de existir: cada cena
     * guarda o id do próprio panorama desde que ele é criado, durante a
     * captura. O caso continua aqui porque o que ele protege é o mesmo, e
     * porque nome repetido é o cenário em que qualquer volta a casar por
     * conteúdo reapareceria.
     */
    it('manda as fotos de cada captura para o SEU panorama, com nomes repetidos', async () => {
      const store = newStore();
      const tours = TestBed.inject(VirtualTourService);

      spyOn(TestBed.inject(PropertyService), 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      spyOn(tours, 'createTour').and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      let n = 0;
      spyOn(tours, 'addPanorama').and.callFake(
        () =>
          of({ id: `pan-${n++}` } as unknown) as ReturnType<
            VirtualTourService['addPanorama']
          >,
      );
      const upload = spyOn(tours, 'uploadCaptureFrames').and.resolveTo({
        uploaded: 8,
        total: 8,
      });
      spyOn(tours, 'montarTour').and.returnValue(
        of({ total: 2 } as unknown) as ReturnType<VirtualTourService['montarTour']>,
      );
      spyOn(tours, 'acompanharMontagem').and.callFake(
        async (_id: string, aoAvancar: (a: never) => void) => {
          aoAvancar({
            total: 1, prontos: 1, falhas: 0, dispensados: 0, terminado: true,
            panoramas: [
              { id: 'pan-0', status: 'DONE' },
              { id: 'pan-1', status: 'DONE' },
            ],
          } as never);
          return null as never;
        },
      );
      spyOn(tours, 'baixarPreview').and.returnValue(
        of(new Blob(['t'])) as ReturnType<VirtualTourService['baixarPreview']>,
      );
      spyOn(URL, 'createObjectURL').and.returnValue('blob:t');

      const framesA = [{ index: 0 }] as unknown as CaptureFrameUpload[];
      const framesB = [{ index: 1 }] as unknown as CaptureFrameUpload[];

      // É o modal de captura que chama isto, uma vez por cômodo, enquanto o
      // corretor espera. Nomes repetidos de propósito: era casando por nome que
      // as fotos das duas cenas iam parar no mesmo panorama, deixando a segunda
      // sem nenhuma e fazendo a IA dispensá-la por falta de verdade de campo.
      const a = await store.tratarCaptura({
        imageData: 'data:image/jpeg;base64,a', frames: framesA, geometry: null,
      });
      const b = await store.tratarCaptura({
        imageData: 'data:image/jpeg;base64,b', frames: framesB, geometry: null,
      });

      expect(upload.calls.allArgs().map((c) => c[0])).toEqual(['pan-0', 'pan-1']);
      expect(upload.calls.argsFor(0)[1]).toBe(framesA);
      expect(upload.calls.argsFor(1)[1]).toBe(framesB);
      expect([a?.panoramaId, b?.panoramaId]).toEqual(['pan-0', 'pan-1']);
    });

    it('não acusa endereço quando o erro está fora dele', async () => {
      const store = storeWith(scene('a'));

      await store.publish();

      expect(store.hasError('name')).toBe(true);
      expect(store.addressHasError()).toBe(false);
    });
  });

  describe('retomarRascunho', () => {
    /**
     * O mesmo rascunho de dois cômodos, reaproveitado pelos casos abaixo.
     * `title: 'Captura em andamento'` é o marcador que `garantirRascunho()`
     * grava — cobrado à parte, no caso que segue.
     */
    function rascunhoDeDoisComodos() {
      return {
        id: 't1',
        propertyId: 'imovel-1',
        status: 'DRAFT',
        updatedAt: '2026-08-26T12:00:00Z',
        property: {
          title: 'Casa na praia',
          type: 'HOUSE',
          purpose: 'SALE',
          address: null,
        },
        panoramas: [
          {
            id: 'p1', roomName: 'Sala', order: 0, initialPanorama: true,
            treatmentStatus: 'DONE',
            hotspots: [
              { id: 'h1', label: null, positionX: 0.25, positionY: 0.5, targetId: 'p2' },
            ],
          },
          {
            id: 'p2', roomName: 'Quarto', order: 1, initialPanorama: false,
            treatmentStatus: 'DONE', hotspots: [],
          },
        ],
      };
    }

    it('remonta as cenas do rascunho sem baixar equirect nenhuma', async () => {
      // Retomar um tour de seis cômodos baixando as fotos inteiras seriam
      // dezenas de MB no 4G antes de mostrar qualquer coisa. A foto chega
      // quando o viewer pedir.
      const store = newStore();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of(rascunhoDeDoisComodos()) as never,
      );
      const baixar = spyOn(TestBed.inject(PanoramaImageCache), 'obter');

      await store.retomarRascunho('t1');

      expect(store.scenes().map((s) => s.room)).toEqual(['Sala', 'Quarto']);
      expect(store.rascunhoTourId()).toBe('t1');
      expect(store.rascunhoPropertyId()).toBe('imovel-1');
      expect(store.property().name).toBe('Casa na praia');
      expect(baixar).not.toHaveBeenCalled();
    });

    it('religa os hotspots aos ids locais das cenas', async () => {
      // O hotspot do servidor aponta para um panoramaId; o wizard trabalha com
      // o id local da cena. Sem a tradução, a etapa 2 abre com todo ponto sem
      // destino — que é como um ponto inerte, descartado no publicar.
      const store = newStore();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of(rascunhoDeDoisComodos()) as never,
      );

      await store.retomarRascunho('t1');

      const sala = store.scenes()[0];
      const quarto = store.scenes()[1];
      expect(sala.hotspots[0].target).toBe(quarto.id);
      expect(sala.hotspots[0].serverId).toBe('h1');
    });

    it('a cena retomada guarda o id do servidor e fica sem imageData', async () => {
      const store = newStore();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of(rascunhoDeDoisComodos()) as never,
      );

      await store.retomarRascunho('t1');

      expect(store.scenes()[0].serverPanoramaId).toBe('p1');
      expect(store.scenes()[0].imageData).toBe('');
      // E mesmo assim é cena íntegra: `readyScenes` precisa contá-la, ou o
      // wizard retomado abre dizendo que não há imagem nenhuma.
      expect(store.readyScenes().length).toBe(2);
    });

    /**
     * O `Record<TreatmentStatus, WizardSceneAiState>` do topo do store existe
     * exatamente para esta tradução, e a retomada fazia a sua própria:
     * `=== 'DONE' ? 'done' : 'idle'`. `PENDING`/`PROCESSING` viravam `idle`,
     * o selo "melhorando" sumia do card e o corretor via como pronto um cômodo
     * que a IA ainda estava montando.
     */
    it('traduz o estado da IA pelo mapa, e não só DONE contra o resto', async () => {
      const store = newStore();
      const base = rascunhoDeDoisComodos();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of({
          ...base,
          panoramas: [
            { ...base.panoramas[0], treatmentStatus: 'PROCESSING' },
            { ...base.panoramas[1], treatmentStatus: 'FAILED' },
          ],
        }) as never,
      );

      await store.retomarRascunho('t1');

      expect(store.scenes()[0].aiState).toBe('processing');
      expect(store.scenes()[1].aiState).toBe('failed');
    });

    it('trata PENDING como montagem em curso, e não como cômodo pronto', async () => {
      const store = newStore();
      const base = rascunhoDeDoisComodos();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of({
          ...base,
          panoramas: [{ ...base.panoramas[0], treatmentStatus: 'PENDING' }],
        }) as never,
      );

      await store.retomarRascunho('t1');

      expect(store.scenes()[0].aiState).toBe('processing');
    });

    it('devolve o nome vazio quando o título é só o marcador de garantirRascunho()', async () => {
      // `garantirRascunho()` grava 'Captura em andamento' como marcador, não
      // como dado — o comentário do próprio método já diz isso. Devolvê-lo
      // faria a etapa 3 abrir com esse texto no campo Nome, como se o
      // corretor mesmo tivesse digitado.
      const store = newStore();
      const marcador = rascunhoDeDoisComodos();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of({ ...marcador, property: { ...marcador.property, title: 'Captura em andamento' } }) as never,
      );

      await store.retomarRascunho('t1');

      expect(store.property().name).toBe('');
    });

    /**
     * `title`, `type` e `purpose` são gravados JUNTOS por `garantirRascunho()`,
     * os três como marcador. A Tarefa 9 filtrou só o título, e Casa/Venda
     * voltavam como escolha do corretor: a etapa 3 abria pré-selecionada,
     * `invalidFields()` passava, e um apartamento para alugar era publicado
     * rotulado como casa à venda sem ninguém ter tocado nos campos.
     */
    it('não devolve type e purpose quando eles também são só marcadores', async () => {
      const store = newStore();
      const marcador = rascunhoDeDoisComodos();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of({
          ...marcador,
          property: {
            ...marcador.property,
            title: 'Captura em andamento',
            type: 'HOUSE',
            purpose: 'SALE',
          },
        }) as never,
      );

      await store.retomarRascunho('t1');

      expect(store.property().type).toBe('');
      expect(store.property().purpose).toBe('');
      // E a etapa 3 volta a cobrar os três, em vez de deixar publicar assim.
      expect(store.invalidFields()).toEqual(['name', 'type', 'purpose']);
    });

    it('devolve type e purpose quando o corretor já os escolheu', async () => {
      const store = newStore();
      const escolhido = rascunhoDeDoisComodos();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of({
          ...escolhido,
          property: {
            ...escolhido.property,
            title: 'Casa na praia',
            type: 'APARTMENT',
            purpose: 'RENT',
          },
        }) as never,
      );

      await store.retomarRascunho('t1');

      expect(store.property().type).toBe('APARTMENT');
      expect(store.property().purpose).toBe('RENT');
    });

    it('zera a fila de hotspots a apagar de uma sessão anterior', async () => {
      // `retomarRascunho` substitui o estado inteiro por dado vindo do
      // servidor — não há nada da sessão anterior para excluir. Se a fila de
      // `removeScene`/`patchScene` sobrevivesse, o PRÓXIMO `salvarRascunho()`
      // mandaria apagar um hotspot de um rascunho que este retomar sequer
      // carregou.
      const store = storeWith(
        scene('a', {
          serverPanoramaId: 'p-old',
          hotspots: [
            { id: 'h-old', u: 0.5, v: 0.5, label: '', target: 'b', serverId: 'srv-old' },
          ],
        }),
        scene('b', { serverPanoramaId: 'p-old-2' }),
      );
      comRascunhoCriado(store);
      const tours = TestBed.inject(VirtualTourService);
      spyOn(tours, 'deletePanorama').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deletePanorama']>,
      );
      // Empilha 'srv-old' em hotspotsParaApagar, como se o corretor tivesse
      // removido o ambiente e saído sem salvar.
      store.removeScene('a');

      spyOn(tours, 'lerRascunho').and.returnValue(
        of(rascunhoDeDoisComodos()) as never,
      );
      await store.retomarRascunho('t1');

      const apagar = spyOn(tours, 'deleteHotspot').and.returnValue(
        of(undefined) as ReturnType<VirtualTourService['deleteHotspot']>,
      );
      spyOn(tours, 'atualizarPanorama').and.returnValue(
        of({ id: 'p1' } as unknown) as ReturnType<VirtualTourService['atualizarPanorama']>,
      );
      spyOn(tours, 'atualizarHotspot').and.returnValue(
        of({ id: 'h1' } as unknown) as ReturnType<VirtualTourService['atualizarHotspot']>,
      );
      spyOn(TestBed.inject(PropertyService), 'updateProperty').and.returnValue(
        of({} as unknown) as ReturnType<PropertyService['updateProperty']>,
      );

      await store.salvarRascunho();

      expect(apagar).not.toHaveBeenCalled();
    });

    /**
     * A conexão escolhida é a única parte do wizard que não se deduz do resto,
     * e por isso ela viaja por uma coluna própria. Sem esta volta, retomar
     * depois da etapa de ordenação abria a etapa de passagens sem fila e a de
     * ordenação com todos os cômodos soltos — o trabalho inteiro de uma etapa,
     * perdido em silêncio.
     */
    it('traz de volta as conexões escolhidas, em ids locais', async () => {
      const store = newStore();
      const base = rascunhoDeDoisComodos();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of({
          ...base,
          panoramas: [
            { ...base.panoramas[0], hotspots: [], draftConnections: ['p2'] },
            { ...base.panoramas[1], draftConnections: ['p1'] },
          ],
        }) as never,
      );

      await store.retomarRascunho('t1');

      const [sala, quarto] = store.scenes();
      expect(sala.connections).toEqual([quarto.id]);
      expect(quarto.connections).toEqual([sala.id]);
    });

    /**
     * Rascunho gravado antes de `draftConnections` existir tem os pontos e não
     * tem a coluna. Sem a dedução, ele voltaria com a etapa de passagens
     * dizendo que não há nada a fazer, ao lado de pontos já marcados.
     */
    it('deduz a conexão dos pontos quando o rascunho é anterior à coluna', async () => {
      const store = newStore();
      spyOn(TestBed.inject(VirtualTourService), 'lerRascunho').and.returnValue(
        of(rascunhoDeDoisComodos()) as never,
      );

      await store.retomarRascunho('t1');

      const [sala, quarto] = store.scenes();
      expect(sala.connections).toEqual([quarto.id]);
      expect(quarto.connections).toEqual([sala.id]);
    });
  });

  /**
   * A Tarefa 9 devolve a cena retomada SEM foto, de propósito — reidratar seis
   * equirretangulares no 4G antes de mostrar qualquer coisa seria pior que não
   * retomar. `garantirImagem` é o que busca essa foto quando alguém finalmente
   * precisa dela: o viewer da etapa 2, a miniatura da etapa 1.
   */
  describe('garantirImagem', () => {
    it('baixa a foto de uma cena retomada e a guarda na cena', async () => {
      const store = storeWith(
        scene('s1', { room: 'Sala', serverPanoramaId: 'p1', imageData: '' }),
      );
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter')
        .and.resolveTo('blob:http://localhost/abc');

      const url = await store.garantirImagem('s1', 'treated');

      expect(url).toBe('blob:http://localhost/abc');
      expect(store.scenes()[0].treatedImageUrl).toBe('blob:http://localhost/abc');
      expect(obter).toHaveBeenCalledWith('p1', 'treated');
    });

    it('não vai à rede quando a cena já tem a foto em memória', async () => {
      // Cena recém-capturada já traz a dataURL da costura e o blob da tratada,
      // vindos do modal. Baixar de novo seria pagar 4G por algo que está ali.
      const store = storeWith(
        scene('s1', {
          room: 'Sala',
          serverPanoramaId: 'p1',
          imageData: 'data:image/jpeg;base64,SGk=',
          treatedImageUrl: 'blob:http://localhost/ja-tenho',
        }),
      );
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter');

      const url = await store.garantirImagem('s1', 'treated');

      expect(url).toBe('blob:http://localhost/ja-tenho');
      expect(obter).not.toHaveBeenCalled();
    });

    it('devolve vazio, sem ir à rede, para uma cena que nunca subiu e não tem foto', async () => {
      // Sem `serverPanoramaId` não há o que baixar — essa cena não existe no
      // servidor. Estourar aqui seria pior que devolver vazio e deixar quem
      // chamou decidir.
      const store = storeWith(scene('s1', { imageData: '' }));
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter');

      const url = await store.garantirImagem('s1', 'treated');

      expect(url).toBe('');
      expect(obter).not.toHaveBeenCalled();
    });
  });

  /**
   * A MINIATURA de uma cena retomada.
   *
   * Separada de `garantirImagem` porque é outra imagem: o card da etapa 1 e o
   * rail da etapa 2 desenham 196x110, e a foto cheia é dezenas de MB. Guardar
   * a pequena em `treatedImageUrl` faria a esfera da etapa 2 abrir borrada —
   * daí ela viver num mapa à parte.
   */
  describe('garantirMiniatura', () => {
    it('baixa reduzida e guarda fora da cena', async () => {
      const store = storeWith(
        scene('s1', { room: 'Sala', serverPanoramaId: 'p1', imageData: '' }),
      );
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter').and.resolveTo(
        'blob:mini',
      );

      const url = await store.garantirMiniatura('s1');

      expect(url).toBe('blob:mini');
      expect(obter).toHaveBeenCalledWith('p1', 'treated', 320);
      expect(store.miniatura('s1')).toBe('blob:mini');
      // O viewer continua sem imagem: quem baixa a esfera é a etapa 2.
      expect(store.scenes()[0].treatedImageUrl).toBeUndefined();
    });

    it('baixa uma vez só', async () => {
      const store = storeWith(
        scene('s1', { room: 'Sala', serverPanoramaId: 'p1', imageData: '' }),
      );
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter').and.resolveTo(
        'blob:mini',
      );

      await store.garantirMiniatura('s1');
      await store.garantirMiniatura('s1');

      expect(obter).toHaveBeenCalledTimes(1);
    });

    it('não tenta de novo depois de uma falha, e não rejeita', async () => {
      // Quem chama é um `effect`, que reroda a cada mutação da cena — uma
      // tecla digitada no nome basta. Sem esta memória, uma falha de rede
      // virava um download novo por tecla; e uma promise rejeitada ali não
      // teria onde ser tratada.
      const store = storeWith(
        scene('s1', { room: 'Sala', serverPanoramaId: 'p1', imageData: '' }),
      );
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter').and.rejectWith(
        new Error('rede caiu'),
      );

      await expectAsync(store.garantirMiniatura('s1')).toBeResolvedTo('');
      await expectAsync(store.garantirMiniatura('s1')).toBeResolvedTo('');

      expect(obter).toHaveBeenCalledTimes(1);
    });

    it('devolve vazio, sem ir à rede, para uma cena que nunca subiu', async () => {
      const store = storeWith(scene('s1', { imageData: '' }));
      const obter = spyOn(TestBed.inject(PanoramaImageCache), 'obter');

      expect(await store.garantirMiniatura('s1')).toBe('');
      expect(obter).not.toHaveBeenCalled();
    });
  });

  /**
   * `descartarRascunho` joga fora a captura em andamento — o botão que a
   * Tarefa 9 pediu de par com "retomar". Apaga o IMÓVEL, não o tour: ver o
   * comentário do método na implementação para a razão inteira (cascade e o
   * filtro da listagem).
   */
  describe('descartarRascunho', () => {
    it('descartar apaga o IMÓVEL, não o tour', async () => {
      // Imóvel sem tour nenhum passa pelo filtro da listagem: ele esconde
      // quem tem tour DRAFT, não quem não tem tour. Apagar só o tour deixaria
      // no catálogo a linha vazia "Captura em andamento" que aquele filtro
      // existe para evitar. `Property` é onDelete: Cascade, então uma chamada
      // basta.
      const store = storeWith(scene('s1', { serverPanoramaId: 'p1' }));
      comRascunhoCriado(store);
      const apagarImovel = spyOn(TestBed.inject(PropertyService), 'deleteProperty')
        .and.returnValue(of(undefined) as ReturnType<PropertyService['deleteProperty']>);
      const apagarTour = spyOn(TestBed.inject(VirtualTourService), 'deleteTour')
        .and.returnValue(of(undefined) as ReturnType<VirtualTourService['deleteTour']>);

      await store.descartarRascunho();

      expect(apagarImovel).toHaveBeenCalledWith('imovel-1');
      expect(apagarTour).not.toHaveBeenCalled();
    });

    it('descartar limpa o wizard e solta os blobs', async () => {
      const store = storeWith(scene('s1', { serverPanoramaId: 'p1' }));
      comRascunhoCriado(store);
      spyOn(TestBed.inject(PropertyService), 'deleteProperty').and.returnValue(
        of(undefined) as ReturnType<PropertyService['deleteProperty']>,
      );
      const liberar = spyOn(TestBed.inject(PanoramaImageCache), 'liberar');

      await store.descartarRascunho();

      expect(store.scenes()).toEqual([]);
      expect(store.rascunhoTourId()).toBeNull();
      expect(store.rascunhoPropertyId()).toBeNull();
      expect(liberar).toHaveBeenCalled();
    });

    it('descartar solta também as miniaturas', async () => {
      // Os `blob:` das miniaturas vivem num mapa do store, fora da cena: sem
      // limpá-los, "Criar outro tour" começaria com as miniaturas do tour
      // anterior apontando para blobs já revogados.
      const store = storeWith(scene('s1', { serverPanoramaId: 'p1', imageData: '' }));
      comRascunhoCriado(store);
      spyOn(TestBed.inject(PropertyService), 'deleteProperty').and.returnValue(
        of(undefined) as ReturnType<PropertyService['deleteProperty']>,
      );
      spyOn(TestBed.inject(PanoramaImageCache), 'obter').and.resolveTo('blob:mini');
      await store.garantirMiniatura('s1');

      await store.descartarRascunho();

      expect(store.miniatura('s1')).toBe('');
    });

    it('descartar um rascunho que nunca subiu não chama a rede', async () => {
      // Sem `rascunhoPropertyId` não há imóvel nenhum no servidor — a etapa 1
      // ainda não tirou a primeira foto. Chamar `deleteProperty` aqui seria
      // apagar um id que não existe.
      const store = newStore();
      const apagarImovel = spyOn(TestBed.inject(PropertyService), 'deleteProperty')
        .and.returnValue(of(undefined) as ReturnType<PropertyService['deleteProperty']>);

      await store.descartarRascunho();

      expect(apagarImovel).not.toHaveBeenCalled();
    });
  });
});

/**
 * Ordenar e conectar ambientes.
 *
 * A ordem de verdade e a posicao no array -- `publish-payload.ts` faz
 * `ready.map((scene, i) => ...)` com `order: i` e `initialPanorama: i === 0`.
 * Mexer so no campo `order` nao mudaria nada em lugar nenhum.
 */
describe('TourDraftStore — ordenar e conectar', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    store = TestBed.inject(TourDraftStore);
  });

  function cenaCom(
    id: string,
    connections: string[] = [],
    hotspots: WizardScene['hotspots'] = [],
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

  const ids = () => store.scenes().map((s) => s.id);
  const conexoes = (id: string) =>
    store.scenes().find((s) => s.id === id)?.connections ?? [];
  const pontos = (id: string) =>
    store.scenes().find((s) => s.id === id)?.hotspots ?? [];

  // ---- conexao orfa ------------------------------------------------------

  it('remover um ambiente tira ele das conexoes dos outros', () => {
    store.scenes.set([
      cenaCom('sala', ['cozinha', 'quarto']),
      cenaCom('cozinha', ['sala']),
      cenaCom('quarto', ['sala']),
    ]);

    store.removeScene('cozinha');

    expect(conexoes('sala')).toEqual(['quarto']);
    expect(ids()).toEqual(['sala', 'quarto']);
  });

  it('remover um ambiente sem conexoes nao estoura', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha')]);
    expect(() => store.removeScene('cozinha')).not.toThrow();
  });

  // ---- moveScene ---------------------------------------------------------

  it('moveScene move para baixo', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha'), cenaCom('quarto')]);
    store.moveScene(0, 2);
    expect(ids()).toEqual(['cozinha', 'quarto', 'sala']);
  });

  it('moveScene move para cima', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha'), cenaCom('quarto')]);
    store.moveScene(2, 0);
    expect(ids()).toEqual(['quarto', 'sala', 'cozinha']);
  });

  it('moveScene reescreve o campo order para a posicao nova', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha'), cenaCom('quarto')]);
    store.moveScene(0, 2);
    expect(store.scenes().map((s) => s.order)).toEqual([0, 1, 2]);
  });

  // Reordenar e sobre a sequencia, nao sobre o grafo.
  it('moveScene nao mexe nas conexoes', () => {
    store.scenes.set([
      cenaCom('sala', ['cozinha', 'quarto']),
      cenaCom('cozinha', ['sala']),
      cenaCom('quarto', ['sala']),
    ]);
    store.moveScene(0, 2);
    expect(conexoes('sala')).toEqual(['cozinha', 'quarto']);
  });

  it('moveScene com indice invalido nao faz nada', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha')]);
    store.moveScene(0, 9);
    expect(ids()).toEqual(['sala', 'cozinha']);
    store.moveScene(-1, 0);
    expect(ids()).toEqual(['sala', 'cozinha']);
  });

  it('moveScene para a propria posicao nao faz nada', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha')]);
    store.moveScene(1, 1);
    expect(ids()).toEqual(['sala', 'cozinha']);
  });

  // ---- ligar e desligar --------------------------------------------------

  it('ligar escreve nos dois ambientes', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha')]);
    store.ligarAmbientes('sala', 'cozinha');

    expect(conexoes('sala')).toEqual(['cozinha']);
    expect(conexoes('cozinha')).toEqual(['sala']);
  });

  it('desligar tira dos dois e devolve os pontos perdidos', () => {
    store.scenes.set([
      cenaCom('sala', ['cozinha'], [
        { id: 'h1', u: 0.5, v: 0.5, label: '', target: 'cozinha' },
      ]),
      cenaCom('cozinha', ['sala']),
    ]);

    const perdidos = store.desligarAmbientes('sala', 'cozinha');

    expect(perdidos.map((h) => h.id)).toEqual(['h1']);
    expect(conexoes('sala')).toEqual([]);
    expect(conexoes('cozinha')).toEqual([]);
    expect(pontos('sala')).toEqual([]);
  });

  // O ponto ja gravado no servidor precisa ser APAGADO la, e quem sabe disso e
  // a store. Sem empilhar o serverId, o laco de exclusao do salvarRascunho --
  // que so percorre scenes() -- nunca mais o veria.
  it('desligar tira da tela o ponto que ja existia no servidor', () => {
    store.scenes.set([
      cenaCom('sala', ['cozinha'], [
        { id: 'h1', serverId: 'srv-1', u: 0.5, v: 0.5, label: '', target: 'cozinha' },
      ]),
      cenaCom('cozinha', ['sala']),
    ]);

    const perdidos = store.desligarAmbientes('sala', 'cozinha');

    expect(perdidos[0].serverId).toBe('srv-1');
    expect(pontos('sala')).toEqual([]);
  });

  it('desligar o que nao esta ligado nao perde nada', () => {
    store.scenes.set([cenaCom('sala'), cenaCom('cozinha')]);
    expect(store.desligarAmbientes('sala', 'cozinha')).toEqual([]);
  });
});

/**
 * Quatro etapas: imagens, ordenacao, passagens, informacoes.
 *
 * A tela de ordenacao virou etapa propria porque escondida dentro de outra o
 * botao "Voltar" fica errado: `back()` so sabe decrementar `step`, e de uma
 * sub-fase ele saltaria a tela inteira.
 */
describe('TourDraftStore — quatro etapas', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    store = TestBed.inject(TourDraftStore);
    store.scenes.set([
      {
        id: 'sala',
        room: 'Sala',
        fileName: 'sala.jpg',
        fileSize: 1024,
        imageData: 'data:image/jpeg;base64,x',
        order: 0,
        hotspots: [],
        state: 'ready',
      },
    ]);
  });

  it('TOTAL_ETAPAS e quatro', () => {
    expect(TOTAL_ETAPAS).toBe(4);
  });

  it('o progresso chega a 100 so na ultima etapa', () => {
    store.step.set(3);
    expect(store.progressPct()).toBe(75);
    store.step.set(4);
    expect(store.progressPct()).toBe(100);
  });

  // Publicar mudou de etapa: era a 3, agora e a 4. Sem isto, `next()` na etapa
  // 3 publicaria um tour sem os dados do imovel.
  it('next na etapa 3 avanca, e nao publica', () => {
    const publicar = spyOn(store, 'publish');
    store.step.set(3);
    store.next();

    expect(publicar).not.toHaveBeenCalled();
    expect(store.step()).toBe(4);
  });

  it('next na etapa 4 publica', () => {
    const publicar = spyOn(store, 'publish');
    store.step.set(4);
    store.next();

    expect(publicar).toHaveBeenCalled();
  });

  it('back desce uma etapa, e para na 1', () => {
    store.step.set(4);
    store.back();
    expect(store.step()).toBe(3);

    store.step.set(1);
    store.back();
    expect(store.step()).toBe(1);
  });

  // Cada etapa cobra a alcancabilidade pela fonte que ELA produz. As duas
  // regras usam o mesmo grafo e dao respostas diferentes de proposito.
  function duasCenas(connections: [string[], string[]]) {
    return [
      {
        id: 'sala',
        room: 'Sala',
        fileName: 'sala.jpg',
        fileSize: 1024,
        imageData: 'data:image/jpeg;base64,x',
        order: 0,
        hotspots: [],
        state: 'ready' as const,
        connections: connections[0],
      },
      {
        id: 'cozinha',
        room: 'Cozinha',
        fileName: 'cozinha.jpg',
        fileSize: 1024,
        imageData: 'data:image/jpeg;base64,x',
        order: 1,
        hotspots: [],
        state: 'ready' as const,
        connections: connections[1],
      },
    ];
  }

  // O que a ordenacao NAO cobra: ponto posicionado. Ali nao ha nenhum ainda, e
  // exigi-los travaria a tela por um defeito que so a etapa seguinte conserta.
  it('conectados e sem pontos: a ordenacao segue, as passagens travam', () => {
    store.scenes.set(duasCenas([['cozinha'], ['sala']]));

    store.step.set(2);
    expect(store.canAdvance()).toBeTrue();

    store.step.set(3);
    expect(store.canAdvance()).toBeFalse();
  });

  // O que a ordenacao COBRA: a conexao. Sem isto o corretor seguia para a etapa
  // 3 e encontrava um "volte aos ambientes" -- o wizard deixava entrar num
  // lugar cuja unica instrucao e sair.
  it('sem conexao nenhuma, a ordenacao nao deixa seguir', () => {
    store.scenes.set(duasCenas([[], []]));

    store.step.set(2);
    expect(store.canAdvance()).toBeFalse();
  });

  // Um ambiente nao tem com quem se conectar: cobrar seria travar por um
  // defeito que nao existe.
  it('com um ambiente so, a ordenacao nao cobra conexao', () => {
    store.scenes.set([duasCenas([[], []])[0]]);

    store.step.set(2);
    expect(store.canAdvance()).toBeTrue();
  });
});

/**
 * O caminho que a ordem das fotos ja descreve.
 *
 * Um imovel e percorrido em sequencia, e a ordem em que o corretor fotografa e
 * quase sempre a ordem em que se anda por ele. Deixar isso implicito obrigava a
 * refazer na tela de ordenacao um caminho que ele acabou de andar com o
 * telefone na mao -- e, com dois ambientes, a "escolher" a unica ligacao
 * possivel.
 *
 * A ligacao nasce COM o ambiente e nunca e refeita depois. Reordenar, conectar
 * a mao ou remover sao decisoes do corretor, e um encadeamento que se
 * recalculasse sozinho apagaria a escolha dele -- e junto, os pontos ja
 * posicionados nas conexoes desfeitas.
 */
describe('TourDraftStore — caminho pre-definido pela ordem das fotos', () => {
  let store: TourDraftStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    store = TestBed.inject(TourDraftStore);
  });

  function capturar(room: string, bytes = '123456789'): void {
    store.addCapturedScene({
      room,
      fileName: `${room}.jpg`,
      imageData: `data:image/jpeg;base64,${btoa(bytes)}`,
    });
  }

  const ids = () => store.scenes().map((s) => s.id);
  const ligacoes = () => store.scenes().map((s) => s.connections ?? []);

  // PNG 2x1 real: a validacao de proporcao decodifica a imagem.
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP8z4AATEQyAAAJAgHz2AsvpAAAAABJRU5ErkJggg==';

  async function arquivo(nome: string): Promise<File> {
    const blob = await (await fetch(PNG)).blob();
    return new File([blob], nome, { type: 'image/png' });
  }

  // O upload e outro caminho de codigo, e o pedido vale igual para ele.
  it('o upload encadeia na ordem dos arquivos', async () => {
    await store.addFiles([await arquivo('a.png'), await arquivo('b.png')]);

    const [a, b] = ids();
    expect(ligacoes()).toEqual([[b], [a]]);
  });

  // Arquivo recusado nao vira ambiente, entao nao entra no caminho: a foto
  // seguinte se liga a ultima que de fato virou um.
  it('arquivo recusado nao entra no caminho', async () => {
    await store.addFiles([
      await arquivo('a.png'),
      new File(['isto nao e uma foto'], 'contrato.pdf', { type: 'application/pdf' }),
      await arquivo('c.png'),
    ]);

    const [a, , c] = ids();
    expect(store.scenes()[1].state).toBe('rejected');
    expect(ligacoes()).toEqual([[c], [], [a]]);
  });

  it('a primeira captura nao se liga a ninguem', () => {
    capturar('Sala');
    expect(ligacoes()).toEqual([[]]);
  });

  it('a segunda ja chega ligada a primeira, nos dois sentidos', () => {
    capturar('Sala');
    capturar('Cozinha');

    const [sala, cozinha] = ids();
    expect(ligacoes()).toEqual([[cozinha], [sala]]);
  });

  // Corrente, nao estrela: a terceira foto se liga a SEGUNDA. Ligar tudo na
  // primeira desenharia um imovel em que todo comodo da na sala.
  it('a terceira se liga a segunda, e nao a primeira', () => {
    capturar('Sala');
    capturar('Cozinha');
    capturar('Quarto');

    const [sala, cozinha, quarto] = ids();
    expect(ligacoes()).toEqual([[cozinha], [sala, quarto], [cozinha]]);
  });

  // O caminho pronto e o que a etapa 2 passou a cobrar: sem ele, um upload
  // recem-feito ja abriria travado.
  it('com o caminho pronto, a ordenacao deixa seguir', () => {
    capturar('Sala');
    capturar('Cozinha');

    store.step.set(2);
    expect(store.canAdvance()).toBeTrue();
  });

  // Reordenar move o card, nao reescreve o caminho: a corrente segue Sala–
  // Cozinha, agora com a cozinha na frente.
  it('reordenar NAO refaz o caminho', () => {
    capturar('Sala');
    capturar('Cozinha');
    const [sala, cozinha] = ids();

    store.moveScene(0, 1);

    expect(ids()).toEqual([cozinha, sala]);
    expect(ligacoes()).toEqual([[sala], [cozinha]]);
  });

  // Desfazer a mao tem que valer: um encadeamento que voltasse sozinho tornaria
  // a tela de ordenacao decorativa.
  it('desligar a mao nao e desfeito', () => {
    capturar('Sala');
    capturar('Cozinha');
    const [sala, cozinha] = ids();

    store.desligarAmbientes(sala, cozinha);

    expect(ligacoes()).toEqual([[], []]);
  });
});
