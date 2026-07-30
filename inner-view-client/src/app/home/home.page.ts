import { Component, OnInit, ViewChild, inject } from '@angular/core';
import { IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { add } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { InnerViewListComponent } from '../components/inner-view-list/inner-view-list.component';
import { PropertyService } from '../services/property.service';
import { Property } from '../models/property.model';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton,
    AppHeaderComponent, InnerViewListComponent, RouterLink, TranslatePipe,
  ],
})
export class HomePage implements OnInit {
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  properties: Property[] = [];
  filteredItems: Property[] = [];

  private propertyService = inject(PropertyService);

  constructor() {
    addIcons({ add });
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

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
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
