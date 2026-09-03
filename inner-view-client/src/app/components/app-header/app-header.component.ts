import { Component, Input, signal, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon, IonPopover, IonList, IonItem, IonLabel } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  globeOutline, personCircleOutline, logOutOutline, checkmarkOutline, arrowBackOutline,
  ellipsisHorizontal, settingsOutline,
} from 'ionicons/icons';
import { TranslatePipe } from '@ngx-translate/core';
import { BrandLogoComponent } from '../brand-logo/brand-logo.component';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';

export interface HeaderNavLink {
  labelKey: string;
  href: string;
}

/**
 * Sticky app header. Collapses to a floating rounded bar once the page is
 * scrolled.
 *
 * The hamburguer and its full-screen sheet are gone: on the phone, the everyday
 * destinations live in `TabBarComponent` at the bottom of the screen, and
 * language, sign-out and "My properties" moved to the settings screen — reached
 * from the gear on the right of this header, which stands in for the desktop
 * cluster below 744px. Two competing navigations on the same screen is what
 * confuses people — and a menu nobody opens is navigation that does not
 * happen.
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
    BrandLogoComponent,
  ],
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.scss'],
})
export class AppHeaderComponent {
  /** Shows a back arrow on the left of the brand signature. */
  @Input() backHref: string | null = null;
  /** Optional page title rendered next to the brand signature on internal screens. */
  @Input() pageTitle: string | null = null;
  /** Renders the compact variant used over the immersive 360 viewer. */
  @Input() variant: 'default' | 'overlay' = 'default';
  /** No viewer imersivo, preserva somente o voltar no cabeçalho overlay. */
  @Input() chromeVisible = true;

  readonly links: HeaderNavLink[] = [
    { labelKey: 'NAV.HOME', href: '/home' },
    { labelKey: 'NAV.MY_PROPERTIES', href: '/profile' },
    { labelKey: 'NAV.NEW_TOUR', href: '/upload' },
  ];

  scrolled = signal(false);
  isLangPopoverOpen = false;
  langPopoverEvent?: Event;
  isNavPopoverOpen = false;
  navPopoverEvent?: Event;

  private router = inject(Router);
  private authService = inject(AuthService);
  languageService = inject(LanguageService);

  isAuthenticated = computed(() => this.authService.isAuthenticated());

  constructor() {
    addIcons({
      globeOutline, personCircleOutline, logOutOutline, checkmarkOutline, arrowBackOutline,
      ellipsisHorizontal, settingsOutline,
    });
  }

  /**
   * ion-content scrolls its own container, so the window scroll event never
   * fires; pages forward their scroll offset here instead.
   */
  onContentScroll(scrollTop: number) {
    this.scrolled.set(scrollTop > 10);
  }

  openLanguagePopover(event: Event) {
    this.langPopoverEvent = event;
    this.isLangPopoverOpen = true;
  }

  openNavPopover(event: Event) {
    this.navPopoverEvent = event;
    this.isNavPopoverOpen = true;
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
    this.authService.signout();
  }

}
