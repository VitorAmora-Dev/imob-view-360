import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { OWL_LOADER_COLOR, OwlLoaderComponent } from './owl-loader.component';

describe('OwlLoaderComponent', () => {
  let fixture: ComponentFixture<OwlLoaderComponent> | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OwlLoaderComponent],
    }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  it('mantém a cor configurável em uma única constante hexadecimal', () => {
    expect(OWL_LOADER_COLOR).toMatch(/^#[\dA-F]{6}$/i);
  });

  it('carrega, anima, reduz o movimento e libera o modelo real', async () => {
    let reducedMotion = false;
    let notifyMotionChange: (() => void) | undefined;
    const media = {
      get matches() { return reducedMotion; },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        (_type: string, listener: EventListener) => {
          notifyMotionChange = () => listener(new Event('change'));
        },
      ),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      addListener: jasmine.createSpy('addListener'),
      removeListener: jasmine.createSpy('removeListener'),
      dispatchEvent: jasmine.createSpy('dispatchEvent'),
    } as unknown as MediaQueryList;
    spyOn(window, 'matchMedia').and.returnValue(media);

    fixture = TestBed.createComponent(OwlLoaderComponent);
    fixture.detectChanges();

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (fixture.componentInstance['action']) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const component = fixture.componentInstance;
    const renderer = component['renderer'] as THREE.WebGLRenderer;
    component['renderOnce']();
    const context = renderer.getContext();
    const contextAttributes = context.getContextAttributes();
    const pixels = new Uint8Array(
      renderer.domElement.width * renderer.domElement.height * 4,
    );
    context.readPixels(
      0,
      0,
      renderer.domElement.width,
      renderer.domElement.height,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels,
    );

    let opaquePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 10) opaquePixels += 1;
    }

    const expectedColor = new THREE.Color(OWL_LOADER_COLOR);
    const modelColors: THREE.Color[] = [];
    component['motionRoot']?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if ('color' in material && material.color instanceof THREE.Color) {
          modelColors.push(material.color);
        }
      });
    });

    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input, select, button')).toBeNull();
    expect(component['motionRoot']).toBeDefined();
    expect(component['action']?.getClip().duration).toBeCloseTo(2.875, 3);
    expect(component['featherMeshes'].length).toBe(3);
    expect(component['impactWaves'].length).toBe(2);
    expect(contextAttributes?.alpha).toBeTrue();
    expect(opaquePixels).toBeGreaterThan(100);
    expect(modelColors.length).toBeGreaterThan(0);
    expect(modelColors.every((color) => color.equals(expectedColor))).toBeTrue();
    expect(pixels[3]).toBe(0);

    reducedMotion = true;
    notifyMotionChange?.();
    expect(component['animationFrameId']).toBeNull();
    expect(component['action']?.paused).toBeTrue();

    const forceContextLoss = spyOn(renderer, 'forceContextLoss').and.callThrough();
    const dispose = spyOn(renderer, 'dispose').and.callThrough();
    fixture.destroy();
    fixture = undefined;
    expect(forceContextLoss).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
});
