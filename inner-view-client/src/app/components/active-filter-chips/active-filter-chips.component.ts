import { Component, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';

import { FilterChip } from '../../home/property-filters';

/**
 * Os filtros ativos, à vista e removíveis um a um.
 *
 * Visível nas duas larguras, inclusive no mobile onde os controles estão
 * escondidos dentro do sheet: sem os chips, a única pista de que há filtro
 * ligado seria o número no botão, e uma lista curta sem explicação parece
 * acervo vazio.
 */
@Component({
  selector: 'app-active-filter-chips',
  templateUrl: './active-filter-chips.component.html',
  styleUrls: ['./active-filter-chips.component.scss'],
  standalone: true,
  imports: [IonIcon, TranslatePipe],
})
export class ActiveFilterChipsComponent {
  readonly chips = input.required<FilterChip[]>();
  readonly remove = output<FilterChip['key']>();
  readonly clear = output<void>();

  constructor() {
    addIcons({ closeOutline });
  }
}
