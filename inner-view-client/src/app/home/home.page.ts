import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton } from '@ionic/angular/standalone';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { add, alertCircleOutline, imagesOutline, searchOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { InnerViewListComponent } from '../components/inner-view-list/inner-view-list.component';
import { HomePlaceholderComponent } from '../components/home-placeholder/home-placeholder.component';
import { HomeNoTourBannerComponent } from '../components/home-no-tour-banner/home-no-tour-banner.component';
import { PropertyService } from '../services/property.service';
import { Property } from '../models/property.model';
import { HomeStatus, resolveHomeView } from './home-view';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton,
    AppHeaderComponent, InnerViewListComponent, HomePlaceholderComponent,
    HomeNoTourBannerComponent, RouterLink, TranslatePipe,
  ],
})
export class HomePage implements OnInit {
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  readonly status = signal<HomeStatus>('loading');
  readonly properties = signal<Property[]>([]);
  readonly query = signal('');

  /**
   * Filtro como `computed`, e não uma segunda lista mutada por handler: duas
   * listas mantidas em paralelo saem de sincronia no dia em que um terceiro
   * caminho mexe em `properties`.
   */
  readonly filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    const todos = this.properties();
    if (!q) return todos;
    return todos.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      (p.address?.city ?? '').toLowerCase().includes(q)
    );
  });

  readonly view = computed(() => resolveHomeView({
    status: this.status(),
    total: this.properties().length,
    filtered: this.filtered().length,
  }));

  private readonly semTour = computed(() =>
    this.properties().filter(p => !p.virtualTour));

  /**
   * Exige que NENHUM imóvel tenha tour, e lê `properties` — não `filtered` —
   * para não aparecer e sumir conforme a pessoa digita na busca.
   */
  readonly mostrarFaixa = computed(() =>
    this.view() === 'list' &&
    this.properties().length > 0 &&
    this.semTour().length === this.properties().length);

  readonly totalSemTour = computed(() => this.semTour().length);

  /**
   * Busca e FAB aparecem juntos, e de uma condição só.
   *
   * Lista branca de propósito: se um sexto estado entrar aqui um dia e ninguém
   * lembrar desta linha, a moldura some — que é uma tela incompleta. Com lista
   * negra, ela apareceria num estado que ninguém avaliou, oferecendo "adicionar"
   * sobre uma tela de erro. Some é melhor do que mente, que é a tese do ticket.
   */
  readonly mostrarMoldura = computed(() =>
    this.view() === 'list' || this.view() === 'no-results');

  private propertyService = inject(PropertyService);
  private router = inject(Router);

  constructor() {
    addIcons({ add, alertCircleOutline, imagesOutline, searchOutline });
  }

  ngOnInit() {
    this.carregar();
  }

  /**
   * Extraído do ngOnInit para o "Tentar de novo" reusá-lo. Recarregar a página
   * inteira perderia o texto da busca e piscaria o app por causa de uma
   * chamada só.
   */
  carregar(): void {
    // O campo de busca é destruído no estado de carregando, e ele não tem
    // `[value]`: voltar com `query` preenchido mostraria "nenhum resultado para
    // zzzz" sobre uma caixa de busca visivelmente vazia. Hoje nenhum caminho da
    // interface chega lá — mas um `ion-refresher` nesta tela, que é a adição
    // mais provável a ela, chegaria.
    this.query.set('');
    this.status.set('loading');
    this.propertyService.listProperties({ limit: 100 }).subscribe({
      next: (res) => {
        this.properties.set(res.data);
        this.status.set('ready');
      },
      error: (error) => {
        console.error('Error loading properties:', error);
        this.status.set('error');
      },
    });
  }

  irParaNovoTour(): void {
    this.router.navigate(['/tour/novo']);
  }

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
  }

  onSearch(event: CustomEvent<{ value?: string | null }>) {
    this.query.set(event.detail.value ?? '');
  }
}
