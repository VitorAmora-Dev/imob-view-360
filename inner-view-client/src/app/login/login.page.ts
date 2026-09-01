import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent, IonInput, IonButton, IonToast, IonSpinner
} from '@ionic/angular/standalone';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BrandLogoComponent } from '../components/brand-logo/brand-logo.component';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    FormsModule, RouterLink,
    IonContent, IonInput, IonButton, IonToast, IonSpinner,
    TranslatePipe, BrandLogoComponent,
  ],
})
export class LoginPage {
  email = '';
  password = '';
  loading = false;
  errorMessage = '';
  showToast = false;

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  submit() {
    if (!this.email || !this.password) return;
    this.loading = true;
    this.authService.signin(this.email, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/home']);
      },
      error: () => {
        this.loading = false;
        this.errorMessage = this.translate.instant('AUTH.INVALID_CREDENTIALS');
        this.showToast = true;
      },
    });
  }
}
