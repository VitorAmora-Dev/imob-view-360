import { Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { Panorama } from '../../models/virtual-tour.model';
import { VirtualTourService } from '../../services/virtual-tour.service';
import { TourSheetComponent } from '../tour-sheet/tour-sheet.component';
import { TourSheetStore } from '../tour-sheet/tour-sheet.store';

/**
 * Largura pedida ao servidor para a miniatura de cada card.
 *
 * Num telefone de 390px cada card fica com ~165px; 320 cobre DPR 2 sem
 * desperdício. Sem esse parâmetro a rota devolve a equirretangular inteira —
 * dezenas de MB por cômodo —, e é isso que tornaria trinta cenas inviáveis.
 */
const LARGURA_DA_MINIATURA = 320;

/**
 * O sheet "Cenas do tour": primeiro consumidor do `TourSheetComponent`.
 *
 * Fechar ao escolher é regra DESTE sheet e mora aqui, não no shell: TV-4 diz
 * com todas as letras que copiar código mantém o sheet aberto. Se a regra
 * subisse para o shell, o primeiro consumidor teria ditado a API para os
 * outros três.
 */
@Component({
  selector: 'app-cenas-sheet',
  standalone: true,
  imports: [TourSheetComponent, TranslatePipe],
  templateUrl: './cenas-sheet.component.html',
  styleUrls: ['./cenas-sheet.component.scss'],
})
export class CenasSheetComponent {
  readonly cenas = input<Panorama[]>([]);
  readonly atualId = input<string | null>(null);

  readonly selecionada = output<Panorama>();

  readonly store = inject(TourSheetStore);
  private readonly tours = inject(VirtualTourService);
  private readonly translate = inject(TranslateService);

  /**
   * Mesma ordem do tour — `order` crescente, igual ao que o
   * `panoramic-viewer` usa em `atualizarNav()`. Duas listas das mesmas cenas
   * em ordens diferentes seria percebido como aleatoriedade.
   */
  readonly ordenadas = computed(() =>
    [...this.cenas()].sort((a, b) => a.order - b.order),
  );

  /** "1 cena" / "N cenas". O ngx-translate não faz plural sozinho. */
  readonly legenda = computed(() => {
    const total = this.ordenadas().length;
    return total === 1
      ? this.translate.instant('VIEWER.CENAS.UMA')
      : this.translate.instant('VIEWER.CENAS.CONTAGEM', { n: total });
  });

  miniatura(cena: Panorama): string {
    return this.tours.urlDoPreview(cena.id, 'treated', { largura: LARGURA_DA_MINIATURA });
  }

  escolher(cena: Panorama): void {
    this.selecionada.emit(cena);
    this.store.fechar();
  }
}
