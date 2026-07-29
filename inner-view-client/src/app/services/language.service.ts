import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly STORAGE_KEY = 'app_lang';
  currentLang = signal<'pt' | 'en'>('pt');

  constructor(private translate: TranslateService) {
    const saved = (localStorage.getItem(this.STORAGE_KEY) as 'pt' | 'en') || 'pt';
    this.translate.addLangs(['pt', 'en']);
    this.use(saved);
  }

  toggle() {
    this.use(this.currentLang() === 'pt' ? 'en' : 'pt');
  }

  use(lang: 'pt' | 'en') {
    this.translate.use(lang);
    this.currentLang.set(lang);
    localStorage.setItem(this.STORAGE_KEY, lang);
  }
}
