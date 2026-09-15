import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CaptureMinimapComponent } from './capture-minimap.component';

describe('CaptureMinimapComponent', () => {
  let fixture: ComponentFixture<CaptureMinimapComponent>;
  let component: CaptureMinimapComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CaptureMinimapComponent] });
    fixture = TestBed.createComponent(CaptureMinimapComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('targets', [
      { yawDeg: 0, pitchDeg: 0 },
      { yawDeg: 90, pitchDeg: 0 },
      { yawDeg: 180, pitchDeg: 0 },
      { yawDeg: 270, pitchDeg: 0 },
    ]);
    fixture.componentRef.setInput('capturedCount', 1);
    fixture.detectChanges();
  });

  it('distingue pontos concluído, atual e pendentes', () => {
    const points: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.capture-minimap__point'),
    );

    expect(points.length).toBe(4);
    expect(points[0].classList).toContain('is-done');
    expect(points[1].classList).toContain('is-current');
    expect(points[2].classList).not.toContain('is-done');
    expect(points[2].classList).not.toContain('is-current');
  });

  it('gira os pontos no sentido oposto ao celular sem change detection', () => {
    component.paintHeading(90);

    const rotor: HTMLElement = fixture.nativeElement.querySelector('.capture-minimap__rotor');
    expect(rotor.style.transform).toBe('rotate(-90deg)');
  });
});
