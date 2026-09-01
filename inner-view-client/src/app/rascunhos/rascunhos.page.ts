import { Component, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { RascunhosBandComponent } from '../components/rascunhos-band/rascunhos-band.component';

/**
 * A aba Rascunhos: as capturas em andamento com a tela inteira.
 *
 * DONO: Frente A.
 *
 * Casca fina de propósito. Buscar a lista, baixar miniatura, retomar e
 * descartar já vivem no `RascunhosBandComponent`, que a home usa como faixa —
 * inclusive o diálogo de descarte e a regra de que o cartão só some quando o
 * DELETE dá certo. Duplicar isso aqui daria duas cópias que divergem na
 * primeira correção; o que muda entre as duas telas é só o `layout`.
 */
@Component({
  selector: 'app-rascunhos',
  templateUrl: './rascunhos.page.html',
  styleUrls: ['./rascunhos.page.scss'],
  standalone: true,
  imports: [IonContent, TranslatePipe, AppHeaderComponent, RascunhosBandComponent],
})
export class RascunhosPage {
  @ViewChild(AppHeaderComponent) private header?: AppHeaderComponent;

  /** O header encolhe com o scroll e depende do container do ion-content. */
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.header?.onContentScroll(event.detail.scrollTop);
  }
}
