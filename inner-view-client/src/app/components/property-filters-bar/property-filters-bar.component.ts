import { Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { PropertyFilters, contarFiltros } from '../../home/property-filters';
import { PropertyFiltersFormComponent } from '../property-filters-form/property-filters-form.component';
import { PropertyFiltersSheetComponent } from '../property-filters-sheet/property-filters-sheet.component';
// O helper é genérico — um sinal de `matchMedia` que solta o listener no
// destroy — apesar de morar sob o wizard, que foi quem precisou dele primeiro.
// Movê-lo para um lugar neutro é limpeza de outro PR; duplicar a fiação do
// `matchMedia` aqui seria pior.
import { isMobileViewport } from '../../tour-wizard/hotspots/media';

/**
 * Onde os filtros ficam, dada a largura da tela.
 *
 * O ticket pede duas coisas que puxam em direções opostas: "os filtros ficam
 * visíveis e acessíveis" e "o layout não apresenta cortes ou overflow em
 * mobile". No desktop cabe uma barra; no telefone, três controles lado a lado
 * viram três controles espremidos. Então: barra embutida no desktop, botão
 * "Filtros (N)" abrindo um bottom sheet no telefone.
 *
 * Só um dos dois EXISTE por vez — não é um escondido por CSS. Ver o teste do
 * sheet ausente no desktop e o comentário de `hotspots/media.ts`.
 */
@Component({
  selector: 'app-property-filters-bar',
  templateUrl: './property-filters-bar.component.html',
  styleUrls: ['./property-filters-bar.component.scss'],
  standalone: true,
  imports: [PropertyFiltersFormComponent, PropertyFiltersSheetComponent, TranslatePipe],
})
export class PropertyFiltersBarComponent {
  readonly filters = input.required<PropertyFilters>();
  readonly filtersChange = output<PropertyFilters>();

  readonly mobile = isMobileViewport();
  readonly sheetAberto = signal(false);

  readonly quantidade = computed(() => contarFiltros(this.filters()));

  /**
   * Sem filtro o botão diz só "Filtros": "Filtros (0)" anuncia um número que
   * não quer dizer nada.
   */
  readonly rotuloKey = computed(() =>
    this.quantidade() > 0 ? 'HOME.FILTERS.TOGGLE_COUNT' : 'HOME.FILTERS.TOGGLE',
  );

  readonly rotuloParams = computed(() => ({ n: this.quantidade() }));

  abrirSheet(): void {
    this.sheetAberto.set(true);
  }

  fecharSheet(): void {
    this.sheetAberto.set(false);
  }

  aoMudar(filtros: PropertyFilters): void {
    this.filtersChange.emit(filtros);
  }
}
