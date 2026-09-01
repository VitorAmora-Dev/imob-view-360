import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonCard, IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heartOutline, heart, codeSlashOutline, homeOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { Property } from '../../models/property.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-inner-view-card',
  templateUrl: './inner-view-card.component.html',
  styleUrls: ['./inner-view-card.component.scss'],
  standalone: true,
  imports: [IonCard, IonButton, IonIcon, TranslatePipe]
})
export class InnerViewCardComponent {
  @Input() item!: Property;

  @Output() likeChange = new EventEmitter<boolean>();

  /**
   * O tour a divulgar. Quem abre o modal é a página — ver
   * `InnerViewListComponent.embedClick`.
   */
  @Output() embedClick = new EventEmitter<string>();

  liked = false;

  private router = inject(Router);

  constructor() {
    addIcons({ heartOutline, heart, codeSlashOutline, homeOutline });
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

  /**
   * Pede o painel de embed para a página, em vez de compartilhar daqui.
   *
   * O que havia antes era `navigator.share` com fallback para copiar o link.
   * Funcionava, mas entregava só metade: o código de `<iframe>` — que é como um
   * corretor põe o tour no próprio site — só existia dentro de "Meus imóveis".
   * O painel completo já existia e agora atende as duas telas.
   */
  onEmbed(event: Event) {
    event.stopPropagation();

    const tourId = this.item.virtualTour?.id;
    if (tourId) this.embedClick.emit(tourId);
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
