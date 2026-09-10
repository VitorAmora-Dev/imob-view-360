import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import * as THREE from 'three';
import { Panorama } from '../../models/virtual-tour.model';
import { hotspotToWorld } from '../../tour-wizard/hotspots/hotspot-projection';
import { PanoramicViewerComponent } from './panoramic-viewer.component';

/** O `ngAfterViewInit` do viewer adia o init num setTimeout(0). */
function afterInit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('PanoramicViewerComponent — superfície para o overlay de pins', () => {
  let fixture: ComponentFixture<PanoramicViewerComponent>;
  let component: PanoramicViewerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanoramicViewerComponent],
      // A lista de ambientes traduz o próprio nome acessível.
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PanoramicViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  it('não expõe câmera antes de inicializar', () => {
    expect(component.viewerCamera).toBeNull();
  });

  it('expõe a câmera do three.js depois de inicializar', async () => {
    fixture.detectChanges();
    await afterInit();

    expect(component.viewerCamera).not.toBeNull();
    expect(component.viewerCamera!.isPerspectiveCamera).toBe(true);
  });

  it('expõe o tamanho do canvas', async () => {
    fixture.detectChanges();
    await afterInit();

    const size = component.viewerSize;

    expect(size).not.toBeNull();
    expect(size!.width).toBeGreaterThan(0);
    expect(size!.height).toBeGreaterThan(0);
  });

  it('chama o assinante de frame durante o laço de render', async () => {
    fixture.detectChanges();
    await afterInit();
    let frames = 0;

    component.onFrame(() => frames++);
    await afterInit();

    expect(frames).toBeGreaterThan(0);
  });

  describe('criação de hotspot em editMode', () => {
    function canvas(): HTMLCanvasElement {
      return fixture.nativeElement.querySelector('canvas');
    }

    /** Simula um gesto: pointerdown, opcionalmente move, pointerup e click. */
    function gesto(deslocamento: number): void {
      const el = canvas();
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, clientY: y };

      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x }));
      el.dispatchEvent(
        new PointerEvent('pointerup', { ...opts, clientX: x + deslocamento }),
      );
      el.dispatchEvent(
        new MouseEvent('click', { ...opts, clientX: x + deslocamento }),
      );
    }

    beforeEach(async () => {
      // O OrbitControls captura o ponteiro no `pointerdown`, e o browser recusa
      // capturar um `pointerId` que não veio de um dispositivo real. Não é o
      // comportamento sob teste — o que importa aqui é a trava de arrasto.
      spyOn(HTMLElement.prototype, 'setPointerCapture').and.stub();
      spyOn(HTMLElement.prototype, 'releasePointerCapture').and.stub();

      fixture.componentRef.setInput('editMode', true);
      fixture.detectChanges();
      await afterInit();
    });

    it('emite o ponto no clique parado', () => {
      const emitidos: unknown[] = [];
      component.hotspotPlaced.subscribe((e) => emitidos.push(e));

      gesto(0);

      expect(emitidos.length).toBe(1);
    });

    it('não emite quando o clique vem no fim de um arrasto', () => {
      // O OrbitControls gira no arrasto e o browser dispara `click` ao soltar.
      // Sem esta supressão, girar o panorama cria um hotspot a cada solta.
      const emitidos: unknown[] = [];
      component.hotspotPlaced.subscribe((e) => emitidos.push(e));

      gesto(80);

      expect(emitidos).toEqual([]);
    });

    it('tolera o tremor de mão de um clique parado', () => {
      const emitidos: unknown[] = [];
      component.hotspotPlaced.subscribe((e) => emitidos.push(e));

      gesto(3);

      expect(emitidos.length).toBe(1);
    });

    it('volta a emitir no clique seguinte ao arrasto', () => {
      const emitidos: unknown[] = [];
      component.hotspotPlaced.subscribe((e) => emitidos.push(e));

      gesto(80);
      gesto(0);

      expect(emitidos.length).toBe(1);
    });
  });

  /**
   * Duas cargas de textura em voo ao mesmo tempo.
   *
   * `TextureLoader.load` é assíncrono e não cancelável, e os callbacks chegam em
   * ordem de CONCLUSÃO, nunca de pedido. Dois toques rápidos numa rede lenta
   * deixam duas cargas correndo, e a foto que aparece era a que baixasse por
   * último — medido com a rede estrangulada, três toques rendiam quatro trocas
   * de foto, com o cômodo errado no meio.
   *
   * Aqui as duas cargas são resolvidas à MÃO, fora de ordem. É o único jeito de
   * um teste falar sobre isso sem depender de qual download termina primeiro.
   */
  describe('duas cargas de textura em voo', () => {
    interface Pedido {
      ok: (textura: THREE.Texture) => void;
      falhou: () => void;
    }

    function comoda(id: string, order: number): Panorama {
      return {
        id,
        roomName: id.toUpperCase(),
        imageUrl: `https://exemplo.invalido/${id}.jpg`,
        order,
        initialPanorama: order === 0,
        originHotspots: [],
        measurements: [],
      };
    }

    let pedidos: Pedido[];

    beforeEach(async () => {
      pedidos = [];
      spyOn(THREE.TextureLoader.prototype, 'load').and.callFake(((
        _url: string,
        ok: (t: THREE.Texture) => void,
        _progresso: unknown,
        falhou: () => void,
      ) => {
        pedidos.push({ ok, falhou });
        return new THREE.Texture();
      }) as never);

      component.panoramas = [comoda('a', 0), comoda('b', 1), comoda('c', 2)];
      fixture.detectChanges();
      await afterInit();
      // `pedidos[0]` é a carga inicial, e fica pendurada de propósito.
    });

    it('prevalece a cena pedida por último, e não a que baixou por último', () => {
      const trocas: string[] = [];
      component.panoramaChange.subscribe((p) => trocas.push(p.id));

      component.navigateTo('b');
      component.navigateTo('c');
      expect(pedidos.length).toBe(3);

      // 'c' chega primeiro (estava no cache); 'b', pesada, chega depois.
      pedidos[2].ok(new THREE.Texture());
      pedidos[1].ok(new THREE.Texture());

      expect(trocas).toEqual(['c']);
      expect(component.idAtual).toBe('c');
    });

    it('solta a textura descartada em vez de deixá-la órfã na GPU', () => {
      const tardia = new THREE.Texture();
      spyOn(tardia, 'dispose');

      component.navigateTo('b');
      component.navigateTo('c');
      pedidos[2].ok(new THREE.Texture());
      pedidos[1].ok(tardia);

      // Ela nunca chega a ser atribuída ao material, então ninguém mais a
      // solta: uma equirretangular de 8192x4096 são ~128 MB de GPU.
      expect(tardia.dispose).toHaveBeenCalled();
    });

    it('a falha de um pedido abandonado não vira loadFailed', () => {
      component.navigateTo('b');
      component.navigateTo('c');
      pedidos[2].ok(new THREE.Texture());

      const falhas: string[] = [];
      component.loadFailed.subscribe((p) => falhas.push(p.id));

      pedidos[1].falhou();

      // Sem esta guarda, o aviso de "não carregou" subia em tela cheia por cima
      // do cômodo 'c', que está na tela e está correto.
      expect(falhas).toEqual([]);
      expect(component.loading).toBe(false);
    });
  });

  /**
   * O sprite do viewer e o pin HTML da etapa 2 têm de nascer no MESMO ponto.
   *
   * São duas implementações da mesma conta, em arquivos diferentes — e foi
   * exatamente aí que o eixo vertical divergiu: `addHotspots` usava
   * `(1 - positionY) * π` e espelhava no equador o ponto que o clique deste
   * mesmo componente gravava. Ninguém viu porque o erro é ZERO no equador, que
   * é onde caem o seed (`positionY: 0.5`) e o clique no centro do canvas.
   *
   * Por isso os casos abaixo ficam LONGE do equador, e por isso a asserção é
   * contra `hotspotToWorld`: amarrar as duas fórmulas é o que impede a próxima
   * divergência de passar despercebida.
   */
  describe('sprites concordam com a projeção do overlay', () => {
    function panoramaCom(positionX: number, positionY: number): Panorama {
      return {
        id: 'p1',
        roomName: 'Sala',
        imageUrl: '',
        order: 0,
        initialPanorama: true,
        measurements: [],
        originHotspots: [
          { id: 'h1', label: 'Porta', positionX, positionY, targetId: 'p2' },
        ],
      };
    }

    function spriteDo(component: PanoramicViewerComponent): THREE.Sprite {
      return (component as unknown as { hotspotSprites: THREE.Sprite[] })
        .hotspotSprites[0];
    }

    beforeEach(async () => {
      fixture.detectChanges();
      await afterInit();
    });

    it('põe o sprite onde o overlay projetaria — perto do topo', () => {
      // `positionY = 0.15` é bem acima do equador: com a fórmula espelhada o
      // sprite ia parar em 0.85, do outro lado, com y de sinal trocado.
      component.reloadHotspots(panoramaCom(0.25, 0.15));

      const esperado = hotspotToWorld(0.25, 0.15);

      expect(spriteDo(component).position.distanceTo(esperado)).toBeLessThan(0.5);
      // Guarda explícita do sinal: acima do equador o y é positivo.
      expect(spriteDo(component).position.y).toBeGreaterThan(0);
    });

    it('põe o sprite onde o overlay projetaria — perto do chão', () => {
      component.reloadHotspots(panoramaCom(0.8, 0.9));

      const esperado = hotspotToWorld(0.8, 0.9);

      expect(spriteDo(component).position.distanceTo(esperado)).toBeLessThan(0.5);
      expect(spriteDo(component).position.y).toBeLessThan(0);
    });
  });

  it('para de chamar o assinante depois de cancelado', async () => {
    fixture.detectChanges();
    await afterInit();
    let frames = 0;
    const cancelar = component.onFrame(() => frames++);
    await afterInit();

    cancelar();
    const congelado = frames;
    await afterInit();

    expect(frames).toBe(congelado);
  });

  /**
   * A planta na parede.
   *
   * Ela mora no viewer, e não nas páginas, porque é estrutural: sem ela o
   * visitante só troca de ambiente por hotspot, e um ambiente que ninguém ligou
   * fica invisível — fotografado, pago e inalcançável. Se fosse peça avulsa, a
   * próxima tela que mostrasse um tour esqueceria de incluí-la.
   */
  describe('lista de ambientes', () => {
    function sala(id: string, roomName: string, order: number): Panorama {
      return {
        id,
        roomName,
        imageUrl: '',
        order,
        initialPanorama: order === 0,
        measurements: [],
        originHotspots: [],
      };
    }

    /** Aplica as entradas passando pelo `ngOnChanges`, como o Angular faria. */
    function comPanoramas(lista: Panorama[], roomNav = true): void {
      component.panoramas = lista;
      component.roomNav = roomNav;
      component.ngOnChanges({
        panoramas: { currentValue: lista, previousValue: [], firstChange: true, isFirstChange: () => true },
      });
      fixture.detectChanges();
    }

    const textos = () =>
      [...fixture.nativeElement.querySelectorAll('.viewer-nav__item')].map(
        (b: HTMLElement) => b.textContent!.trim(),
      );

    it('não aparece com um ambiente só — não há para onde ir', () => {
      comPanoramas([sala('a', 'Sala', 0)]);

      expect(component.mostrarNav).toBeFalse();
      expect(fixture.nativeElement.querySelector('.viewer-nav')).toBeNull();
    });

    it('aparece a partir do segundo ambiente', () => {
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);

      expect(component.mostrarNav).toBeTrue();
      expect(fixture.nativeElement.querySelector('.viewer-nav')).not.toBeNull();
    });

    it('só some se a tela DISSER que tem outra navegação', () => {
      // O padrão é aparecer. Amarrar isto ao `editMode` foi a primeira versão e
      // estava errada: o wizard usa esse modo tendo um trilho próprio, mas o
      // inner-view usa o MESMO modo para marcar hotspots — e lá desligar a
      // lista tirava a única navegação que existia.
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)], false);

      expect(component.mostrarNav).toBeFalse();
    });

    it('aparece mesmo em modo de edição, se ninguém disse o contrário', () => {
      component.editMode = true;
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);

      expect(component.mostrarNav).toBeTrue();
    });

    it('lista na ordem do tour, não na ordem em que as cenas chegaram', () => {
      comPanoramas([
        sala('c', 'Quarto', 2),
        sala('a', 'Sala', 0),
        sala('b', 'Cozinha', 1),
      ]);
      component.navAberta = true;
      fixture.detectChanges();

      expect(textos()).toEqual(['Sala', 'Cozinha', 'Quarto']);
    });

    it('marca onde a pessoa está, e não só por cor', () => {
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);
      component.idAtual = 'b';
      component.navAberta = true;
      fixture.detectChanges();

      const marcados = [
        ...fixture.nativeElement.querySelectorAll('[aria-current="true"]'),
      ].map((b: HTMLElement) => b.textContent!.trim());

      expect(marcados).toEqual(['Cozinha']);
    });

    it('escolher o ambiente em que já se está não recarrega a foto', () => {
      // Recarregar decodifica a equirretangular inteira e a sobe para a GPU.
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);
      component.idAtual = 'a';
      const espia = spyOn(component, 'navigateTo');

      component.irPara('a');

      expect(espia).not.toHaveBeenCalled();
      expect(component.navAberta).toBeFalse();
    });

    it('escolher outro ambiente navega e fecha a lista', () => {
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);
      component.idAtual = 'a';
      component.navAberta = true;
      const espia = spyOn(component, 'navigateTo');

      component.irPara('b');

      expect(espia).toHaveBeenCalledWith('b');
      expect(component.navAberta).toBeFalse();
    });

    it('o pin do tour publicado escreve o nome do destino, não uma pílula vazia', () => {
      // Estava `hotspot.label ?? ''`, e um ponto sem rótulo — que é o estado em
      // que ele NASCE — desenhava uma pílula larga com um dot e texto nenhum.
      // Um botão sem nome sobre a foto, no tour que o cliente recebe.
      //
      // Testa o método privado de propósito: ele é puro, e a alternativa seria
      // ler pixels de uma textura de canvas para provar que há texto.
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);

      const derivado = component['rotuloDo']({ label: '', targetId: 'b' });
      const proprio = component['rotuloDo']({ label: 'Porta', targetId: 'b' });
      const orfao = component['rotuloDo']({ label: '', targetId: 'sumiu' });

      expect(derivado).toBe('Cozinha');
      expect(proprio).toBe('Porta');
      expect(orfao).toBe('');
    });

    it('deixar de ter segundo ambiente fecha a lista aberta', () => {
      // Senão ela ficaria pendurada sobre a foto, listando um ambiente só.
      comPanoramas([sala('a', 'Sala', 0), sala('b', 'Cozinha', 1)]);
      component.navAberta = true;

      comPanoramas([sala('a', 'Sala', 0)]);

      expect(component.navAberta).toBeFalse();
    });
  });
});

/**
 * `resetView()` existe para o assistente guiado: avançar de ambiente tem de
 * devolver a câmera ao ângulo inicial.
 *
 * Sem ele, `loadPanorama()` troca só a textura e o OrbitControls fica no ângulo
 * do ambiente anterior — um ângulo que na foto nova não quer dizer nada, já que
 * equirretangulares de celular não compartilham orientação de bússola.
 */
describe('PanoramicViewerComponent — resetView', () => {
  let fixture: ComponentFixture<PanoramicViewerComponent>;
  let component: PanoramicViewerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanoramicViewerComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PanoramicViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  // Quem chama é um `effect`, e ele pode disparar antes do init adiado ou
  // depois do destroy. Explodir ali derrubaria a etapa inteira.
  it('antes de inicializar não explode', () => {
    expect(() => component.resetView()).not.toThrow();
  });

  it('devolve a câmera ao ponto inicial', async () => {
    fixture.detectChanges();
    await afterInit();

    const camera = component.viewerCamera!;
    camera.position.set(400, 120, -300);

    component.resetView();

    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(0, 5);
    expect(camera.position.z).toBeCloseTo(0.1, 5);
  });
});

/**
 * A superfície que a tela de visualização refeita consome (TV-8).
 *
 * Três acréscimos, todos ADITIVOS: quem não pedir nada continua com o viewer
 * que embed, wizard e captura já usam. É essa promessa que estes testes
 * guardam — o padrão de `hotspots` é 'sprites', e o toque na foto só avisa
 * quem quis ouvir.
 */
describe('PanoramicViewerComponent — superfície da tela de visualização', () => {
  let fixture: ComponentFixture<PanoramicViewerComponent>;
  let component: PanoramicViewerComponent;

  function panoramaCom(hotspots: number): Panorama {
    return {
      id: 'p1',
      roomName: 'Sala',
      imageUrl: '',
      order: 0,
      initialPanorama: true,
      measurements: [],
      originHotspots: Array.from({ length: hotspots }, (_, i) => ({
        id: `h${i}`,
        label: 'Porta',
        positionX: 0.5,
        positionY: 0.5,
        targetId: 'p2',
      })),
    };
  }

  function sprites(): THREE.Sprite[] {
    return (component as unknown as { hotspotSprites: THREE.Sprite[] }).hotspotSprites;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanoramicViewerComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PanoramicViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  describe('modo dos hotspots', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await afterInit();
    });

    it('desenha sprites por padrão — quem não pediu nada não perde nada', () => {
      component.reloadHotspots(panoramaCom(2));

      expect(sprites().length).toBe(2);
    });

    it("com 'none' não desenha sprite nenhum", () => {
      fixture.componentRef.setInput('hotspotMode', 'none');
      fixture.detectChanges();

      component.reloadHotspots(panoramaCom(2));

      expect(sprites().length).toBe(0);
    });

    it('trocar o modo com a tela montada limpa os sprites que já estavam lá', () => {
      component.reloadHotspots(panoramaCom(2));
      expect(sprites().length).toBe(2);

      // Sem o tratamento em ngOnChanges eles só sumiriam na próxima troca de
      // cômodo — e a tela ficaria com pin dobrado até lá, um sprite e um HTML.
      fixture.componentRef.setInput('hotspotMode', 'none');
      fixture.detectChanges();

      expect(sprites().length).toBe(0);
    });
  });

  describe('toque na foto', () => {
    function toque(deslocamento: number): void {
      const el: HTMLCanvasElement = fixture.nativeElement.querySelector('canvas');
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, clientY: y };

      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: x + deslocamento }));
      el.dispatchEvent(new MouseEvent('click', { ...opts, clientX: x + deslocamento }));
    }

    beforeEach(async () => {
      // O OrbitControls captura o ponteiro no pointerdown, e o browser recusa
      // capturar um pointerId que não veio de dispositivo real.
      spyOn(HTMLElement.prototype, 'setPointerCapture').and.stub();
      spyOn(HTMLElement.prototype, 'releasePointerCapture').and.stub();

      fixture.componentRef.setInput('hotspotMode', 'none');
      fixture.detectChanges();
      await afterInit();
    });

    it('avisa no toque parado', () => {
      let toques = 0;
      component.canvasTapped.subscribe(() => toques++);

      toque(0);

      expect(toques).toBe(1);
    });

    it('não avisa quando o toque foi um arrasto', () => {
      // Girar a foto é o gesto principal da tela. Se ele contasse como toque, a
      // interface sumiria e voltaria a cada movimento.
      let toques = 0;
      component.canvasTapped.subscribe(() => toques++);

      toque(40);

      expect(toques).toBe(0);
    });
  });

  it('avisa quando a foto do cômodo não carrega', async () => {
    // Uma data-URI quebrada, e não um endereço que dá 404: a falha acontece na
    // decodificação, no mesmo processo, sem depender de o servidor de teste
    // responder de um jeito ou de outro.
    //
    // Antes deste aviso, a falha só apagava o spinner: a tela ficava com a foto
    // do cômodo ANTERIOR e nada dizendo que aquilo era outro lugar.
    let falhas = 0;
    component.loadFailed.subscribe(() => falhas++);

    fixture.componentRef.setInput('panoramas', [
      { ...panoramaCom(0), imageUrl: 'data:image/png;base64,--nao-e-imagem--' },
    ]);
    fixture.detectChanges();
    await afterInit();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(falhas).toBeGreaterThan(0);
  });
});

/**
 * O modo paisagem: o arrasto quando o palco esta girado por CSS.
 *
 * A conta mora em `arrasto-girado.ts` e tem spec proprio, sem WebGL. O que
 * estes casos provam e a LIGACAO — que a entrada troca mesmo quem move a
 * camera, e que o resultado e azimute, nao elevacao.
 *
 * E a diferenca que salva o recurso. Com o aparelho deitado, o arrasto que a
 * pessoa faz na horizontal chega ao viewport como VERTICAL; se ele fosse parar
 * no angulo polar — que e grampeado — o dedo bateria numa parede meio giro
 * depois. E o sintoma engana: como a imagem tambem esta girada, o polar
 * PARECE movimento horizontal e passa num teste rapido.
 */
describe('PanoramicViewerComponent — modo paisagem', () => {
  let fixture: ComponentFixture<PanoramicViewerComponent>;
  let component: PanoramicViewerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanoramicViewerComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    fixture = TestBed.createComponent(PanoramicViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  async function deitar(): Promise<HTMLCanvasElement> {
    fixture.detectChanges();
    await afterInit();

    fixture.componentRef.setInput('rotacaoDaTela', 90);
    fixture.detectChanges();
    // O remedir e adiado um quadro de proposito — ver `aplicarRotacaoDaTela`.
    await afterInit();

    return (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
  }

  /** Onde a camera esta olhando, em coordenadas esfericas. */
  function mira(): THREE.Spherical {
    return new THREE.Spherical().setFromVector3(component.viewerCamera!.position.clone());
  }

  /** Um arrasto na VIEWPORT, do jeito que o dedo o entrega. */
  function arrastar(canvas: HTMLCanvasElement, dvx: number, dvy: number): void {
    const comum = { pointerId: 1, bubbles: true, clientX: 100, clientY: 100 };

    canvas.dispatchEvent(new PointerEvent('pointerdown', comum));
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { ...comum, clientX: 100 + dvx, clientY: 100 + dvy }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', { ...comum, clientX: 100 + dvx, clientY: 100 + dvy }),
    );
  }

  it('arrasto vertical na viewport vira AZIMUTE, e nao elevacao', async () => {
    const canvas = await deitar();
    const antes = mira();

    arrastar(canvas, 0, 120);

    const depois = mira();
    expect(Math.abs(depois.theta - antes.theta)).toBeGreaterThan(0.05);
    expect(depois.phi).toBeCloseTo(antes.phi, 6);
  });

  it('arrasto horizontal na viewport vira ELEVACAO', async () => {
    const canvas = await deitar();
    const antes = mira();

    arrastar(canvas, 120, 0);

    const depois = mira();
    expect(Math.abs(depois.phi - antes.phi)).toBeGreaterThan(0.05);
    expect(depois.theta).toBeCloseTo(antes.theta, 6);
  });

  /**
   * O caso que separa o recurso certo do que "parecia certo": deitado, a pessoa
   * gira para o lado quantas voltas quiser. Se isto passasse pelo polar, a
   * soma pararia perto de meio giro e nao chegaria nem a uma volta.
   */
  /**
   * Quanto cada passo mexeu, passo a passo.
   *
   * Nao da para somar voltas lendo a camera: `theta` sai de um `atan2` e volta
   * sempre enrolado em (-π, π]. O que distingue um eixo livre de um grampeado
   * nao e o total — e se o movimento PARA. Por isso a medida e o tamanho de
   * cada passo, e nao a soma deles.
   */
  function passos(
    canvas: HTMLCanvasElement,
    dvx: number,
    dvy: number,
    quantos: number,
    angulo: (m: THREE.Spherical) => number,
  ): number[] {
    const andados: number[] = [];
    let anterior = angulo(mira());

    for (let i = 0; i < quantos; i++) {
      arrastar(canvas, dvx, dvy);
      const agora = angulo(mira());
      andados.push(Math.abs(agora - anterior));
      anterior = agora;
    }

    return andados;
  }

  /**
   * O caso que separa o recurso certo do que "parecia certo".
   *
   * Deitado, a pessoa gira para o lado quantas voltas quiser: TODO passo anda.
   * O contraste esta no caso seguinte — o eixo que o arrasto NAO usa satura.
   */
  it('deitado, o giro lateral nao tem parede', async () => {
    const canvas = await deitar();
    // Um oitavo de volta por passo: `2π · (h/8 · 0.5) / h`.
    const passo = canvas.clientHeight / 8;

    const andados = passos(canvas, 0, passo, 10, (m) => m.theta);

    expect(andados.filter((d) => d < 0.01).length).toBe(0);
  });

  /**
   * O outro lado da mesma moeda: a elevacao SATURA, e e por isso que mandar o
   * arrasto lateral para ela deixaria o recurso quebrado de um jeito que so
   * aparece meio giro depois — quando o dedo bate na parede.
   */
  it('a elevacao satura, que e a parede que o giro lateral evita', async () => {
    const canvas = await deitar();
    const passo = canvas.clientHeight / 8;

    const andados = passos(canvas, passo, 0, 10, (m) => m.phi);

    expect(andados.filter((d) => d < 0.01).length).toBeGreaterThan(0);
    expect(andados[andados.length - 1]).toBeLessThan(0.01);
  });

  /**
   * Levantar a tela devolve a camera ao `OrbitControls`. Sem desligar o handler
   * proprio, os dois moveriam a camera no mesmo gesto.
   */
  it('voltar para a vertical desliga o arrasto girado', async () => {
    const canvas = await deitar();

    fixture.componentRef.setInput('rotacaoDaTela', 0);
    fixture.detectChanges();
    await afterInit();

    const antes = mira();
    // So o `pointermove`: sem o `pointerdown` do handler proprio nao ha gesto
    // em curso, e o do OrbitControls so escuta o `document` depois do dele.
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 400, clientY: 400 }),
    );

    const depois = mira();
    expect(depois.theta).toBeCloseTo(antes.theta, 10);
    expect(depois.phi).toBeCloseTo(antes.phi, 10);
  });
});
