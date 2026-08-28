import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * O diagrama do ciclo, quando o percurso fecha.
 *
 * Nao e a tela de "tour publicado" -- nada foi publicado ainda, e a etapa 3 vem
 * depois. E a confirmacao de que os toques viraram um percurso, no mesmo lugar
 * onde o percurso foi montado.
 */
@Component({
  selector: 'app-guided-cycle',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guided-cycle.component.html',
  styleUrls: ['./guided-cycle.component.scss'],
})
export class GuidedCycleComponent {
  /** Nomes dos ambientes, na ordem do percurso. */
  readonly rooms = input.required<string[]>();

  readonly continuar = output<void>();
  readonly editar = output<void>();

  readonly total = computed(() => this.rooms().length);

  /** O projeto resolve plural por sufixo `_ONE` escolhido no TypeScript. */
  readonly textoKey = computed(() =>
    this.total() === 1
      ? 'TOUR_WIZARD.STEP2.GUIDED.CYCLE_TEXT_ONE'
      : 'TOUR_WIZARD.STEP2.GUIDED.CYCLE_TEXT',
  );

  readonly primeiro = computed(() => this.rooms()[0] ?? '');
}
