import { Component, ViewChild, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import {
  businessOutline,
  checkmarkOutline,
  globeOutline,
  logOutOutline,
} from 'ionicons/icons';

import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';

/** Os idiomas na ordem em que aparecem. */
const IDIOMAS = [
  { codigo: 'pt', rotulo: 'Português' },
  { codigo: 'en', rotulo: 'English' },
] as const;

/**
 * Ajustes da conta: onde o que estava atrás do hambúrguer passa a morar.
 *
 * DONO: Frente A.
 *
 * No celular o bloco `header-desktop` é `display: none`, e até esta tela o
 * `mobile-sheet` era o ÚNICO caminho para idioma, sair e "Meus imóveis" — menu
 * escondido é navegação que não acontece. Com a barra inferior assumindo a
 * navegação, este é o destino da quarta aba, e é ele que impede que essas três
 * coisas fiquem inalcançáveis quando o hambúrguer sai.
 *
 * "Meus imóveis" mora aqui por decisão de produto: o motivo de ir lá era pegar
 * o código de embed, e o embed passou a estar no card da própria home.
 */
@Component({
  selector: 'app-configuracoes',
  templateUrl: './configuracoes.page.html',
  styleUrls: ['./configuracoes.page.scss'],
  standalone: true,
  imports: [IonContent, IonIcon, RouterLink, TranslatePipe, AppHeaderComponent],
})
export class ConfiguracoesPage {
  @ViewChild(AppHeaderComponent) private header?: AppHeaderComponent;

  private readonly auth = inject(AuthService);

  readonly idiomas = IDIOMAS;
  readonly idioma = inject(LanguageService);

  constructor() {
    addIcons({ businessOutline, globeOutline, logOutOutline, checkmarkOutline });
  }

  /** O header encolhe com o scroll e depende do container do ion-content. */
  onScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  escolherIdioma(codigo: (typeof IDIOMAS)[number]['codigo']): void {
    this.idioma.use(codigo);
  }

  sair(): void {
    this.auth.signout();
  }
}
