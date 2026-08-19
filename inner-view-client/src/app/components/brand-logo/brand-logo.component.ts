import { Component, Input } from '@angular/core';

export type BrandLogoKind = 'horizontal' | 'symbol';
export type BrandLogoTone = 'blue' | 'white';

@Component({
  selector: 'app-brand-logo',
  standalone: true,
  templateUrl: './brand-logo.component.html',
  styleUrls: ['./brand-logo.component.scss'],
})
export class BrandLogoComponent {
  @Input() kind: BrandLogoKind = 'horizontal';
  @Input() tone: BrandLogoTone = 'blue';
  @Input() decorative = false;
  @Input() accessibleLabel = 'ARP VISION';

  get src(): string {
    if (this.kind === 'symbol') {
      return 'assets/brand/arp-vision-symbol-blue-transparent.svg';
    }

    return this.tone === 'white'
      ? 'assets/brand/arp-vision-horizontal-white.svg'
      : 'assets/brand/arp-vision-horizontal-blue.svg';
  }

  get intrinsicWidth(): number {
    return this.kind === 'symbol' ? 34 : 104;
  }

  get intrinsicHeight(): number {
    return this.kind === 'symbol' ? 72 : 26;
  }
}
