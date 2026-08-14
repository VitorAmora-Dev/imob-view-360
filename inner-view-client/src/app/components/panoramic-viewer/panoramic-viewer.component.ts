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
  private initialized = false;

  ngAfterViewInit() {
    setTimeout(() => {
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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.renderer?.domElement.removeEventListener('click', this.onCanvasClick);
    this.renderer?.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer?.domElement.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onWindowResize);
    this.frameCallbacks.clear();
    this.clearHotspots();
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
        (this.sphereMesh.material as THREE.MeshBasicMaterial).map = texture;
        (this.sphereMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
        this.clearHotspots();
        this.addHotspots(panorama);
        this.loading = false;
        this.panoramaChange.emit(panorama);
      },
      undefined,
      () => { this.loading = false; }
    );
  }

  private initThreeJS() {
    const container = this.canvasContainer.nativeElement;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 1, 1100);
    this.camera.position.set(0, 0, 0.1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
      // Convert UV coords (positionX, positionY) to 3D world position inside the inverted sphere.
      // Uses Three.js SphereGeometry UV mapping: phi = positionX * 2π, theta = (1-positionY) * π
      const phi = hotspot.positionX * 2 * Math.PI;
      const theta = (1 - hotspot.positionY) * Math.PI;
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

  private createHotspotSprite(label: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;

    // Background pill — white guest-favorite-badge language over the photo
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 88, 44);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arrow icon
    ctx.fillStyle = '#222222';
    ctx.font = 'bold 36px "Inter Variable", Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⟶', 48, 48);

    // Label text
    if (label) {
      ctx.fillStyle = '#222222';
      ctx.font = '600 18px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const maxWidth = 180;
      ctx.fillText(label, 80, 48, maxWidth);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    // Scale keeps canvas aspect ratio (256:96 ≈ 8:3), sized for visibility at r=490
    sprite.scale.set(80, 30, 1);
    return sprite;
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

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (this.editMode) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObject(this.sphereMesh);
      if (hits.length > 0 && hits[0].uv) {
        // Three.js SphereGeometry has -x in its formula; scale(-1,1,1) cancels it back to +x.
        // addHotspots uses theta=(1-posY)*π while UV v maps to theta=v*π, so posY = 1-v.
        // posX maps directly: posX = u.
        this.hotspotPlaced.emit({ positionX: hits[0].uv.x, positionY: 1 - hits[0].uv.y });
      }
      return;
    }

    if (this.hotspotSprites.length === 0) return;
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
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  };

  private animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    for (const callback of this.frameCallbacks) callback();
  }
}
