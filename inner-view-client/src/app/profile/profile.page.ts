import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonSegment, IonSegmentButton, IonLabel,
  IonGrid, IonRow, IonCol, IonCard,
  IonButton, IonIcon, IonActionSheet, IonToast, IonSearchbar
} from '@ionic/angular/standalone';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { EmbedModalComponent } from '../components/embed-modal/embed-modal.component';
import { addIcons } from 'ionicons';
import {
  pencilOutline, trashOutline, copyOutline,
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
    IonContent,
    IonSegment, IonSegmentButton, IonLabel,
    IonGrid, IonRow, IonCol, IonCard,
    IonButton, IonIcon, IonActionSheet, IonToast, IonSearchbar,
    AppHeaderComponent, EmbedModalComponent, TranslatePipe
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

  /** Tour aberto no modal de embed, ou `null`. O modal monta link e iframe. */
  embedTourId: string | null = null;

  isEditSheetOpen = false;
  editSheetButtons: any[] = [];

  isToastOpen = false;
  toastMessage = '';

  constructor() {
    addIcons({ pencilOutline, trashOutline, copyOutline, homeOutline, personOutline });
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
    this.embedTourId = property.virtualTour?.id ?? null;
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
