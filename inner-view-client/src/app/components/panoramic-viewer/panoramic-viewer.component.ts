import { Component, Input, OnDestroy, OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit, Output, EventEmitter } from '@angular/core';
import { IonSpinner } from '@ionic/angular/standalone';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Panorama } from '../../models/virtual-tour.model';

/**
 * Deslocamento, em px, acima do qual o gesto conta como arrasto e não clique.
 * Cobre o tremor de mão sem engolir um toque curto de verdade.
 */
const DRAG_SLOP_PX = 6;

@Component({
  selector: 'app-panoramic-viewer',
  standalone: true,
  imports: [IonSpinner],
  template: `
    <div #canvasContainer class="canvas-container">
      @if (loading) {
        <div class="loading-overlay">
          <ion-spinner name="crescent"></ion-spinner>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .canvas-container {
      width: 100%;
      height: 100%;
    }

    .loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
    }

    ion-spinner {
      width: 48px;
      height: 48px;
      color: #fff;
    }
  `]
})
export class PanoramicViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef<HTMLDivElement>;

  @Input() panoramas: Panorama[] = [];
  @Input() editMode = false;
  @Output() panoramaChange = new EventEmitter<Panorama>();
  @Output() hotspotPlaced = new EventEmitter<{ positionX: number; positionY: number }>();

  loading = true;

  /**
   * Câmera do three.js, para o overlay HTML de pins da etapa 2 projetar cada
   * hotspot em coordenadas de tela. `null` até o init, que é adiado um tick.
   */
  get viewerCamera(): THREE.PerspectiveCamera | null {
    return this.initialized ? this.camera : null;
  }

  /** Tamanho do canvas em px CSS — o denominador da projeção para a tela. */
  get viewerSize(): { width: number; height: number } | null {
    if (!this.initialized) return null;
    const canvas = this.renderer.domElement;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  /**
   * Assina um callback rodado ao fim de cada frame, já com a câmera atualizada
   * pelo OrbitControls. Devolve a função que cancela.
   *
   * Deliberadamente NÃO é um `@Output`: um EventEmitter aqui dispararia change
   * detection do Angular 60 vezes por segundo. Quem assina escreve direto no
   * DOM. E é chamado de dentro deste laço, e não de um requestAnimationFrame
   * próprio, para que os pins e a foto andem no mesmo frame — em laços
   * separados eles saem de sincronia e os pins arrastam atrás no giro rápido.
   */
  onFrame(callback: () => void): () => void {
    this.frameCallbacks.add(callback);
    return () => {
      this.frameCallbacks.delete(callback);
    };
  }

  /**
   * O par `(u, v)` do panorama sob um ponto da tela, em coordenadas de cliente.
   * `null` antes do init ou quando o raio não acerta a esfera.
   *
   * O `v` sai já na convenção do backend (`positionY`, com 0 no TOPO), que é a
   * mesma de `hotspotPlaced` e do `WizardHotspot` — ver a cadeia inteira em
   * `hotspot-projection.ts`.
   *
   * É público porque o arraste de pin (B9) precisa da MESMA conta que o clique:
   * um ponto arrastado tem de parar exatamente onde um clique no mesmo pixel o
   * colocaria. Duas implementações da conversão divergiriam, e o sintoma seria
   * o pin escapando do dedo — sem erro nenhum no console.
   */
  uvAt(clientX: number, clientY: number): { u: number; v: number } | null {
    if (!this.initialized) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.sphereMesh);
    const uv = hits[0]?.uv;

    // Three.js SphereGeometry has -x in its formula; scale(-1,1,1) cancels it
    // back to +x, so positionX = u directly. The vertical axis flips once:
    // the geometry writes uv.y = 1 at the top pole, and the backend wants 0
    // there.
    return uv ? { u: uv.x, v: 1 - uv.y } : null;
  }

  private readonly frameCallbacks = new Set<() => void>();
  private pointerDownAt: { x: number; y: number } | null = null;
  private suppressNextClick = false;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private sphereMesh!: THREE.Mesh;
  private hotspotSprites: THREE.Sprite[] = [];
  private hotspotTargetMap = new Map<THREE.Sprite, string>();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private animationFrameId: number | null = null;
  private initTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  ngAfterViewInit() {
    this.initTimeout = setTimeout(() => {
      this.initTimeout = null;
      this.initThreeJS();
      this.initialized = true;
      if (this.panoramas.length > 0) {
        this.loadInitialPanorama();
      }
    }, 0);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['panoramas'] && !changes['panoramas'].firstChange && this.initialized) {
      if (this.panoramas.length > 0) {
        this.loadInitialPanorama();
      }
    }
    if (changes['editMode'] && this.initialized) {
      this.renderer.domElement.style.cursor = this.editMode ? 'crosshair' : 'grab';
    }
  }

  ngOnDestroy() {
    // O init é adiado um tick, e o componente pode morrer antes de ele rodar —
    // a etapa 2 monta o viewer dentro de um `@if` que some quando a última cena
    // válida sai. Sem cancelar, o timeout ainda dispararia `initThreeJS()`
    // sobre um container já desanexado, criando um contexto WebGL órfão, um
    // laço de rAF que ninguém para e um listener de resize que ninguém tira —
    // exatamente os vazamentos que o `forceContextLoss()` abaixo existe para
    // evitar.
    if (this.initTimeout !== null) {
      clearTimeout(this.initTimeout);
      this.initTimeout = null;
    }
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.renderer?.domElement.removeEventListener('click', this.onCanvasClick);
    this.renderer?.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer?.domElement.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onWindowResize);
    this.frameCallbacks.clear();
    this.clearHotspots();
    // A esfera também é nossa: geometria, material e a textura carregada.
    const material = this.sphereMesh?.material as THREE.MeshBasicMaterial | undefined;
    material?.map?.dispose();
    material?.dispose();
    this.sphereMesh?.geometry.dispose();
    this.controls?.dispose();
    // `dispose()` solta os recursos mas não o contexto WebGL em si, e o browser
    // só mantém ~16 vivos. A etapa 2 monta e desmonta este componente a cada
    // ida e volta entre etapas do wizard, então sem isto o canvas morre com
    // "too many active WebGL contexts" depois de algumas navegações.
    this.renderer?.forceContextLoss();
    this.renderer?.dispose();
  }

  navigateTo(targetId: string) {
    const target = this.panoramas.find(p => p.id === targetId);
    if (target) {
      this.loadPanorama(target);
    }
  }

  reloadHotspots(panorama: Panorama) {
    this.clearHotspots();
    this.addHotspots(panorama);
  }

  private loadInitialPanorama() {
    const initial = this.panoramas.find(p => p.initialPanorama)
      ?? this.panoramas.reduce((a, b) => a.order <= b.order ? a : b);
    this.loadPanorama(initial);
  }

  private loadPanorama(panorama: Panorama) {
    this.loading = true;
    const dataUri = panorama.imageData.startsWith('data:')
      ? panorama.imageData
      : `data:image/jpeg;base64,${panorama.imageData}`;

    const loader = new THREE.TextureLoader();
    loader.load(
      dataUri,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        // An equirect wraps the sphere very unevenly: near the poles a row of
        // texels is squeezed into almost no screen width, so isotropic mip
        // selection picks a coarse level and the ceiling and floor go soft.
        // This is a texture-filtering blur, not a stitching one.
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

        const material = this.sphereMesh.material as THREE.MeshBasicMaterial;
        // A textura anterior tem de ser solta ANTES de perder a referência.
        // `map = novaTextura` só troca o ponteiro: a antiga continua ocupando
        // memória de GPU até o contexto morrer, e uma equirretangular de
        // 8192×4096 são ~128 MB descomprimidos. Trocar de ambiente algumas
        // vezes bastava para chegar em CONTEXT_LOST_WEBGL e a tela ficar preta.
        material.map?.dispose();
        material.map = texture;
        material.needsUpdate = true;
        this.clearHotspots();
        this.addHotspots(panorama);
        this.loading = false;
        this.panoramaChange.emit(panorama);
      },
      undefined,
      () => { this.loading = false; }
    );
  }

  /**
   * Quantos pixels de verdade por pixel de CSS.
   *
   * Sem isto o `WebGLRenderer` fica em 1, que é o padrão do three.js, e num
   * celular de DPR 3 o viewer desenha **11% dos pixels que a tela tem** —
   * medido: buffer de 358×269 numa tela de 1074×807. O compositor estica o
   * resto. Não é a foto que está ruim nem a costura: é o viewer renderizando em
   * um terço da resolução linear e sendo ampliado.
   *
   * O teto de 2 não é timidez. DPR 3 custaria 9× os pixels de DPR 1, e este
   * viewer não desenha um cubo: é uma esfera de 120×80 segmentos com uma
   * equirretangular que pode ter 8192px de largura, num GPU de celular. A 2×
   * já são 4× os pixels, e é o degrau em que a diferença ainda se vê a olho —
   * de 2 para 3 quase não se vê, e o custo é o mesmo tanto de novo.
   */
  private pixelRatioAlvo(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  private initThreeJS() {
    const container = this.canvasContainer.nativeElement;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 1, 1100);
    this.camera.position.set(0, 0, 0.1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.pixelRatioAlvo());
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableZoom = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;

    // UVs are interpolated linearly across each face, so coarse segments bend
    // straight lines — 60×40 spans 6° per segment, enough to visibly curve a
    // wall corner. Denser costs nothing at this triangle count.
    const geometry = new THREE.SphereGeometry(500, 120, 80);
    geometry.scale(-1, 1, 1);
    this.sphereMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    this.scene.add(this.sphereMesh);

    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onWindowResize);

    this.animate();
  }

  private addHotspots(panorama: Panorama) {
    for (const hotspot of panorama.originHotspots) {
      // De (positionX, positionY) para a posição 3D dentro da esfera invertida.
      //
      // `theta` é medido a partir de +Y, e `positionY = 0` é o TOPO — daí a
      // multiplicação direta. A cadeia, que é fácil de derivar ao contrário:
      // `SphereGeometry` grava `uv.y = 1 - v_geom` com `v_geom = 0` no polo de
      // cima, e `onCanvasClick` emite `positionY = 1 - uv.y`. Os dois "1 -" se
      // cancelam: `positionY = v_geom`, e o theta da geometria é `v_geom * π`.
      //
      // Estava `(1 - positionY) * π` — que espelhava no equador exatamente o
      // ponto que o clique deste mesmo componente havia gravado. Passava
      // despercebido porque o erro é ZERO no equador, que é onde caem tanto o
      // seed quanto o clique de teste típico, no centro do canvas.
      const phi = hotspot.positionX * 2 * Math.PI;
      const theta = hotspot.positionY * Math.PI;
      const r = 490;
      const x = r * Math.cos(phi) * Math.sin(theta);
      const y = r * Math.cos(theta);
      const z = r * Math.sin(phi) * Math.sin(theta);

      const sprite = this.createHotspotSprite(hotspot.label ?? '');
      sprite.position.set(x, y, z);
      this.scene.add(sprite);
      this.hotspotSprites.push(sprite);
      this.hotspotTargetMap.set(sprite, hotspot.targetId);
    }
  }

  private clearHotspots() {
    for (const sprite of this.hotspotSprites) {
      this.scene.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      sprite.material.dispose();
    }
    this.hotspotSprites = [];
    this.hotspotTargetMap.clear();
  }

  /**
   * O pin que o visitante vê, com a MESMA identidade do pin do wizard.
   *
   * Era uma pílula branca com seta preta, enquanto o corretor marca os pontos
   * numa etapa cujo pin é escuro com dot na cor da marca — duas linguagens para
   * a mesma coisa, e quem monta o tour não reconhecia o que tinha publicado.
   *
   * As cores saem dos tokens `--tw-pin-bg` e `--tw-brand` lidos do documento, e
   * não de hex copiado. Isto aqui é canvas, não CSS: ler a fonte é a única
   * forma de não virar uma terceira cópia da identidade, que é o tipo de
   * duplicação que já custou um bug de eixo neste mesmo arquivo. Os fallbacks
   * cobrem o caso de a folha do wizard não estar carregada.
   */
  private createHotspotSprite(label: string): THREE.Sprite {
    // Desenha em coordenadas lógicas de 256×96 e guarda o dobro de texels.
    //
    // O sprite ocupa ~280px FÍSICOS numa tela de celular (14° de largura num
    // FOV horizontal de ~39°, a 2× de pixel ratio). Uma textura de 256 seria
    // ampliada justo onde mora o texto. 512 cobre isso com folga; acima disso
    // o mipmap devolve o borrão que a supera­mostragem tinha comprado, porque
    // o sprite passa a ser minificado demais.
    const ESCALA = 2;
    const L = 256;
    const A = 96;

    const canvas = document.createElement('canvas');
    canvas.width = L * ESCALA;
    canvas.height = A * ESCALA;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ESCALA, ESCALA);

    const raiz = getComputedStyle(document.documentElement);
    const token = (nome: string, padrao: string) =>
      raiz.getPropertyValue(nome).trim() || padrao;
    const marca = token('--tw-brand', '#ff385c');

    // Halo escuro por fora, antes de tudo. Uma borda vermelha sobre um teto
    // branco ou uma parede clara desaparece; o halo é o que dá silhueta sobre
    // foto QUALQUER, que é a condição real deste pin — ele flutua sobre uma
    // imagem que ninguém controla.
    ctx.save();
    ctx.shadowColor = token('--tw-pin-halo-canvas', 'rgba(0, 0, 0, 0.55)');
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(10, 10, L - 20, A - 20, (A - 20) / 2);
    ctx.fillStyle = token('--tw-pin-bg-canvas', 'rgba(11, 13, 18, 0.95)');
    ctx.fill();
    ctx.restore();

    // A borda é da marca, e é ela que faz o pin ser notado de longe.
    //
    // A alternativa era pintar a PÍLULA inteira de vermelho. Medi as duas:
    // branco sobre a Rausch #ff385c dá 3,5:1, abaixo do 4,5:1 que a WCAG pede
    // para texto normal; branco sobre esta pílula dá ~17:1. Como o pedido é
    // justamente enxergar melhor, o vermelho entra na silhueta e o texto fica
    // onde se lê. Ver §11 das notas do sprint.
    ctx.beginPath();
    ctx.roundRect(10, 10, L - 20, A - 20, (A - 20) / 2);
    ctx.strokeStyle = marca;
    ctx.lineWidth = 5;
    ctx.stroke();

    // O dot, maior que antes: é a única mancha cheia da cor da marca.
    ctx.beginPath();
    ctx.arc(52, A / 2, 13, 0, Math.PI * 2);
    ctx.fillStyle = marca;
    ctx.fill();

    if (label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 28px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Reticências de verdade. O `maxWidth` do `fillText` ESPREME a fonte para
      // caber, e um nome comprido sai condensado e ilegível; o pin do wizard
      // corta com ellipsis, e aqui é a mesma promessa.
      ctx.fillText(this.comReticencias(ctx, label, L - 78 - 20), 78, A / 2 + 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    // SEM isto o pin sai lavado, e foi o que apareceu no celular: o renderer
    // trabalha com `outputColorSpace = 'srgb'`, então uma textura que não se
    // declara sRGB é lida como se fosse linear e convertida de novo na saída.
    // Medido: #ff385c chegava à tela como #ff81a2, um rosa claro, e a pílula
    // #101218 como #474b56, um cinza médio. A foto já fazia isso certo desde
    // sempre (`loadPanorama`); só o sprite ficou de fora.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    // Mantém a proporção 8:3 do canvas. 1,5× o tamanho anterior: a 80×30 o pin
    // dava ~28px de altura no celular, e o piso de alvo da WCAG é 44.
    sprite.scale.set(120, 45, 1);
    return sprite;
  }

  /** Corta o texto e põe reticências, como o `text-overflow` do pin HTML. */
  private comReticencias(
    ctx: CanvasRenderingContext2D,
    texto: string,
    limite: number,
  ): string {
    if (ctx.measureText(texto).width <= limite) return texto;

    let corte = texto.length;
    while (corte > 1 && ctx.measureText(`${texto.slice(0, corte)}…`).width > limite) {
      corte--;
    }
    return `${texto.slice(0, corte)}…`;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  /**
   * Decide se o `click` que vem a seguir é clique ou sobra de arrasto.
   *
   * O OrbitControls gira no arrasto, e o browser dispara `click` ao soltar
   * porque o down e o up caíram no mesmo elemento. Sem esta trava, girar o
   * panorama em `editMode` criaria um hotspot a cada solta.
   */
  private readonly onPointerUp = (event: PointerEvent) => {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    this.suppressNextClick = Math.hypot(dx, dy) > DRAG_SLOP_PX;
  };

  private readonly onCanvasClick = (event: MouseEvent) => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    if (this.editMode) {
      const uv = this.uvAt(event.clientX, event.clientY);
      if (uv) {
        this.hotspotPlaced.emit({ positionX: uv.u, positionY: uv.v });
      }
      return;
    }

    if (this.hotspotSprites.length === 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.hotspotSprites);
    if (intersects.length > 0) {
      const sprite = intersects[0].object as THREE.Sprite;
      const targetId = this.hotspotTargetMap.get(sprite);
      if (targetId) {
        this.navigateTo(targetId);
      }
    }
  };

  private readonly onWindowResize = () => {
    const container = this.canvasContainer.nativeElement;
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    // O DPR também muda aqui, e não só no primeiro desenho: arrastar a janela
    // de um monitor comum para um Retina dispara `resize` com um
    // `devicePixelRatio` novo. Sem reaplicar, a tela boa herda a resolução da
    // ruim e não há nada na interface que explique por quê.
    this.renderer.setPixelRatio(this.pixelRatioAlvo());
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  };

  private animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    for (const callback of this.frameCallbacks) callback();
  }
}
