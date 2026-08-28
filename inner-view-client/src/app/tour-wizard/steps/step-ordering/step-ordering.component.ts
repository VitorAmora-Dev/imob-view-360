import { Component, computed, inject, signal } from '@angular/core';
import { IonReorderGroup } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { nomeDoAmbiente, resumoDeConexoes } from '../../passagens/fila';
import { TourDraftStore } from '../../tour-draft.store';
import { ConnectionPickerComponent } from './connection-picker.component';
import { RoomCardComponent } from './room-card.component';

/**
 * Etapa 2 -- ordenacao dos ambientes e escolha das conexoes.
 *
 * A sequencia dos cards e a sequencia do tour: `publish-payload.ts` numera pela
 * posicao no array. Reordenar aqui muda o tour de verdade.
 */
@Component({
  selector: 'app-tour-step-ordering',
  standalone: true,
  imports: [
    TranslatePipe,
    IonReorderGroup,
    RoomCardComponent,
    ConnectionPickerComponent,
  ],
  templateUrl: './step-ordering.component.html',
  styleUrls: ['./step-ordering.component.scss'],
})
export class StepOrderingComponent {
  readonly draft = inject(TourDraftStore);

  /**
   * Qual card esta aberto -- um por vez.
   *
   * Dois abertos deixam a lista alta demais no celular, e o Ionic desloca os
   * vizinhos pela altura do card arrastado: um card expandido no meio faz o
   * preview do arraste saltar.
   */
  private readonly abertoId = signal<string | null>(null);

  readonly cenas = computed(() => this.draft.readyScenes());
  readonly total = computed(() => this.cenas().length);

  /** Ambientes que ninguem alcanca pelas conexoes escolhidas. Ver a store. */
  readonly ilhados = computed(() =>
    this.draft.ilhadosPorConexao().map(nomeDoAmbiente).join(', '),
  );

  estaAberto(id: string): boolean {
    return this.abertoId() === id;
  }

  nomesDe(id: string): string[] {
    const cenas = this.cenas();
    const cena = cenas.find((s) => s.id === id);
    return cena ? resumoDeConexoes(cena, cenas) : [];
  }

  alternarCard(id: string): void {
    this.abertoId.update((atual) => (atual === id ? null : id));
  }

  /** Escolher ou desescolher um destino. Ligar e simetrico; desligar tambem. */
  alternarConexao(origemId: string, destinoId: string): void {
    const origem = this.cenas().find((s) => s.id === origemId);
    if (!origem) return;

    if ((origem.connections ?? []).includes(destinoId)) {
      this.draft.desligarAmbientes(origemId, destinoId);
      return;
    }
    this.draft.ligarAmbientes(origemId, destinoId);
  }

  /**
   * O arraste comecou: recolhe o card aberto.
   *
   * O Ionic desloca os vizinhos por `translateY` da altura do card arrastado.
   * Um card expandido no meio da lista faz o preview saltar por cima dos outros.
   */
  aoComecarArraste(): void {
    this.abertoId.set(null);
  }

  /**
   * O arraste terminou.
   *
   * `complete(false)` e nao `complete()`: sem o argumento o Ionic faz
   * `insertBefore` no DOM por baixo do `@for`, e o Angular reescreve a lista no
   * proximo ciclo -- os dois mexendo no mesmo no, com resultado imprevisivel.
   * Quem muda a ordem e o sinal.
   */
  aoReordenar(evento: CustomEvent): void {
    const detalhe = evento.detail as unknown as {
      from: number;
      to: number;
      complete: (mover: boolean) => void;
    };
    this.draft.moveScene(detalhe.from, detalhe.to);
    detalhe.complete(false);
  }
}
