import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  IonContent,
  IonSearchbar,
  IonIcon,
  IonFab,
  IonFabButton,
  IonProgressBar,
} from '@ionic/angular/standalone';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, distinctUntilChanged, switchMap, tap } from 'rxjs';
import { addIcons } from 'ionicons';
import { add, alertCircleOutline, imagesOutline, searchOutline } from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';

import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { InnerViewListComponent } from '../components/inner-view-list/inner-view-list.component';
import { HomePlaceholderComponent } from '../components/home-placeholder/home-placeholder.component';
import { HomeNoTourBannerComponent } from '../components/home-no-tour-banner/home-no-tour-banner.component';
import { RascunhosBandComponent } from '../components/rascunhos-band/rascunhos-band.component';
import { PropertyFiltersBarComponent } from '../components/property-filters-bar/property-filters-bar.component';
import { ActiveFilterChipsComponent } from '../components/active-filter-chips/active-filter-chips.component';
import { PropertyService } from '../services/property.service';
import { Property } from '../models/property.model';
import { HomeStatus, resolveHomeView } from './home-view';
import {
  FilterChip,
  PropertyFilters,
  chipsAtivos,
  limparTodos,
  mesmosFiltros,
  parseFilters,
  removerFiltro,
  temCriterios,
  temFiltros,
  toListParams,
  toQueryParams,
} from './property-filters';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonContent, IonSearchbar, IonIcon, IonFab, IonFabButton, IonProgressBar,
    AppHeaderComponent, InnerViewListComponent, HomePlaceholderComponent,
    HomeNoTourBannerComponent, RascunhosBandComponent, PropertyFiltersBarComponent,
    ActiveFilterChipsComponent, RouterLink, TranslatePipe,
  ],
})
export class HomePage {
  @ViewChild(AppHeaderComponent) header?: AppHeaderComponent;

  private readonly propertyService = inject(PropertyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly status = signal<HomeStatus>('loading');
  readonly properties = signal<Property[]>([]);

  /** Só a PRIMEIRA carga ocupa a tela inteira. Ver `resolveHomeView`. */
  private readonly jaCarregou = signal(false);

  /** Incrementado pelo "Tentar de novo": os critérios não mudam, a consulta refaz. */
  private readonly tentativa = signal(0);

  /**
   * A URL é a fonte de verdade dos critérios.
   *
   * Lido como observable, e não do `snapshot` no `ngOnInit`: com
   * `IonicRouteStrategy`, navegar de `/home?type=HOUSE` para `/home?type=LAND`
   * NÃO recria o componente, e um snapshot lido uma vez congelaria os filtros
   * na primeira montagem.
   */
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly filters = computed<PropertyFilters>(() => parseFilters(this.params()));

  readonly comCriterios = computed(() => temCriterios(this.filters()));
  readonly comFiltros = computed(() => temFiltros(this.filters()));
  readonly chips = computed(() => chipsAtivos(this.filters()));

  readonly view = computed(() =>
    resolveHomeView({
      status: this.status(),
      jaCarregou: this.jaCarregou(),
      vazio: this.properties().length === 0,
      comCriterios: this.comCriterios(),
    }),
  );

  /** Não é uma `view`: é uma barra de progresso por cima da view anterior. */
  readonly refiltrando = computed(
    () => this.status() === 'loading' && this.jaCarregou(),
  );

  private readonly semTour = computed(() =>
    this.properties().filter((p) => !p.virtualTour),
  );

  /**
   * Some com QUALQUER critério ativo.
   *
   * A faixa diz "N imóveis ainda não possuem imagens 360°" — uma frase sobre o
   * acervo. Com o servidor filtrando, `properties()` é a página filtrada, e a
   * mesma frase passaria a falar do resultado da busca no tom de quem fala da
   * conta inteira. É um empurrão sobre a conta, não sobre uma pesquisa.
   */
  readonly mostrarFaixa = computed(
    () =>
      this.view() === 'list' &&
      !this.comCriterios() &&
      this.properties().length > 0 &&
      this.semTour().length === this.properties().length,
  );

  readonly totalSemTour = computed(() => this.semTour().length);

  /**
   * Busca, filtros e FAB aparecem juntos, e de uma condição só.
   *
   * Lista branca de propósito: se um sexto estado entrar aqui um dia e ninguém
   * lembrar desta linha, a moldura some — que é uma tela incompleta. Com lista
   * negra, ela apareceria num estado que ninguém avaliou, oferecendo
   * "adicionar" sobre uma tela de erro. Some é melhor do que mente.
   */
  readonly mostrarMoldura = computed(
    () => this.view() === 'list' || this.view() === 'no-results',
  );

  /** O projeto resolve plural por sufixo `_ONE` escolhido no TypeScript. */
  readonly contagemKey = computed(() =>
    this.properties().length === 1
      ? 'HOME.FILTERS.RESULT_COUNT_ONE'
      : 'HOME.FILTERS.RESULT_COUNT',
  );

  readonly contagemParams = computed(() => ({ n: this.properties().length }));

  constructor() {
    addIcons({ add, alertCircleOutline, imagesOutline, searchOutline });

    const gatilho = computed(() => ({
      filtros: this.filters(),
      tentativa: this.tentativa(),
    }));

    toObservable(gatilho)
      .pipe(
        // `parseFilters` devolve objeto novo a cada leitura da URL, e o router
        // emite em navegações que não mexeram em critério nenhum.
        distinctUntilChanged(
          (a, b) =>
            a.tentativa === b.tentativa && mesmosFiltros(a.filtros, b.filtros),
        ),
        tap(() => this.status.set('loading')),
        // `switchMap` cancela a requisição anterior. Sem ele, uma resposta
        // lenta de um critério antigo chega depois da rápida do critério novo e
        // sobrescreve a tela com o resultado errado — defeito que só aparece em
        // rede ruim e é quase impossível de reproduzir depois.
        switchMap(({ filtros }) =>
          this.propertyService.listProperties(toListParams(filtros)).pipe(
            catchError((erro) => {
              console.error('Error loading properties:', erro);
              this.status.set('error');
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this.properties.set(res.data);
        this.status.set('ready');
        this.jaCarregou.set(true);
      });
  }

  /**
   * Todo caminho que muda critério passa por aqui: navega, e a requisição é
   * consequência de a URL ter mudado. Um caminho só, sem estado duplicado para
   * sair de sincronia.
   *
   * `replaceUrl` porque empilhar uma entrada por filtro faria o botão voltar do
   * celular desfazer um filtro por vez, e sair da home exigiria tantos toques
   * quantos filtros a pessoa mexeu.
   */
  aplicarFiltros(filtros: PropertyFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(filtros),
      replaceUrl: true,
    });
  }

  onSearch(event: CustomEvent<{ value?: string | null }>): void {
    this.aplicarFiltros({
      ...this.filters(),
      query: (event.detail.value ?? '').trim(),
    });
  }

  removerChip(key: FilterChip['key']): void {
    this.aplicarFiltros(removerFiltro(this.filters(), key));
  }

  limpar(): void {
    this.aplicarFiltros(limparTodos(this.filters()));
  }

  /** "Tentar de novo": mesmos critérios, consulta refeita. */
  carregar(): void {
    this.tentativa.update((n) => n + 1);
  }

  irParaNovoTour(): void {
    void this.router.navigate(['/tour/novo']);
  }

  onScroll(event: CustomEvent<{ scrollTop: number }>) {
    this.header?.onContentScroll(event.detail.scrollTop);
  }
}
