import {
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ModalController } from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Capture360Component } from '../../../components/capture-360/capture-360.component';
import { captureSupported } from '../../../components/capture-360/capture-support';
import {
  CaptureFrameUpload,
  CaptureGeometry,
} from '../../../services/virtual-tour.service';
import { TourDraftStore } from '../../tour-draft.store';
import { SceneCardComponent } from '../../ui/scene-card/scene-card.component';

/**
 * Etapa 1 — Imagens 360°.
 *
 * DONO: Frente A (tarefas A5 e A6; a lista de ambientes é a A8).
 *
 * A imagem vem primeiro no wizard porque sem ela nada mais faz sentido, e
 * porque é o insumo mais caro de obter: quem não tem foto descobre na primeira
 * tela, não depois de preencher um formulário inteiro.
 */
@Component({
  selector: 'app-tour-step-images',
  standalone: true,
  imports: [TranslatePipe, SceneCardComponent],
  templateUrl: './step-images.component.html',
  styleUrls: ['./step-images.component.scss'],
})
export class StepImagesComponent {
  readonly store = inject(TourDraftStore);

  /**
   * ngx-translate não tem plural, e "1 imagens" é o tipo de detalhe que faz o
   * app parecer mal-acabado. Duas chaves resolvem — português e inglês
   * concordam na regra do singular.
   */
  readonly countKey = computed(() =>
    this.store.scenes().length === 1
      ? 'TOUR_WIZARD.STEP1.SCENES_COUNT_ONE'
      : 'TOUR_WIZARD.STEP1.SCENES_COUNT',
  );
  private readonly modalController = inject(ModalController);
  private readonly translate = inject(TranslateService);

  private readonly fileInput =
    viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  readonly isDragOver = signal(false);

  /**
   * `dragenter`/`dragleave` disparam também ao cruzar as bordas dos filhos, o
   * que faz o realce piscar enquanto o cursor atravessa o ícone ou os botões.
   * Contar as entradas e saídas em vez de ligar/desligar resolve: só é saída de
   * verdade quando o contador zera.
   */
  private dragDepth = 0;

  readonly cameraAvailable = captureSupported();

  // ---- entrada por arquivo -----------------------------------------------

  /**
   * Clicar em qualquer ponto do card abre o seletor. É conveniência de mouse —
   * o caminho acessível é o próprio `<input type="file">`, que fica na ordem de
   * tabulação com o rótulo visível como `<label>`, e não escondido com
   * `display: none`.
   */
  openFilePicker(): void {
    this.fileInput().nativeElement.click();
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.store.addFiles(Array.from(input.files ?? []));
    // Zerar permite reenviar o mesmo arquivo logo em seguida: sem isso o
    // `change` não dispara de novo para uma seleção idêntica.
    input.value = '';
  }

  // ---- arrastar e soltar --------------------------------------------------

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth++;
    this.isDragOver.set(true);
  }

  /** Sem `preventDefault` no dragover o navegador nunca dispara o `drop`. */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragOver.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void this.store.addFiles(files);
  }

  // ---- captura pela câmera ------------------------------------------------

  /**
   * Abre a captura 360° guiada do próprio app — não um `<input capture>`.
   *
   * O handoff sugere `capture="environment"`, que só tira uma foto comum; o
   * projeto já tem captura guiada com costura, que é o que produz um
   * equirretangular de verdade. Onde ela não roda (desktop, navegador sem
   * sensores), cai no seletor de arquivos, que é o mesmo degrau para o qual o
   * `capture` degradaria.
   */
  async openCapture(): Promise<void> {
    if (!this.cameraAvailable) {
      this.openFilePicker();
      return;
    }

    const modal = await this.modalController.create({
      component: Capture360Component,
      cssClass: 'capture-360-modal',
    });
    await modal.present();

    const { role, data } = await modal.onDidDismiss<{
      imageData: string;
      frames: CaptureFrameUpload[];
      geometry: CaptureGeometry | null;
    }>();
    if (role !== 'confirm' || !data?.imageData) return;

    // Sem perguntar o nome do ambiente aqui: ele é editável no card, logo
    // abaixo. Um diálogo modal entre a captura e o resultado interrompe quem
    // acabou de girar em torno do próprio celular por um minuto.
    const n = this.store.scenes().length + 1;
    this.store.addCapturedScene({
      room: this.translate.instant('TOUR_WIZARD.STEP1.CAPTURED_ROOM', { n }),
      fileName: `captura-360-${n}.jpg`,
      fileSize: data.imageData.length,
      imageData: data.imageData,
      frames: data.frames,
      geometry: data.geometry,
    });
  }
}
