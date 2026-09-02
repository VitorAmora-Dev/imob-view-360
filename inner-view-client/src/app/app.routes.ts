import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { tourWizardLeaveGuard } from './guards/tour-wizard-leave.guard';

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
    // O `:id` é o do IMÓVEL, não o do tour — e continua sendo (decisão D10 do
    // SPRINT-4-TOUR-VIEWER.md). Trocar o parâmetro arrastaria a home, os cards,
    // os guards e todo link que já foi enviado por aí.
    path: 'inner-view-page/:id',
    loadComponent: () => import('./tour-viewer/tour-viewer.page').then(m => m.TourViewerPage),
    canActivate: [authGuard],
  },
  {
    // A tela antiga fica de pé enquanto a refatoração não fecha — é a única
    // referência viva de upload inline e edição de hotspots na visualização.
    // Some no último PR do sprint (TV-12), junto com esta rota.
    path: 'inner-view-legado/:id',
    loadComponent: () => import('./inner-view-page/inner-view-page.page').then(m => m.InnerViewPagePage),
    canActivate: [authGuard],
  },
  {
    path: 'configuracoes',
    loadComponent: () =>
      import('./configuracoes/configuracoes.page').then(m => m.ConfiguracoesPage),
    canActivate: [authGuard],
  },
  {
    path: 'rascunhos',
    loadComponent: () =>
      import('./rascunhos/rascunhos.page').then(m => m.RascunhosPage),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.page').then(m => m.ProfilePage),
    canActivate: [authGuard],
  },
  {
    path: 'tour/novo',
    loadComponent: () => import('./tour-wizard/tour-wizard.page').then(m => m.TourWizardPage),
    canActivate: [authGuard],
    // Pergunta antes de sair quando há foto capturada e ainda não publicada —
    // ver `tourWizardLeaveGuard` para o porquê de ser um guard e não um
    // evento do header.
    canDeactivate: [tourWizardLeaveGuard],
  },
  {
    // O EDITAR do visualizador (SPRINT-4-TOUR-VIEWER.md, TV-11). Mesma tela do
    // wizard, em modo de edição: sem descarte, e a ação final salva em vez de
    // publicar. O `:id` aqui é o do TOUR — diferente do `:id` de
    // `inner-view-page`, que é o do IMÓVEL.
    path: 'tour/:id/editar',
    loadComponent: () => import('./tour-wizard/tour-wizard.page').then(m => m.TourWizardPage),
    canActivate: [authGuard],
    canDeactivate: [tourWizardLeaveGuard],
  },
  {
    // A tela antiga segue de pé enquanto o wizard não fecha o fluxo inteiro —
    // é a única referência viva de como o publicar funciona. Some no último PR
    // do sprint, junto com este redirect.
    path: 'upload',
    redirectTo: 'tour/novo',
    pathMatch: 'full',
  },
  {
    path: 'upload-legado',
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
