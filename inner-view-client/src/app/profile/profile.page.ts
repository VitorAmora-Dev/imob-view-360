import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonSegment, IonSegmentButton, IonLabel,
  IonGrid, IonRow, IonCol, IonCard,
  IonButton, IonIcon, IonModal, IonActionSheet, IonTextarea, IonToast, IonSearchbar
} from '@ionic/angular/standalone';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { addIcons } from 'ionicons';
import {
  shareSocialOutline, pencilOutline, trashOutline, closeOutline, copyOutline,
  homeOutline, personOutline
} from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AlertController } from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { UserService } from '../services/user.service';
import { PropertyService } from '../services/property.service';
import { UserProfile } from '../models/user.model';
import { Property } from '../models/property.model';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
    IonSegment, IonSegmentButton, IonLabel,
    IonGrid, IonRow, IonCol, IonCard,
    IonButton, IonIcon, IonModal, IonActionSheet, IonTextarea, IonToast, IonSearchbar,
    AppHeaderComponent, TranslatePipe
  ]
})
export class ProfilePage implements OnInit {
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  private userService = inject(UserService);
  private propertyService = inject(PropertyService);
  private alertController = inject(AlertController);
  private translate = inject(TranslateService);

  user: UserProfile | null = null;
  properties: Property[] = [];
  filteredProperties: Property[] = [];

  activeSegment = 'uploads';

  isEmbedModalOpen = false;
  embedLink = '';
  embedCode = '';

  isEditSheetOpen = false;
  editSheetButtons: any[] = [];

  isToastOpen = false;
  toastMessage = '';

  constructor() {
    addIcons({ shareSocialOutline, pencilOutline, trashOutline, closeOutline, copyOutline, homeOutline, personOutline });
  }

  ngOnInit() {
    this.userService.getUser().subscribe({ next: (u) => (this.user = u) });
    this.propertyService.listProperties({ limit: 100 }).subscribe({
      next: (res) => {
        this.properties = res.data;
        this.filteredProperties = res.data;
      }
    });
  }

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  onSegmentChange(event: any) {
    this.activeSegment = event.detail.value;
  }

  onSearchProperties(event: any) {
    const query = (event.detail.value ?? '').toLowerCase().trim();
    this.filteredProperties = query
      ? this.properties.filter(p =>
          p.title.toLowerCase().includes(query) ||
          (p.description ?? '').toLowerCase().includes(query)
        )
      : this.properties;
  }

  openEmbedModal(property: Property) {
    const origin = window.location.origin;
    const tourId = property.virtualTour?.id ?? '';
    this.embedLink = `${origin}/embed/${tourId}`;
    this.embedCode = `<iframe src="${origin}/embed/${tourId}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`;
    this.isEmbedModalOpen = true;
  }

  openEditSheet(property: Property) {
    this.editSheetButtons = [
      {
        text: this.translate.instant('PROFILE.ACTION_SHEET.RENAME'),
        icon: 'pencil-outline',
        handler: () => {
          this.showToast(this.translate.instant('PROFILE.TOAST.COMING_SOON'));
        }
      },
      {
        text: this.translate.instant('PROFILE.ACTION_SHEET.DELETE'),
        icon: 'trash-outline',
        role: 'destructive',
        handler: () => this.confirmAndDeleteProperty(property),
      },
      {
        text: this.translate.instant('PROFILE.ACTION_SHEET.CANCEL'),
        role: 'cancel'
      }
    ];
    this.isEditSheetOpen = true;
  }

  private async confirmAndDeleteProperty(property: Property) {
    const alert = await this.alertController.create({
      header: this.translate.instant('PROFILE.DELETE_TOUR_CONFIRM_HEADER'),
      message: this.translate.instant('PROFILE.DELETE_TOUR_CONFIRM_MSG'),
      buttons: [
        { text: this.translate.instant('PROFILE.ACTION_SHEET.CANCEL'), role: 'cancel' },
        { text: this.translate.instant('PROFILE.DELETE_CONFIRM'), role: 'confirm', cssClass: 'alert-danger' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    try {
      await firstValueFrom(this.propertyService.deleteProperty(property.id));
      this.properties = this.properties.filter(p => p.id !== property.id);
      this.filteredProperties = this.filteredProperties.filter(p => p.id !== property.id);
      this.showToast(this.translate.instant('PROFILE.DELETE_TOUR_SUCCESS'));
    } catch {
      this.showToast(this.translate.instant('PROFILE.DELETE_TOUR_ERROR'));
    }
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.showToast(this.translate.instant('PROFILE.TOAST.COPIED'));
    });
  }

  thumbnailUrl(tourId: string): string {
    return `${environment.apiUrl}/virtual-tours/${tourId}/thumbnail`;
  }

  get roleLabel(): string {
    if (!this.user) return '';
    return this.user.type === 'ADMINISTRATOR' ? 'Administrador' : 'Corretor';
  }

  private showToast(message: string) {
    this.toastMessage = message;
    this.isToastOpen = true;
  }
}
