import { Component, inject, input, output } from '@angular/core';
import { IonContent, IonModal } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PropertyFilters } from '../../home/property-filters';
import { PropertyFiltersFormComponent } from '../property-filters-form/property-filters-form.component';

/**
 * Os filtros no telefone.
 *
 * `IonModal` com `breakpoints` e não um painel à mão: arrastar para baixo,
 * prender o foco, fechar no Esc, devolver o foco a quem abriu e a animação de
 * entrada vêm prontos — mesma decisão do `hotspot-sheet`, e pelo mesmo motivo.
 *
 * Aplica AO VIVO: mexer num controle aqui dentro já navega e já refiltra, igual
 * ao desktop. O botão do rodapé só fecha. Acumular aqui e aplicar no botão
 * daria ao mobile um estado de filtro que o desktop não tem, e com ele um
 * "cancelar" que precisa desfazer.
 */
@Component({
  selector: 'app-property-filters-sheet',
  templateUrl: './property-filters-sheet.component.html',
  styleUrls: ['./property-filters-sheet.component.scss'],
  standalone: true,
  imports: [IonModal, IonContent, TranslatePipe, PropertyFiltersFormComponent],
})
export class PropertyFiltersSheetComponent {
  private readonly translate = inject(TranslateService);

  readonly filters = input.required<PropertyFilters>();
  readonly isOpen = input.required<boolean>();

  readonly filtersChange = output<PropertyFilters>();
  readonly closed = output<void>();

  /** O `0` é o que permite arrastar para baixo até fechar. */
  readonly breakpoints = [0, 0.6, 0.95];
  readonly initialBreakpoint = 0.6;

  aoMudar(filtros: PropertyFilters): void {
    this.filtersChange.emit(filtros);
  }

  close(): void {
    this.closed.emit();
  }

  /**
   * Dá nome ao diálogo, entrando no shadow DOM do Ionic.
   *
   * O `role="dialog"` não fica no `<ion-modal>`, e sim num `.modal-wrapper`
   * dentro do shadow root; `aria-label` no host nomeia o host, que é um nó
   * genérico, e `aria-labelledby` não atravessa fronteira de shadow. O
   * levantamento inteiro, feito com a árvore de acessibilidade na mão, está em
   * `hotspot-sheet.component.ts` — aqui é a mesma solução com um título fixo,
   * que dispensa o effect de lá.
   */
  nomearDialogo(event: Event): void {
    const modal = event.target as HTMLElement;
    modal.shadowRoot
      ?.querySelector('.modal-wrapper')
      ?.setAttribute(
        'aria-label',
        this.translate.instant('HOME.FILTERS.SHEET_TITLE'),
      );
  }
}
