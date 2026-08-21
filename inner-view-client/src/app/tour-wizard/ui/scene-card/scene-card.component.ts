import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TourDraftStore } from '../../tour-draft.store';
import { WizardScene } from '../../tour-wizard.model';
import { TrashIconComponent } from '../trash-icon/trash-icon.component';

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
  imports: [TranslatePipe, TrashIconComponent],
  templateUrl: './scene-card.component.html',
  styleUrls: ['./scene-card.component.scss'],
})
export class SceneCardComponent {
  readonly scene = input.required<WizardScene>();

  private readonly store = inject(TourDraftStore);

  /**
   * Número do ambiente entre os VÁLIDOS, 1-based. Zero quando a cena não é
   * válida — aí não há número a dar, e o card mostra o motivo da recusa no lugar
   * do badge. Contar as recusadas fazia a numeração pular junto com a do tour
   * publicado, que só conhece as válidas.
   */
  readonly roomNumber = computed(
    () =>
      this.store.readyScenes().findIndex((s) => s.id === this.scene().id) + 1,
  );

  /**
   * Capa é a primeira cena VÁLIDA, não a primeira da lista.
   *
   * Derivar da posição punha o badge num arquivo recusado sempre que ele fosse o
   * primeiro — enquanto `coverScene()` e o `initialPanorama` do payload apontavam
   * para outro. A tela dizia uma coisa e o tour publicado fazia outra.
   */
  readonly isCover = computed(
    () => this.store.coverScene()?.id === this.scene().id,
  );

  readonly sizeLabel = computed(() => formatBytes(this.scene().fileSize));

  /**
   * Este ambiente está sem nome E a pessoa já tentou avançar.
   *
   * As duas condições juntas: o card nasce sem nome de propósito (ver
   * `defaultRoomName`), então marcar de saída seria vermelho antes de erro.
   * Só cenas com imagem são cobradas — uma recusada não vira ambiente do tour.
   */
  readonly semNome = computed(
    () =>
      this.store.showErrors() &&
      this.scene().state === 'ready' &&
      !this.scene().room.trim(),
  );

  /**
   * A montagem por IA deste ambiente está em curso.
   *
   * `uploading` e `processing` juntos: para quem olha, subir as fotos e montar
   * são o mesmo "estamos trabalhando nisso", e separá-los daria duas mensagens
   * para o mesmo minuto de espera.
   */
  readonly melhorando = computed(() => {
    const ai = this.scene().aiState;
    return ai === 'uploading' || ai === 'processing';
  });

  /**
   * Terminou e ficou melhor. É o único selo que a IA ganha na etapa 1 — o
   * antes e depois de verdade acontece na etapa 2, sobre a imagem grande.
   *
   * `failed` e `skipped` não aparecem: o tour funciona igual com o panorama
   * costurado, o corretor não tem o que fazer a respeito, e um aviso ali só o
   * faria desconfiar de uma foto que está boa.
   */
  readonly melhorado = computed(() => this.scene().aiState === 'done');

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
