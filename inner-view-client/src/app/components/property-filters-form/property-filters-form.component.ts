import { Component, computed, input, output } from '@angular/core';
import { IonInput } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

import {
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PropertyPurpose,
  PropertyType,
} from '../../models/property.model';
import {
  PropertyFilters,
  limparTodos,
  temFiltros,
} from '../../home/property-filters';

/**
 * Os controles de filtro, sem opinião sobre onde estão.
 *
 * Existe separado da barra porque é montado em dois lugares — embutido no
 * desktop, dentro do bottom sheet no mobile — e renderizar os dois ao mesmo
 * tempo, escondendo um por CSS, duplicaria rótulos e ids na árvore de
 * acessibilidade. Só um dos dois existe por vez; este componente é o que os
 * dois hospedam.
 *
 * Não navega e não chama serviço: emite o filtro novo e a página resolve.
 */
@Component({
  selector: 'app-property-filters-form',
  templateUrl: './property-filters-form.component.html',
  styleUrls: ['./property-filters-form.component.scss'],
  standalone: true,
  imports: [IonInput, TranslatePipe],
})
export class PropertyFiltersFormComponent {
  readonly filters = input.required<PropertyFilters>();
  readonly filtersChange = output<PropertyFilters>();

  readonly types = PROPERTY_TYPES;
  readonly purposes = PROPERTY_PURPOSES;

  readonly mostrarLimpar = computed(() => temFiltros(this.filters()));

  onType(event: Event): void {
    const valor = (event.target as HTMLSelectElement).value;
    this.filtersChange.emit({
      ...this.filters(),
      type: (valor || null) as PropertyType | null,
    });
  }

  onPurpose(event: Event): void {
    const valor = (event.target as HTMLSelectElement).value;
    this.filtersChange.emit({
      ...this.filters(),
      purpose: (valor || null) as PropertyPurpose | null,
    });
  }

  /**
   * O debounce é do próprio `ion-input` (400 ms, no template). Ele fica ANTES
   * da navegação, e não antes da requisição: com a URL atualizada a cada tecla
   * e a busca atrasada, um link copiado no meio da digitação apontaria para um
   * resultado que a pessoa nunca viu.
   */
  onLocation(event: CustomEvent<{ value?: string | null }>): void {
    this.filtersChange.emit({
      ...this.filters(),
      location: (event.detail.value ?? '').trim(),
    });
  }

  limpar(): void {
    this.filtersChange.emit(limparTodos(this.filters()));
  }
}
