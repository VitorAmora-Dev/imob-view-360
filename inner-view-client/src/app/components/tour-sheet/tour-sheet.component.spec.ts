import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { TOUR_MOBILE_QUERY } from './media';
import { TourSheetComponent } from './tour-sheet.component';

/**
 * O que se prova aqui NÃO é o desenho do `IonModal` -- arrasto, trap de foco e
 * animação são responsabilidade do Ionic, e testá-los seria testar a
 * biblioteca. O que se prova é a LIGAÇÃO: que `travado` chega em `canDismiss`,
 * que `variante` decide haver ou não `breakpoints`, que o fechamento
 * desemboca em `(fechado)`, e que os dois slots caem em lugares diferentes.
 *
 * Mesmo critério que `hotspot-sheet.component.spec.ts` já usa.
 */
@Component({
  standalone: true,
  imports: [TourSheetComponent],
  template: `
    <app-tour-sheet
      [isOpen]="aberto()"
      [titulo]="titulo()"
      [subtitulo]="sub()"
      [variante]="variante()"
      [travado]="travado()"
      (fechado)="fechou = fechou + 1">
      <p class="corpo-de-teste">corpo</p>
      <button rodape class="rodape-de-teste">ok</button>
    </app-tour-sheet>
  `,
})
class HospedeiroDeTesteComponent {
  readonly aberto = signal(true);
  readonly titulo = signal('Cenas do tour');
  readonly sub = signal<string | null>('3 cenas');
  readonly variante = signal<'sheet' | 'adaptavel'>('sheet');
  readonly travado = signal(false);
  fechou = 0;
}

/**
 * Segundo hóspede, só para o caso das paradas sobrescritas.
 *
 * Separado do principal DE PROPÓSITO: se o hóspede principal passasse
 * `[breakpoints]`, nenhum outro teste exercitaria mais o DEFAULT do shell --
 * que é justamente o valor que o Cenas consome sem dizer nada.
 */
@Component({
  standalone: true,
  imports: [TourSheetComponent],
  template: `
    <app-tour-sheet
      [isOpen]="true"
      [titulo]="'Gerenciar cenas'"
      [breakpoints]="[0, 0.9]"
      [initialBreakpoint]="0.9">
      <p>lista</p>
    </app-tour-sheet>
  `,
})
class HospedeiroQueSobrescreveComponent {}

/**
 * Terceiro hóspede: conteúdo mais alto do que o sheet.
 *
 * É o formato do TV-6 ("uma lista que cresce sem teto"). O `.modal-wrapper` do
 * Ionic tem `--overflow: hidden`, então sem uma área rolável no shell os
 * últimos itens ficam CORTADOS e inalcançáveis -- não rolados.
 */
@Component({
  standalone: true,
  imports: [TourSheetComponent],
  template: `
    <app-tour-sheet [isOpen]="true" [titulo]="'Gerenciar cenas'">
      <div class="lista-alta" style="height: 4000px"></div>
      <button rodape class="rodape-alto">ok</button>
    </app-tour-sheet>
  `,
})
class HospedeiroAltoComponent {}

describe('TourSheetComponent', () => {
  let fixture: ComponentFixture<HospedeiroDeTesteComponent>;
  let host: HospedeiroDeTesteComponent;
  let alvoModal: HTMLElement;

  /** Tudo o que foi criado no teste, para o `afterEach` derrubar. */
  const criados: ComponentFixture<unknown>[] = [];

  /**
   * Dublê de `MediaQueryList`. A viewport do Karma é a que for, e o teste
   * precisa poder dizer "isto é um celular" sem depender do tamanho da janela
   * de quem roda a suíte.
   *
   * Ele GUARDA os ouvintes de propósito: o shell reage ao corte de 767px
   * sendo cruzado com o sheet aberto (girar o celular), e um dublê que
   * ignorasse `addEventListener` deixaria esse eixo inteiro invisível para a
   * suíte. Mesmo padrão de `hotspot-sheet.component.spec.ts`.
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

  /** O que o dublê de `matchMedia` responde para a consulta do visualizador. */
  let media: MediaFalsa;

  function montar(ehMobile = true): void {
    media.mudarPara(ehMobile);
    fixture = TestBed.createComponent(HospedeiroDeTesteComponent);
    criados.push(fixture);
    host = fixture.componentInstance;
    fixture.detectChanges();
    // O no' e' guardado AGORA, e nao consultado a cada uso: ao apresentar, o
    // Ionic TELEPORTA o `<ion-modal>` para fora da arvore do fixture (vai para
    // o `<body>`, deixando so um comentario no lugar). Reconsultar por
    // `fixture.nativeElement.querySelector` depois disso devolveria `null`, e o
    // teste estaria medindo o teleporte em vez da marcacao.
    alvoModal = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
  }

  const modal = () => alvoModal;

  /**
   * O conteudo do `<ng-template>` so entra no DOM quando o Ionic APRESENTA o
   * modal, e apresentar e' assincrono. Sem esperar, uma consulta pelo titulo
   * acharia `null` e o teste estaria medindo a ausencia do modal em vez da
   * marcacao. As ligacoes de propriedade (`canDismiss`, `breakpoints`) ja
   * estao no elemento antes disso, e por isso os outros testes sao sincronos.
   */
  function apresentado(no: HTMLElement = modal()): Promise<void> {
    return new Promise((resolve) => {
      no.addEventListener('didPresent', () => resolve(), { once: true });
    });
  }

  /** Espera o Ionic TERMINAR de fechar -- `dismiss()` tambem e' assincrono. */
  function fechou(no: HTMLElement = modal()): Promise<void> {
    return new Promise((resolve) => {
      no.addEventListener('didDismiss', () => resolve(), { once: true });
    });
  }

  beforeEach(async () => {
    media = mediaFalsa(true);
    // So a consulta do VISUALIZADOR e' dublada, e o resto passa para o
    // `matchMedia` real. Devolver o duble para toda consulta o entregaria
    // tambem ao Ionic, que pergunta por plataforma e por
    // `prefers-reduced-motion` -- e ele passaria a acreditar em coisas que
    // nenhum teste daqui disse. Mesmo cuidado ja documentado em
    // `hotspot-sheet.component.spec.ts`.
    const real = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((consulta: string) =>
      consulta === TOUR_MOBILE_QUERY ? media.lista : real(consulta),
    );

    await TestBed.configureTestingModule({
      imports: [
        HospedeiroDeTesteComponent,
        HospedeiroQueSobrescreveComponent,
        HospedeiroAltoComponent,
      ],
      providers: [provideIonicAngular()],
    }).compileComponents();
  });

  /**
   * Um `IonModal` apresentado prende o foco no DOCUMENTO, que e' um so para a
   * suite inteira, e sobrevive ao teardown do TestBed. Sem esta limpeza, um
   * modal desta suite aparece em `document.activeElement` na suite seguinte --
   * exatamente a falha intermitente que `hotspot-sheet.component.spec.ts` ja
   * documenta no seu proprio `afterEach`.
   *
   * `backdrop-no-scroll` sai junto: o Ionic o poe no `<body>` ao apresentar, e
   * e' ele quem trava a rolagem da PAGINA. Como o `<body>` do Karma e' um so
   * para todos os arquivos, um resto dele aqui deixaria as suites seguintes
   * rodando com `overflow: hidden` no documento.
   */
  afterEach(() => {
    while (criados.length) criados.pop()!.destroy();
    document.querySelectorAll('ion-modal').forEach((m) => m.remove());
    document.body.classList.remove('backdrop-no-scroll');
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it('mostra titulo e subtitulo, e projeta corpo e rodape em lugares distintos', async () => {
    montar();
    await apresentado();
    const raiz = modal();

    expect(raiz.querySelector('.tour-sheet__titulo')?.textContent?.trim())
      .toBe('Cenas do tour');
    expect(raiz.querySelector('.tour-sheet__sub')?.textContent?.trim())
      .toBe('3 cenas');

    // O rodape fica FORA da area rolavel: com o botao dentro do corpo, ele
    // rola junto e sai da tela justamente quando e' preciso (TV-5 empilha
    // botoes no fim de um sheet rolavel).
    expect(raiz.querySelector('.tour-sheet__conteudo .corpo-de-teste')).not.toBeNull();
    expect(raiz.querySelector('.tour-sheet__conteudo .rodape-de-teste')).toBeNull();
    expect(raiz.querySelector('.tour-sheet__rodape .rodape-de-teste')).not.toBeNull();
  });

  it('sem subtitulo, nao renderiza o paragrafo vazio', async () => {
    montar();
    // Espera a apresentacao pelo mesmo motivo do teste acima -- e aqui ela e'
    // o que impede a asserticao de passar por vacuidade: sem o modal montado
    // `.tour-sheet__sub` seria `null` mesmo com um `@if` quebrado.
    await apresentado();
    expect(modal().querySelector('.tour-sheet__sub')).not.toBeNull();

    host.sub.set(null);
    fixture.detectChanges();

    expect(modal().querySelector('.tour-sheet__sub')).toBeNull();
  });

  /**
   * O nome acessivel do dialogo, e o unico guarda que ele tem.
   *
   * O no' do dialogo vive no shadow DOM do Ionic e o `<h2>` vive na luz, entao
   * `aria-labelledby` nao alcanca: IDREF nao atravessa fronteira de shadow.
   * Sobra escrever `aria-label` literal no `.modal-wrapper`. Se o Ionic
   * renomear essa classe, `nomearDialogo` passa a escrever em coisa nenhuma,
   * NADA quebra visualmente e o leitor de tela volta a anunciar so "dialogo".
   * A spec registra este teste como o que denuncia isso.
   */
  it('nomeia o dialogo dentro do shadow DOM, e o nome acompanha o titulo', async () => {
    montar();
    await apresentado();

    const wrapper = modal().shadowRoot?.querySelector('.modal-wrapper') ?? null;
    expect(wrapper)
      .withContext('`.modal-wrapper` sumiu do shadow DOM do ion-modal')
      .not.toBeNull();
    expect(wrapper?.getAttribute('aria-label')).toBe('Cenas do tour');

    // Trocar o titulo com o sheet JA aberto: quem mantem o nome em dia daqui
    // para a frente e' o `effect` do construtor, porque `nomearDialogo` so
    // roda uma vez, no `didPresent`.
    host.titulo.set('Cenas do tour (revisado)');
    fixture.detectChanges();

    expect(wrapper?.getAttribute('aria-label')).toBe('Cenas do tour (revisado)');
  });

  // UM teste para o fechamento, e nao um por gesto: `detail.role` nao e' lido
  // por nada no componente, entao um teste de `'backdrop'` e outro de
  // `'gesture'` disparariam o MESMO `didDismiss` no mesmo elemento e provariam
  // a mesma ligacao -- o segundo seria o primeiro com outra string. Os tres
  // gestos (scrim, Esc e arrasto) so se distinguem DENTRO do Ionic, e a
  // verificacao de que os tres desembocam aqui acontece no navegador, com o
  // viewer rodando (Task 7 do plano), junto da devolucao do foco ao gatilho.
  //
  // O evento do DOM chama-se `didDismiss`, e nao `ionModalDidDismiss`: o
  // `proxyOutputs` do `IonModal` liga cada `@Output` ao evento de MESMO nome, e
  // `didDismiss` e' o atalho que o `ion-modal` emite ao lado do longo.
  // Disparar o longo aqui nao acordaria a ligacao do template.
  it('o fechamento do Ionic vira (fechado)', () => {
    montar();
    expect(host.fechou).toBe(0);

    modal().dispatchEvent(new CustomEvent('didDismiss', { detail: { role: 'backdrop' } }));
    fixture.detectChanges();

    expect(host.fechou).toBe(1);
  });

  /**
   * `travado` recusa os GESTOS, e nunca o fechamento programatico.
   *
   * O Ionic consulta `canDismiss` dentro de `dismiss()` para QUALQUER papel.
   * Um `canDismiss` booleano em `false` portanto vetaria tambem o consumidor
   * mandando fechar -- que e' o caso do TV-5: `travado` ligado a `apagando()`,
   * a requisicao falha, o consumidor mostra o toast e chama `fechar()` sem
   * baixar `apagando` no mesmo tick. O sheet ficaria na tela com o Angular
   * achando que `isOpen` e' `false`, e como o watcher do Ionic so reage a
   * `true -> false`, mandar fechar de novo nao adiantaria.
   *
   * Os tres gestos chegam com papel -- `'backdrop'` (scrim e Esc) ou
   * `'gesture'`; o fechamento programatico chega com papel `undefined`.
   */
  it('travado recusa os gestos, mas nunca o fechamento programatico', () => {
    montar();
    const alvo = modal() as HTMLElement & {
      canDismiss: (dado?: unknown, papel?: string) => boolean;
    };
    const podeFechar = alvo.canDismiss;

    expect(typeof podeFechar)
      .withContext('`canDismiss` precisa ser funcao para poder olhar o papel')
      .toBe('function');
    expect(podeFechar(undefined, 'backdrop')).toBeTrue();
    expect(podeFechar()).toBeTrue();

    host.travado.set(true);
    fixture.detectChanges();

    // canDismiss e nao backdropDismiss: travar so o scrim deixaria o Esc e o
    // arrasto fechando, e o caso que pede isto (TV-5, "Apagando...") e'
    // justamente aquele em que fechar no meio da requisicao deixa a tela em
    // estado ambiguo.
    expect(podeFechar(undefined, 'backdrop')).toBeFalse();
    expect(podeFechar(undefined, 'gesture')).toBeFalse();
    expect(podeFechar())
      .withContext('o consumidor precisa conseguir fechar mesmo travado')
      .toBeTrue();
  });

  /**
   * Destruir o consumidor com o sheet APRESENTADO precisa desmontar o modal.
   *
   * Ao apresentar, o Ionic move o `<ion-modal>` para o `<body>`. Quando o
   * Angular destroi o consumidor, o no' fica la, apresentado: o `<body>`
   * segue com `backdrop-no-scroll` (o app inteiro para de rolar), o foco
   * continua preso num dialogo invisivel e `(fechado)` nunca e' emitido. E' o
   * caminho do "voltar" do navegador com o sheet de Cenas aberto -- e o
   * `initParentRemovalObserver` do Ionic NAO cobre esse caso.
   */
  it('ao destruir o consumidor, o sheet apresentado se desmonta sozinho', async () => {
    montar();
    await apresentado();
    const no = modal();

    expect(document.body.classList.contains('backdrop-no-scroll'))
      .withContext('precondicao: apresentar trava a rolagem da pagina')
      .toBeTrue();

    const saiu = fechou(no);
    // Sai da lista do `afterEach`: quem destroi e' o proprio teste, e e' o
    // efeito DESSA destruicao que esta sob medicao.
    criados.pop();
    fixture.destroy();
    await saiu;

    expect(document.body.classList.contains('backdrop-no-scroll'))
      .withContext('a rolagem da pagina ficou travada depois do teardown')
      .toBeFalse();
    expect(no.classList.contains('overlay-hidden'))
      .withContext('sobrou um ion-modal apresentado no <body>')
      .toBeTrue();
  });

  it('variante sheet tem breakpoints em qualquer largura', () => {
    montar(false);
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toEqual([0, 0.55]);
  });

  // O 0 e' o que permite arrastar para baixo ate fechar. Sem ele o sheet trava
  // na menor parada e o arrasto deixa de ser gesto de fechamento -- que e'
  // criterio de aceite.
  it('a menor parada e zero, senao o arrasto nao fecha', () => {
    montar();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints?.[0]).toBe(0);
  });

  // As paradas sao INPUT, e nao constante do modulo, porque a altura util e'
  // propriedade do conteudo: o Cenas trava a grade em 340px e uma parada alta
  // mostraria sheet vazio, mas o TV-6 e' uma lista que cresce sem teto. Se o
  // valor fosse fixo aqui, TV-6 so' teria como pedir 0.9 editando o shell --
  // que e' exatamente o que a spec diz que TV-4/5/6 nao devem precisar fazer.
  it('o consumidor pode sobrescrever as paradas', () => {
    media.mudarPara(true);
    const f = TestBed.createComponent(HospedeiroQueSobrescreveComponent);
    criados.push(f);
    f.detectChanges();

    const alvo = f.nativeElement.querySelector('ion-modal') as HTMLElement & {
      breakpoints?: number[];
      initialBreakpoint?: number;
    };

    expect(alvo.breakpoints).toEqual([0, 0.9]);
    expect(alvo.initialBreakpoint).toBe(0.9);
  });

  it('variante adaptavel: bottom sheet no mobile', () => {
    montar(true);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toEqual([0, 0.55]);
  });

  // TV-5 pede dialogo centralizado de 480px no desktop com o mesmo conteudo.
  // Quem decide a forma e' a PRESENCA de breakpoints: com eles o Ionic desenha
  // sheet, sem eles desenha modal centrado. A largura vem do SCSS, pela
  // custom property `--width` que o proprio `ion-modal` consome.
  it('variante adaptavel: modal centrado de 480px no desktop, sem breakpoints', () => {
    montar(false);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toBeUndefined();
    expect(alvo.classList).toContain('tour-sheet--centrado');
    expect(getComputedStyle(alvo).getPropertyValue('--width').trim()).toBe('480px');
  });

  /**
   * Girar o celular com o sheet `adaptavel` aberto precisa FECHAR o sheet.
   *
   * O Ionic decide `isSheetModal` no instante do `present()`. Trocar
   * `breakpoints` depois muda so a propriedade e a classe, e o que sobra na
   * tela e' um hibrido: caixa de 480px que continua com grabber, continua
   * arrastavel e continua deslocada -- nem sheet nem dialogo. Fechar, e deixar
   * o consumidor reabrir na forma certa, e' o conserto minimo; e ele e' do
   * SHELL porque o consumidor nao tem como saber que a largura mudou.
   */
  it('trocar a forma com o sheet aberto fecha o sheet, em vez de virar um hibrido', async () => {
    montar(true);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    await apresentado();
    expect(host.fechou).toBe(0);

    const saiu = fechou();
    // 390x844 retrato -> 844x390 paisagem: o corte de 767px foi cruzado.
    media.mudarPara(false);
    fixture.detectChanges();
    await saiu;
    fixture.detectChanges();

    expect(host.fechou)
      .withContext('o sheet ficou aberto com a forma trocada por baixo dele')
      .toBe(1);
  });

  /**
   * A area rolavel existe de verdade.
   *
   * O `.modal-wrapper` do Ionic tem `--overflow: hidden`: sem `overflow-y` no
   * proprio `.tour-sheet__conteudo`, conteudo mais alto que o sheet e'
   * CORTADO e inalcancavel, nao rolado. TV-6 e' descrito como "uma lista que
   * cresce sem teto" -- os ultimos itens ficariam fora do alcance.
   *
   * `scrollTop` e' a asserticao que importa: um elemento nao rolavel IGNORA a
   * atribuicao e continua em zero, enquanto `scrollHeight > clientHeight` e'
   * verdade ate com `overflow: visible` e passaria sem o conserto.
   */
  it('o conteudo rola quando passa da altura do sheet', async () => {
    media.mudarPara(true);
    const f = TestBed.createComponent(HospedeiroAltoComponent);
    criados.push(f);
    f.detectChanges();
    const alvo = f.nativeElement.querySelector('ion-modal') as HTMLElement;
    await apresentado(alvo);

    const conteudo = alvo.querySelector('.tour-sheet__conteudo') as HTMLElement;
    expect(conteudo.scrollHeight)
      .withContext('o conteudo de teste precisa passar da altura do sheet')
      .toBeGreaterThan(conteudo.clientHeight);

    conteudo.scrollTop = 200;

    expect(conteudo.scrollTop)
      .withContext('o conteudo foi cortado em vez de rolado')
      .toBeGreaterThan(0);
  });

  /**
   * No celular, o gesto do sheet precisa CEDER a area rolavel -- e sao dois
   * ajustes, nenhum dos dois sozinho resolve.
   *
   * O `canStart` do gesto do Ionic
   * (`@ionic/core/.../modal/gestures/sheet.js`) tem exatamente dois desvios que
   * poupam a rolagem, e ambos exigem um `contentEl`:
   *
   *   206: `if (!expandToScroll && contentEl) { ... }`
   *   210: `if (currentBreakpoint === 1 && contentEl) { ... }`
   *
   * `expandToScroll` e' `true` por padrao, e as paradas do shell sao
   * `[0, 0.55]` -- nunca 1. Alem disso `findClosestIonContent` procura
   * `closest('ion-content, .ion-content-scroll-host')`, e a area rolavel do
   * shell e' um `<div overflow-y:auto>` que nao e' nenhum dos dois: `contentEl`
   * fica `null`, os dois desvios sao pulados e o `canStart` cai no `return
   * true` da linha 224. Resultado: TODO arrasto vertical dentro do conteudo
   * vira arrasto do sheet -- para cima nao faz nada, para baixo fecha, e o
   * conteudo abaixo da dobra fica inalcancavel no APARELHO que e' o alvo do
   * dominio. No desktop a roda do mouse funciona, entao isso nao aparece numa
   * conferencia de mesa.
   *
   * Com os dois no lugar, `contentEl` passa a ser o proprio
   * `.tour-sheet__conteudo` e o desvio da linha 206 devolve
   * `scrollEl.scrollTop === 0`: o sheet so' comeca a arrastar quando a area ja'
   * esta' no topo.
   */
  it('o gesto do sheet cede a area rolavel: expandToScroll falso e scroll host', async () => {
    montar();
    await apresentado();
    const alvo = modal() as HTMLElement & { expandToScroll?: boolean };

    expect(alvo.expandToScroll)
      .withContext('sem expandToScroll=false o desvio da linha 206 do canStart nao roda')
      .toBeFalse();

    const conteudo = alvo.querySelector('.tour-sheet__conteudo') as HTMLElement;
    expect(conteudo.classList)
      .withContext('sem a classe, findClosestIonContent devolve null e o desvio e pulado')
      .toContain('ion-content-scroll-host');
  });
});
