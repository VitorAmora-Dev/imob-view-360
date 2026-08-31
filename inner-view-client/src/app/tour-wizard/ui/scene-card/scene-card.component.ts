import { Component, computed, effect, inject, input } from '@angular/core';
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

  constructor() {
    /**
     * Cena retomada (Tarefa 9) chega sem foto — `imageData` vazio de
     * propósito, ver o campo em `tour-wizard.model.ts`. A rota de preview é
     * autenticada, então um `background-image` direto para a URL da API não
     * levaria o token; só o `PanoramaImageCache`, via store, devolve o `blob:`
     * que o CSS pode usar. Sem isto, o card de um rascunho retomado fica com a
     * miniatura vazia para sempre — ninguém mais pede por ela.
     *
     * `garantirMiniatura` e não `garantirImagem`: o que este card desenha é um
     * retângulo de 196×110, e a segunda baixa a equirretangular inteira — a
     * foto que o viewer da etapa 2 vai querer, e que ele mesmo pede quando
     * chegar a hora.
     */
    effect(() => {
      if (this.thumbUrl()) return;
      void this.store.garantirMiniatura(this.scene().id);
    });
  }

  /**
   * Fonte da miniatura: a tratada quando existe — é o que a IA entregou —,
   * senão a foto original, senão a miniatura baixada para a cena retomada.
   * Pode devolver vazio enquanto o download não responde: cabe ao template não
   * desenhar `background-image` nesse caso (ver o template — `url('')` desenha
   * ícone de imagem quebrada).
   */
  readonly thumbUrl = computed(() => {
    const cena = this.scene();
    return cena.treatedImageUrl ?? (cena.imageData || this.store.miniatura(cena.id));
  });

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

  /** Nome da ação destrutiva mesmo antes de o ambiente ser nomeado. */
  readonly accessibleName = computed(
    () => this.scene().room.trim() || this.scene().fileName,
  );

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
