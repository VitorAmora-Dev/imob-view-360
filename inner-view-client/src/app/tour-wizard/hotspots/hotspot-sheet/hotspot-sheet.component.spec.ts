import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardHotspot, WizardScene } from '../../tour-wizard.model';
import { TW_MOBILE_QUERY } from '../media';
import { HotspotSheetComponent } from './hotspot-sheet.component';

/**
 * Bottom sheet do mobile (B8).
 *
 * O que importa aqui não é o desenho do `IonModal` — isso é responsabilidade do
 * Ionic e testá-lo seria testar a biblioteca. O que se prova é a ligação: quando
 * o sheet existe, em que altura ele abre, e que ele NÃO existe no desktop, onde
 * o mesmo estado é atendido pelo painel ao lado do viewer.
 */
describe('HotspotSheetComponent', () => {
  let draft: TourDraftStore;
  let editor: HotspotEditorStore;
  let media: MediaFalsa;

  /**
   * Dublê de `MediaQueryList`. A viewport do Karma é a que for, e o teste
   * precisa dizer "isto é um celular" sem depender do tamanho da janela de quem
   * roda a suíte.
   */
  interface MediaFalsa {
    lista: MediaQueryList;
    mudarPara(matches: boolean): void;
  }

  function mediaFalsa(matches: boolean): MediaFalsa {
    const ouvintes = new Set<() => void>();
    const lista = {
      matches,
      addEventListener: (_: string, fn: () => void) => ouvintes.add(fn),
      removeEventListener: (_: string, fn: () => void) => ouvintes.delete(fn),
    };
    return {
      lista: lista as unknown as MediaQueryList,
      mudarPara(valor: boolean) {
        lista.matches = valor;
        ouvintes.forEach((fn) => fn());
      },
    };
  }

  function scene(id: string, hotspots: WizardHotspot[] = []): WizardScene {
    return {
      id,
      room: id,
      fileName: `${id}.jpg`,
      fileSize: 1024,
      imageData: 'data:image/jpeg;base64,x',
      order: 0,
      hotspots,
      state: 'ready',
    };
  }

  function hotspot(id: string): WizardHotspot {
    return { id, u: 0.5, v: 0.5, label: '', target: null };
  }

  function monta(): ComponentFixture<HotspotSheetComponent> {
    const fixture = TestBed.createComponent(HotspotSheetComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    media = mediaFalsa(true);
    // Só a consulta do wizard é dublada. O Ionic também pergunta por media
    // queries (plataforma, `prefers-reduced-motion`), e devolver o mesmo dublê
    // para todo mundo o faria acreditar em coisas que não foram ditas aqui.
    const real = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((consulta: string) =>
      consulta === TW_MOBILE_QUERY ? media.lista : real(consulta),
    );

    TestBed.configureTestingModule({
      providers: [
        TourDraftStore,
        HotspotEditorStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
    draft = TestBed.inject(TourDraftStore);
    editor = TestBed.inject(HotspotEditorStore);

    draft.scenes.set([scene('a', [hotspot('h1'), hotspot('h2')]), scene('b')]);
    draft.selectedSceneId.set('a');
  });

  it('fica fechado enquanto ninguém pede', () => {
    expect(monta().componentInstance.isOpen()).toBeFalse();
  });

  it('abre quando o store pede o editor', () => {
    const fixture = monta();

    editor.openEditor('h2');
    fixture.detectChanges();

    expect(fixture.componentInstance.isOpen()).toBeTrue();
    expect(fixture.componentInstance.mode()).toBe('editor');
  });

  it('não abre no desktop — lá quem responde é o painel', () => {
    // Um IonModal escondido por CSS continuaria prendendo o foco e travando o
    // scroll; a única forma segura de não tê-lo é não abri-lo.
    media.mudarPara(false);
    const fixture = monta();

    editor.openEditor('h1');
    fixture.detectChanges();

    expect(fixture.componentInstance.isOpen()).toBeFalse();
  });

  it('a lista abre mais alta que o editor', () => {
    // O editor deixa a foto à vista porque o ponto que se está nomeando está
    // nela; a lista é para varrer e não tem essa dependência.
    const fixture = monta();

    editor.openEditor('h1');
    const noEditor = fixture.componentInstance.initialBreakpoint();
    editor.openList();
    const naLista = fixture.componentInstance.initialBreakpoint();

    expect(naLista).toBeGreaterThan(noEditor);
  });

  it('deixa arrastar para baixo até fechar', () => {
    // Sem o 0 na lista de paradas o sheet trava na menor altura e a única saída
    // vira o botão.
    expect(monta().componentInstance.breakpoints).toContain(0);
  });

  it('acha a posição do ponto em edição, que é o número que o pin mostra', () => {
    const fixture = monta();

    editor.openEditor('h2');
    fixture.detectChanges();

    expect(fixture.componentInstance.editingIndex()).toBe(1);
  });

  it('fechar zera o estado do store', () => {
    // Vale para o botão, para o arrasto e para o Esc: os três caem aqui. Se o
    // estado sobrevivesse, o sheet reabriria sozinho na próxima troca de
    // ambiente.
    const fixture = monta();
    editor.openList();

    fixture.componentInstance.close();

    expect(editor.sheet()).toBeNull();
  });

  it('dá nome ao diálogo dentro do shadow root do Ionic', () => {
    // O `role="dialog"` do Ionic mora num `.modal-wrapper` no shadow DOM, e não
    // no `<ion-modal>`. Nomear o host deixa o diálogo anônimo — medido na
    // árvore de acessibilidade. Ver `nomearDialogo`.
    const fixture = monta();
    editor.openList();
    fixture.detectChanges();

    const host = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-wrapper';
    host.attachShadow({ mode: 'open' }).appendChild(wrapper);

    fixture.componentInstance.nomearDialogo({ target: host } as unknown as Event);

    expect(wrapper.getAttribute('aria-label')).toBe(
      fixture.componentInstance.title(),
    );
  });

  it('o nome do diálogo acompanha o título, e não só a apresentação', () => {
    // Escrever o nome uma vez no `didPresent` só está certo enquanto o título
    // não puder mudar com o sheet aberto — o que hoje é verdade por acidente,
    // e por acidente de cinco fatos distintos (ver o effect no componente).
    // Este teste desfaz a dependência: o dia em que alguém fizer o card da
    // lista abrir o editor, o nome vai junto.
    const fixture = monta();
    editor.openList();
    fixture.detectChanges();

    const host = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-wrapper';
    host.attachShadow({ mode: 'open' }).appendChild(wrapper);
    fixture.componentInstance.nomearDialogo({ target: host } as unknown as Event);
    const naLista = wrapper.getAttribute('aria-label');

    // O modal continua apresentado; só o modo mudou.
    editor.openEditor('h2');
    fixture.detectChanges();

    expect(wrapper.getAttribute('aria-label')).not.toBe(naLista);
    expect(wrapper.getAttribute('aria-label')).toBe(
      fixture.componentInstance.title(),
    );
  });

  it('para de escrever no diálogo depois de fechado', () => {
    // Sem soltar o nó, o componente escreveria para sempre num wrapper
    // descartado — e o seguraria vivo junto.
    const fixture = monta();
    editor.openList();
    fixture.detectChanges();

    const host = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-wrapper';
    host.attachShadow({ mode: 'open' }).appendChild(wrapper);
    fixture.componentInstance.nomearDialogo({ target: host } as unknown as Event);

    fixture.componentInstance.close();
    wrapper.removeAttribute('aria-label');
    editor.openEditor('h2');
    fixture.detectChanges();

    expect(wrapper.getAttribute('aria-label')).toBeNull();
  });

  it('não explode se o Ionic mudar o shadow DOM por baixo', () => {
    // Degradar em silêncio é o certo aqui: o sheet inteiro não pode parar de
    // abrir porque um seletor de a11y deixou de casar.
    const fixture = monta();
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' });

    expect(() =>
      fixture.componentInstance.nomearDialogo({ target: host } as unknown as Event),
    ).not.toThrow();
  });

  it('segue a viewport que muda de tamanho com o sheet aberto', () => {
    media.mudarPara(false);
    const fixture = monta();
    editor.openList();
    fixture.detectChanges();
    expect(fixture.componentInstance.isOpen()).toBeFalse();

    media.mudarPara(true);
    fixture.detectChanges();

    expect(fixture.componentInstance.isOpen()).toBeTrue();
  });
});
