import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';
import { TourDraftStore } from '../../tour-draft.store';

/**
 * Painel de hotspots do desktop (tarefa B6).
 *
 * DONO: Frente B.
 *
 * É onde o ponto ganha nome e destino. No mobile o mesmo conteúdo vive no
 * bottom sheet (B8) — aqui ele fica sempre aberto ao lado do viewer, porque há
 * largura para isso e porque ver a lista inteira enquanto se olha a foto é o
 * que deixa o corretor perceber que esqueceu um destino.
 *
 * SEM seletor de tipo, ao contrário do handoff: o hotspot de informação está
 * cortado deste sprint (§2.1 do plano), e um seletor com uma opção só é ruído.
 */
@Component({
  selector: 'app-hotspot-panel',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './hotspot-panel.component.html',
  styleUrls: ['./hotspot-panel.component.scss'],
})
export class HotspotPanelComponent {
  private readonly draft = inject(TourDraftStore);
  readonly editor = inject(HotspotEditorStore);

  readonly hotspots = computed(() => this.editor.hotspots());
  readonly targets = computed(() => this.editor.targetOptions());

  /**
   * Não há para onde apontar quando o tour tem um ambiente só.
   *
   * O select fica de fora nesse caso, com uma explicação no lugar: um campo
   * vazio e sem opções faz o corretor procurar o que fazer de errado, quando na
   * verdade falta uma foto na etapa 1.
   */
  readonly hasTargets = computed(() => this.targets().length > 0);

  onLabel(id: string, event: Event): void {
    this.editor.update(id, { label: (event.target as HTMLInputElement).value });
  }

  /** `''` no select é "sem destino", que é um estado válido — e o inicial. */
  onTarget(id: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.editor.update(id, { target: value || null });
  }

  remove(id: string): void {
    this.editor.remove(id);
  }
}
