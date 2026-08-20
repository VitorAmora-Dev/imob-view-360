import { Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { informationCircleOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Faixa que acompanha a lista quando nenhum imóvel da conta tem tour.
 *
 * Informativa, sem ação: a ação mora nos cards, porque "2 imóveis sem tour" é
 * plural e um botão único teria de escolher um imóvel pela pessoa.
 *
 * Não é o `app-home-placeholder` porque não é placeholder de nada — não ocupa o
 * lugar de conteúdo ausente, acompanha conteúdo presente.
 */
@Component({
  selector: 'app-home-no-tour-banner',
  templateUrl: './home-no-tour-banner.component.html',
  styleUrls: ['./home-no-tour-banner.component.scss'],
  standalone: true,
  imports: [IonIcon, TranslatePipe],
})
export class HomeNoTourBannerComponent {
  /**
   * `input.required` e não `@Input` com setter: derivar `computed` de um input
   * é exatamente o que o signal input resolve, e é o que `scene-card` e
   * `hotspot-card` já fazem neste repositório. A ponte setter → signal privado
   * escreve à mão o que a API já entrega.
   *
   * Quem decide SE a faixa aparece é a HomePage. Com `count` 0 este componente
   * renderiza a chave plural — correto nos dois idiomas —, mas não é papel dele
   * se esconder.
   */
  readonly count = input.required<number>();

  /**
   * O projeto resolve plural por sufixo `_ONE` escolhido no TypeScript — mesma
   * convenção de `SCENES_COUNT_ONE` e `WARN_RATIO_ONE`.
   */
  readonly messageKey = computed(() =>
    this.count() === 1 ? 'HOME.NO_TOUR_BANNER_ONE' : 'HOME.NO_TOUR_BANNER',
  );

  readonly messageParams = computed(() => ({ n: this.count() }));

  constructor() {
    addIcons({ informationCircleOutline });
  }
}
