import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { Property } from '../models/property.model';
import { TourViewerStore } from './tour-viewer.store';

/**
 * Visualização de um tour, pelo DONO dele (SPRINT-4-TOUR-VIEWER.md).
 *
 * Esta página é só o ARRANJO. Ela não tem estado próprio e quase não tem
 * comportamento: quem sabe das coisas é o `TourViewerStore`, e quem as desenha
 * são os componentes de cada frente, encaixados nos slots do template.
 *
 * O arranjo nasceu pronto no commit-zero (TV-0) exatamente por isso: é o único
 * arquivo que as três frentes tocariam, e um template que cresce por três lados
 * ao mesmo tempo é conflito garantido. Cada frente substitui o SEU marcador no
 * `.html` e não mexe no resto.
 *
 * A rota é `inner-view-page/:id`, e o `:id` é o do IMÓVEL — não o do tour.
 * Decisão D10 do plano: mudar isso arrastaria home, cards, guards e todo link
 * que já foi enviado por aí.
 */
@Component({
  selector: 'app-tour-viewer',
  templateUrl: './tour-viewer.page.html',
  styleUrls: ['./tour-viewer.page.scss'],
  standalone: true,
  providers: [TourViewerStore],
  imports: [IonContent, IonSpinner, PanoramicViewerComponent, TranslatePipe],
})
export class TourViewerPage implements OnInit {
  readonly store = inject(TourViewerStore);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/home']);
      return;
    }

    // A home navega com o imóvel já em mãos. Aproveitar isso é o que evita uma
    // tela cinza de meio segundo em cima de um dado que já estava carregado.
    const emMemoria = this.router.getCurrentNavigation()?.extras.state?.['property'] as
      | Property
      | undefined;

    void this.store.carregar(id, emMemoria);
  }

  /** O EDITAR da tab bar e do cluster do desktop. Destino real: TV-11. */
  editarTour(): void {
    const id = this.store.tourId();
    if (!id) return;

    this.store.mostrarToast('TOUR_VIEWER.TOAST.OPENING_EDITOR');
    void this.router.navigate(['/tour/novo'], { queryParams: { rascunho: id } });
  }

  voltar(): void {
    void this.router.navigate(['/home']);
  }
}
