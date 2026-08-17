import { Component } from '@angular/core';

/**
 * Lixeira — o símbolo de "excluir" do wizard.
 *
 * DONO: Frente A.
 *
 * É SVG e não o emoji 🗑 porque emoji não obedece a `color`: no iOS ele sai
 * sempre no desenho colorido do sistema, então um botão vermelho ficaria com um
 * ícone cinza-azulado dentro, e a pílula escura da lixeira ficaria com um ícone
 * colorido em cima do texto branco. Com `stroke="currentColor"` o ícone é da cor
 * de quem o hospeda, aqui e lá.
 *
 * Sem tamanho próprio: quem chama define a caixa do host (o botão sabe se está
 * num dedo ou num mouse), e o desenho preenche.
 */
@Component({
  selector: 'app-tw-trash-icon',
  standalone: true,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false">
      <path d="M4 7h16" />
      <path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7" />
      <path d="M6.6 7l.7 12.1A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.9L17.4 7" />
      <path d="M10.2 11v6" />
      <path d="M13.8 11v6" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      svg {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class TrashIconComponent {}
