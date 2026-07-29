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

  ngOnInit() {
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
