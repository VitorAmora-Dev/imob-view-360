import { Component, computed, input, output, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonTextarea,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { closeOutline, copyOutline } from 'ionicons/icons';

/**
 * Link público e código de `<iframe>` de um tour, prontos para copiar.
 *
 * DONO: Frente A.
 *
 * Nasceu inline dentro de `profile.page.html`, servindo só à tela de "Meus
 * imóveis". Isso deixava o embed a duas navegações de distância de onde o
 * corretor está: ele vê o imóvel na home e precisa ir procurar no perfil para
 * pegar o link. Extraído, o mesmo modal atende o card da home e o perfil, sem
 * ninguém repetir a montagem do iframe.
 *
 * Uma instância por PÁGINA, nunca por card: quem abre passa o `tourId`, e uma
 * lista de vinte imóveis segue tendo um `ion-modal` só.
 *
 * O link é o da rota `/embed/:id`, que é PÚBLICA. É a razão de o botão existir:
 * quem recebe não tem conta, e `/inner-view-page` está atrás do `authGuard`.
 */
@Component({
  selector: 'app-embed-modal',
  templateUrl: './embed-modal.component.html',
  styleUrls: ['./embed-modal.component.scss'],
  standalone: true,
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonTextarea,
    IonToast,
    TranslatePipe,
  ],
})
export class EmbedModalComponent {
  /** O tour a divulgar. `null` mantém o modal fechado. */
  readonly tourId = input<string | null>(null);

  readonly closed = output<void>();

  readonly link = computed(() => {
    const id = this.tourId();
    return id ? `${window.location.origin}/embed/${id}` : '';
  });

  readonly codigo = computed(() => {
    const url = this.link();
    return url
      ? `<iframe src="${url}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`
      : '';
  });

  /**
   * Confirmação da cópia.
   *
   * `ion-toast` declarativo aqui dentro, e não o `ToastController`: um overlay
   * criado por controller sobrevive ao componente que o criou, e este vive e
   * morre com a página que o hospeda.
   */
  readonly copiou = signal(false);

  constructor() {
    addIcons({ closeOutline, copyOutline });
  }

  fechar(): void {
    this.closed.emit();
  }

  async copiar(texto: string): Promise<void> {
    if (!texto) return;

    try {
      await navigator.clipboard.writeText(texto);
      this.copiou.set(true);
    } catch {
      // Copiar pode falhar sem permissão de área de transferência. O texto
      // continua à vista e selecionável no campo — anunciar "copiado" quando
      // não foi é pior que ficar calado.
    }
  }
}
