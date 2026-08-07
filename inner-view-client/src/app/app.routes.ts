import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then(m => m.RegisterPage),
  },
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then(m => m.HomePage),
    canActivate: [authGuard],
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: 'inner-view-page/:id',
    loadComponent: () => import('./inner-view-page/inner-view-page.page').then(m => m.InnerViewPagePage),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.page').then(m => m.ProfilePage),
    canActivate: [authGuard],
  },
  {
    path: 'upload',
    loadComponent: () => import('./upload-tour/upload-tour.page').then(m => m.UploadTourPage),
    canActivate: [authGuard],
  },
  {
    path: 'embed/:id',
    loadComponent: () => import('./embed/embed.page').then(m => m.EmbedPage),
  },
  {
    // Bancada de remontagem: lê uma pasta de fotos exportadas e costura de novo,
    // sem aparelho e sem rede. Não é ligada por nenhum link — é ferramenta de
    // diagnóstico, e fica fora do guard porque não toca em dado de ninguém.
    path: 'dev/remontagem',
    loadComponent: () =>
      import('./components/capture-360/restitch-harness.component').then(
        m => m.RestitchHarnessComponent
      ),
  },
  {
    path: '**',
    redirectTo: 'home',
  },
];
