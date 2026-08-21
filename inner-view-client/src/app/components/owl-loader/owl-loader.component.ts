import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Único valor visual que pode ser customizado no loader. */
export const OWL_LOADER_COLOR = '#0454ED';

const OWL_MODEL_URL = 'assets/owl-loader/logo-coruja-cabeca-3d-animada.glb';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const START_HOLD_SECONDS = 0.35;
const RISE_SECONDS = 0.5;
const ROTATION_SECONDS = 2;
const LIFT_HEIGHT = 0.55 * 1.65;
const ROTATION_TURNS = 3;
const DESCENT_SECONDS = 0.4;
const END_HOLD_SECONDS = 0.35;
const IMPACT_INTENSITY = 0.35;

type ColorableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
};

interface HeadSideMaterialState {
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  roughness: number;
  opacity: number;
  depthWrite: boolean;
}

@Component({
  selector: 'app-owl-loader',
  standalone: true,
  templateUrl: './owl-loader.component.html',
  styleUrls: ['./owl-loader.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
  },
})
export class OwlLoaderComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasHost', { static: true })
  private canvasHost!: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  private readonly clock = new THREE.Clock(false);
  private readonly owlColor = new THREE.Color(OWL_LOADER_COLOR);
  private readonly seamForward = new THREE.Vector3(0, 0, 1);

  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private resizeObserver?: ResizeObserver;
  private motionPreference?: MediaQueryList;
  private animationFrameId: number | null = null;
  private destroyed = false;

  private mixer?: THREE.AnimationMixer;
  private action?: THREE.AnimationAction;
  private activeClip?: THREE.AnimationClip;
  private motionRoot?: THREE.Group;
  private baseMotionPosition?: THREE.Vector3;
  private headPivot?: THREE.Object3D;
  private basePosition?: THREE.Vector3;
  private bodyRoot?: THREE.Object3D;
  private baseBodyPosition?: THREE.Vector3;
  private baseBodyQuaternion?: THREE.Quaternion;
  private leftWingMotion?: THREE.Group;
  private rightWingMotion?: THREE.Group;
  private baseLeftWingPosition?: THREE.Vector3;
  private baseRightWingPosition?: THREE.Vector3;
  private leftEyeMotion?: THREE.Group;
  private rightEyeMotion?: THREE.Group;
  private baseLeftEyeScale?: THREE.Vector3;
  private baseRightEyeScale?: THREE.Vector3;
  private featherGroup?: THREE.Group;
  private impactWaveGroup?: THREE.Group;

  private readonly featherMeshes: Array<
    THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>
  > = [];
  private readonly impactWaves: Array<
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  > = [];
  private readonly headSideMaterialStates: HeadSideMaterialState[] = [];

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.initializeThree());
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.motionPreference?.removeEventListener('change', this.onMotionPreferenceChange);

    this.clock.stop();
    this.action?.stop();
    this.mixer?.stopAllAction();
    if (this.mixer && this.motionRoot) this.mixer.uncacheRoot(this.motionRoot);

    if (this.scene) this.disposeObjectTree(this.scene);

    // O contexto precisa ser perdido antes do dispose: o navegador mantém um
    // limite baixo de contextos WebGL vivos entre montagens do componente.
    this.renderer?.renderLists.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();

    this.featherMeshes.length = 0;
    this.impactWaves.length = 0;
    this.headSideMaterialStates.length = 0;
  }

  private initializeThree(): void {
    const host = this.canvasHost.nativeElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 0.15, 17.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x252a33, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(4, 5, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db5d5, 2.2);
    rim.position.set(-5, 2, -4);
    this.scene.add(rim);

    this.motionPreference = window.matchMedia(REDUCED_MOTION_QUERY);
    this.motionPreference.addEventListener('change', this.onMotionPreferenceChange);
    this.resizeObserver = new ResizeObserver(this.onContainerResize);
    this.resizeObserver.observe(host);
    window.addEventListener('resize', this.onWindowResize);
    this.resizeRenderer();

    new GLTFLoader().load(
      OWL_MODEL_URL,
      (gltf) => this.onModelLoaded(gltf),
      undefined,
      () => this.renderOnce(),
    );

    this.syncMotionPreference();
  }

  private onModelLoaded(gltf: GLTF): void {
    if (this.destroyed || !this.scene) {
      this.disposeObjectTree(gltf.scene);
      return;
    }

    this.applyOwlColor(gltf.scene);

    const headPivot = gltf.scene.getObjectByName('Pivo_Pescoco_Cabeca');
    const bodyRoot = gltf.scene.getObjectByName('Corpo_Fixo');
    if (!headPivot || !bodyRoot) {
      this.disposeObjectTree(gltf.scene);
      return;
    }

    this.motionRoot = new THREE.Group();
    this.motionRoot.name = 'Movimento_Coruja_Inteira_Preview';
    this.motionRoot.add(gltf.scene);
    this.scene.add(this.motionRoot);
    this.baseMotionPosition = this.motionRoot.position.clone();

    this.mixer = new THREE.AnimationMixer(this.motionRoot);
    this.headPivot = headPivot;
    this.basePosition = headPivot.position.clone();
    this.bodyRoot = bodyRoot;
    this.baseBodyPosition = bodyRoot.position.clone();
    this.baseBodyQuaternion = bodyRoot.quaternion.clone();

    if (!this.setupEyeMotion() || !this.setupWingMotion()) {
      this.renderOnce();
      return;
    }

    this.setupHeadSeamMaterials();
    this.createFeathers(gltf.scene);
    this.createImpactWaves(gltf.scene);
    this.buildAnimation();
    this.syncMotionPreference();
    this.renderOnce();
  }

  /** Recolore o GLB inteiro, inclusive os olhos, a partir da constante única. */
  private applyOwlColor(model: THREE.Object3D): void {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const recolor = (source: THREE.Material): THREE.Material => {
        const material = source.clone() as ColorableMaterial;
        material.color?.copy(this.owlColor);
        if (material.emissive && material.emissive.getHex() !== 0) {
          material.emissive.copy(this.owlColor);
        }
        material.needsUpdate = true;
        return material;
      };

      object.material = Array.isArray(object.material)
        ? object.material.map(recolor)
        : recolor(object.material);
    });
  }

  private setupWingMotion(): boolean {
    if (!this.bodyRoot) return false;

    const parts = this.bodyRoot.children
      .filter((child) => child.name.startsWith('Corpo_Fixo_Parte_'))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (parts.length < 2) return false;

    this.leftWingMotion = new THREE.Group();
    this.leftWingMotion.name = 'Movimento_Asa_Esquerda';
    this.rightWingMotion = new THREE.Group();
    this.rightWingMotion.name = 'Movimento_Asa_Direita';
    this.bodyRoot.add(this.leftWingMotion, this.rightWingMotion);

    this.leftWingMotion.attach(parts[0]);
    parts.slice(1).forEach((part) => this.rightWingMotion?.attach(part));
    this.baseLeftWingPosition = this.leftWingMotion.position.clone();
    this.baseRightWingPosition = this.rightWingMotion.position.clone();
    return true;
  }

  private setupEyeMotion(): boolean {
    if (!this.headPivot) return false;

    const headArt = this.headPivot.getObjectByName('Cabeca_3D');
    const leftEye = this.headPivot.getObjectByName('Cabeca_3D_Parte_02');
    const rightEye = this.headPivot.getObjectByName('Cabeca_3D_Parte_03');
    if (!headArt || !leftEye || !rightEye) return false;

    const eyeCenter = (eye: THREE.Object3D): THREE.Vector3 => {
      const bounds = new THREE.Box3();
      eye.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox);
      });
      return bounds.getCenter(new THREE.Vector3());
    };

    this.leftEyeMotion = new THREE.Group();
    this.leftEyeMotion.name = 'Movimento_Olho_Esquerdo';
    this.leftEyeMotion.position.copy(eyeCenter(leftEye));
    this.rightEyeMotion = new THREE.Group();
    this.rightEyeMotion.name = 'Movimento_Olho_Direito';
    this.rightEyeMotion.position.copy(eyeCenter(rightEye));
    headArt.add(this.leftEyeMotion, this.rightEyeMotion);
    this.leftEyeMotion.attach(leftEye);
    this.rightEyeMotion.attach(rightEye);
    this.baseLeftEyeScale = this.leftEyeMotion.scale.clone();
    this.baseRightEyeScale = this.rightEyeMotion.scale.clone();
    return true;
  }

  private setupHeadSeamMaterials(): void {
    if (!this.headPivot) return;

    const seen = new Set<string>();
    this.headPivot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (
          !(material instanceof THREE.MeshStandardMaterial)
          || material.name !== 'Laterais_Azul_0454ED'
          || seen.has(material.uuid)
        ) return;

        seen.add(material.uuid);
        this.headSideMaterialStates.push({
          material,
          color: material.color.clone(),
          emissive: material.emissive.clone(),
          emissiveIntensity: material.emissiveIntensity,
          roughness: material.roughness,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        });
        material.transparent = true;
        material.needsUpdate = true;
      });
    });
  }

  private createFeathers(model: THREE.Object3D): void {
    this.featherGroup = new THREE.Group();
    this.featherGroup.name = 'Penas_Vento_Preview';

    const shape = new THREE.Shape();
    shape.moveTo(0, -0.15);
    shape.bezierCurveTo(0.11, -0.04, 0.1, 0.12, 0, 0.17);
    shape.bezierCurveTo(-0.08, 0.09, -0.08, -0.05, 0, -0.15);
    const geometry = new THREE.ShapeGeometry(shape, 12);

    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: OWL_LOADER_COLOR,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      });
      const feather = new THREE.Mesh(geometry, material);
      feather.name = `Mini_Pena_${index + 1}`;
      feather.visible = false;
      feather.userData['index'] = index;
      this.featherGroup.add(feather);
      this.featherMeshes.push(feather);
    }
    model.add(this.featherGroup);
  }

  private createRibbonGeometry(
    points: Array<[number, number]>,
    width: number,
    samples = 52,
  ): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
      false,
      'centripetal',
    );
    const positions: number[] = [];
    const indices: number[] = [];

    for (let index = 0; index <= samples; index += 1) {
      const progress = index / samples;
      const point = curve.getPoint(progress);
      const tangent = curve.getTangent(progress).normalize();
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0);
      const taper = Math.max(0.035, Math.pow(Math.sin(Math.PI * progress), 0.42));
      const halfWidth = width * taper * 0.5;
      positions.push(
        point.x + normal.x * halfWidth,
        point.y + normal.y * halfWidth,
        0,
        point.x - normal.x * halfWidth,
        point.y - normal.y * halfWidth,
        0,
      );

      if (index < samples) {
        const offset = index * 2;
        indices.push(
          offset,
          offset + 1,
          offset + 2,
          offset + 1,
          offset + 3,
          offset + 2,
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private createImpactWaves(model: THREE.Object3D): void {
    this.impactWaveGroup = new THREE.Group();
    this.impactWaveGroup.name = 'Ondas_Impacto_Preview';

    const impactShapes: Array<Array<[number, number]>> = [
      [[0, -0.22], [0.006, -0.11], [0.01, 0], [0.007, 0.11], [0, 0.22]],
      [[0.09, -0.25], [0.098, -0.125], [0.102, 0], [0.098, 0.125], [0.09, 0.25]],
    ];
    impactShapes.forEach((points, index) => {
      const geometry = this.createRibbonGeometry(points, 0.04 - index * 0.002, 42);
      const material = new THREE.MeshBasicMaterial({
        color: OWL_LOADER_COLOR,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      });
      const wave = new THREE.Mesh(geometry, material);
      wave.name = `Onda_Impacto_${index + 1}`;
      wave.visible = false;
      wave.userData['delay'] = index * 0.022;
      wave.userData['indexCount'] = geometry.index?.count ?? 0;
      geometry.setDrawRange(0, 0);
      this.impactWaveGroup?.add(wave);
      this.impactWaves.push(wave);
    });
    model.add(this.impactWaveGroup);
  }

  private buildAnimation(): void {
    if (
      !this.mixer
      || !this.headPivot
      || !this.basePosition
      || !this.bodyRoot
      || !this.baseBodyPosition
      || !this.baseBodyQuaternion
      || !this.leftWingMotion
      || !this.rightWingMotion
      || !this.baseLeftWingPosition
      || !this.baseRightWingPosition
      || !this.leftEyeMotion
      || !this.rightEyeMotion
      || !this.baseLeftEyeScale
      || !this.baseRightEyeScale
      || !this.motionRoot
      || !this.baseMotionPosition
    ) return;

    const movementStart = START_HOLD_SECONDS;
    const launchDuration = Math.min(0.18, RISE_SECONDS * 0.35);
    const launchEnd = movementStart + launchDuration;
    const riseEnd = movementStart + RISE_SECONDS;
    const rotationStart = launchEnd;
    const rotationEnd = rotationStart + ROTATION_SECONDS;
    const descentStart = rotationEnd - DESCENT_SECONDS;
    const duration = rotationEnd + END_HOLD_SECONDS;
    const independentRiseDuration = riseEnd - launchEnd;
    const positionTimes = [
      0,
      movementStart,
      launchEnd,
      launchEnd + independentRiseDuration * 0.35,
      launchEnd + independentRiseDuration * 0.72,
      riseEnd,
      descentStart,
      descentStart + DESCENT_SECONDS * 0.35,
      descentStart + DESCENT_SECONDS * 0.75,
      rotationEnd,
      duration,
    ];
    const rotationTimes = [0, rotationStart];
    const angles = [0, 0];
    const rotationSteps = ROTATION_TURNS * 4;
    for (let step = 1; step <= rotationSteps; step += 1) {
      rotationTimes.push(rotationStart + ROTATION_SECONDS * (step / rotationSteps));
      angles.push(step * Math.PI / 2);
    }
    rotationTimes.push(duration);
    angles.push(ROTATION_TURNS * Math.PI * 2);

    const lifts = [
      0,
      0,
      0,
      LIFT_HEIGHT * 0.18,
      LIFT_HEIGHT * 0.72,
      LIFT_HEIGHT,
      LIFT_HEIGHT,
      LIFT_HEIGHT * 0.82,
      LIFT_HEIGHT * 0.3,
      0,
      0,
    ];
    const positions: number[] = [];
    const rotations: number[] = [];
    positionTimes.forEach((_, index) => {
      positions.push(
        this.basePosition!.x,
        this.basePosition!.y + lifts[index],
        this.basePosition!.z,
      );
    });
    rotationTimes.forEach((_, index) => rotations.push(...this.quaternionAt(angles[index])));

    this.bodyRoot.position.copy(this.baseBodyPosition);
    this.bodyRoot.quaternion.copy(this.baseBodyQuaternion);
    this.leftWingMotion.position.copy(this.baseLeftWingPosition);
    this.rightWingMotion.position.copy(this.baseRightWingPosition);
    this.leftEyeMotion.scale.copy(this.baseLeftEyeScale);
    this.rightEyeMotion.scale.copy(this.baseRightEyeScale);
    this.motionRoot.position.copy(this.baseMotionPosition);
    this.motionRoot.scale.setScalar(1);

    const tracks: THREE.KeyframeTrack[] = [
      new THREE.VectorKeyframeTrack(
        `${this.headPivot.name}.position`,
        positionTimes,
        positions,
        THREE.InterpolateLinear,
      ),
      new THREE.QuaternionKeyframeTrack(
        `${this.headPivot.name}.quaternion`,
        rotationTimes,
        rotations,
        THREE.InterpolateLinear,
      ),
    ];

    const blinkLead = Math.min(0.06, DESCENT_SECONDS * 0.15);
    const blinkRecovery = Math.min(0.16, END_HOLD_SECONDS * 0.5);
    const eyeTimes = [
      0,
      rotationEnd - blinkLead,
      rotationEnd,
      rotationEnd + blinkRecovery * 0.45,
      rotationEnd + blinkRecovery,
      duration,
    ];
    const eyeOpen = [1, 1, 0.7, 0.84, 1, 1];
    const leftEyeScales: number[] = [];
    const rightEyeScales: number[] = [];
    eyeOpen.forEach((amount) => {
      leftEyeScales.push(
        this.baseLeftEyeScale!.x,
        this.baseLeftEyeScale!.y * amount,
        this.baseLeftEyeScale!.z,
      );
      rightEyeScales.push(
        this.baseRightEyeScale!.x,
        this.baseRightEyeScale!.y * amount,
        this.baseRightEyeScale!.z,
      );
    });
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${this.leftEyeMotion.name}.scale`,
        eyeTimes,
        leftEyeScales,
        THREE.InterpolateLinear,
      ),
      new THREE.VectorKeyframeTrack(
        `${this.rightEyeMotion.name}.scale`,
        eyeTimes,
        rightEyeScales,
        THREE.InterpolateLinear,
      ),
    );

    const landingStart = rotationEnd - DESCENT_SECONDS * 0.35;
    const rootTimes = [
      0,
      movementStart,
      movementStart + launchDuration * 0.3,
      movementStart + launchDuration * 0.7,
      launchEnd,
      riseEnd,
      descentStart,
      landingStart,
      landingStart + (rotationEnd - landingStart) * 0.55,
      rotationEnd,
      rotationEnd + END_HOLD_SECONDS * 0.3,
      rotationEnd + END_HOLD_SECONDS * 0.62,
      duration,
    ];
    const rootOffsets = [
      0,
      0,
      0.025,
      0.095,
      0.13,
      0.13,
      0.13,
      0.13,
      0.055,
      -0.045,
      0.045,
      -0.014,
      0,
    ];
    const rootPositions: number[] = [];
    rootTimes.forEach((_, index) => {
      rootPositions.push(
        this.baseMotionPosition!.x,
        this.baseMotionPosition!.y + rootOffsets[index],
        this.baseMotionPosition!.z,
      );
    });
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${this.motionRoot.name}.position`,
        rootTimes,
        rootPositions,
        THREE.InterpolateLinear,
      ),
    );

    const wingTimes = [
      0,
      movementStart,
      launchEnd,
      launchEnd + independentRiseDuration * 0.35,
      launchEnd + independentRiseDuration * 0.72,
      riseEnd,
      descentStart,
      descentStart + DESCENT_SECONDS * 0.32,
      descentStart + DESCENT_SECONDS * 0.75,
      rotationEnd,
      duration,
    ];
    const wingOpen = [0, 0, 0, 0.18, 0.72, 1, 1, 0.82, 0.3, 0, 0];
    const leftWingPositions: number[] = [];
    const rightWingPositions: number[] = [];
    wingOpen.forEach((amount) => {
      leftWingPositions.push(
        this.baseLeftWingPosition!.x - 0.12 * amount,
        this.baseLeftWingPosition!.y + 0.045 * amount,
        this.baseLeftWingPosition!.z,
      );
      rightWingPositions.push(
        this.baseRightWingPosition!.x + 0.07 * amount,
        this.baseRightWingPosition!.y + 0.012 * amount,
        this.baseRightWingPosition!.z,
      );
    });
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${this.leftWingMotion.name}.position`,
        wingTimes,
        leftWingPositions,
        THREE.InterpolateLinear,
      ),
      new THREE.VectorKeyframeTrack(
        `${this.rightWingMotion.name}.position`,
        wingTimes,
        rightWingPositions,
        THREE.InterpolateLinear,
      ),
    );

    this.activeClip = new THREE.AnimationClip('Cabeca_Giro_360_Preview', duration, tracks);
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(this.activeClip);
    this.action.setLoop(THREE.LoopRepeat, Infinity);
    this.action.timeScale = 1;
    this.action.play();
  }

  private quaternionAt(angle: number): [number, number, number, number] {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle,
    );
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
  }

  private updateFeathers(): void {
    if (!this.action || !this.featherGroup || !this.basePosition || !this.headPivot) {
      this.featherMeshes.forEach((feather) => { feather.visible = false; });
      return;
    }

    const riseEnd = START_HOLD_SECONDS + RISE_SECONDS;
    const headCenterX = this.headPivot.position.x;
    const headCenterY = this.headPivot.position.y + 1.25;
    const bursts = [
      { start: riseEnd + 0.05, duration: 0.31, side: -1, y: 0.08, size: 1.08 },
      { start: riseEnd + 0.15, duration: 0.42, side: 1, y: -0.25, size: 1.2 },
      { start: riseEnd + 0.15, duration: 0.42, side: 1, y: 0.27, size: 1.08 },
    ];

    this.featherMeshes.forEach((feather, index) => {
      const burst = bursts[index];
      const progress = (this.action!.time - burst.start) / burst.duration;
      if (progress <= 0 || progress >= 1) {
        feather.visible = false;
        return;
      }

      feather.visible = true;
      feather.position.set(
        headCenterX + burst.side * (1.45 + progress * 0.75)
          + IMPACT_INTENSITY * progress * 0.18,
        headCenterY + burst.y + Math.sin(Math.PI * progress) * 0.36 + progress * 0.28,
        0.72 + index * 0.012,
      );
      feather.rotation.set(
        progress * 1.1,
        progress * burst.side * 0.65,
        burst.side * (0.35 + progress * 3.1),
      );
      feather.scale.setScalar(burst.size * (0.9 + Math.sin(Math.PI * progress) * 0.14));
      feather.material.opacity = Math.sin(Math.PI * progress) * 0.9;
    });
  }

  private updateImpactWaves(): void {
    const hideWaves = (): void => {
      this.impactWaves.forEach((wave) => {
        wave.visible = false;
        wave.geometry.setDrawRange(0, 0);
      });
    };

    if (!this.action || !this.impactWaveGroup || !this.basePosition) {
      hideWaves();
      return;
    }

    const launchDuration = Math.min(0.18, RISE_SECONDS * 0.35);
    const launchEnd = START_HOLD_SECONDS + launchDuration;
    const rotationEnd = launchEnd + ROTATION_SECONDS;
    const impactStart = rotationEnd - 0.005;
    const impactDuration = 0.28;

    this.impactWaveGroup.position.set(
      this.basePosition.x + 0.58,
      this.basePosition.y - 3,
      0.78,
    );
    this.impactWaveGroup.rotation.z = -0.64;
    this.impactWaveGroup.scale.setScalar(1.12);

    this.impactWaves.forEach((wave, index) => {
      const delay = Number(wave.userData['delay']);
      const indexCount = Number(wave.userData['indexCount']);
      const localProgress = (this.action!.time - impactStart - delay) / impactDuration;
      if (localProgress <= 0 || localProgress >= 1) {
        wave.visible = false;
        wave.geometry.setDrawRange(0, 0);
        return;
      }

      wave.visible = true;
      const reveal = Math.min(1, localProgress / 0.22);
      const triangleCount = Math.floor((indexCount * reveal) / 6);
      wave.geometry.setDrawRange(0, triangleCount * 6);
      const fadeIn = Math.min(1, localProgress / 0.1);
      const fadeOut = Math.min(1, (1 - localProgress) / 0.62);
      wave.position.set(
        localProgress * 0.012 * index,
        -localProgress * 0.008 * index,
        index * 0.003,
      );
      wave.scale.setScalar(0.96 + reveal * 0.04);
      wave.material.opacity = Math.min(fadeIn, fadeOut)
        * (0.76 + IMPACT_INTENSITY * 0.24);
    });
  }

  private updateHeadSeam(): void {
    if (!this.headPivot || !this.basePosition || this.headSideMaterialStates.length === 0) {
      return;
    }

    const lift = Math.max(0, this.headPivot.position.y - this.basePosition.y);
    const assembled = 1 - THREE.MathUtils.smoothstep(lift, 0.015, 0.2);
    const forward = this.seamForward.set(0, 0, 1).applyQuaternion(this.headPivot.quaternion);
    const frontFacing = Math.pow(Math.abs(forward.z), 8);
    const blend = assembled * frontFacing;

    this.headSideMaterialStates.forEach((state) => {
      state.material.color.copy(state.color).lerp(this.owlColor, blend);
      state.material.emissive.copy(state.emissive).lerp(this.owlColor, blend);
      state.material.emissiveIntensity = state.emissiveIntensity + blend * 0.1;
      state.material.roughness = THREE.MathUtils.lerp(state.roughness, 0.62, blend);
      state.material.opacity = THREE.MathUtils.lerp(state.opacity, 0, blend);
      state.material.depthWrite = blend < 0.01 ? state.depthWrite : false;
    });
  }

  private syncMotionPreference(): void {
    if (this.motionPreference?.matches) {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.clock.stop();
      if (this.action && this.mixer) {
        this.action.paused = true;
        this.mixer.setTime(0);
      }
      this.renderOnce();
      return;
    }

    if (this.action) this.action.paused = false;
    this.clock.start();
    this.startAnimationLoop();
  }

  private startAnimationLoop(): void {
    if (this.animationFrameId !== null || this.destroyed || this.motionPreference?.matches) {
      return;
    }
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  }

  private readonly renderFrame = (): void => {
    this.animationFrameId = null;
    if (this.destroyed || this.motionPreference?.matches) return;

    this.mixer?.update(this.clock.getDelta());
    this.updateFeathers();
    this.updateImpactWaves();
    this.updateHeadSeam();
    this.renderOnce();
    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private renderOnce(): void {
    if (this.destroyed || !this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
  }

  private resizeRenderer(): void {
    if (!this.renderer || !this.camera) return;

    const host = this.canvasHost.nativeElement;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    if (this.motionPreference?.matches) this.renderOnce();
  }

  private disposeObjectTree(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => {
        materials.add(material);
        Object.values(material).forEach((value: unknown) => {
          if (value instanceof THREE.Texture) textures.add(value);
        });
      });
    });

    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    root.clear();
  }

  private readonly onContainerResize = (): void => this.resizeRenderer();
  private readonly onWindowResize = (): void => this.resizeRenderer();
  private readonly onMotionPreferenceChange = (): void => this.syncMotionPreference();
}
