import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { CenasSheetComponent } from '../components/cenas-sheet/cenas-sheet.component';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { Property } from '../models/property.model';
import { NavegacaoEntreTelas } from '../services/navegacao-entre-telas.service';
import { TvHeaderComponent } from './chrome/tv-header.component';
import { TvToastComponent } from './chrome/tv-toast.component';
import { TourDesktopChromeComponent } from './desktop/tour-desktop-chrome.component';
import { TourHotspotOverlayComponent } from './hotspots/tour-hotspot-overlay.component';
import { PalcoDoTour } from './palco-do-tour';
import { TourScenesStripComponent } from './scenes/tour-scenes-strip.component';
import { TourDeleteSheetComponent } from './sheets/delete/tour-delete-sheet.component';
import { TourManageSheetComponent } from './sheets/manage/tour-manage-sheet.component';
import { TourShareSheetComponent } from './sheets/share/tour-share-sheet.component';
import { TourActionsBarComponent } from './tour-actions-bar/tour-actions-bar.component';
import { TourViewerStore } from './tour-viewer.store';

/**
 * Visualização de um tour, pelo DONO dele (SPRINT-4-TOUR-VIEWER.md).
 *
 * Esta página é só o ARRANJO. Ela não tem estado próprio e quase não tem
 * comportamento: quem sabe das coisas é o `TourViewerStore`, quem liga a
 * intenção do store ao que está no canvas é o `PalcoDoTour`, e quem desenha
 * cada frente são os componentes encaixados nos slots do template.
 *
 * O arranjo nasceu pronto no commit-zero (TV-0) exatamente por isso: é o único
 * arquivo que as três frentes tocariam, e um template que cresce por três lados
 * ao mesmo tempo é conflito garantido. Cada frente substitui o SEU marcador no
 * `.html` e não mexe no resto.
 *
 * A rota é `inner-view-page/:id`, e o `:id` é o do IMÓVEL — não o do tour.
 * Decisão D10 do plano: mudar isso arrastaria home, cards, guards e todo link
 * que já foi enviado por aí. É também o que dá a esta tela — e só a ela — a
 * permissão de editar: a rota do imóvel é escopada por agência no servidor.
 * Ver `TourViewerStore.podeEditar`.
 */
@Component({
  selector: 'app-tour-viewer',
  templateUrl: './tour-viewer.page.html',
  styleUrls: ['./tour-viewer.page.scss'],
  standalone: true,
  providers: [TourViewerStore],
  imports: [
    CenasSheetComponent,
    IonContent,
    IonSpinner,
    PanoramicViewerComponent,
    TourDeleteSheetComponent,
    TourDesktopChromeComponent,
    TourHotspotOverlayComponent,
    TourScenesStripComponent,
    TourManageSheetComponent,
    TourShareSheetComponent,
    TranslatePipe,
    TvHeaderComponent,
    TvToastComponent,
    TourActionsBarComponent,
  ],
})
export class TourViewerPage extends PalcoDoTour implements OnInit {
  readonly offline = signal(!navigator.onLine);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navegacao = inject(NavegacaoEntreTelas);

  constructor() {
    super();

    // A faixa de aviso segue a rede de verdade, e não um palpite do carregamento:
    // o tour continua navegável com o que já baixou, e some quando a rede volta.
    const aoMudarRede = () => this.offline.set(!navigator.onLine);
    window.addEventListener('online', aoMudarRede);
    window.addEventListener('offline', aoMudarRede);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', aoMudarRede);
      window.removeEventListener('offline', aoMudarRede);
    });

    /**
     * A tela voltou a aparecer — e o tour pode ter mudado enquanto ela esteve
     * fora.
     *
     * O app usa `<ion-router-outlet>`, que MANTÉM a página na pilha: sair daqui
     * para o wizard e voltar reusa esta mesma instância, e o `ngOnInit` abaixo
     * — que é quem chama `carregar()` — não roda de novo. O corretor salvava a
     * edição, era devolvido para cá pelo próprio salvamento (ver `edicaoSalva`
     * na página do wizard) e via o tour como ele era ANTES de editar. Só ir até
     * a home e entrar outra vez mostrava o resultado, porque só aí a página era
     * destruída e criada de novo.
     *
     * A regra já existia no `NavegacaoEntreTelas`, escrita para a home;
     * faltava esta tela ser consumidora dela.
     *
     * O critério é o caminho DESTE imóvel, e não o prefixo `/inner-view-page/`:
     * com prefixo, ir do tour de um imóvel para o de outro não contaria como
     * ter saído, e voltar também não recarregaria — o mesmo defeito num lugar
     * novo.
     *
     * `recarregar()` e não `carregar(id)`: é o caminho que o "Tentar de novo"
     * já usa, e ele não repassa o imóvel que veio em memória da home — que é o
     * ponto, porque aquele objeto é justamente o desatualizado.
     */
    const idDoImovel = this.route.snapshot.paramMap.get('id');
    this.navegacao
      .aoVoltarPara((caminho) => caminho === `/inner-view-page/${idDoImovel}`)
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.store.recarregar());
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/home']);
      return;
    }

    // A home navega com o imóvel já em mãos. Aproveitar isso é o que evita uma
    // tela cinza de meio segundo em cima de um dado que já estava carregado.
    const emMemoria = this.router.getCurrentNavigation()?.extras.state?.['property'] as
      | Property
      | undefined;

    void this.store.carregar(id, emMemoria);
  }

  /**
   * O EDITAR da tab bar e do cluster do desktop.
   *
   * Leva ao wizard em MODO DE EDIÇÃO (TV-11), e não à retomada de rascunho: a
   * rota de retomada recusa tour publicado de propósito, porque o wizard
   * aberto por ela oferece "Descartar captura" — que apagaria o imóvel inteiro,
   * com as fotos, os hotspots e o link que já foi enviado ao cliente.
   */
  editarTour(): void {
    const id = this.store.tourId();
    if (!id) return;

    this.store.mostrarToast('TOUR_VIEWER.TOAST.OPENING_EDITOR');
    void this.router.navigate(['/tour', id, 'editar']);
  }

  voltar(): void {
    void this.router.navigate(['/home']);
  }
}
