import {
  Component, ElementRef, Input, OnDestroy, signal, computed, inject,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon, IonPopover, IonList, IonItem, IonLabel } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  globeOutline, personCircleOutline, logOutOutline, checkmarkOutline, arrowBackOutline,
} from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { MenuToggleIconComponent } from '../menu-toggle-icon/menu-toggle-icon.component';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';

export interface HeaderNavLink {
  labelKey: string;
  href: string;
}

/**
 * Sticky app header. Collapses to a floating rounded bar once the page is
 * scrolled (desktop) and to a full-screen sheet behind a hamburguer (mobile).
 *
 * Sits inside the page's <ion-content> rather than in an <ion-header> because
 * the shrink-on-scroll effect needs the content scroll container. As a
 * consequence, scroll offsets have to be forwarded by the host page via
 * `[scrollEvents]="true" (ionScroll)="onScroll($event)"` — a window scroll
 * listener would never fire — and the status-bar inset that ion-header used to
 * handle is applied manually in the SCSS via --ion-safe-area-top.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink, RouterLinkActive, TranslatePipe,
    IonIcon, IonPopover, IonList, IonItem, IonLabel,
    MenuToggleIconComponent,
  ],
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.scss'],
})
export class AppHeaderComponent implements OnDestroy {
  /** Shows a back arrow on the left of the wordmark. */
  @Input() backHref: string | null = null;
  /** Optional page title rendered next to the wordmark on internal screens. */
  @Input() pageTitle: string | null = null;
  /** Renders the compact variant used over the immersive 360 viewer. */
  @Input() variant: 'default' | 'overlay' = 'default';

  readonly links: HeaderNavLink[] = [
    { labelKey: 'NAV.HOME', href: '/home' },
    { labelKey: 'NAV.MY_PROPERTIES', href: '/profile' },
    { labelKey: 'NAV.NEW_TOUR', href: '/upload' },
  ];

  scrolled = signal(false);
  menuOpen = signal(false);
  isLangPopoverOpen = false;
  langPopoverEvent?: Event;

  private router = inject(Router);
  private authService = inject(AuthService);
  private elementRef = inject(ElementRef<HTMLElement>);
  languageService = inject(LanguageService);

  isAuthenticated = computed(() => this.authService.isAuthenticated());

  constructor() {
    addIcons({ globeOutline, personCircleOutline, logOutOutline, checkmarkOutline, arrowBackOutline });
  }

  ngOnDestroy() {
    this.unlockScroll();
  }

  /**
   * ion-content scrolls its own container, so the window scroll event never
   * fires; pages forward their scroll offset here instead.
   */
  onContentScroll(scrollTop: number) {
    this.scrolled.set(scrollTop > 10);
  }

  toggleMenu() {
    this.menuOpen.update(open => !open);
    if (this.menuOpen()) {
      this.lockScroll();
    } else {
      this.unlockScroll();
    }
  }

  closeMenu() {
    this.menuOpen.set(false);
    this.unlockScroll();
  }

  openLanguagePopover(event: Event) {
    this.langPopoverEvent = event;
    this.isLangPopoverOpen = true;
  }

  selectLang(lang: 'pt' | 'en') {
    this.languageService.use(lang);
    this.isLangPopoverOpen = false;
  }

  goBack() {
    if (this.backHref) {
      this.router.navigate([this.backHref]);
    }
  }

  signout() {
    this.closeMenu();
    this.authService.signout();
  }

  /**
   * The page scrolls inside ion-content's own container, not the body, so
   * `body { overflow: hidden }` alone does not stop it. Ionic exposes
   * `--overflow` on ion-content for exactly this; the body class is kept as a
   * belt-and-braces measure for any non-Ionic scroller.
   */
  private lockScroll() {
    document.body.classList.add('menu-scroll-lock');
    this.hostContent()?.style.setProperty('--overflow', 'hidden');
  }

  private unlockScroll() {
    document.body.classList.remove('menu-scroll-lock');
    this.hostContent()?.style.removeProperty('--overflow');
  }

  /** The ion-content this header was projected into, if any. */
  private hostContent(): HTMLElement | null {
    return this.elementRef.nativeElement.closest('ion-content');
  }
}
