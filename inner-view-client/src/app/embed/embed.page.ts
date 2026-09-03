import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { VirtualTour } from '../models/virtual-tour.model';
import { VirtualTourService } from '../services/virtual-tour.service';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';

@Component({
  selector: 'app-embed',
  templateUrl: './embed.page.html',
  styleUrls: ['./embed.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonSpinner, PanoramicViewerComponent]
})
export class EmbedPage implements OnInit {
  private route = inject(ActivatedRoute);
  private virtualTourService = inject(VirtualTourService);

  tour: VirtualTour | null = null;
  loadError = false;

  /**
   * A navegação entre ambientes aparece dentro do iframe.
   *
   * É a outra metade do interruptor "Mostrar controles" do sheet Incorporar
   * (TV-4): lá `TourViewerStore.linkPublico()` acrescenta `?controles=0` ao
   * link, e é AQUI que esse parâmetro vira alguma coisa. Sem esta leitura o
   * interruptor gerava uma URL diferente e um embed idêntico — o pior tipo de
   * defeito, porque a tela de quem configura mostra que funcionou.
   *
   * Lido no `snapshot`, e não observado: um embed não troca de parâmetro sem
   * recarregar o iframe inteiro.
   *
   * Ligado por padrão, e só `controles=0` desliga. Qualquer outro valor —
   * ausente, vazio, `1`, lixo — mantém os controles: um parâmetro que alguém
   * digitou errado não deveria mutilar silenciosamente o tour de quem incorpora.
   */
  mostrarControles = true;

  ngOnInit() {
    this.mostrarControles = this.route.snapshot.queryParamMap.get('controles') !== '0';

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.loadError = true; return; }

    this.virtualTourService.findTour(id).subscribe({
      next: (tour) => {
        this.tour = tour;
        this.virtualTourService.recordView(id).subscribe();
      },
      error: () => { this.loadError = true; }
    });
  }
}
