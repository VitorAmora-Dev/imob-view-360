import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../../../components/panoramic-viewer/panoramic-viewer.component';
import { WizardHotspot } from '../../tour-wizard.model';
import { hotspotToWorld, projectToScreen } from '../hotspot-projection';
import { TW_REDUCED_MOTION_QUERY } from '../media';
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
      <app-hotspot-overlay
        [viewer]="viewer"
        [hotspots]="hotspots()"
        [draggingId]="draggingId()"
        (pinActivated)="ativados.push($event)"
        (pinDragStarted)="iniciados.push($event)"
        (pinDragMoved)="movimentos.push($event)"
        (pinDragEnded)="fins = fins + 1" />
    </div>
  `,
})
class HostComponent {
  readonly hotspots = signal<WizardHotspot[]>([]);
  readonly draggingId = signal<string | null>(null);
  readonly ativados: string[] = [];
  readonly iniciados: string[] = [];
  readonly movimentos: { u: number; v: number; clientX: number; clientY: number }[] = [];
  fins = 0;
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
      // O overlay traduz o `aria-label` do pin (B4/B12). Nada aqui depende do
      // texto — o que está sob teste é a projeção —, mas sem o provider o
      // componente nem chega a ser construído.
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
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

  it('mostra acima do centro o hotspot de v MENOR', async () => {
    // v=0 é o topo da esfera — ver a cadeia de conversão em hotspot-projection.
    host.hotspots.set([hs('alto', 0.75, 0.38), hs('baixo', 0.75, 0.62)]);
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

  it('o dedo acerta 44px, mesmo com a pílula desenhada em 34', async () => {
    // Vários pontos sobre uma foto com 44px de altura cada pesam demais, então
    // a pílula é menor e a área de toque é esticada por fora. Antes do
    // acabamento o pin media 5×13px — dá para clicar com mouse e não dá para
    // acertar com o polegar.
    host.hotspots.set([hs('p', 0.75, 0.5)]);
    fixture.detectChanges();
    await frames();

    const pin = pins()[0];
    expect(Math.round(pin.getBoundingClientRect().height)).toBe(34);

    // A área vem do ::before. O hit test de verdade, com `elementFromPoint`,
    // não serve aqui: a página do Karma tem o relatório do Jasmine por cima da
    // fixture e o ponto medido cai nele. Foi medido no navegador — 44px nos
    // dois eixos — e o que se trava aqui é a regra que produz esse número.
    const area = getComputedStyle(pin, '::before');
    expect(area.height).toBe('44px');
    expect(area.minWidth).toBe('44px');
  });

  it('só pulsa o ponto que leva a algum lugar', async () => {
    // O anel é a promessa de "clique aqui e você vai para outro lugar" que o
    // visitante vai ver. Pulsar num ponto sem destino seria ensaiar uma
    // promessa que ele ainda não cumpre.
    host.hotspots.set([
      { ...hs('com', 0.75, 0.5), target: 'outro' },
      hs('sem', 0.72, 0.5),
    ]);
    fixture.detectChanges();
    await frames();

    const anel = (el: HTMLElement) =>
      getComputedStyle(el.querySelector('.tw-pin__dot')!, '::after').animationName;

    expect(anel(pins()[0])).toBe('tw-pulse-ring');
    expect(anel(pins()[1])).toBe('none');
  });

  /**
   * Long-press e arraste (B9).
   *
   * O gesto é reconhecido no overlay porque é ele que sabe onde os pins estão
   * na tela. O que se prova aqui é a MÁQUINA DE ESTADOS — quando o arraste
   * começa, quando não começa, e o que acontece com o clique que o browser
   * dispara depois. A conta de posição está no `uvAt`, provada à parte.
   */
  describe('arraste do pin', () => {
    const PONTO = { x: 700, y: 400 };
    /** Valor do handoff. Escrito à mão aqui de propósito: é contrato, não
     *  detalhe — se alguém mexer na constante, este teste tem de reclamar. */
    const LONG_PRESS_MS = 320;

    function toque(tipo: string, x = PONTO.x, y = PONTO.y): PointerEvent {
      return new PointerEvent(tipo, {
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
      });
    }

    function mouse(tipo: string, x = PONTO.x, y = PONTO.y): PointerEvent {
      return new PointerEvent(tipo, {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        bubbles: true,
      });
    }

    /**
     * Os dois cliques são eventos diferentes, e o overlay depende disso.
     *
     * O que o browser dispara ao fim de um gesto de ponteiro traz `detail` ≥ 1;
     * o que o Enter num <button> sintetiza traz `detail` 0. `element.click()`
     * também gera 0 — usá-lo para simular a sobra de um arraste testaria o
     * caminho errado.
     */
    function cliqueDePonteiro(el: HTMLElement): void {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    }

    function cliqueDeTeclado(el: HTMLElement): void {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    }

    async function comUmPin(): Promise<HTMLElement> {
      host.hotspots.set([hs('p', 0.75, 0.5)]);
      fixture.detectChanges();
      await frames();
      // O relógio só é trocado DEPOIS do init do viewer, que também usa
      // setTimeout — congelá-lo antes deixaria o viewer sem câmera.
      jasmine.clock().install();
      return pins()[0];
    }

    afterEach(() => jasmine.clock().uninstall());

    it('o dedo parado por 320ms pega o ponto', async () => {
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      expect(host.iniciados).toEqual([]); // ainda não: o gesto é o tempo

      jasmine.clock().tick(LONG_PRESS_MS);

      expect(host.iniciados).toEqual(['p']);
    });

    it('o dedo que anda antes dos 320ms não pega nada', async () => {
      // É a regra do DoD: passar o polegar sobre um ponto para rolar a tela não
      // pode sequestrar o ponto.
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      jasmine.clock().tick(100);
      pin.dispatchEvent(toque('pointermove', PONTO.x, PONTO.y + 30));
      jasmine.clock().tick(LONG_PRESS_MS);

      expect(host.iniciados).toEqual([]);
    });

    it('o tremor de quem segura o telefone não cancela', async () => {
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      pin.dispatchEvent(toque('pointermove', PONTO.x + 4, PONTO.y + 4));
      jasmine.clock().tick(LONG_PRESS_MS);

      expect(host.iniciados).toEqual(['p']);
    });

    it('o mouse arrasta na hora, sem esperar', async () => {
      // Esperar 320ms de mouse parado seria um gesto que ninguém descobre, e o
      // DoD pede mover em desktop também.
      const pin = await comUmPin();

      pin.dispatchEvent(mouse('pointerdown'));
      pin.dispatchEvent(mouse('pointermove', PONTO.x + 40, PONTO.y));

      expect(host.iniciados).toEqual(['p']);
    });

    it('o mouse que mal se mexe ainda é clique', async () => {
      const pin = await comUmPin();

      pin.dispatchEvent(mouse('pointerdown'));
      pin.dispatchEvent(mouse('pointermove', PONTO.x + 3, PONTO.y));
      pin.dispatchEvent(mouse('pointerup'));
      cliqueDePonteiro(pin);

      expect(host.iniciados).toEqual([]);
      expect(host.ativados).toEqual(['p']);
    });

    it('o ponto em arraste segue o ponteiro', async () => {
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      jasmine.clock().tick(LONG_PRESS_MS);
      pin.dispatchEvent(toque('pointermove', 800, 300));

      expect(host.movimentos.length).toBe(1);
      expect(host.movimentos[0].clientX).toBe(800);
      expect(host.movimentos[0].u).toBeGreaterThanOrEqual(0);
      expect(host.movimentos[0].u).toBeLessThanOrEqual(1);
    });

    it('largar o ponto não navega junto', async () => {
      // O browser dispara `click` no alvo da captura depois do `pointerup`.
      // Sem a trava, soltar um ponto sobre a foto abriria o destino dele.
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      jasmine.clock().tick(LONG_PRESS_MS);
      pin.dispatchEvent(toque('pointermove', 800, 300));
      pin.dispatchEvent(toque('pointerup'));
      cliqueDePonteiro(pin);

      expect(host.fins).toBe(1);
      expect(host.ativados).toEqual([]);
    });

    it('passar o dedo por cima e soltar adiante não navega', async () => {
      // Com a captura ligada no `pointerdown`, o browser dispara o `click` no
      // pin mesmo quando a solta acontece longe dele. Sem a trava, encostar num
      // ponto no meio de um gesto qualquer levaria o corretor para outro
      // ambiente sem ele ter pedido.
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      pin.dispatchEvent(toque('pointermove', PONTO.x + 120, PONTO.y));
      pin.dispatchEvent(toque('pointerup'));
      cliqueDePonteiro(pin);

      expect(host.iniciados).toEqual([]); // não virou arraste: andou cedo demais
      expect(host.ativados).toEqual([]); // e também não virou clique
    });

    it('o clique seguinte volta a valer', async () => {
      // A trava vale para UM clique. Se ficasse ligada, o ponto arrastado
      // nunca mais navegaria.
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      jasmine.clock().tick(LONG_PRESS_MS);
      pin.dispatchEvent(toque('pointerup'));
      cliqueDePonteiro(pin);
      cliqueDePonteiro(pin);

      expect(host.ativados).toEqual(['p']);
    });

    it('o ponteiro cancelado encerra o arraste', async () => {
      // Chamada recebida, dedo saindo da tela, gesto do sistema — o browser
      // manda `pointercancel` e nenhum `pointerup`. Sem isto o ponto ficaria
      // grudado no ponteiro para sempre.
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      jasmine.clock().tick(LONG_PRESS_MS);
      pin.dispatchEvent(toque('pointercancel'));
      pin.dispatchEvent(toque('pointermove', 900, 200));

      expect(host.fins).toBe(1);
      expect(host.movimentos).toEqual([]);
    });

    it('o teclado nunca cai na trava de clique', async () => {
      // Encontrado no navegador, tabulando pela etapa: depois de arrastar um
      // ponto com o mouse, dar Tab até um pin e apertar Enter não fazia nada.
      //
      // A trava é ligada no `pointerup` e só é desligada pelo clique seguinte
      // ou pelo `pointerdown` seguinte — e quem usa teclado não gera nenhum dos
      // dois. Ela ficava pendurada até o próximo toque de ponteiro, que podia
      // não vir nunca.
      const pin = await comUmPin();

      pin.dispatchEvent(toque('pointerdown'));
      jasmine.clock().tick(LONG_PRESS_MS);
      pin.dispatchEvent(toque('pointermove', 800, 300));
      pin.dispatchEvent(toque('pointerup'));

      cliqueDeTeclado(pin);

      expect(host.ativados).toEqual(['p']);
    });

    it('aumenta o ponto que está sendo arrastado', async () => {
      // Sai do laço de frame e não do CSS: aquele reescreve `transform` a cada
      // frame e sobrescreveria um `scale` de classe.
      const pin = await comUmPin();
      jasmine.clock().uninstall();

      host.draggingId.set('p');
      fixture.detectChanges();
      await frames();

      expect(pin.style.transform).toContain('scale(');
      jasmine.clock().install();
    });
  });
});

/**
 * Menos movimento (B12).
 *
 * O `tour-wizard.scss` já zera os tokens de transição numa media query, mas o
 * aumento do pin em arraste não passa por CSS: o laço de frame reescreve
 * `transform` sessenta vezes por segundo, então quem decide se o `scale` entra
 * é o TypeScript — e a preferência precisa chegar até lá.
 */
describe('HotspotOverlayComponent — menos movimento', () => {
  @Component({
    standalone: true,
    imports: [PanoramicViewerComponent, HotspotOverlayComponent],
    template: `
      <div style="width: 1280px; height: 720px; position: relative">
        <app-panoramic-viewer #viewer [editMode]="true" />
        <app-hotspot-overlay
          [viewer]="viewer"
          [hotspots]="hotspots()"
          [draggingId]="'p'" />
      </div>
    `,
  })
  class HostSemMovimentoComponent {
    readonly hotspots = signal<WizardHotspot[]>([hs('p', 0.75, 0.5)]);
  }

  it('não aumenta o ponto em arraste quando o sistema pede menos movimento', async () => {
    const real = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((consulta: string) =>
      consulta === TW_REDUCED_MOTION_QUERY
        ? ({
            matches: true,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          } as unknown as MediaQueryList)
        : real(consulta),
    );

    await TestBed.configureTestingModule({
      imports: [HostSemMovimentoComponent],
      providers: [provideTranslateService({ lang: 'pt', fallbackLang: 'pt' })],
    }).compileComponents();

    const fixture = TestBed.createComponent(HostSemMovimentoComponent);
    fixture.detectChanges();
    await frames();

    const pin: HTMLElement = fixture.nativeElement.querySelector('[data-hotspot-id]');

    // Continua posicionado — o que sai é só o crescimento. A sombra da classe
    // `is-dragging` segue lá, e ela é cor, não deslocamento.
    expect(pin.style.transform).toContain('translate3d');
    expect(pin.style.transform).not.toContain('scale(');

    fixture.destroy();
  });
});

/**
 * A ida e volta do arraste: o par `(u, v)` que o `uvAt` devolve para um pixel
 * tem de projetar de volta NAQUELE pixel.
 *
 * É o que faz o ponto parar debaixo do dedo em vez de escapar dele. Roda contra
 * o viewer de verdade porque o que está sob teste é justamente o acordo entre a
 * esfera do three.js e a câmera.
 */
describe('PanoramicViewerComponent.uvAt', () => {
  @Component({
    standalone: true,
    imports: [PanoramicViewerComponent],
    template: `
      <div style="width: 1280px; height: 720px; position: relative">
        <app-panoramic-viewer #viewer [editMode]="true" />
      </div>
    `,
  })
  class ViewerSozinhoComponent {}

  it('devolve o par que projeta de volta no mesmo pixel', async () => {
    await TestBed.configureTestingModule({ imports: [ViewerSozinhoComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ViewerSozinhoComponent);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 60));

    const viewer: PanoramicViewerComponent = fixture.debugElement.query(
      By.directive(PanoramicViewerComponent),
    ).componentInstance;
    const canvas: HTMLCanvasElement = fixture.nativeElement.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();

    // Fora do centro de propósito: no centro o erro de um eixo trocado é
    // exatamente zero, e o teste passaria com a conta errada.
    const alvo = { x: rect.left + rect.width * 0.62, y: rect.top + rect.height * 0.38 };
    const uv = viewer.uvAt(alvo.x, alvo.y);

    expect(uv).not.toBeNull();

    const volta = projectToScreen(
      hotspotToWorld(uv!.u, uv!.v),
      viewer.viewerCamera!,
      rect.width,
      rect.height,
    );

    expect(volta).not.toBeNull();
    expect(volta!.x).toBeCloseTo(alvo.x - rect.left, 0);
    expect(volta!.y).toBeCloseTo(alvo.y - rect.top, 0);

    fixture.destroy();
  });
});
