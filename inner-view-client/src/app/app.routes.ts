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
    path: '**',
    redirectTo: 'home',
  },
];
