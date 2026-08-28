import { tourWizardLeaveGuard } from './tour-wizard-leave.guard';
import { TourWizardPage } from '../tour-wizard/tour-wizard.page';

/**
 * O guard em si é só repasse — a decisão inteira mora em
 * `TourWizardPage.aoVoltar()` (ver seu spec e seus comentários para o
 * porquê de a saída da rota `tour/novo` ser um `CanDeactivate`, e não um
 * `@Output` do `app-header`). O que este teste prova é só a ligação: o que
 * `aoVoltar()` devolve é o que o guard devolve para o Router.
 */
describe('tourWizardLeaveGuard', () => {
  function componenteFalso(resultado: boolean): TourWizardPage {
    return { aoVoltar: () => Promise.resolve(resultado) } as unknown as TourWizardPage;
  }

  // As chamadas reais do Router trazem mais três argumentos (rota e estado,
  // antes e depois) que o guard nunca usa — só o componente decide.
  const guard = tourWizardLeaveGuard as unknown as (
    component: TourWizardPage,
  ) => boolean | Promise<boolean>;

  it('libera a navegação quando aoVoltar() resolve true', async () => {
    expect(await guard(componenteFalso(true))).toBe(true);
  });

  it('segura a navegação quando aoVoltar() resolve false', async () => {
    expect(await guard(componenteFalso(false))).toBe(false);
  });
});
