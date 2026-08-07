import { Component, OnInit, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonIcon, IonSpinner,
  AlertController, ToastController
} from '@ionic/angular/standalone';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, cloudUploadOutline, downloadOutline, trashOutline, gitNetworkOutline, informationCircleOutline } from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Property } from '../models/property.model';
import { VirtualTour, Panorama } from '../models/virtual-tour.model';
import { PropertyService } from '../services/property.service';
import { VirtualTourService } from '../services/virtual-tour.service';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { dataUriToBlob, panoramaFilename, toPanoramaDataUri } from './panorama-download.util';

@Component({
  selector: 'app-inner-view-page',
  templateUrl: './inner-view-page.page.html',
  styleUrls: ['./inner-view-page.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonIcon, IonSpinner,
    PanoramicViewerComponent, AppHeaderComponent, TranslatePipe
  ]
})
export class InnerViewPagePage implements OnInit {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild(PanoramicViewerComponent) viewer!: PanoramicViewerComponent;

  property: Property | null = null;
  tour: VirtualTour | null = null;
  currentPanorama: Panorama | null = null;
  infoPanelVisible = true;
  loading = true;
  loadError = false;
  uploading = false;
  editingHotspots = false;

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private propertyService = inject(PropertyService);
  private virtualTourService = inject(VirtualTourService);
  private alertController = inject(AlertController);
  private toastController = inject(ToastController);
  private translate = inject(TranslateService);

  constructor() {
    addIcons({ eyeOutline, eyeOffOutline, cloudUploadOutline, downloadOutline, trashOutline, gitNetworkOutline, informationCircleOutline });
  }

  ngOnInit() {
    const nav = this.router.getCurrentNavigation();
    const stateProperty = nav?.extras.state?.['property'] as Property | undefined;

    const id = this.route.snapshot.paramMap.get('id')!;

    if (stateProperty) {
      this.property = stateProperty;
      if (stateProperty.virtualTour?.id) {
        this.loadTour(stateProperty.virtualTour.id);
      } else if (stateProperty.virtualTour === undefined) {
        this.propertyService.findProperty(id).subscribe({
          next: (p) => {
            this.property = p;
            if (p.virtualTour?.id) {
              this.loadTour(p.virtualTour.id);
            } else {
              this.loading = false;
            }
          },
          error: () => {
            this.loading = false;
            this.loadError = true;
          }
        });
      } else {
        this.loading = false;
      }
    } else {
      this.propertyService.findProperty(id).subscribe({
        next: (property) => {
          this.property = property;
          if (property.virtualTour?.id) {
            this.loadTour(property.virtualTour.id);
          } else {
            this.loading = false;
          }
        },
        error: () => {
          this.loading = false;
          this.loadError = true;
        }
      });
    }
  }

  onPanoramaChange(panorama: Panorama) {
    this.currentPanorama = panorama;
  }

  /** Baixa o panorama que está sendo visto como JPEG (só no cliente). */
  onDownloadPanorama() {
    if (!this.currentPanorama) return;
    try {
      const blob = dataUriToBlob(toPanoramaDataUri(this.currentPanorama.imageData));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = panoramaFilename(this.property?.title ?? '', this.currentPanorama.roomName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      this.showToast('INNER_VIEW.DOWNLOAD_SUCCESS', 'success');
    } catch {
      this.showToast('INNER_VIEW.DOWNLOAD_ERROR', 'danger');
    }
  }

  toggleHotspotEdit() {
    this.editingHotspots = !this.editingHotspots;
  }

  targetRoomName(targetId: string): string {
    return this.tour?.panoramas.find(p => p.id === targetId)?.roomName ?? '—';
  }

  async onDeleteHotspot(hotspotId: string) {
    if (!this.currentPanorama || !this.tour) return;
    try {
      await firstValueFrom(this.virtualTourService.deleteHotspot(hotspotId));
      // Update local state without re-fetching tour (avoids viewer jumping to initial panorama)
      this.currentPanorama = {
        ...this.currentPanorama,
        originHotspots: this.currentPanorama.originHotspots.filter(h => h.id !== hotspotId),
      };
      this.tour = {
        ...this.tour,
        panoramas: this.tour.panoramas.map(p =>
          p.id === this.currentPanorama!.id ? this.currentPanorama! : p
        ),
      };
      this.viewer?.reloadHotspots(this.currentPanorama);
    } catch {
      this.showToast('INNER_VIEW.HOTSPOT_ERROR', 'danger');
    }
  }

  async onHotspotPlaced(pos: { positionX: number; positionY: number }) {
    if (!this.tour || !this.currentPanorama) return;

    const options = this.tour.panoramas
      .filter(p => p.id !== this.currentPanorama!.id)
      .map(p => ({ type: 'radio' as const, label: p.roomName, value: p.id }));

    if (options.length === 0) {
      this.showToast('INNER_VIEW.HOTSPOT_NO_TARGET', 'danger');
      return;
    }

    const alert = await this.alertController.create({
      header: this.translate.instant('INNER_VIEW.HOTSPOT_SELECT_TARGET'),
      inputs: options,
      buttons: [
        { text: this.translate.instant('INNER_VIEW.DELETE_CANCEL'), role: 'cancel' },
        { text: this.translate.instant('INNER_VIEW.CONFIRM'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm' || !data?.values) return;

    try {
      await firstValueFrom(this.virtualTourService.createHotspot({
        panoramaId: this.currentPanorama.id,
        targetId: data.values,
        positionX: pos.positionX,
        positionY: pos.positionY,
      }));
      this.tour = await firstValueFrom(this.virtualTourService.findTour(this.tour.id));
      this.showToast('INNER_VIEW.HOTSPOT_CREATED', 'success');
    } catch {
      this.showToast('INNER_VIEW.HOTSPOT_ERROR', 'danger');
    }
  }

  get pageTitle(): string {
    return this.currentPanorama?.roomName ?? this.property?.title ?? 'Inner View';
  }

  openFilePicker() {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.property) return;

    const roomName = await this.promptRoomName();
    if (!roomName) return;

    this.uploading = true;
    try {
      const imageData = await this.readFileAsDataUrl(file);

      let tourId: string;
      if (this.tour) {
        await firstValueFrom(this.virtualTourService.addPanorama(this.tour.id, {
          roomName,
          imageData,
          order: this.tour.panoramas.length,
        }));
        tourId = this.tour.id;
      } else {
        const created = await firstValueFrom(this.virtualTourService.createTour(this.property.id, [
          { roomName, imageData, order: 0, initialPanorama: true },
        ]));
        tourId = created.id;
        this.property.virtualTour = { id: created.id, status: created.status };
      }

      // Create endpoints omit imageData in the response, so re-fetch the full tour
      this.tour = await firstValueFrom(this.virtualTourService.findTour(tourId));
      this.showToast('INNER_VIEW.UPLOAD_SUCCESS', 'success');
    } catch {
      this.showToast('INNER_VIEW.UPLOAD_ERROR', 'danger');
    } finally {
      this.uploading = false;
    }
  }

  async onDeleteTour() {
    if (!this.tour) return;
    const confirmed = await this.confirm(
      'INNER_VIEW.DELETE_TOUR_CONFIRM_HEADER',
      'INNER_VIEW.DELETE_TOUR_CONFIRM_MSG',
    );
    if (!confirmed) return;

    try {
      await firstValueFrom(this.virtualTourService.deleteTour(this.tour.id));
      this.router.navigate(['/home']);
    } catch {
      this.showToast('INNER_VIEW.DELETE_TOUR_ERROR', 'danger');
    }
  }

  async onDeletePanorama() {
    if (!this.tour || !this.currentPanorama) return;
    const confirmed = await this.confirm(
      'INNER_VIEW.DELETE_PANORAMA_CONFIRM_HEADER',
      'INNER_VIEW.DELETE_PANORAMA_CONFIRM_MSG',
    );
    if (!confirmed) return;

    try {
      await firstValueFrom(this.virtualTourService.deletePanorama(this.currentPanorama.id));
      const updated = await firstValueFrom(this.virtualTourService.findTour(this.tour.id));
      this.tour = updated;
      this.currentPanorama = null;
      if (updated.panoramas.length === 0) {
        this.tour = null;
      }
      this.showToast('INNER_VIEW.DELETE_PANORAMA_SUCCESS', 'success');
    } catch {
      this.showToast('INNER_VIEW.DELETE_PANORAMA_ERROR', 'danger');
    }
  }

  private async confirm(headerKey: string, messageKey: string): Promise<boolean> {
    const alert = await this.alertController.create({
      header: this.translate.instant(headerKey),
      message: this.translate.instant(messageKey),
      buttons: [
        { text: this.translate.instant('INNER_VIEW.DELETE_CANCEL'), role: 'cancel' },
        { text: this.translate.instant('INNER_VIEW.DELETE_CONFIRM'), role: 'confirm', cssClass: 'alert-danger' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  private async promptRoomName(): Promise<string | null> {
    const alert = await this.alertController.create({
      header: this.translate.instant('INNER_VIEW.ROOM_NAME_TITLE'),
      inputs: [{
        name: 'roomName',
        type: 'text',
        placeholder: this.translate.instant('INNER_VIEW.ROOM_NAME_PLACEHOLDER'),
      }],
      buttons: [
        { text: this.translate.instant('INNER_VIEW.CANCEL'), role: 'cancel' },
        { text: this.translate.instant('INNER_VIEW.CONFIRM'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    const roomName = (data?.values?.roomName ?? '').trim();
    return role === 'confirm' && roomName ? roomName : null;
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private async showToast(messageKey: string, color: 'success' | 'danger') {
    const toast = await this.toastController.create({
      message: this.translate.instant(messageKey),
      duration: 3000,
      color,
      position: 'bottom',
    });
    await toast.present();
  }

  private loadTour(tourId: string) {
    this.virtualTourService.findTour(tourId).subscribe({
      next: (tour) => {
        this.tour = tour;
        this.loading = false;
        this.virtualTourService.recordView(tourId).subscribe();
      },
      error: () => {
        this.loading = false;
        this.loadError = true;
      }
    });
  }
}
