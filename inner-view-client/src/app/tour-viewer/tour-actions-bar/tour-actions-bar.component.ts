import { Component, computed, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import {
  eyeOffOutline,
  eyeOutline,
  pencilOutline,
  phoneLandscapeOutline,
  phonePortraitOutline,
  shareSocialOutline,
} from 'ionicons/icons';

/**
 * Ações do tour no alcance do polegar: EDITAR, OCULTAR e COMPARTILHAR.
 *
 * A barra só comunica intenção: abrir o editor, alternar o modo imersivo e
 * abrir o sheet Compartilhar são decisões do shell, nunca efeitos executados
 * por este componente.
 *
 * ELA NÃO SOME INTEIRA NO IMERSIVO, e é a única peça de chrome nessa situação.
 * O botão de ocultar era flutuante e sobrevivia ao imersivo justamente porque
 * era ele o caminho de volta; ao trazê-lo para cá, a barra herdou esse papel.
 * Escondê-la por completo deixaria como único jeito de recuperar a interface um
 * toque na foto — que não tem afordância nenhuma e que ninguém descobre. O que
 * some é a BARRA: a placa de vidro, a borda e os outros dois botões. Fica um
 * botão redondo, do mesmo tamanho e no mesmo espírito do antigo flutuante.
 */
@Component({
  selector: 'app-tour-actions-bar',
  standalone: true,
  imports: [IonIcon, TranslatePipe],
  templateUrl: './tour-actions-bar.component.html',
  styleUrls: ['./tour-actions-bar.component.scss'],
  host: {
    '[class.is-imersivo]': '!chromeVisible()',
  },
})
export class TourActionsBarComponent {
  readonly canEdit = input.required<boolean>();
  readonly hasScenes = input.required<boolean>();
  readonly chromeVisible = input.required<boolean>();
  readonly deitado = input.required<boolean>();

  readonly editRequested = output<void>();
  readonly shareRequested = output<void>();
  readonly visibilityToggled = output<void>();
  readonly orientationToggled = output<void>();

  /**
   * Tour sem cena nenhuma não tem o que compartilhar: quem recebesse o link
   * abriria uma tela vazia. Mesma regra que o EMBED tinha antes de virar aba
   * do Compartilhar — inclusive a exceção de quem não pode editar, para quem a
   * barra não pode ficar sem ação nenhuma.
   */
  readonly podeCompartilhar = computed(() => this.hasScenes() || !this.canEdit());

  /**
   * O rótulo diz a AÇÃO, não o estado: "Ocultar" quando há o que ocultar.
   *
   * Sem `aria-pressed` de propósito, ao contrário do botão flutuante que este
   * substitui. Com o nome acessível mudando junto, o par vira contradição — o
   * leitor de tela anunciava "Mostrar interface, pressionado", que descreve o
   * modo imersivo usando o rótulo da ação que sai dele.
   */
  readonly chaveDaVisibilidade = computed(() =>
    this.chromeVisible() ? 'TOUR_VIEWER.HIDE_UI' : 'TOUR_VIEWER.SHOW_UI',
  );

  readonly chaveCurtaDaVisibilidade = computed(() =>
    this.chromeVisible() ? 'TOUR_VIEWER.ACTIONS.HIDE' : 'TOUR_VIEWER.ACTIONS.SHOW',
  );

  /** O ícone mostra o que o toque FAZ, como no cluster do desktop. */
  readonly iconeDaVisibilidade = computed(() =>
    this.chromeVisible() ? 'eye-off-outline' : 'eye-outline',
  );

  /**
   * Deitar a tela: o mesmo par rótulo/ícone da visibilidade, pelo mesmo motivo.
   *
   * Sai no imersivo, e não fica junto do de ocultar: o invariante desta barra é
   * que o imersivo deixa UM botão, e ele já é o caminho de volta para os dois —
   * devolver a interface traz este botão de novo.
   */
  readonly chaveDaOrientacao = computed(() =>
    this.deitado() ? 'TOUR_VIEWER.ACTIONS.PORTRAIT_LONG' : 'TOUR_VIEWER.ACTIONS.LANDSCAPE_LONG',
  );

  readonly chaveCurtaDaOrientacao = computed(() =>
    this.deitado() ? 'TOUR_VIEWER.ACTIONS.PORTRAIT' : 'TOUR_VIEWER.ACTIONS.LANDSCAPE',
  );

  readonly iconeDaOrientacao = computed(() =>
    this.deitado() ? 'phone-portrait-outline' : 'phone-landscape-outline',
  );

  constructor() {
    addIcons({
      pencilOutline,
      eyeOutline,
      eyeOffOutline,
      shareSocialOutline,
      phoneLandscapeOutline,
      phonePortraitOutline,
    });
  }
}
