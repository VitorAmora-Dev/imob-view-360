import { Component, Input, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonCard, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { homeOutline } from 'ionicons/icons';
import { Property } from '../../models/property.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-inner-view-card',
  templateUrl: './inner-view-card.component.html',
  styleUrls: ['./inner-view-card.component.scss'],
  standalone: true,
  imports: [IonCard, IonIcon]
})
export class InnerViewCardComponent {
  @Input() item!: Property;

  private router = inject(Router);

  constructor() {
    addIcons({ homeOutline });
  }

  onCardClick() {
    this.router.navigate(['/inner-view-page', this.item.id], {
      state: { property: this.item },
    });
  }

  get thumbnailUrl(): string {
    return `${environment.apiUrl}/virtual-tours/${this.item.virtualTour!.id}/thumbnail`;
  }

  get locationLabel(): string {
    const a = this.item.address;
    if (!a) return '';
    return [a.district, a.city, a.state].filter(Boolean).join(' · ');
  }

  get priceLabel(): string {
    if (!this.item.price) return '';
    return `R$ ${this.item.price.toLocaleString('pt-BR')}`;
  }
}
