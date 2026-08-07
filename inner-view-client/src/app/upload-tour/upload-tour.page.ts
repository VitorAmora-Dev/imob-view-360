import { Component, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
  IonList, IonSpinner, IonModal, IonNote,
  ActionSheetController, AlertController, ModalController, ToastController,
} from '@ionic/angular/standalone';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { addIcons } from 'ionicons';
import { addCircleOutline, cameraOutline, imageOutline, trashOutline, eyeOutline, closeOutline } from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { PropertyService } from '../services/property.service';
import { CepService, CepNotFoundError } from '../services/cep.service';
import {
  CaptureFrameUpload,
  CaptureGeometry,
  VirtualTourService,
} from '../services/virtual-tour.service';
import { Panorama } from '../models/virtual-tour.model';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { Capture360Component } from '../components/capture-360/capture-360.component';
import { captureSupported } from '../components/capture-360/capture-support';

interface PanoramaItem {
  roomName: string;
  imageData: string;
  fileName: string;
  /** Originals from a guided capture; empty for an uploaded file. */
  frames?: CaptureFrameUpload[];
  /** What the stitch measured; absent for an uploaded file. */
  geometry?: CaptureGeometry | null;
}

@Component({
  selector: 'app-upload-tour',
  templateUrl: './upload-tour.page.html',
  styleUrls: ['./upload-tour.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
    IonButton, IonIcon, IonItem, IonLabel, IonInput, IonSelect, IonSelectOption,
    IonList, IonSpinner, IonModal, IonNote,
    PanoramicViewerComponent,
    AppHeaderComponent,
    TranslatePipe,
  ],
})
export class UploadTourPage {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  title = '';
  type = '';
  purpose = '';
  cep = '';
  street = '';
  number = '';
  complement = '';
  district = '';
  city = '';
  state = '';
  cepLoading = false;
  private lastLookedUpCep = '';
  panoramas: PanoramaItem[] = [];
  submitting = false;
  isPreviewOpen = false;
  previewPanoramas: Panorama[] = [];

  readonly propertyTypes = ['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'RURAL', 'OFFICE'];
  readonly purposes = ['SALE', 'RENT', 'SALE_OR_RENT'];

  private router = inject(Router);
  private propertyService = inject(PropertyService);
  private cepService = inject(CepService);
  private virtualTourService = inject(VirtualTourService);
  private alertController = inject(AlertController);
  private actionSheetController = inject(ActionSheetController);
  private modalController = inject(ModalController);
  private toastController = inject(ToastController);
  private translate = inject(TranslateService);

  constructor() {
    addIcons({ addCircleOutline, cameraOutline, imageOutline, trashOutline, eyeOutline, closeOutline });
  }

  get canSubmit(): boolean {
    return !!(this.title.trim() && this.type && this.purpose) && this.addressValid && !this.submitting;
  }

  get addressIncomplete(): boolean {
    return this.addressTouched && !this.addressValid;
  }

  private get addressTouched(): boolean {
    return !!(
      this.cep.trim() || this.street.trim() || this.number.trim() || this.complement.trim() ||
      this.district.trim() || this.city.trim() || this.state.trim()
    );
  }

  private get addressValid(): boolean {
    if (!this.addressTouched) return true;
    return !!(this.street.trim() && this.city.trim() && this.state.trim().length === 2);
  }

  onCepInput(event: CustomEvent) {
    const raw = (event.detail.value ?? '') as string;
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    this.cep = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    const input = event.target as HTMLIonInputElement;
    input.value = this.cep;

    if (digits.length === 8 && digits !== this.lastLookedUpCep) {
      this.lookupCep(digits);
    }
  }

  onCepBlur() {
    const digits = this.cep.replace(/\D/g, '');
    if (digits.length === 8 && digits !== this.lastLookedUpCep) {
      this.lookupCep(digits);
    }
  }

  private async lookupCep(digits: string) {
    this.cepLoading = true;
    this.lastLookedUpCep = digits;
    try {
      const address = await firstValueFrom(this.cepService.lookup(digits));
      this.street = address.street;
      this.district = address.district ?? '';
      this.city = address.city;
      this.state = address.state;
      this.complement = address.complement ?? '';
    } catch (error) {
      const key = error instanceof CepNotFoundError ? 'UPLOAD.ADDRESS.CEP_NOT_FOUND' : 'UPLOAD.ADDRESS.CEP_LOOKUP_ERROR';
      this.showToast(key, 'danger');
    } finally {
      this.cepLoading = false;
    }
  }

  openFilePicker() {
    this.fileInput.nativeElement.click();
  }

  async addImage() {
    if (!captureSupported()) {
      this.openFilePicker();
      return;
    }
    const sheet = await this.actionSheetController.create({
      header: this.translate.instant('CAPTURE.ADD_METHOD_TITLE'),
      buttons: [
        { text: this.translate.instant('CAPTURE.WITH_CAMERA'), icon: 'camera-outline', data: 'capture' },
        { text: this.translate.instant('CAPTURE.FROM_FILE'), icon: 'image-outline', data: 'file' },
        { text: this.translate.instant('INNER_VIEW.CANCEL'), role: 'cancel' },
      ],
    });
    await sheet.present();
    const { data } = await sheet.onDidDismiss();
    if (data === 'capture') {
      await this.openCapture();
    } else if (data === 'file') {
      this.openFilePicker();
    }
  }

  private async openCapture() {
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

    const roomName = await this.promptRoomName();
    if (!roomName) return;

    this.panoramas.push({
      roomName,
      imageData: data.imageData,
      fileName: `captura-360-${this.panoramas.length + 1}.jpg`,
      frames: data.frames,
      geometry: data.geometry,
    });
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const roomName = await this.promptRoomName();
    if (!roomName) return;

    const imageData = await this.readFileAsDataUrl(file);
    this.panoramas.push({ roomName, imageData, fileName: file.name });
  }

  removePanorama(index: number) {
    this.panoramas.splice(index, 1);
  }

  openPreview() {
    this.previewPanoramas = this.panoramas.map((p, i) => ({
      id: `preview-${i}`,
      roomName: p.roomName,
      imageData: p.imageData,
      order: i,
      initialPanorama: i === 0,
      originHotspots: [],
      measurements: [],
    }));
    this.isPreviewOpen = true;
  }

  async onSubmit() {
    if (!this.canSubmit) return;

    this.submitting = true;
    try {
      const code = `IML-${Date.now().toString(36).toUpperCase()}`;
      const address = this.addressTouched
        ? {
            street: this.street.trim(),
            number: this.number.trim() || undefined,
            complement: this.complement.trim() || undefined,
            district: this.district.trim() || undefined,
            city: this.city.trim(),
            state: this.state.trim().toUpperCase(),
            zipCode: this.cep.replace(/\D/g, '') || undefined,
          }
        : undefined;
      const property = await firstValueFrom(
        this.propertyService.createProperty({
          code,
          title: this.title.trim(),
          type: this.type,
          purpose: this.purpose,
          ...(address ? { address } : {}),
        })
      );

      if (this.panoramas.length > 0) {
        const tour = await firstValueFrom(
          this.virtualTourService.createTour(
            property.id,
            this.panoramas.map((p, i) => ({
              roomName: p.roomName,
              imageData: p.imageData,
              order: i,
              initialPanorama: i === 0,
              ...(p.geometry ?? {}),
            }))
          )
        );
        // The tour is saved; the originals are an archive that follows it up in
        // the background, matched to the panorama that came from them by order.
        for (const [i, item] of this.panoramas.entries()) {
          const panorama = tour.panoramas.find((p) => p.order === i);
          if (panorama && item.frames?.length) {
            void this.virtualTourService.uploadCaptureFrames(panorama.id, item.frames);
          }
        }
      }

      await this.showToast('UPLOAD.SUCCESS', 'success');
      this.router.navigate(['/home']);
    } catch {
      this.showToast('UPLOAD.ERROR', 'danger');
    } finally {
      this.submitting = false;
    }
  }

  private async promptRoomName(): Promise<string | null> {
    const alert = await this.alertController.create({
      header: this.translate.instant('INNER_VIEW.ROOM_NAME_TITLE'),
      inputs: [{ name: 'roomName', type: 'text', placeholder: this.translate.instant('INNER_VIEW.ROOM_NAME_PLACEHOLDER') }],
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
}
