import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PropertyService } from '../services/property.service';
import { VirtualTourService } from '../services/virtual-tour.service';
import { TourDraftStore } from './tour-draft.store';
import { WizardScene } from './tour-wizard.model';

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

  describe('a regra bloqueante da etapa 2', () => {
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
      store.goTo(2);

      expect(store.canAdvance()).toBe(true);
      expect(store.etapa2Opcional()).toBe(true);
    });

    it('trava com dois ambientes sem ligação', () => {
      const store = storeWith(scene('a'), scene('b'));
      store.goTo(2);

      expect(store.canAdvance()).toBe(false);
      expect(store.ambientesIlhados().map((s) => s.id)).toEqual(['b']);
    });

    it('libera quando todo ambiente é alcançável', () => {
      const store = storeWith(
        scene('a', { hotspots: [ponto('h1', 'b')] }),
        scene('b'),
      );
      store.goTo(2);

      expect(store.canAdvance()).toBe(true);
    });

    it('um ponto sem destino não conta como ligação', () => {
      // Órfão é descartado na publicação. Se contasse, o wizard liberaria um
      // tour que o servidor recebe quebrado — que é o defeito inteiro.
      const store = storeWith(
        scene('a', { hotspots: [ponto('h1', null)] }),
        scene('b'),
      );
      store.goTo(2);

      expect(store.canAdvance()).toBe(false);
    });

    it('não trava as outras etapas', () => {
      // A regra é da etapa 2. Nas etapas 1 e 3 o mesmo rascunho anda.
      const store = storeWith(scene('a'), scene('b'));

      expect(store.canAdvance()).toBe(true);
    });

    it('remover um ambiente não joga o corretor de volta à etapa 1', () => {
      // `removeScene` devolve à etapa 1 quando some a última imagem. Se essa
      // guarda olhasse `canAdvance`, ilhar um ambiente na etapa 2 arrastaria o
      // corretor duas telas atrás — para consertar algo que se conserta ali
      // mesmo.
      const store = storeWith(
        scene('a', { hotspots: [ponto('h1', 'b')] }),
        scene('b'),
        scene('c', { hotspots: [ponto('h2', 'a')] }),
      );
      store.goTo(2);

      store.removeScene('a');

      expect(store.step()).toBe(2);
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
      // Só o `id` interessa ao publicar; o resto do Property não é lido.
      const create = spyOn(property, 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      // O imóvel entra, o tour falha: é o buraco por onde a duplicata nascia.
      const createTour = spyOn(tours, 'createTour').and.returnValue(
        throwError(() => new Error('413')),
      );

      await store.publish();
      expect(store.publishedPropertyId()).toBe('imovel-1');

      createTour.and.returnValue(
        of({ id: 'tour-1', panoramas: [] } as unknown) as ReturnType<
          VirtualTourService['createTour']
        >,
      );
      await store.publish();

      expect(create).toHaveBeenCalledTimes(1);
      expect(store.published()).toBe(true);
      expect(store.publishedTourId()).toBe('tour-1');
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
     * montagem por IA a dispensava por falta de verdade de campo. Nome com
     * espaço no fim errava sozinho, porque o payload manda `trim()` e a busca
     * comparava sem.
     */
    it('manda as fotos de cada cena para o panorama da MESMA ordem', async () => {
      const frames = (i: number) =>
        [{ index: i }] as unknown as WizardScene['frames'];
      const store = storeWith(
        scene('a', { room: 'Ambiente 2 ', frames: frames(0) }),
        scene('b', { room: 'Ambiente 2', frames: frames(1) }),
      );
      pronto(store);

      spyOn(TestBed.inject(PropertyService), 'createProperty').and.returnValue(
        of({ id: 'imovel-1' }) as ReturnType<PropertyService['createProperty']>,
      );
      const tours = TestBed.inject(VirtualTourService);
      spyOn(tours, 'createTour').and.returnValue(
        of({
          id: 'tour-1',
          panoramas: [
            { id: 'pan-0', roomName: 'Ambiente 2', order: 0 },
            { id: 'pan-1', roomName: 'Ambiente 2', order: 1 },
          ],
        } as unknown) as ReturnType<VirtualTourService['createTour']>,
      );
      const upload = spyOn(tours, 'uploadCaptureFrames').and.resolveTo({
        uploaded: 1,
      } as never);
      spyOn(tours, 'montarTour').and.returnValue(
        of({ total: 2 }) as ReturnType<VirtualTourService['montarTour']>,
      );
      spyOn(tours, 'acompanharMontagem').and.resolveTo(undefined as never);
      // Se voltasse a existir, seria o round-trip que baixa tudo de novo.
      const refetch = spyOn(tours, 'findTour');

      await store.publish();

      expect(upload.calls.allArgs().map((a) => a[0])).toEqual([
        'pan-0',
        'pan-1',
      ]);
      expect(upload.calls.argsFor(0)[1]).toBe(store.scenes()[0].frames!);
      expect(upload.calls.argsFor(1)[1]).toBe(store.scenes()[1].frames!);
      expect(refetch).not.toHaveBeenCalled();
    });

    it('não acusa endereço quando o erro está fora dele', async () => {
      const store = storeWith(scene('a'));

      await store.publish();

      expect(store.hasError('name')).toBe(true);
      expect(store.addressHasError()).toBe(false);
    });
  });
});
