import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import {
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PropertyPurpose,
  PropertyType,
} from '../../tour-wizard.model';
import { AddressAccordionComponent } from '../../ui/address-accordion/address-accordion.component';
import { TourSummaryComponent } from '../../ui/tour-summary/tour-summary.component';

/**
 * Etapa 3 — Informações do imóvel.
 *
 * DONO: Frente A (tarefas A9 e A10).
 *
 * Três campos visíveis e o endereço colapsado. O corte é deliberado: tudo que
 * dá para preencher depois sai da frente de quem só quer publicar o tour.
 */
@Component({
  selector: 'app-tour-step-info',
  standalone: true,
  imports: [TranslatePipe, AddressAccordionComponent, TourSummaryComponent],
  templateUrl: './step-info.component.html',
  styleUrls: ['./step-info.component.scss'],
})
export class StepInfoComponent {
  readonly store = inject(TourDraftStore);

  // Os rótulos traduzidos reusam `UPLOAD.TYPE.*` e `UPLOAD.PURPOSE.*`, que já
  // existem: são o mesmo vocabulário de domínio da tela antiga, e duplicá-los
  // só criaria duas traduções para divergirem com o tempo.
  readonly types = PROPERTY_TYPES;
  readonly purposes = PROPERTY_PURPOSES;

  onName(event: Event): void {
    this.store.patchProperty({ name: (event.target as HTMLInputElement).value });
  }

  onType(event: Event): void {
    this.store.patchProperty({
      type: (event.target as HTMLSelectElement).value as PropertyType | '',
    });
  }

  onPurpose(event: Event): void {
    this.store.patchProperty({
      purpose: (event.target as HTMLSelectElement).value as PropertyPurpose | '',
    });
  }
}
