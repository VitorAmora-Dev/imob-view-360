import { Component, OnInit, inject } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon, IonSearchbar, IonPopover, IonList, IonItem, IonLabel, IonFab, IonFabButton } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { personCircleOutline, globeOutline, checkmarkOutline, logOutOutline, add } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { InnerViewListComponent } from '../components/inner-view-list/inner-view-list.component';
import { PropertyService } from '../services/property.service';
import { AuthService } from '../services/auth.service';
import { Property } from '../models/property.model';
import { LanguageService } from '../services/language.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon, IonSearchbar, IonPopover, IonList, IonItem, IonLabel, IonFab, IonFabButton, InnerViewListComponent, RouterLink, TranslatePipe],
})
export class HomePage implements OnInit {
  properties: Property[] = [];
  filteredItems: Property[] = [];
  isLangPopoverOpen = false;
  langPopoverEvent?: Event;

  private propertyService = inject(PropertyService);
  private authService = inject(AuthService);
  languageService = inject(LanguageService);

  constructor() {
    addIcons({ personCircleOutline, globeOutline, checkmarkOutline, logOutOutline, add });
  }

  openLanguagePopover(event: Event) {
    this.langPopoverEvent = event;
    this.isLangPopoverOpen = true;
  }

  selectLang(lang: 'pt' | 'en') {
    this.languageService.use(lang);
    this.isLangPopoverOpen = false;
  }

  signout() {
    this.authService.signout();
  }

  ngOnInit() {
    this.propertyService.listProperties({ limit: 100 }).subscribe({
      next: (res) => {
        this.properties = res.data;
        this.filteredItems = res.data;
      },
      error: (error) => {
        console.error('Error loading properties:', error);
      }
    });
  }

  onSearch(event: any) {
    const query = (event.detail.value ?? '').toLowerCase().trim();
    this.filteredItems = query
      ? this.properties.filter(p =>
          p.title.toLowerCase().includes(query) ||
          (p.description ?? '').toLowerCase().includes(query) ||
          (p.address?.city ?? '').toLowerCase().includes(query)
        )
      : this.properties;
  }
}
