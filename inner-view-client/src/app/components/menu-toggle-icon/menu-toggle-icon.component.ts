import { Component, Input } from '@angular/core';

/**
 * Animated hamburguer/close icon. The single continuous path morphs between
 * the two bars and the "X" by animating stroke-dasharray/offset while the
 * whole glyph rotates -45deg.
 */
@Component({
  selector: 'app-menu-toggle-icon',
  standalone: true,
  template: `
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="menu-toggle"
      [class.menu-toggle--open]="open"
      [style.--toggle-duration.ms]="duration">
      <path
        class="morph-path"
        d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22" />
      <path d="M7 16 27 16" />
    </svg>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }

    .menu-toggle {
      width: 100%;
      height: 100%;
      transition: transform var(--toggle-duration, 300ms) ease-in-out;
    }

    .menu-toggle--open {
      transform: rotate(-45deg);
    }

    .morph-path {
      stroke-dasharray: 12 63;
      transition: stroke-dasharray var(--toggle-duration, 300ms) ease-in-out,
        stroke-dashoffset var(--toggle-duration, 300ms) ease-in-out;
    }

    .menu-toggle--open .morph-path {
      stroke-dasharray: 20 300;
      stroke-dashoffset: -32.42px;
    }

    @media (prefers-reduced-motion: reduce) {
      .menu-toggle,
      .morph-path {
        transition: none;
      }
    }
  `],
})
export class MenuToggleIconComponent {
  @Input() open = false;
  @Input() duration = 300;
}
