import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { TourSheetComponent } from '../../../components/tour-sheet/tour-sheet.component';
import { TourViewerStore } from '../../tour-viewer.store';

/**
 * A confirmação de apagar o tour (TV-5, `04-sheets.md` §3).
 *
 * Este componente É o invariante 4 do sprint ("ação destrutiva sempre passa por
 * confirmação") em forma de arquivo. `TourViewerStore.apagarTour()` não
 * confirma nada de propósito — ele é o DEPOIS da confirmação, e chamá-lo de
 * qualquer outro lugar é exatamente o bug que a separação existe para impedir.
 *
 * Bottom sheet no celular e diálogo centrado de 480px no desktop, pela
 * `variante="adaptavel"` do shell. Sem media query própria: o corte é do shell,
 * e ele precisa dele em TypeScript — a diferença entre sheet e diálogo é a
 * PRESENÇA de `breakpoints` no `<ion-modal>`, e isso o CSS não alcança.
 */
@Component({
  selector: 'app-tour-delete-sheet',
  standalone: true,
  imports: [TourSheetComponent, TranslatePipe],
  templateUrl: './tour-delete-sheet.component.html',
  styleUrls: ['./tour-delete-sheet.component.scss'],
})
export class TourDeleteSheetComponent {
  private readonly store = inject(TourViewerStore);

  readonly aberto = computed(() => this.store.sheet() === 'delete');
  readonly nome = this.store.tourName;
  readonly quantidadeDeCenas = computed(() => this.store.scenes().length);
  readonly apagando = this.store.apagando;

  /**
   * Apaga, e só devolve o sheet à pessoa se der errado.
   *
   * No sucesso não há o que fechar: `apagarTour()` navega para a home, a página
   * do visualizador é destruída e o shell derruba o `<ion-modal>` junto — é o
   * `destroyRef.onDestroy` dele, escrito para este caminho.
   *
   * Na falha o sheet SEGUE ABERTO. Fechar aqui deixaria a pessoa de volta num
   * tour que ela mandou apagar, com um toast passageiro como única pista de que
   * ele ainda existe — e o gesto seguinte seria mandar apagar de novo.
   *
   * A guarda de reentrada não é teatro: `[travado]` recusa os três GESTOS de
   * fechamento, mas não impede um segundo toque no próprio botão. Sem ela, dois
   * toques rápidos disparam dois DELETE, e o segundo volta 404 sobre um tour
   * que o primeiro apagou com sucesso — falha anunciada para uma operação que
   * deu certo.
   */
  async confirmar(): Promise<void> {
    if (this.apagando()) return;

    const apagou = await this.store.apagarTour();
    if (!apagou) this.store.mostrarToast('TOUR_VIEWER.TOAST.DELETE_ERROR');
  }

  cancelar(): void {
    if (this.apagando()) return;
    this.store.fecharSheet();
  }
}
