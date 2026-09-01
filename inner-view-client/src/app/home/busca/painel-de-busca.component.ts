import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { closeOutline, searchOutline } from 'ionicons/icons';

import {
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PropertyPurpose,
  PropertyType,
} from '../../models/property.model';
import {
  ChaveDoCriterio,
  CriterioAtivo,
  FILTROS_VAZIOS,
  PropertyFilters,
  criteriosAtivos,
} from '../property-filters';

interface Passo {
  /**
   * O id do passo É a chave do critério que ele edita.
   *
   * Um vocabulário só, de propósito: com "onde/finalidade/tipo" de um lado e
   * "query/purpose/type" do outro, cada leitura do resumo precisaria de uma
   * tabela de conversão — e a tabela é onde o erro mora.
   */
  readonly id: ChaveDoCriterio;
  /** A pergunta, com o passo aberto. */
  readonly tituloKey: string;
  /** O rótulo curto, com o passo fechado. */
  readonly rotuloKey: string;
}

const PASSOS: readonly Passo[] = [
  {
    id: 'query',
    tituloKey: 'HOME.SEARCH.WHERE_TITLE',
    rotuloKey: 'HOME.SEARCH.WHERE_LABEL',
  },
  {
    id: 'purpose',
    tituloKey: 'HOME.SEARCH.PURPOSE_TITLE',
    rotuloKey: 'HOME.SEARCH.PURPOSE_LABEL',
  },
  {
    id: 'type',
    tituloKey: 'HOME.SEARCH.TYPE_TITLE',
    rotuloKey: 'HOME.SEARCH.TYPE_LABEL',
  },
];

/** Mostrado no passo fechado que ninguém preencheu. */
const SEM_VALOR: CriterioAtivo = {
  key: 'query',
  labelKey: 'HOME.SEARCH.EMPTY_VALUE',
  labelText: '',
};

/**
 * Os três passos da busca: onde, finalidade e tipo.
 *
 * DONO: Frente A.
 *
 * Um passo aberto por vez; os outros ficam como uma linha "rótulo … valor" que
 * volta a abrir com um toque. É a mecânica do Airbnb, e o motivo dela é o
 * mesmo aqui: três perguntas curtas, uma de cada vez, cabem num telefone de
 * uma mão — três campos simultâneos, não.
 *
 * **Nada navega enquanto este painel está aberto.** As edições vão para
 * `rascunho`, e só o "Buscar" emite. Antes disto, cada mexida num `select`
 * navegava na hora: trocar finalidade e tipo custava DUAS requisições e duas
 * repinturas da lista, e a segunda cancelava a primeira pelo `switchMap` da
 * home. Também é o que torna "Limpar tudo" reversível — fechar sem buscar não
 * mudou nada.
 *
 * Separado da casca (`BuscaComponent`) porque o conteúdo de um `ion-modal`
 * mora num `<ng-template>` e só existe no DOM depois de apresentado: testar os
 * passos através da casca exigiria apresentar um modal de verdade, que num
 * TestBed falha com "framework delegate is missing". Mesma divisão do
 * `wizard-dialog`.
 */
@Component({
  selector: 'app-painel-de-busca',
  standalone: true,
  templateUrl: './painel-de-busca.component.html',
  styleUrls: ['./painel-de-busca.component.scss'],
  imports: [IonIcon, TranslatePipe],
})
export class PainelDeBuscaComponent {
  /** Os critérios de agora — o ponto de partida do rascunho. */
  readonly filters = input.required<PropertyFilters>();

  /** Emitido UMA vez, no "Buscar". É o que navega. */
  readonly buscar = output<PropertyFilters>();
  readonly fechou = output<void>();

  readonly passos = PASSOS;
  readonly finalidades = PROPERTY_PURPOSES;
  readonly tipos = PROPERTY_TYPES;

  /**
   * O rascunho, semeado dos critérios da URL.
   *
   * `linkedSignal` e não um `effect`: a relação é exatamente "escrevível, mas
   * volta ao valor da fonte quando a fonte muda". Com `effect` seria preciso
   * lembrar de não escrever de dentro dele, e a semeadura aconteceria um tique
   * depois da primeira pintura.
   */
  readonly rascunho = linkedSignal<PropertyFilters>(() => this.filters());

  readonly passo = signal<ChaveDoCriterio>(PASSOS[0].id);

  /** No último passo o botão da direita vira "Buscar". Ver `seguir()`. */
  readonly noUltimo = computed(() => this.passo() === PASSOS[PASSOS.length - 1].id);

  constructor() {
    addIcons({ closeOutline, searchOutline });
  }

  abrir(id: ChaveDoCriterio): void {
    this.passo.set(id);
  }

  /** O valor que a linha fechada mostra, ou "Qualquer" quando vazio. */
  valorDe(id: ChaveDoCriterio): CriterioAtivo {
    return criteriosAtivos(this.rascunho()).find((c) => c.key === id) ?? SEM_VALOR;
  }

  escreverTexto(evento: Event): void {
    const texto = (evento.target as HTMLInputElement).value;
    this.rascunho.update((atual) => ({ ...atual, query: texto }));
  }

  /**
   * Escolher a finalidade AVANÇA.
   *
   * O toque já disse tudo o que este passo tinha a perguntar, e obrigar a um
   * segundo toque em "Próximo" seria cobrar duas vezes pela mesma resposta.
   */
  escolherFinalidade(valor: PropertyPurpose | null): void {
    this.rascunho.update((atual) => ({ ...atual, purpose: valor }));
    this.avancar();
  }

  /**
   * Escolher o tipo NÃO avança: não há para onde. O que vem depois dele é o
   * "Buscar", que já está no rodapé — mandar embora sozinho tiraria da pessoa
   * a chance de rever a escolha antes de disparar a consulta.
   */
  escolherTipo(valor: PropertyType | null): void {
    this.rascunho.update((atual) => ({ ...atual, type: valor }));
  }

  /** "Limpar tudo": zera o rascunho e volta ao começo. NÃO navega. */
  limparTudo(): void {
    this.rascunho.set(FILTROS_VAZIOS);
    this.passo.set(PASSOS[0].id);
  }

  /** O botão da direita: "Próximo" enquanto há passo à frente, senão "Buscar". */
  seguir(): void {
    if (this.noUltimo()) {
      this.buscar.emit(this.rascunho());
      return;
    }
    this.avancar();
  }

  private avancar(): void {
    const atual = PASSOS.findIndex((p) => p.id === this.passo());
    const proximo = PASSOS[atual + 1];
    if (proximo) this.passo.set(proximo.id);
  }
}
