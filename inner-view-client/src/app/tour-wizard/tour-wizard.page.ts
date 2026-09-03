import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';
import { filaDePassagens } from './passagens/fila';
import { TourPublishedComponent } from './published/tour-published.component';
import { StepOrderingComponent } from './steps/step-ordering/step-ordering.component';
import { StepPassagesComponent } from './steps/step-passages/step-passages.component';
import { StepImagesComponent } from './steps/step-images/step-images.component';
import { StepInfoComponent } from './steps/step-info/step-info.component';
import { TourDraftStore } from './tour-draft.store';
import { WizardActionsComponent } from './ui/wizard-actions/wizard-actions.component';
import { WizardStepperComponent } from './ui/wizard-stepper/wizard-stepper.component';
import { DialogoDoWizard } from './ui/wizard-dialog/dialogo-do-wizard.service';
import { WizardDialogComponent } from './ui/wizard-dialog/wizard-dialog.component';
import { PerguntaDoWizard } from './ui/wizard-dialog/wizard-dialog.model';

/**
 * As perguntas que esta tela faz, e as respostas que ela sabe interpretar.
 *
 * Fora da classe porque não dependem de nada dela: são dados. Os `id` viram
 * constantes para o `switch` lá embaixo comparar com a MESMA string que a
 * pergunta declara — literal solto nos dois lugares é como um renomear
 * silencioso vira "nenhuma ação foi escolhida".
 */
const SAIR_SALVANDO = 'continuar-depois';
const SAIR_DESCARTANDO = 'descartar';
const SAIR_SEM_SALVAR = 'sair-mesmo-assim';
const TENTAR_DE_NOVO = 'tentar-de-novo';

/**
 * Duas saídas, e a segura vem primeiro — na leitura, no foco e na largura.
 *
 * `dispensavel` porque a terceira saída do alerta antigo ("Ficar aqui") virou
 * o X, o toque fora e o Esc: tocar em voltar sem querer é o caso comum, e o
 * caso comum não merece um botão do mesmo tamanho das duas decisões reais.
 * Dispensar responde `null`, que esta tela lê como "fica".
 */
const PERGUNTA_DE_SAIDA: PerguntaDoWizard = {
  tituloKey: 'TOUR_WIZARD.COMMON.LEAVE_TITLE',
  mensagemKey: 'TOUR_WIZARD.COMMON.LEAVE_MESSAGE',
  dispensavel: true,
  // "Fechar" descreveria o gesto; aqui o X quer dizer "ficar aqui", que e' o
  // que o leitor de tela precisa anunciar.
  fecharKey: 'TOUR_WIZARD.COMMON.LEAVE_CANCEL',
  acoes: [
    {
      id: SAIR_SALVANDO,
      rotuloKey: 'TOUR_WIZARD.COMMON.LEAVE_KEEP',
      tom: 'primario',
    },
    {
      id: SAIR_DESCARTANDO,
      rotuloKey: 'TOUR_WIZARD.COMMON.LEAVE_DISCARD',
      tom: 'destrutivo',
      icone: 'lixeira',
      // Dois toques. `descartarRascunho()` apaga o imóvel em cascata — as
      // fotos e o tratamento por IA que já subiram vão junto, e não voltam. Com
      // o alerta de três botões, este ficava protegido por estar no meio da
      // pilha; com dois botões grandes ele passou a ser metade da tela, do lado
      // em que o polegar descansa. A confirmação devolve o custo que a
      // simplificação tirou.
      confirmaKey: 'TOUR_WIZARD.COMMON.LEAVE_DISCARD_CONFIRM',
    },
  ],
};

/**
 * A saída em modo de EDIÇÃO (TV-11).
 *
 * A diferença para a pergunta acima é a ausência: não há "Descartar captura".
 * Aquele botão apaga o imóvel em cascata, e aqui o tour está no ar, com link
 * que já circulou. Sair sem salvar deixa o tour exatamente como estava — que é
 * o pior desfecho possível deste diálogo, e é um desfecho seguro.
 *
 * Sem `icone: 'lixeira'` em lugar nenhum, pela mesma razão: nada aqui apaga
 * coisa alguma.
 */
const PERGUNTA_DE_SAIDA_EM_EDICAO: PerguntaDoWizard = {
  tituloKey: 'TOUR_WIZARD.COMMON.LEAVE_EDIT_TITLE',
  mensagemKey: 'TOUR_WIZARD.COMMON.LEAVE_EDIT_MESSAGE',
  dispensavel: true,
  fecharKey: 'TOUR_WIZARD.COMMON.LEAVE_CANCEL',
  acoes: [
    {
      id: SAIR_SALVANDO,
      rotuloKey: 'TOUR_WIZARD.COMMON.LEAVE_EDIT_SAVE',
      tom: 'primario',
    },
    {
      id: SAIR_SEM_SALVAR,
      rotuloKey: 'TOUR_WIZARD.COMMON.LEAVE_EDIT_DISCARD',
      tom: 'neutro',
    },
  ],
};

/**
 * `dispensavel: false` porque tocar fora não é resposta: os dois desfechos
 * aqui são consequentes, e o default silencioso seria justamente o que este
 * aviso existe para tirar do caminho.
 *
 * Sem lixeira no "Sair mesmo assim": ele não apaga nada — deixa para trás o
 * que ainda não subiu. A lixeira é do descarte, e só dele.
 */
const PERGUNTA_DE_SALVAMENTO_FALHO: PerguntaDoWizard = {
  tituloKey: 'TOUR_WIZARD.COMMON.SAVE_FAILED_TITLE',
  mensagemKey: 'TOUR_WIZARD.COMMON.SAVE_FAILED_MESSAGE',
  dispensavel: false,
  acoes: [
    {
      id: TENTAR_DE_NOVO,
      rotuloKey: 'TOUR_WIZARD.COMMON.SAVE_RETRY',
      tom: 'primario',
    },
    {
      id: SAIR_SEM_SALVAR,
      rotuloKey: 'TOUR_WIZARD.COMMON.SAVE_FAILED_LEAVE',
      tom: 'destrutivo',
    },
  ],
};

/** Ver `retomar()` para o motivo de "siga como tour novo" não estar aqui. */
const PERGUNTA_DE_RETOMADA_FALHA: PerguntaDoWizard = {
  tituloKey: 'TOUR_WIZARD.COMMON.RESUME_FAILED_TITLE',
  mensagemKey: 'TOUR_WIZARD.COMMON.RESUME_FAILED_MESSAGE',
  dispensavel: false,
  acoes: [
    {
      id: TENTAR_DE_NOVO,
      rotuloKey: 'TOUR_WIZARD.COMMON.RESUME_FAILED_RETRY',
      tom: 'primario',
    },
    {
      id: 'voltar-ao-inicio',
      rotuloKey: 'TOUR_WIZARD.COMMON.RESUME_FAILED_HOME',
      tom: 'neutro',
    },
  ],
};

/**
 * Wizard de criação de tour: topbar, stepper, corpo da etapa e barra de ação.
 *
 * DONO: Frente A.
 *
 * A página é só o arranjo — quem sabe algo são o stepper, a barra de ação e
 * cada etapa, todos lendo o mesmo `TourDraftStore`. Por isso ela não tem nem
 * `@Input` nem estado próprio.
 *
 * O store é fornecido AQUI, e não em `root`: o rascunho morre junto com a tela
 * (não há persistência — ver §2.3 do plano do sprint) e "Criar outro tour" é
 * só um `reset()`.
 */
@Component({
  selector: 'app-tour-wizard',
  templateUrl: './tour-wizard.page.html',
  styleUrls: ['./tour-wizard.page.scss'],
  standalone: true,
  providers: [TourDraftStore, DialogoDoWizard],
  imports: [
    IonContent,
    TranslatePipe,
    WizardStepperComponent,
    WizardActionsComponent,
    StepImagesComponent,
    StepOrderingComponent,
    StepPassagesComponent,
    StepInfoComponent,
    TourPublishedComponent,
    WizardDialogComponent,
  ],
})
export class TourWizardPage implements OnInit {
  readonly store = inject(TourDraftStore);

  /**
   * Público porque o template o liga no `<app-tw-wizard-dialog>`: quem abre e
   * fecha o diálogo é o serviço, e a página só faz a pergunta e lê a
   * resposta.
   */
  readonly dialogo = inject(DialogoDoWizard);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /**
   * A etapa de passagens entrega a tela para a foto — e só enquanto há foto.
   *
   * O modo imersivo esconde o stepper e a barra de ação no celular (ver o
   * SCSS), e a barra é onde mora o único "Continuar". Com a fila acabada, ou
   * sem conexão nenhuma escolhida, a etapa não mostra foto: mostra um
   * parágrafo. Esconder a barra ali prendia o corretor numa tela quase branca,
   * sem avançar nem voltar — foi o que aconteceu no celular.
   *
   * A condição sai da mesma função pura que a etapa usa para montar a fila, e
   * não de um `@Output` dela: o `PassagensStore` é fornecido pelo componente
   * da etapa, e a página não o alcança. Haver passagem pendente é exatamente
   * o caso em que a etapa monta o visualizador.
   */
  readonly imersivo = computed(
    () =>
      this.store.step() === 3 &&
      !this.store.published() &&
      filaDePassagens(this.store.scenes()).some((p) => !p.feita),
  );

  constructor() {
    // `visibilitychange`, e não `beforeunload`: navegador de celular ignora ou
    // limita o segundo, e ele não dispara quando o SISTEMA mata o app em
    // segundo plano — que é justamente um dos dois jeitos de perder o
    // trabalho que esta tarefa fecha (o outro é o botão de voltar, coberto
    // pelo `tourWizardLeaveGuard`).
    const aoEsconder = () => {
      if (document.visibilityState !== 'hidden') return;
      if (this.store.published() || !this.store.readyScenes().length) return;
      void this.store.salvarRascunho().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', aoEsconder);

    // Salvou a edição: volta para o visualizador de onde o corretor veio.
    //
    // Não há tela de sucesso aqui — o tour já estava publicado, e anunciar
    // "seu tour está no ar!" para quem renomeou um cômodo seria mentir sobre o
    // que acabou de acontecer. A confirmação é ver o tour de novo, com a
    // alteração feita.
    effect(() => {
      if (!this.store.edicaoSalva()) return;
      void this.router.navigate(this.destinoDeSaida());
    });
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('visibilitychange', aoEsconder),
    );
  }

  /**
   * Entrada pela faixa "Capturas em andamento" da home, que navega para
   * `/tour/novo?rascunho=<tourId>`. Sem o parâmetro, o wizard começa vazio
   * como sempre começou — é o mesmo caminho do FAB e do "Criar meu primeiro
   * tour".
   */
  ngOnInit(): void {
    // `tour/:id/editar` — o EDITAR do visualizador. Tem precedência sobre a
    // retomada porque são rotas diferentes: o parâmetro de caminho só existe
    // na de edição.
    const emEdicao = this.route.snapshot.paramMap.get('id');
    if (emEdicao) {
      void this.abrirParaEdicao(emEdicao);
      return;
    }

    const rascunho = this.route.snapshot.queryParamMap.get('rascunho');
    if (rascunho) void this.retomar(rascunho);
  }

  /**
   * Abre o tour para edição, com a mesma pergunta da retomada quando falha.
   *
   * Seguir em frente calado seria pior aqui do que lá: o wizard vazio com
   * `rascunhoTourId` nulo trataria a primeira captura como tour NOVO, e o
   * corretor que veio editar um tour publicado ganharia um segundo imóvel.
   */
  private async abrirParaEdicao(tourId: string): Promise<void> {
    try {
      await this.store.abrirParaEdicao(tourId);

      // O sheet Gerenciar pode pedir a etapa de Informações diretamente. A
      // ausência (ou qualquer outro valor) preserva a entrada normal do botão
      // Editar, sem mudar o fluxo de criação nem a retomada de rascunho.
      if (this.route.snapshot.queryParamMap.get('etapa') === '4') {
        this.store.step.set(4);
      }
      return;
    } catch {
      // A pergunta fica fora do catch pelo mesmo motivo de `retomar()`.
    }

    if ((await this.dialogo.perguntar(PERGUNTA_DE_RETOMADA_FALHA)) === TENTAR_DE_NOVO) {
      await this.abrirParaEdicao(tourId);
      return;
    }

    void this.router.navigate(['/home']);
  }

  /**
   * Falhou a retomada: PERGUNTA, nunca segue em frente calado.
   *
   * O `.catch(() => undefined)` que morava aqui dizia que o pior caso era "o
   * wizard abrir vazio, como se tivesse tocado no FAB". Não era. Vazio, mas
   * com `rascunhoTourId` nulo — e a primeira captura chamaria
   * `garantirRascunho()`, que CRIA imóvel e tour DRAFT novos. O rascunho
   * original continuava intacto na faixa, e a home passava a mostrar dois
   * cartões para o que o corretor acha que é uma captura só, com as fotos
   * repartidas entre eles.
   *
   * Ele tocou na faixa exatamente para NÃO recomeçar. Então as duas saídas são
   * tentar de novo ou voltar para a home — nenhuma delas é "siga como tour
   * novo". `dispensavel: false` na pergunta pelo mesmo motivo: fechar no
   * toque de fora devolveria justamente o estado que ela existe para impedir.
   */
  private async retomar(tourId: string): Promise<void> {
    try {
      await this.store.retomarRascunho(tourId);
      return;
    } catch {
      // Segue abaixo: a pergunta não pode acontecer dentro do `catch`, senão
      // uma falha DELA viraria uma segunda entrada neste mesmo bloco.
    }

    if ((await this.dialogo.perguntar(PERGUNTA_DE_RETOMADA_FALHA)) === TENTAR_DE_NOVO) {
      // Recursão só avança com gesto do corretor: cada rodada nova custa um
      // toque, então rede fora não vira laço de tentativas.
      await this.retomar(tourId);
      return;
    }

    void this.router.navigate(['/home']);
  }

  /**
   * Salvar falhou na saída: pergunta em vez de deixar sair acreditando.
   *
   * Resolve `false` (fica) no "tentar de novo" — o guard cancela a saída e o
   * corretor vê o aviso da barra, com o botão de repetir. Resolve `true` no
   * "sair mesmo assim", que é escolha informada, e é o que o texto do botão
   * precisa deixar claro.
   *
   * A pergunta não é dispensável (ver `PERGUNTA_DE_SALVAMENTO_FALHO`), então
   * `null` aqui só chegaria se ela fosse substituída por outra — caso em que
   * ficar é a resposta segura.
   */
  private async avisarQueNaoSalvou(): Promise<boolean> {
    return (await this.dialogo.perguntar(PERGUNTA_DE_SALVAMENTO_FALHO)) === SAIR_SEM_SALVAR;
  }

  /**
   * "Tentar de novo" do aviso da barra.
   *
   * Fogo-e-esquece de propósito: quem lê o resultado é o próprio
   * `estadoDoSalvamento`, que a barra observa. Um `await` aqui só serviria
   * para reescrever no `catch` o que o sinal já vai dizer.
   */
  salvarDeNovo(): void {
    void this.store.salvarRascunho().catch(() => undefined);
  }

  /**
   * Voltar compacto da galeria; o guard da rota preserva a decisão de saída.
   *
   * Em edição o destino é o VISUALIZADOR de onde o corretor veio, e não a
   * home: ele tocou em EDITAR dentro de um tour, e devolvê-lo à listagem o
   * faria procurar de novo o imóvel que estava aberto na tela.
   */
  voltar(): void {
    void this.router.navigate(this.destinoDeSaida());
  }

  private destinoDeSaida(): unknown[] {
    const propertyId = this.store.rascunhoPropertyId();
    return this.store.editando() && propertyId
      ? ['/inner-view-page', propertyId]
      : ['/home'];
  }

  /**
   * A decisão de saída em voo, ou `null` quando nenhuma está.
   *
   * O Router cancela uma navegação em curso quando outra chega, e roda o
   * `canDeactivate` de novo — então o botão físico do Android, um duplo
   * toque no header ou o voltar do navegador em sequência chamam
   * `aoVoltar()` mais de uma vez antes da primeira responder. Sem esta
   * trava, a segunda chamada abriria um SEGUNDO diálogo por cima do primeiro;
   * se os dois botões escolhidos divergissem ("Descartar" em cima,
   * "Continuar depois" embaixo), `salvarRascunho()` rodaria DEPOIS do
   * `reset()` do descarte e recriaria um imóvel "Captura em andamento" vazio
   * — o registro fantasma que o comentário de `descartarRascunho()` existe
   * para evitar.
   *
   * Não é `async` de propósito: `return this.decisaoDeSaida;` precisa
   * devolver o MESMO objeto de promise para o segundo chamador, e uma função
   * `async` sempre embrulha o que ela devolve numa promise nova.
   */
  private decisaoDeSaida: Promise<boolean> | null = null;

  /**
   * Decide se dá para sair do wizard. Devolve `true` para deixar a navegação
   * seguir, `false` para ficar.
   *
   * Chamado pelo `tourWizardLeaveGuard` (`CanDeactivate` da rota `tour/novo`),
   * não por um `@Output` do `app-header`: o header é compartilhado por toda a
   * tela (§7 do SPRINT-3-TOUR-WIZARD.md, "consumido como está") e ele mesmo
   * navega com `backHref` — não emite evento. Um guard de rota, além de
   * cobrir o clique no header, intercepta o voltar do NAVEGADOR e o botão
   * FÍSICO do Android, os dois casos do chamado original que um `@Output` no
   * header nunca veria.
   */
  aoVoltar(): Promise<boolean> {
    if (this.decisaoDeSaida) return this.decisaoDeSaida;

    const decisao = this.decidirSaida();
    this.decisaoDeSaida = decisao;
    void decisao.finally(() => {
      if (this.decisaoDeSaida === decisao) this.decisaoDeSaida = null;
    });
    return decisao;
  }

  /**
   * Sem cômodo nenhum não há o que perguntar. E depois de publicado também
   * não: o tour já está no ar, e oferecer "descartar" ali apagaria um imóvel
   * que deixou de ser rascunho.
   */
  private async decidirSaida(): Promise<boolean> {
    // `edicaoSalva` é o `published` do modo de edição: o trabalho está no
    // servidor, e perguntar de novo seguraria a navegação que o próprio
    // salvamento disparou.
    if (
      this.store.published() ||
      this.store.edicaoSalva() ||
      !this.store.readyScenes().length
    ) {
      return true;
    }

    const pergunta = this.store.editando()
      ? PERGUNTA_DE_SAIDA_EM_EDICAO
      : PERGUNTA_DE_SAIDA;

    switch (await this.dialogo.perguntar(pergunta)) {
      // Só a pergunta de CRIAÇÃO oferece este. Ver `PERGUNTA_DE_SAIDA_EM_EDICAO`.
      case SAIR_DESCARTANDO:
        await this.store.descartarRascunho().catch(() => undefined);
        return true;

      case SAIR_SALVANDO:
        // A única das saídas em que o corretor PEDIU para salvar — e o
        // diálogo que ele acabou de ler afirma que está guardado.
        //
        // Antes: engolir a falha e sair. A rede caía e ele saía acreditando,
        // sem os nomes, os hotspots e as conexões. As fotos e o tratamento por
        // IA de fato estão salvos — eles sobem durante a captura —, mas o
        // resto é exatamente o que esta funcionalidade existe para guardar.
        //
        // Sair continua sendo opção dele; prender alguém no wizard porque a
        // rede caiu é pior. O que deixa de existir é sair sem saber.
        try {
          await this.store.salvarRascunho();
          return true;
        } catch {
          return this.avisarQueNaoSalvou();
        }

      case SAIR_SEM_SALVAR:
        // Só existe em edição, e é escolha informada: o tour continua no ar
        // exatamente como estava antes de esta tela abrir.
        return true;

      default:
        // O X, o toque fora e o Esc. Dispensar É "ficar aqui" — foi o botão
        // que eles substituíram, e é a resposta segura para o toque em voltar
        // que ninguém quis dar.
        return false;
    }
  }
}
