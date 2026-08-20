import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonCard, IonButton, IonIcon, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heartOutline, heart, starOutline, star, shareSocialOutline, homeOutline } from 'ionicons/icons';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Property } from '../../models/property.model';
import { environment } from '../../../environments/environment';
import { ADD_TOUR_INTENT } from '../../models/navigation-intent';

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
  @Output() favoriteChange = new EventEmitter<boolean>();
  @Output() shareClick = new EventEmitter<void>();

  liked = false;
  favorited = false;

  private router = inject(Router);
  private toastController = inject(ToastController);
  private translate = inject(TranslateService);

  constructor() {
    addIcons({ heartOutline, heart, starOutline, star, shareSocialOutline, homeOutline });
  }

  onCardClick() {
    this.navigateToProperty();
  }

  /**
   * Mesmo destino do clique no card, mas carregando a intenção — sem ela o
   * botão seria rótulo, não ação: a página abriria e ficaria esperando um
   * segundo clique que nada na tela pede.
   */
  onCreateTour(event: Event) {
    event.stopPropagation();
    this.navigateToProperty(ADD_TOUR_INTENT);
  }

  /**
   * A rota do imóvel num lugar só. Os dois caminhos que chegam nela diferem
   * APENAS pela intenção — e essa assimetria é o ponto, não um descuido: só
   * quem apertou "Criar tour" quer o seletor de imagem aberto na chegada.
   */
  private navigateToProperty(action?: string) {
    this.router.navigate(['/inner-view-page', this.item.id], {
      state: action ? { property: this.item, action } : { property: this.item },
    });
  }

  onLike(event: Event) {
    event.stopPropagation();
    this.liked = !this.liked;
    this.likeChange.emit(this.liked);
  }

  onFavorite(event: Event) {
    event.stopPropagation();
    this.favorited = !this.favorited;
    this.favoriteChange.emit(this.favorited);
  }

  async onShare(event: Event) {
    event.stopPropagation();
    this.shareClick.emit();

    const tourId = this.item.virtualTour?.id;
    if (!tourId) return;

    // The embed route is the public one — recipients have no account and
    // cannot open /inner-view-page, which sits behind the auth guard.
    const url = `${window.location.origin}/embed/${tourId}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: this.item.title, url });
        return;
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      await this.presentToast(this.translate.instant('CARD.LINK_COPIED'));
    } catch {
      await this.presentToast(this.translate.instant('CARD.SHARE_ERROR'), 'danger');
    }
  }

  private async presentToast(message: string, color?: 'danger') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      ...(color ? { color } : {}),
    });
    await toast.present();
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
