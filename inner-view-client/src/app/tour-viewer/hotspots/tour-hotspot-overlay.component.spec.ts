import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../components/panoramic-viewer/panoramic-viewer.component';
import { ViewerHotspot } from '../tour-viewer.model';
import { TourHotspotOverlayComponent, ladoDoDisco } from './tour-hotspot-overlay.component';

/**
 * Integra com o viewer DE VERDADE, não com um dublê: o que está sendo provado é
 * que a câmera do three.js e a camada HTML concordam sobre onde cada ponto
 * está, e que a perspectiva do disco sobrevive à animação de flutuação. Um
 * dublê de câmera provaria só que a aritmética fecha consigo mesma, e nenhum
 * dublê provaria a segunda coisa.
 */
@Component({
  standalone: true,
  imports: [PanoramicViewerComponent, TourHotspotOverlayComponent],
  template: `
    <div style="width: 1280px; height: 720px; position: relative">
      <app-panoramic-viewer #viewer />
      <app-tv-hotspot-overlay
        [viewer]="viewer"
        [hotspots]="hotspots()"
        (cenaEscolhida)="escolhidas.push($event)" />
    </div>
  `,
})
class HostComponent {
  readonly hotspots = signal<ViewerHotspot[]>([]);
  readonly escolhidas: string[] = [];
}

function hs(
  id: string,
  u: number,
  v: number,
  kind: 'primary' | 'secondary' = 'secondary',
  label = 'Cozinha',
): ViewerHotspot {
  return { id, targetSceneId: `cena-${id}`, label, u, v, kind };
}

/** Espera o init adiado do viewer e alguns frames do laço de render. */
function frames(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

function posicaoDe(el: HTMLElement): { x: number; y: number } | null {
  const match = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(el.style.transform);
  return match ? { x: parseFloat(match[1]), y: parseFloat(match[2]) } : null;
}

describe('ladoDoDisco', () => {
  it('cresce do horizonte para os pés', () => {
    expect(ladoDoDisco(0.5)).toBe(64);
    expect(ladoDoDisco(1)).toBe(124);
    expect(ladoDoDisco(0.75)).toBeGreaterThan(ladoDoDisco(0.6));
  });

  it('bate com os 88px que o handoff especifica para o mobile', () => {
    // Sanidade da escala: o disco do exemplo do handoff cai num pitch de piso
    // plausível. Se alguém mexer na faixa, este número denuncia.
    expect(ladoDoDisco(0.7)).toBe(88);
  });

  it('não passa dos limites com pitch fora da faixa', () => {
    // v abaixo do equador é hotspot no teto — não deveria existir, mas um dado
    // torto não pode virar disco de tamanho negativo.
    expect(ladoDoDisco(0.1)).toBe(64);
    expect(ladoDoDisco(1.4)).toBe(124);
  });
});

describe('TourHotspotOverlayComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    TestBed.inject(TranslateService).setTranslation('pt', {
      TOUR_VIEWER: { HOTSPOT: { GO_TO: 'Ir para {{name}}' } },
    });

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  function pins(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-hotspot-id]'));
  }

  function parte(pin: HTMLElement, classe: string): HTMLElement | null {
    return pin.querySelector<HTMLElement>(classe);
  }

  it('cria um botão por hotspot', async () => {
    host.hotspots.set([hs('a', 0.75, 0.65), hs('b', 0.75, 0.7)]);
    fixture.detectChanges();
    await frames();

    expect(pins().length).toBe(2);
    expect(pins()[0].tagName).toBe('BUTTON');
  });

  it('põe no centro do canvas o hotspot que a câmera encara', async () => {
    host.hotspots.set([hs('centro', 0.75, 0.5)]);
    fixture.detectChanges();
    await frames();

    const posicao = posicaoDe(pins()[0]);

    expect(posicao).not.toBeNull();
    expect(posicao!.x).toBeCloseTo(640, 0);
    expect(posicao!.y).toBeCloseTo(360, 0);
  });

  it('desce na tela o hotspot mais próximo dos pés', async () => {
    host.hotspots.set([hs('longe', 0.75, 0.55), hs('perto', 0.75, 0.72)]);
    fixture.detectChanges();
    await frames();

    expect(posicaoDe(pins()[1])!.y).toBeGreaterThan(posicaoDe(pins()[0])!.y);
  });

  it('tira do DOM visível — e da tabulação — o hotspot atrás da câmera', async () => {
    host.hotspots.set([hs('atras', 0.25, 0.65)]);
    fixture.detectChanges();
    await frames();

    // display:none, e não visibility:hidden: o Tab não pode percorrer destinos
    // que ninguém está vendo.
    expect(pins()[0].style.display).toBe('none');
  });

  it('acompanha o pin que mudou de lugar sem recriar o botão', async () => {
    host.hotspots.set([hs('p', 0.75, 0.6)]);
    fixture.detectChanges();
    await frames();
    const botao = pins()[0];
    const antes = posicaoDe(botao);

    host.hotspots.set([hs('p', 0.71, 0.6)]);
    fixture.detectChanges();
    await frames();

    expect(antes!.x).toBeCloseTo(640, 0);
    expect(Math.abs(posicaoDe(pins()[0])!.x - 640)).toBeGreaterThan(20);
    expect(pins()[0]).toBe(botao);
  });

  // ---- a armadilha do handoff ---------------------------------------------

  it('desenha o disco como ELIPSE DEITADA, não como círculo de frente', async () => {
    // O primeiro item do checklist de QA. Se a keyframe de flutuação engolir o
    // `perspective() rotateX()`, o disco volta a ser um círculo e a razão sobe
    // para 1 — sem erro nenhum no console.
    host.hotspots.set([hs('a', 0.75, 0.7)]);
    fixture.detectChanges();
    await frames();

    const disco = parte(pins()[0], '.tv-pin__disco')!.getBoundingClientRect();

    expect(disco.width).toBeGreaterThan(0);
    expect(disco.height / disco.width).toBeLessThan(0.85);
    expect(disco.height / disco.width).toBeGreaterThan(0.25);
  });

  it('mantém a flutuação e a perspectiva em elementos SEPARADOS', async () => {
    // A outra metade da mesma armadilha: as duas no mesmo elemento compilam,
    // renderizam e só depois se anulam.
    host.hotspots.set([hs('a', 0.75, 0.7)]);
    fixture.detectChanges();
    await frames();

    const bob = getComputedStyle(parte(pins()[0], '.tv-pin__bob')!);
    const disco = getComputedStyle(parte(pins()[0], '.tv-pin__disco')!);

    expect(bob.animationName).toContain('tv-pin-bob');
    expect(bob.transform === 'none' || bob.transform.startsWith('matrix(')).toBeTrue();
    // A perspectiva sobrevive: transform com perspectiva vira matrix3d.
    expect(disco.transform).toContain('matrix3d');
    expect(disco.animationName).toBe('none');
  });

  // ---- hierarquia ---------------------------------------------------------

  it('só o destino em destaque ganha anel de pulso', async () => {
    host.hotspots.set([
      hs('principal', 0.75, 0.7, 'primary'),
      hs('outro', 0.78, 0.7, 'secondary'),
    ]);
    fixture.detectChanges();
    await frames();

    expect(fixture.nativeElement.querySelectorAll('.tv-pin__anel').length).toBe(1);
    expect(parte(pins()[0], '.tv-pin__anel')).not.toBeNull();
    expect(parte(pins()[1], '.tv-pin__anel')).toBeNull();
  });

  it('desenha maior o disco que está mais perto', async () => {
    // Os dois dentro do frustum: a câmera abre 75°, então um ponto muito
    // abaixo do horizonte sai de quadro e mediria zero — provando nada.
    host.hotspots.set([hs('longe', 0.75, 0.52), hs('perto', 0.75, 0.7)]);
    fixture.detectChanges();
    await frames();

    const longe = parte(pins()[0], '.tv-pin__disco')!.getBoundingClientRect().width;
    const perto = parte(pins()[1], '.tv-pin__disco')!.getBoundingClientRect().width;

    expect(perto).toBeGreaterThan(longe);
  });

  // ---- acessibilidade e ação ----------------------------------------------

  it('anuncia para onde leva, e não só o nome do cômodo', async () => {
    host.hotspots.set([hs('a', 0.75, 0.7, 'primary', 'Escritório')]);
    fixture.detectChanges();
    await frames();

    expect(pins()[0].getAttribute('aria-label')).toBe('Ir para Escritório');
    // O rótulo visível não é lido duas vezes.
    expect(parte(pins()[0], '.tv-pin__placa')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('o rótulo vai em caixa alta por CSS, e o dado fica como foi escrito', async () => {
    host.hotspots.set([hs('a', 0.75, 0.7, 'secondary', 'Escritório')]);
    fixture.detectChanges();
    await frames();

    const placa = parte(pins()[0], '.tv-pin__placa')!;

    expect(placa.textContent!.trim()).toBe('Escritório');
    expect(getComputedStyle(placa).textTransform).toBe('uppercase');
  });

  it('o clique emite a cena de destino', async () => {
    host.hotspots.set([hs('a', 0.75, 0.7)]);
    fixture.detectChanges();
    await frames();

    pins()[0].click();

    expect(host.escolhidas).toEqual(['cena-a']);
  });
});
