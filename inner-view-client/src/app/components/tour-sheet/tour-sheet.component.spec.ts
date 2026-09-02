import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';

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
      [titulo]="'Cenas do tour'"
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
  readonly sub = signal<string | null>('3 cenas');
  readonly variante = signal<'sheet' | 'adaptavel'>('sheet');
  readonly travado = signal(false);
  fechou = 0;
}

describe('TourSheetComponent', () => {
  let fixture: ComponentFixture<HospedeiroDeTesteComponent>;
  let host: HospedeiroDeTesteComponent;
  let alvoModal: HTMLElement;

  /**
   * Dublê de `MediaQueryList`. A viewport do Karma é a que for, e o teste
   * precisa poder dizer "isto é um celular" sem depender do tamanho da janela
   * de quem roda a suíte. Mesmo padrão de `hotspot-sheet.component.spec.ts`.
   */
  function mediaFalsa(matches: boolean): MediaQueryList {
    return {
      matches,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  }

  function montar(mobile = true): void {
    spyOn(window, 'matchMedia').and.returnValue(mediaFalsa(mobile));
    fixture = TestBed.createComponent(HospedeiroDeTesteComponent);
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
  function apresentado(): Promise<void> {
    return new Promise((resolve) => {
      modal().addEventListener('didPresent', () => resolve(), { once: true });
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HospedeiroDeTesteComponent],
      providers: [provideIonicAngular()],
    }).compileComponents();
  });

  /**
   * Um `IonModal` apresentado prende o foco no DOCUMENTO, que e' um so para a
   * suite inteira, e sobrevive ao teardown do TestBed. Sem esta limpeza, um
   * modal desta suite aparece em `document.activeElement` na suite seguinte --
   * exatamente a falha intermitente que `hotspot-sheet.component.spec.ts` ja
   * documenta no seu proprio `afterEach`.
   */
  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('ion-modal').forEach((m) => m.remove());
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

  // Os tres gestos de fechar -- scrim, arrasto e Esc -- desembocam todos no
  // mesmo didDismiss do Ionic. Provar que ele emite (fechado) prova os tres;
  // simular o gesto em si seria testar o Ionic.
  it('o fechamento do modal vira (fechado)', () => {
    montar();
    expect(host.fechou).toBe(0);

    // O evento do DOM chama-se `didDismiss`, e nao `ionModalDidDismiss`: o
    // `proxyOutputs` do `IonModal` liga cada `@Output` ao evento de MESMO
    // nome, e `didDismiss` e' o atalho que o `ion-modal` emite ao lado do
    // longo. Disparar o longo aqui nao acordaria a ligacao do template.
    modal().dispatchEvent(new CustomEvent('didDismiss', { detail: { role: 'backdrop' } }));
    fixture.detectChanges();

    expect(host.fechou).toBe(1);
  });

  it('travado recusa o fechamento, e destravado permite', () => {
    montar();
    const alvo = modal() as HTMLElement & { canDismiss: boolean };

    expect(alvo.canDismiss).toBeTrue();

    host.travado.set(true);
    fixture.detectChanges();

    // canDismiss e nao backdropDismiss: travar so o scrim deixaria o Esc e o
    // arrasto fechando, e o caso que pede isto (TV-5, "Apagando...") e'
    // justamente aquele em que fechar no meio da requisicao deixa a tela em
    // estado ambiguo.
    expect(alvo.canDismiss).toBeFalse();
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

  it('variante adaptavel: bottom sheet no mobile', () => {
    montar(true);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toEqual([0, 0.55]);
  });

  // TV-5 pede dialogo centralizado de 480px no desktop com o mesmo conteudo.
  // Quem decide a forma e' a PRESENCA de breakpoints: com eles o Ionic desenha
  // sheet, sem eles desenha modal centrado.
  it('variante adaptavel: modal centrado no desktop, sem breakpoints', () => {
    montar(false);
    host.variante.set('adaptavel');
    fixture.detectChanges();
    const alvo = modal() as HTMLElement & { breakpoints?: number[] };

    expect(alvo.breakpoints).toBeUndefined();
    expect(alvo.classList).toContain('tour-sheet--centrado');
  });
});
