import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { of } from 'rxjs';

import { Panorama, VirtualTour } from '../models/virtual-tour.model';
import { PanoramicViewerComponent } from '../components/panoramic-viewer/panoramic-viewer.component';
import { VirtualTourService } from '../services/virtual-tour.service';
import { EmbedPage } from './embed.page';

/**
 * Dublê do viewer 360.
 *
 * O de verdade sobe three.js, pede um contexto WebGL e começa a baixar
 * equirretangulares — nada disso tem a ver com o que se prova aqui, que é uma
 * ligação de `@Input`. O dublê guarda o valor recebido, que é exatamente a
 * pergunta do teste.
 */
@Component({
  selector: 'app-panoramic-viewer',
  standalone: true,
  template: '',
})
class ViewerDeMentiraComponent {
  @Input() panoramas: Panorama[] = [];
  @Input() roomNav = true;
}

const TOUR = {
  id: 't1',
  status: 'PUBLISHED',
  propertyId: 'p1',
  createdAt: '',
  updatedAt: '',
  panoramas: [{ id: 'a', roomName: 'Sala', imageUrl: '/x', order: 0, originHotspots: [] }],
} as unknown as VirtualTour;

/**
 * A OUTRA METADE do interruptor "Mostrar controles" do sheet Incorporar (TV-4).
 *
 * Lá o store acrescenta `?controles=0` ao link; aqui o parâmetro vira alguma
 * coisa. Enquanto esta metade não existia, o interruptor gerava uma URL
 * diferente e um embed idêntico — e a tela de quem configurava mostrava que
 * tinha funcionado.
 */
describe('EmbedPage — o parâmetro `controles`', () => {
  function montar(queryParams: Record<string, string>) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EmbedPage],
      providers: [
        provideIonicAngular(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 't1' }),
              queryParamMap: convertToParamMap(queryParams),
            },
          },
        },
        {
          provide: VirtualTourService,
          useValue: { findTour: () => of(TOUR), recordView: () => of(null) },
        },
      ],
    }).overrideComponent(EmbedPage, {
      remove: { imports: [PanoramicViewerComponent] },
      add: { imports: [ViewerDeMentiraComponent] },
    });

    const fixture = TestBed.createComponent(EmbedPage);
    fixture.detectChanges();
    return fixture;
  }

  function roomNavDoViewer(fixture: ReturnType<typeof montar>): boolean {
    return (
      fixture.debugElement.query(By.directive(ViewerDeMentiraComponent))
        .componentInstance as ViewerDeMentiraComponent
    ).roomNav;
  }

  it('sem parâmetro nenhum, o embed continua com a navegação de ambientes', () => {
    expect(roomNavDoViewer(montar({}))).toBeTrue();
  });

  it('`controles=0` esconde a navegação de ambientes', () => {
    expect(roomNavDoViewer(montar({ controles: '0' }))).toBeFalse();
  });

  it('`controles=1` deixa como está', () => {
    expect(roomNavDoViewer(montar({ controles: '1' }))).toBeTrue();
  });

  /**
   * Um valor que ninguém previu mantém os controles.
   *
   * O padrão é o comportamento completo: um parâmetro digitado errado não
   * deveria mutilar em silêncio o tour de quem incorporou.
   */
  it('um valor desconhecido não desliga nada', () => {
    expect(roomNavDoViewer(montar({ controles: 'talvez' }))).toBeTrue();
  });
});
