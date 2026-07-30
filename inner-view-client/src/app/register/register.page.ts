import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent, IonInput, IonButton, IonToast, IonSpinner
} from '@ionic/angular/standalone';
import { AppHeaderComponent } from '../components/app-header/app-header.component';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  standalone: true,
  imports: [
    FormsModule, RouterLink,
    IonContent, IonInput, IonButton, IonToast, IonSpinner,
    AppHeaderComponent,
  ],
})
export class RegisterPage {
  agencyName = '';
  cnpj = '';
  agencyEmail = '';
  phone = '';
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  loading = false;
  errorMessage = '';
  showToast = false;

  private authService = inject(AuthService);
  private router = inject(Router);

  get passwordMismatch(): boolean {
    return !!this.confirmPassword && this.password !== this.confirmPassword;
  }

  get formValid(): boolean {
    return (
      !!this.agencyName &&
      !!this.name &&
      !!this.email &&
      this.password.length >= 6 &&
      this.password === this.confirmPassword
    );
  }

  submit() {
    if (!this.formValid) return;
    this.loading = true;
    this.authService.signup({
      agencyName: this.agencyName,
      cnpj: this.cnpj || undefined,
      agencyEmail: this.agencyEmail || undefined,
      phone: this.phone || undefined,
      name: this.name,
      email: this.email,
      password: this.password,
    }).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/home']);
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.status === 409
          ? 'Este e-mail já está cadastrado.'
          : 'Não foi possível criar a conta. Tente novamente.';
        this.showToast = true;
      },
    });
  }
}
