import { Component, computed, input, output, signal } from '@angular/core';
import { IonIcon, IonModal } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { closeOutline, searchOutline } from 'ionicons/icons';

import { PainelDeBuscaComponent } from './painel-de-busca.component';
import {
  FILTROS_VAZIOS,
  PropertyFilters,
  criteriosAtivos,
} from '../property-filters';

/**
 * A busca da home: uma barra fechada, e o painel de três passos por trás dela.
 *
 * DONO: Frente A.
 *
 * Substitui TRÊS mecânicas que faziam o mesmo trabalho: a `ion-searchbar`, o
 * bloco de filtros (que no celular era um bottom sheet e no desktop um
 * formulário inline — dois desenhos para os mesmos campos) e os chips de
 * filtro ativo. Três caminhos para uma coisa é o problema; o que fica é um
 * alvo só, que mostra os critérios ativos e reabre o painel com um toque.
 *
 * A casca e o conteúdo são componentes separados: o conteúdo de um
 * `ion-modal` mora num `<ng-template>` e só existe no DOM depois de
 * apresentado. Ver `PainelDeBuscaComponent`.
 *
 * O `ion-modal` traz de graça o que o sheet antigo já usava e ninguém quer
 * reescrever: trava de foco, Esc, restauração de foco ao fechar e trava de
 * rolagem do fundo.
 */
@Component({
  selector: 'app-busca',
  standalone: true,
  templateUrl: './busca.component.html',
  styleUrls: ['./busca.component.scss'],
  imports: [IonIcon, IonModal, TranslatePipe, PainelDeBuscaComponent],
})
export class BuscaComponent {
  readonly filters = input.required<PropertyFilters>();
  readonly filtersChange = output<PropertyFilters>();

  readonly aberta = signal(false);

  /**
   * O que a barra fechada mostra, na ordem dos passos.
   *
   * Vazio significa "nenhum critério" — e é o que troca o resumo pelo
   * convite ("Buscar imóveis"). Ver `criteriosAtivos`.
   */
  readonly resumo = computed(() => criteriosAtivos(this.filters()));

  constructor() {
    addIcons({ searchOutline, closeOutline });
  }

  aplicar(filtros: PropertyFilters): void {
    this.filtersChange.emit(filtros);
    this.aberta.set(false);
  }

  /**
   * Limpar sem abrir o painel.
   *
   * É o atalho que os chips davam — tirar um filtro custava um toque, e não
   * abrir uma tela para desfazer o que se acabou de fazer. Com os chips fora,
   * este `×` é o que sobra desse gesto, e ele limpa TUDO: com três critérios,
   * um por um não vale a mecânica que os chips cobravam.
   */
  limpar(): void {
    this.filtersChange.emit(FILTROS_VAZIOS);
  }
}
