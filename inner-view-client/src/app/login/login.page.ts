import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent, IonInput, IonButton, IonToast, IonSpinner
} from '@ionic/angular/standalone';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
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
    AppHeaderComponent, BrandLogoComponent,
  ],
})
export class LoginPage {
  email = '';
  password = '';
  loading = false;
  errorMessage = '';
  showToast = false;

  private authService = inject(AuthService);
  private router = inject(Router);

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
        this.errorMessage = 'E-mail ou senha inválidos.';
        this.showToast = true;
      },
    });
  }
}
