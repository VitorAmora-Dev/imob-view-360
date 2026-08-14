import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { CepNotFoundError, CepService } from '../../../services/cep.service';
import { TourDraftStore } from '../../tour-draft.store';

/** Estado da consulta de CEP. O protótipo não desenhou nenhum destes. */
export type CepState = 'idle' | 'loading' | 'notFound' | 'error';

/**
 * Bloco de endereço, colapsado por padrão.
 *
 * DONO: Frente A (tarefa A9).
 *
 * Fica fechado porque endereço é opcional e o corretor quase nunca o tem à mão
 * na hora de publicar — é o campo que faz um formulário parecer longo sem
 * precisar. Aberto só quando ele quiser.
 */
@Component({
  selector: 'app-address-accordion',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './address-accordion.component.html',
  styleUrls: ['./address-accordion.component.scss'],
})
export class AddressAccordionComponent {
  readonly store = inject(TourDraftStore);
  private readonly cepService = inject(CepService);

  readonly isOpen = signal(false);
  readonly cepState = signal<CepState>('idle');

  private readonly numberInput =
    viewChild<ElementRef<HTMLInputElement>>('numberInput');

  /** Evita repetir a consulta do mesmo CEP a cada tecla e a cada blur. */
  private lastLookedUp = '';

  constructor() {
    // Tentou publicar com o endereço pela metade: os campos culpados estão
    // dentro de um bloco fechado, e o botão não faz nada sem dizer por quê.
    // Abrir na hora põe o erro à vista de quem acabou de apertá-lo.
    //
    // Também cobre o remonte: ir para a etapa 2 e voltar destrói este
    // componente e zera o `isOpen`, o que voltaria a esconder o problema.
    effect(() => {
      if (this.store.addressHasError()) this.isOpen.set(true);
    });
  }

  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  /**
   * Formata enquanto digita e dispara a consulta ao fechar os 8 dígitos.
   *
   * A máscara é aplicada de volta no elemento porque o valor exibido tem que
   * acompanhar o que o store guarda; sem isso o cursor briga com o hífen.
   */
  onCepInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    const masked =
      digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    input.value = masked;
    this.store.patchAddress({ zip: masked });

    if (digits.length === 8 && digits !== this.lastLookedUp) {
      void this.lookup(digits);
    }
  }

  /** Rede de segurança para quem colou um CEP e saiu do campo. */
  onCepBlur(): void {
    const digits = this.store.property().address.zip.replace(/\D/g, '');
    if (digits.length === 8 && digits !== this.lastLookedUp) {
      void this.lookup(digits);
    }
  }

  private async lookup(digits: string): Promise<void> {
    this.lastLookedUp = digits;
    this.cepState.set('loading');
    try {
      const address = await firstValueFrom(this.cepService.lookup(digits));
      this.store.patchAddress({
        street: address.street,
        district: address.district ?? '',
        city: address.city,
        state: address.state,
      });
      this.cepState.set('idle');
      // O número é a única coisa que o CEP não sabe. Levar o foco até lá poupa
      // o corretor de procurar qual campo ainda falta.
      this.numberInput()?.nativeElement.focus();
    } catch (error) {
      const naoExiste = error instanceof CepNotFoundError;
      // "Esse CEP não existe" é resposta e vale para sempre — repetir a consulta
      // só gastaria rede. Falha de rede não é resposta: manter o CEP como "já
      // consultado" tranca os dois caminhos de retry, que comparam contra este
      // valor, e a dica de erro fica na tela para sempre mesmo com a conexão de
      // volta. Limpar devolve a segunda chance.
      if (!naoExiste) this.lastLookedUp = '';
      this.cepState.set(naoExiste ? 'notFound' : 'error');
    }
  }

  /** Handler genérico dos demais campos — todos gravam direto no rascunho. */
  onField(field: 'street' | 'number' | 'district' | 'complement' | 'city', event: Event): void {
    this.store.patchAddress({ [field]: (event.target as HTMLInputElement).value });
  }

  /** UF é sempre maiúscula: "sp" e "SP" são o mesmo estado, a API quer um só. */
  onState(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.toUpperCase().slice(0, 2);
    this.store.patchAddress({ state: input.value });
  }
}
