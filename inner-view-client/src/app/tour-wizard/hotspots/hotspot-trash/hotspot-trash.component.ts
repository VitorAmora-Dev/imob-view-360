import { Component, ElementRef, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HotspotEditorStore } from '../../hotspot-editor.store';

/**
 * Alvo de exclusão do arraste (tarefa B10).
 *
 * DONO: Frente B.
 *
 * Aparece só enquanto um ponto está sendo arrastado. Fora disso seria um botão
 * permanente sobre a foto oferecendo excluir algo que não está selecionado —
 * ruído, e um ruído perigoso.
 *
 * A área que conta para o hit test é o HOST, de 184×96px (os "96px de altura e
 * ±92px do eixo" do handoff). O que se vê é a pílula dentro dela, menor: mirar
 * com o dedo, arrastando, tendo o próprio dedo cobrindo o alvo, é bem mais
 * difícil do que mirar parado. O host ser a área evita a divergência clássica
 * entre "o retângulo que o teste usa" e "o retângulo que existe".
 *
 * `aria-hidden` de propósito: é um alvo de ponteiro e nada mais. Quem navega
 * por teclado ou leitor de tela exclui pelo ✕ do card, que tem rótulo e ordem
 * de foco. Anunciar aqui um alvo que essas pessoas não conseguem operar seria
 * anunciar um beco sem saída.
 */
@Component({
  selector: 'app-hotspot-trash',
  standalone: true,
  imports: [TranslatePipe],
  host: { 'aria-hidden': 'true' },
  templateUrl: './hotspot-trash.component.html',
  styleUrls: ['./hotspot-trash.component.scss'],
})
export class HotspotTrashComponent {
  private readonly editor = inject(HotspotEditorStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly dragging = computed(() => this.editor.pinDrag() !== null);
  readonly active = computed(() => this.editor.pinDrag()?.overTrash === true);

  /**
   * Se um ponto da tela cai dentro do alvo.
   *
   * Lê o retângulo do próprio host a cada chamada — durante um arraste o layout
   * não muda, mas guardar o retângulo faria a lixeira errar depois de um giro
   * de tela ou de o teclado do celular abrir e fechar.
   */
  contains(clientX: number, clientY: number): boolean {
    if (!this.dragging()) return false;

    const r = this.host.nativeElement.getBoundingClientRect();
    return (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    );
  }
}
