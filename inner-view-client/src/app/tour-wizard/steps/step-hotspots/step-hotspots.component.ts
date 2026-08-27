import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { FreeHotspotsComponent } from '../../hotspots/free/free-hotspots.component';
import { GuidedHotspotsComponent } from '../../hotspots/guided/guided-hotspots.component';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Etapa 2 — pontos de navegação, em dois modos.
 *
 * O guiado é o padrão: um toque por foto, destino derivado da sequência, e o
 * ciclo fecha. Ele é o padrão porque é o caminho que não tem como dar errado —
 * um ciclo fechado nunca produz ambiente ilhado, e é justamente ambiente ilhado
 * que bloqueia o "Próximo" desta etapa.
 *
 * O livre continua inteiro para quem tem percurso que não é um ciclo: um
 * corredor central com os cômodos pendurados nele é desenho legítimo, e o
 * comentário de `becosSemSaida` já registra isso.
 *
 * O `HotspotEditorStore` é fornecido AQUI, e não na página nem dentro de cada
 * modo. Na página, o estado de edição sobreviveria a sair da etapa e voltar;
 * dentro do modo, cada um ganharia a própria instância, e trocar de modo
 * perderia a edição no meio do caminho.
 */
@Component({
  selector: 'app-tour-step-hotspots',
  standalone: true,
  imports: [TranslatePipe, FreeHotspotsComponent, GuidedHotspotsComponent],
  providers: [HotspotEditorStore],
  templateUrl: './step-hotspots.component.html',
  styleUrls: ['./step-hotspots.component.scss'],
})
export class StepHotspotsComponent {
  readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  /** O corretor pediu o editor livre. Efêmero: sair da etapa esquece. */
  private readonly pediuLivre = signal(false);

  /**
   * Com menos de dois ambientes o assistente não tem o que pedir — não existe
   * próximo ambiente. O editor livre continua servindo: é onde se vê a foto.
   */
  readonly guiado = computed(
    () => !this.pediuLivre() && this.draft.readyScenes().length >= 2,
  );

  /** O link só faz sentido quando há dois modos para alternar. */
  readonly podeAlternar = computed(() => this.draft.readyScenes().length >= 2);

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

  alternarModo(): void {
    this.pediuLivre.update((v) => !v);
  }

  private nomes(cenas: readonly WizardScene[]): string {
    return cenas.map((s) => s.room.trim() || s.fileName).join(', ');
  }
}
