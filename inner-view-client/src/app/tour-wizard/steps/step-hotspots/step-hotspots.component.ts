import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { FreeHotspotsComponent } from '../../hotspots/free/free-hotspots.component';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Etapa 2 — pontos de navegação.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página: o estado de edição
 * não deve sobreviver a sair da etapa 2 e voltar. E fica aqui, e não dentro do
 * modo, para os modos da etapa compartilharem a mesma instância.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [TranslatePipe, FreeHotspotsComponent],
  providers: [HotspotEditorStore],
  templateUrl: './step-hotspots.component.html',
  styleUrls: ['./step-hotspots.component.scss'],
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  /**
   * Os ambientes que o visitante não alcança, e os de onde não se sai, por
   * nome.
   *
   * Nome e não contagem: "2 ambientes sem ligação" manda procurar; "Cozinha,
   * Quarto" manda consertar. Sem os nomes, uma regra que bloqueia vira muro.
   *
   * O fallback para `fileName` é o mesmo do publicar — cena sem nome digitado
   * ainda precisa ser chamada de alguma coisa.
   */
  readonly ilhados = computed(() => this.nomes(this.draft.ambientesIlhados()));
  readonly becos = computed(() => this.nomes(this.draft.becosSemSaida()));

  private nomes(cenas: readonly WizardScene[]): string {
    return cenas.map((s) => s.room.trim() || s.fileName).join(', ');
  }
}
