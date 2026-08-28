import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AlertController,
  ToastController,
  provideIonicAngular,
} from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { RascunhosBandComponent } from './rascunhos-band.component';
import { PanoramaImageCache } from '../../services/panorama-image-cache.service';
import { PropertyService } from '../../services/property.service';
import { RascunhoResumo, VirtualTourService } from '../../services/virtual-tour.service';

/**
 * A faixa "Capturas em andamento" da home (Tarefa 13).
 *
 * As outras nove peças do rascunho retomável (salvar, retomar, descartar,
 * salvamento automático) já existem e estão testadas — o que faltava era um
 * jeito de VOLTAR a um rascunho depois de sair. Este componente é esse jeito.
 *
 * Sem dicionário de tradução carregado nos testes, `TranslatePipe` devolve a
 * própria chave (mesma convenção de `scene-card.component.spec.ts` e
 * `property-filters-bar.component.spec.ts`) — por isso as asserções abaixo
 * procuram a CHAVE (`HOME.DRAFTS_ROOMS`, `HOME.DRAFTS_EMPTY_ROOMS`), não o
 * texto interpolado. `{{count}}` só vira número de verdade em produção, com o
 * catálogo de `pt.json`/`en.json` carregado.
 */
describe('RascunhosBandComponent', () => {
  let fixture: ComponentFixture<RascunhosBandComponent>;
  let virtualTourService: VirtualTourService;
  let propertyService: PropertyService;
  let imagens: PanoramaImageCache;
  let router: Router;
  let alertController: AlertController;

  function rascunho(over: Partial<RascunhoResumo> = {}): RascunhoResumo {
    return {
      id: 't1',
      propertyId: 'i1',
      updatedAt: '2026-08-26T12:00:00Z',
      ambientes: 3,
      capaPanoramaId: 'p1',
      ...over,
    };
  }

  /**
   * Dubla o alerta de confirmacao inteiro.
   *
   * O `AlertController` de verdade nao tem onde se apresentar num TestBed
   * ("framework delegate is missing"), e o que estes casos verificam e a
   * DECISAO — apagou ou nao —, nao o desenho do Ionic. `escolha` e o papel do
   * botao tocado: `destructive` confirma; qualquer outro (o cancelar, ou um
   * toque fora do alerta) desiste.
   */
  function dublarAlerta(escolha: 'destructive' | 'cancel' | 'backdrop'): void {
    alertController = TestBed.inject(AlertController);
    spyOn(alertController, 'create').and.resolveTo({
      present: () => Promise.resolve(),
      onDidDismiss: () => Promise.resolve({ role: escolha }),
    } as unknown as HTMLIonAlertElement);
    spyOn(TestBed.inject(ToastController), 'create').and.resolveTo({
      present: () => Promise.resolve(),
    } as unknown as HTMLIonToastElement);
  }

  function montar(rascunhos: RascunhoResumo[]): void {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });

    virtualTourService = TestBed.inject(VirtualTourService);
    propertyService = TestBed.inject(PropertyService);
    imagens = TestBed.inject(PanoramaImageCache);
    router = TestBed.inject(Router);

    spyOn(virtualTourService, 'listarRascunhos').and.returnValue(of(rascunhos));
    // O download da miniatura é assunto de outro teste (abaixo). Por padrão
    // ele fica pendurado (nunca resolve), para as asserções de estrutura da
    // faixa não dependerem de uma promise que elas não pediram.
    spyOn(imagens, 'obter').and.returnValue(new Promise(() => {}));

    fixture = TestBed.createComponent(RascunhosBandComponent);
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('não desenha nada quando não há rascunho', async () => {
    // A faixa não pode ocupar espaço permanente na home: quem nunca deixou
    // captura pela metade não deve ver um vazio explicando isso. Diferente do
    // `home-no-tour-banner`, ninguém de fora decide isto por ela — ela é quem
    // busca `listarRascunhos()`, então é ela quem sabe se há o que mostrar.
    montar([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.rascunhos')).toBeNull();
  });

  it('desenha um cartão por rascunho, com a contagem de ambientes', async () => {
    montar([
      rascunho({ id: 't1', ambientes: 3 }),
      rascunho({ id: 't2', ambientes: 1, capaPanoramaId: 'p9' }),
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const cartoes = fixture.nativeElement.querySelectorAll('.rascunhos__card');
    expect(cartoes.length).toBe(2);
    expect(cartoes[0].textContent).toContain('HOME.DRAFTS_ROOMS');
    expect(cartoes[0].textContent).not.toContain('HOME.DRAFTS_EMPTY_ROOMS');
  });

  it('desenha o rascunho sem nenhum cômodo, sem miniatura quebrada', async () => {
    // É o estado entre criar o rascunho e a primeira captura terminar. Um
    // <img> com src vazio desenha ícone de imagem quebrada.
    montar([rascunho({ ambientes: 0, capaPanoramaId: null })]);
    await fixture.whenStable();
    fixture.detectChanges();

    const cartao = fixture.nativeElement.querySelector('.rascunhos__card');
    expect(cartao).not.toBeNull();
    expect(cartao.textContent).toContain('HOME.DRAFTS_EMPTY_ROOMS');
    expect(fixture.nativeElement.querySelector('.rascunhos__thumb img')).toBeNull();

    // Sem capa não há o que baixar — pedir mesmo assim desperdiçaria uma
    // requisição que o servidor só devolveria vazia.
    expect(imagens.obter).not.toHaveBeenCalled();
  });

  /**
   * O ponto que mais costuma sair errado nesta tarefa: a rota de preview é
   * autenticada, e uma tag <img src="/api/..."> não passa pelo interceptor —
   * não leva o token. A miniatura só pode chegar pelo `PanoramaImageCache`,
   * que baixa pelo `HttpClient` e devolve `blob:`.
   */
  it('busca a miniatura pelo cache, na variante tratada e REDUZIDA, e não por src direto', async () => {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });
    virtualTourService = TestBed.inject(VirtualTourService);
    imagens = TestBed.inject(PanoramaImageCache);
    spyOn(virtualTourService, 'listarRascunhos').and.returnValue(
      of([rascunho({ capaPanoramaId: 'p1' })]),
    );
    const obter = spyOn(imagens, 'obter').and.resolveTo('blob:xyz');

    fixture = TestBed.createComponent(RascunhosBandComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // A largura é a outra metade do achado: sem ela a faixa dispara um
    // download de equirretangular inteira por rascunho, em paralelo, no
    // `ngOnInit` da home — dezenas de MB para desenhar selos de 196x110.
    expect(obter).toHaveBeenCalledWith('p1', 'treated', 320);
    const img = fixture.nativeElement.querySelector('.rascunhos__thumb img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('blob:xyz');
  });

  it('retomar navega para o wizard com o id do rascunho na query string', async () => {
    montar([rascunho({ id: 't7' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    const navegar = spyOn(router, 'navigate');

    fixture.nativeElement.querySelector('.rascunhos__abrir').click();

    expect(navegar).toHaveBeenCalledWith(['/tour/novo'], {
      queryParams: { rascunho: 't7' },
    });
  });

  /**
   * Apaga o IMÓVEL, não o tour — mesma regra de `descartarRascunho()` no
   * `TourDraftStore`. `VirtualTour.property` é `onDelete: Cascade`: uma
   * chamada derruba tour, panoramas, hotspots e frames de uma vez. Apagar só
   * o tour deixaria um imóvel órfão "Captura em andamento" visível na
   * listagem, que é exatamente a linha vazia que o filtro de lá existe para
   * evitar.
   */
  it('descartar apaga o imóvel, não o tour, e some da faixa', async () => {
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarAlerta('destructive');
    await fixture.whenStable();
    fixture.detectChanges();
    const apagar = spyOn(propertyService, 'deleteProperty').and.returnValue(of(undefined));
    const liberar = spyOn(imagens, 'liberar');

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(apagar).toHaveBeenCalledWith('i1');
    expect(liberar).toHaveBeenCalledWith('p1');
    expect(fixture.nativeElement.querySelector('.rascunhos__card')).toBeNull();
  });

  /**
   * O botão tem 44px, encosta no cartão e vive num carrossel de rolagem
   * horizontal — arrastar a faixa e tocar no botão passam pelo mesmo pixel. E
   * o que ele apaga é o `Property` em cascata: tour, panoramas, hotspots,
   * frames e o tratamento por IA já pago, sem desfazer. O mesmo descarte
   * dentro do wizard passa por um alerta desde a Tarefa 11.
   */
  it('não apaga nada enquanto a pessoa não confirma', async () => {
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarAlerta('cancel');
    await fixture.whenStable();
    fixture.detectChanges();
    const apagar = spyOn(propertyService, 'deleteProperty').and.returnValue(of(undefined));

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(alertController.create).toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
  });

  it('tocar fora do alerta conta como desistir, não como confirmar', async () => {
    // O toque no backdrop não chama handler nenhum. Decidir pelo papel
    // devolvido em `onDidDismiss()` é o que impede um toque fora de apagar por
    // omissão — ou de deixar a promise pendurada para sempre.
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarAlerta('backdrop');
    await fixture.whenStable();
    fixture.detectChanges();
    const apagar = spyOn(propertyService, 'deleteProperty').and.returnValue(of(undefined));

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(apagar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
  });

  it('mantém o cartão quando o DELETE falha, em vez de fingir que apagou', async () => {
    // A remoção otimista com o erro engolido fazia um descarte que não
    // aconteceu parecer concluído: o rascunho reaparecia no carregamento
    // seguinte da home, sem nada explicando.
    montar([rascunho({ id: 't1', propertyId: 'i1' })]);
    dublarAlerta('destructive');
    await fixture.whenStable();
    fixture.detectChanges();
    spyOn(propertyService, 'deleteProperty').and.returnValue(
      throwError(() => new Error('rede caiu')),
    );
    const liberar = spyOn(imagens, 'liberar');

    fixture.nativeElement.querySelector('.rascunhos__descartar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.rascunhos__card')).not.toBeNull();
    // Os blobs também ficam: a capa continua na tela.
    expect(liberar).not.toHaveBeenCalled();
    expect(TestBed.inject(ToastController).create).toHaveBeenCalled();
  });

  it('não derruba a home quando listarRascunhos falha — a faixa é um atalho, não o catálogo', async () => {
    TestBed.configureTestingModule({
      imports: [RascunhosBandComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
        provideRouter([]),
      ],
    });
    spyOn(TestBed.inject(VirtualTourService), 'listarRascunhos').and.throwError('rede');

    expect(() => {
      fixture = TestBed.createComponent(RascunhosBandComponent);
      fixture.detectChanges();
    }).not.toThrow();
  });
});
