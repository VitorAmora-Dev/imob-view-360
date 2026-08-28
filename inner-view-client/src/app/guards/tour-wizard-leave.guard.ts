import { CanDeactivateFn } from '@angular/router';
import { TourWizardPage } from '../tour-wizard/tour-wizard.page';

/**
 * Segura a saída da rota `tour/novo` quando há trabalho que só existe na
 * tela.
 *
 * `CanDeactivate`, e não um `@Output` no `app-header`: o header é
 * compartilhado por toda a tela (§7 do SPRINT-3-TOUR-WIZARD.md, "consumido
 * como está") e ele mesmo navega — não emite evento nenhum. Um guard de rota
 * intercepta os TRÊS jeitos de sair — o clique no header, o voltar do
 * navegador e o botão físico do Android —, e os dois últimos um `@Output` no
 * header nunca veria.
 *
 * Toda a decisão (perguntar, salvar, descartar, ou deixar passar direto) mora
 * em `TourWizardPage.aoVoltar()`; o guard só repassa o resultado.
 */
export const tourWizardLeaveGuard: CanDeactivateFn<TourWizardPage> = (component) =>
  component.aoVoltar();
