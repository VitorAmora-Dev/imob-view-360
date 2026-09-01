import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonCard, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heartOutline, heart, homeOutline } from 'ionicons/icons';
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

  @Output() likeChange = new EventEmitter<boolean>();

  liked = false;

  private router = inject(Router);

  constructor() {
    addIcons({ heartOutline, heart, homeOutline });
  }

  onCardClick() {
    this.router.navigate(['/inner-view-page', this.item.id], {
      state: { property: this.item },
    });
  }

  onLike(event: Event) {
    event.stopPropagation();
    this.liked = !this.liked;
    this.likeChange.emit(this.liked);
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
