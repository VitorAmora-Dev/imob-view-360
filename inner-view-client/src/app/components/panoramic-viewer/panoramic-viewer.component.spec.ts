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
