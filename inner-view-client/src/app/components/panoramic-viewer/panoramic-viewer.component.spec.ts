import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});
