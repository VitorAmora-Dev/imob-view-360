import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { HotspotCardComponent } from '../hotspot-card/hotspot-card.component';

/**
 * Painel de hotspots do desktop (tarefa B6).
 *
 * DONO: Frente B.
 *
 * É a lista sempre aberta ao lado do viewer: há largura para isso, e ver todos
 * os pontos enquanto se olha a foto é o que faz o corretor perceber que
 * esqueceu um destino. No mobile não cabe, e o mesmo card vive no bottom sheet
 * (B8) — o formulário em si é o `HotspotCardComponent`, um só para as duas
 * telas.
 *
 * SEM seletor de tipo, ao contrário do handoff: o hotspot de informação está
 * cortado deste sprint (§2.1 do plano), e um seletor com uma opção só é ruído.
 */
@Component({
  selector: 'app-hotspot-panel',
  standalone: true,
  imports: [TranslatePipe, HotspotCardComponent],
  templateUrl: './hotspot-panel.component.html',
  styleUrls: ['./hotspot-panel.component.scss'],
})
export class HotspotPanelComponent {
  readonly editor = inject(HotspotEditorStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  constructor() {
    /**
     * Clicar num pin sem destino pede "edite este ponto". No mobile isso abre o
     * bottom sheet; no desktop o painel já está aberto, então o equivalente é
     * levar o foco ao campo daquele ponto — senão o clique no pin não teria
     * resposta nenhuma numa lista de oito cards.
     *
     * No mobile este painel está com `display: none` e o `focus()` num elemento
     * escondido não faz nada — quem responde lá é o sheet, com o mesmo estado.
     *
     * O `afterNextRender` não é cerimônia. Aqui dizia que "o card já existe
     * quando se chega aqui, porque o editor é aberto a partir de um pin, e pin
     * só existe para hotspot que já está na lista" — e isso deixou de ser
     * verdade no dia em que criar um ponto passou a abrir a edição dele. Nesse
     * caminho o hotspot nasce e o editor abre no MESMO tick: o `querySelector`
     * corria antes de o `@for` criar o card, achava `null`, e no desktop o
     * clique na foto não tinha resposta nenhuma — nem sheet, que lá não abre,
     * nem foco. Medido: `document.activeElement` seguia em BODY a 768px e a
     * 900px, enquanto a 390px o sheet abria normalmente.
     */
    effect(() => {
      // Depende do ID pedido, e não do objeto `editing()`. O objeto muda de
      // identidade a cada mutação do próprio ponto, e este efeito então
      // re-rodava a cada tecla e a cada `pointermove` de arraste — na prática,
      // escolher um destino no <select> devolvia o foco para o campo de nome no
      // meio da interação. Reproduzido no navegador: SELECT → INPUT.tw-hp__name.
      //
      // `sheet()` só muda quando alguém pede outra coisa, que é exatamente
      // quando levar o foco faz sentido.
      const estado = this.editor.sheet();
      if (estado?.mode !== 'editor') return;

      afterNextRender(
        () => {
          const campo = this.host.nativeElement.querySelector<HTMLInputElement>(
            `#hs-label-${CSS.escape(estado.hotspotId)}`,
          );
          campo?.focus();
          campo?.scrollIntoView({ block: 'nearest' });
        },
        { injector: this.injector },
      );
    });
  }

  readonly hotspots = computed(() => this.editor.hotspots());
}
