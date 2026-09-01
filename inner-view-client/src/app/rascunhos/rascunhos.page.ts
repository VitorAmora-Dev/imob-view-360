import { Component, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { ListaDeRascunhosComponent } from './lista-de-rascunhos/lista-de-rascunhos.component';

/**
 * A aba Rascunhos: as capturas em andamento com a tela inteira.
 *
 * DONO: Frente A.
 *
 * Casca fina de propósito: buscar a lista, baixar miniatura, retomar e
 * descartar vivem no `ListaDeRascunhosComponent` ao lado — inclusive o diálogo
 * de descarte e a regra de que o cartão só some quando o DELETE dá certo. À
 * página cabe o título e o cabeçalho.
 *
 * Componente separado, e não tudo aqui: ele decide sozinho o que desenhar a
 * partir do próprio dado (cartões ou estado vazio), e essa decisão precisa da
 * consulta que ele mesmo faz.
 */
@Component({
  selector: 'app-rascunhos',
  templateUrl: './rascunhos.page.html',
  styleUrls: ['./rascunhos.page.scss'],
  standalone: true,
  imports: [IonContent, TranslatePipe, AppHeaderComponent, ListaDeRascunhosComponent],
})
export class RascunhosPage {
  @ViewChild(AppHeaderComponent) private header?: AppHeaderComponent;

  /** O header encolhe com o scroll e depende do container do ion-content. */
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.header?.onContentScroll(event.detail.scrollTop);
  }
}
