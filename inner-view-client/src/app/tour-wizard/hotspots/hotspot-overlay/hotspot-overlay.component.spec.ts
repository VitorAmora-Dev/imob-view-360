import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { WizardHotspot } from '../../tour-wizard.model';
import { HotspotOverlayComponent } from './hotspot-overlay.component';

/**
 * Integra com o viewer DE VERDADE, não com um dublê: o que está sendo provado
 * é justamente que a câmera do three.js e a camada HTML concordam sobre onde
 * cada ponto está. Um dublê de câmera provaria só que a aritmética fecha
 * consigo mesma.
 */
@Component({
  standalone: true,
  imports: [PanoramicViewerComponent, HotspotOverlayComponent],
  template: `
    <div style="width: 1280px; height: 720px; position: relative">
      <app-panoramic-viewer #viewer [editMode]="true" />
      <app-hotspot-overlay [viewer]="viewer" [hotspots]="hotspots()" />
    </div>
  `,
})
class HostComponent {
  readonly hotspots = signal<WizardHotspot[]>([]);
}

function hs(id: string, u: number, v: number): WizardHotspot {
  return { id, u, v, label: '', target: null };
}

/** Espera o init adiado do viewer e alguns frames do laço de render. */
function frames(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

function posicaoDe(el: HTMLElement): { x: number; y: number } | null {
  const match = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(
    el.style.transform,
  );
  return match ? { x: parseFloat(match[1]), y: parseFloat(match[2]) } : null;
}

describe('HotspotOverlayComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  function pins(): HTMLElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[data-hotspot-id]'),
    );
  }

  it('cria um botão por hotspot', async () => {
    host.hotspots.set([hs('a', 0.75, 0.5), hs('b', 0.75, 0.6)]);
    fixture.detectChanges();
    await frames();

    expect(pins().length).toBe(2);
  });

  it('põe no centro do canvas o hotspot que a câmera encara', async () => {
    host.hotspots.set([hs('centro', 0.75, 0.5)]);
    fixture.detectChanges();
    await frames();
    fixture.detectChanges();

    const posicao = posicaoDe(pins()[0]);

    expect(posicao).not.toBeNull();
    expect(posicao!.x).toBeCloseTo(640, 0);
    expect(posicao!.y).toBeCloseTo(360, 0);
  });

  it('esconde o hotspot que está atrás da câmera', async () => {
    host.hotspots.set([hs('atras', 0.25, 0.5)]);
    fixture.detectChanges();
    await frames();

    expect(pins()[0].style.visibility).toBe('hidden');
  });

  it('mostra acima do centro o hotspot de v maior', async () => {
    host.hotspots.set([hs('alto', 0.75, 0.62), hs('baixo', 0.75, 0.38)]);
    fixture.detectChanges();
    await frames();

    const alto = posicaoDe(pins()[0]);
    const baixo = posicaoDe(pins()[1]);

    expect(alto!.y).toBeLessThan(360);
    expect(baixo!.y).toBeGreaterThan(360);
  });

  it('acompanha o hotspot que mudou de lugar, sem recriar o botão', async () => {
    // Prova que o laço de frame lê o estado atual, e não uma cópia presa na
    // assinatura. Mover o ponto é o que o arraste do B9 vai fazer.
    host.hotspots.set([hs('p', 0.75, 0.5)]);
    fixture.detectChanges();
    await frames();
    const antes = posicaoDe(pins()[0]);
    const botao = pins()[0];

    host.hotspots.set([hs('p', 0.72, 0.5)]);
    fixture.detectChanges();
    await frames();
    const depois = posicaoDe(pins()[0]);

    expect(antes!.x).toBeCloseTo(640, 0);
    expect(Math.abs(depois!.x - 640)).toBeGreaterThan(20);
    expect(pins()[0]).toBe(botao); // `track` por id reaproveitou o nó
  });
});
