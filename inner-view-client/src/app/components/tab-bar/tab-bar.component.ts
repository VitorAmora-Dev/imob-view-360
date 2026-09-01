import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import {
  add,
  home,
  homeOutline,
  settings,
  settingsOutline,
  time,
  timeOutline,
} from 'ionicons/icons';
import { filter, map } from 'rxjs';

import { caminhoDe } from '../../services/navegacao-entre-telas.service';

/**
 * As telas que MOSTRAM a barra.
 *
 * Lista de permissão, e nunca de exclusão: rota nova nasce sem barra, em vez de
 * nascer com uma barra por cima de algo que não a comporta. O caso concreto é o
 * wizard — a `tw-actions` dele é `position: sticky; bottom: 0`, e as duas
 * empilhadas comeriam um quinto da tela do telefone. Login, visualizador 360 e
 * a página pública de embed têm o mesmo problema por motivos próprios.
 */
const COM_BARRA = ['/home', '/rascunhos', '/configuracoes', '/profile'];

/** Aplicada no `body` enquanto a barra está no ar. Ver `global.scss`. */
const CLASSE_DO_BODY = 'com-barra-inferior';

interface Aba {
  readonly rotuloKey: string;
  readonly rota: string;
  readonly icone: string;
  readonly iconeAtivo: string;
  /** Ação, não destino: não ganha estado de "você está aqui". */
  readonly acao?: boolean;
}

const ABAS: readonly Aba[] = [
  {
    rotuloKey: 'TABS.TOURS',
    rota: '/home',
    icone: 'home-outline',
    iconeAtivo: 'home',
  },
  {
    rotuloKey: 'TABS.DRAFTS',
    rota: '/rascunhos',
    icone: 'time-outline',
    iconeAtivo: 'time',
  },
  {
    rotuloKey: 'TABS.NEW',
    rota: '/tour/novo',
    icone: 'add',
    iconeAtivo: 'add',
    acao: true,
  },
  {
    rotuloKey: 'TABS.SETTINGS',
    rota: '/configuracoes',
    icone: 'settings-outline',
    iconeAtivo: 'settings',
  },
];

/**
 * A navegação principal do celular, no rodapé.
 *
 * DONO: Frente A.
 *
 * Até aqui ela morava inteira atrás de um hambúrguer: o bloco `header-desktop`
 * é `display: none` abaixo de 768px, e o `mobile-sheet` era o único caminho
 * para qualquer tela. Menu escondido é navegação que não acontece — "Meus
 * imóveis" custava dois toques e nenhuma visibilidade, num app cujo uso
 * principal é o telefone dentro do imóvel.
 *
 * **Componente próprio e não `ion-tabs`.** O `IonTabs` exige reestruturar as
 * rotas como filhas de uma rota-pai, e login, wizard, visualizador e embed
 * precisam ficar de fora dela. Um componente montado no shell custa um `@if`;
 * a reestruturação custaria o arquivo de rotas inteiro e os guards com ele.
 *
 * **Só no telefone** (ver o SCSS): no desktop a nav do topo já resolve, e uma
 * barra inferior em 1280px seria mobiliário sem função.
 */
@Component({
  selector: 'app-tab-bar',
  templateUrl: './tab-bar.component.html',
  styleUrls: ['./tab-bar.component.scss'],
  standalone: true,
  imports: [IonIcon, RouterLink, TranslatePipe],
})
export class TabBarComponent {
  private readonly router = inject(Router);

  readonly abas = ABAS;

  /**
   * O caminho atual, sem query string nem fragmento.
   *
   * `caminhoDe` é o mesmo do `NavegacaoEntreTelas`, e o motivo de existir vale
   * aqui igual: os filtros da home moram na query string, e comparar a URL
   * inteira faria a barra sumir a cada tecla digitada na busca.
   *
   * O `initialValue` vem do `router.url` porque o primeiro `NavigationEnd` da
   * sessão acontece ANTES de este componente existir — sem ele, a barra ficaria
   * escondida até a primeira navegação.
   */
  private readonly caminho = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map((evento) => caminhoDe(evento.urlAfterRedirects)),
    ),
    { initialValue: caminhoDe(this.router.url) },
  );

  readonly visivel = computed(() => COM_BARRA.includes(this.caminho()));

  constructor() {
    addIcons({ home, homeOutline, time, timeOutline, add, settings, settingsOutline });

    // A barra é `position: fixed` e cobre o pé da tela: sem folga no conteúdo,
    // o último cartão da home fica embaixo dela. A folga é UMA regra em
    // `global.scss`, acionada por esta classe — a alternativa era repetir o
    // mesmo `--padding-bottom` no SCSS das quatro telas, e regra de aparência
    // repetida é regra que só vai ser corrigida uma vez de cada quatro.
    //
    // Mesma técnica do `lockScroll` do `app-header`, que já marca o `body`.
    effect(() => {
      document.body.classList.toggle(CLASSE_DO_BODY, this.visivel());
    });
  }

  /**
   * A aba da tela atual. Ação nunca conta — ver o template.
   *
   * Daqui, e não do `routerLinkActive`: com o directive, a COR viria dele e o
   * ÍCONE de `caminho()`, duas fontes para a mesma verdade. Bastaria uma
   * divergir — `exact` num caminho com parâmetro, por exemplo — para a aba
   * ficar azul com o desenho vazado, ou o contrário.
   */
  estaNaTela(aba: Aba): boolean {
    return !aba.acao && this.caminho() === aba.rota;
  }

  /** O ativo pinta cheio; os demais, contorno. É a convenção do iOS. */
  icone(aba: Aba): string {
    return this.estaNaTela(aba) ? aba.iconeAtivo : aba.icone;
  }
}
