import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';

/**
 * Card de um ambiente na etapa 1.
 *
 * DONO: Frente A (tarefa A8).
 *
 * O nome é editável aqui, e não num diálogo no momento do envio: quem manda
 * oito fotos de uma vez não quer responder oito perguntas antes de ver o
 * resultado. Nomear vira uma tarefa opcional, feita olhando as miniaturas.
 */
@Component({
  selector: 'app-scene-card',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './scene-card.component.html',
  styleUrls: ['./scene-card.component.scss'],
})
export class SceneCardComponent {
  readonly scene = input.required<WizardScene>();
  /** Posição na lista, 1-based — só para rotular "Ambiente N". */
  readonly position = input.required<number>();

  private readonly store = inject(TourDraftStore);

  readonly isCover = computed(() => this.position() === 1);

  readonly sizeLabel = computed(() => formatBytes(this.scene().fileSize));

  /** Sem `type` a recusa não tem explicação: o motivo é o que diz o que fazer. */
  readonly rejectionKey = computed(
    () =>
      `TOUR_WIZARD.STEP1.REJECTED_${(this.scene().rejectedReason ?? 'type').toUpperCase()}`,
  );

  onRename(event: Event): void {
    this.store.renameScene(
      this.scene().id,
      (event.target as HTMLInputElement).value,
    );
  }

  onRemove(): void {
    this.store.removeScene(this.scene().id);
  }
}

/**
 * Tamanho legível. Usa KB/MB decimais (1000), não binários (1024): é o que o
 * sistema operacional mostra ao lado do arquivo, e divergir aí faz o corretor
 * achar que o app está medindo errado.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
