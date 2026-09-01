import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonGrid, IonRow, IonCol } from '@ionic/angular/standalone';
import { Property } from '../../models/property.model';
import { InnerViewCardComponent } from '../inner-view-card/inner-view-card.component';

@Component({
  selector: 'app-inner-view-list',
  templateUrl: './inner-view-list.component.html',
  styleUrls: ['./inner-view-list.component.scss'],
  standalone: true,
  imports: [CommonModule, IonGrid, IonRow, IonCol, InnerViewCardComponent]
})
export class InnerViewListComponent {
  @Input() items: Property[] = [];

  /**
   * Repassa o pedido de embed do card para a página.
   *
   * A lista não abre o modal: um `<app-embed-modal>` por página, e não um por
   * card — vinte imóveis na tela seriam vinte overlays montados para um que
   * abre.
   */
  @Output() embedClick = new EventEmitter<string>();
}
