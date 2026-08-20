import {
  PROPERTY_PURPOSES as PURPOSES_DO_WIZARD,
  PROPERTY_TYPES as TYPES_DO_WIZARD,
} from '../tour-wizard/tour-wizard.model';
import { PROPERTY_PURPOSES, PROPERTY_TYPES } from './property.model';

/**
 * As duas listas existem em dois arquivos, e nao deveriam.
 *
 * O dono natural delas e' este modelo: sao vocabulario do dominio — o wizard
 * escolhe um valor ao cadastrar, a home filtra por eles. Mas
 * `tour-wizard.model.ts` esta marcado CONGELADO no proprio cabecalho
 * (SPRINT-3-TOUR-WIZARD.md 4.2: "mudanca aqui so por PR para
 * feature/tour-wizard, com as duas frentes cientes"), e trocar a definicao de
 * la por um reexport — uma linha — nao e' decisao de quem passa por aqui.
 *
 * Enquanto isso nao se resolve, a duplicata fica com guarda: divergir quebra o
 * build em vez de virar um filtro que aceita um tipo que o wizard nao cadastra,
 * ou o contrario.
 */
describe('vocabulario de imovel duplicado entre modelo e wizard', () => {
  it('os tipos sao os mesmos, na mesma ordem', () => {
    expect(PROPERTY_TYPES).toEqual(TYPES_DO_WIZARD);
  });

  it('as finalidades sao as mesmas, na mesma ordem', () => {
    expect(PROPERTY_PURPOSES).toEqual(PURPOSES_DO_WIZARD);
  });
});
