import {
  CaptureFrameUpload,
  CaptureGeometry,
} from '../services/virtual-tour.service';
import type { PropertyPurpose, PropertyType } from '../models/property.model';

/**
 * Modelo do rascunho em memória do wizard de criação de tour.
 *
 * CONGELADO (SPRINT-3-TOUR-WIZARD.md §4.2): mudança aqui só por PR para
 * `feature/tour-wizard`, com as duas frentes cientes. É o único arquivo que
 * as duas leem e do qual as duas dependem.
 *
 * Quase nada aqui é o que o servidor guarda: estes tipos existem enquanto o
 * corretor preenche o wizard. As exceções são os campos `server*Id`, que são a
 * ponte entre o rascunho em memória e as linhas que já subiram — sem eles não
 * há como retomar uma captura nem reconciliar o que mudou.
 */

/**
 * Etapas do wizard: imagens, ordenação e conexões, passagens, informações.
 *
 * Não existe etapa 0 nem 5 — o sucesso é um estado à parte, `published()`.
 */
export type WizardStep = 1 | 2 | 3 | 4;

/**
 * Quantas etapas existem, num lugar só.
 *
 * Existe porque o total estava espalhado por onze pontos, incluindo DENTRO de
 * uma string de tradução (`"Etapa {{step}} de 3"`) — o único deles que some em
 * silêncio quando alguém acrescenta uma etapa.
 */
export const TOTAL_ETAPAS = 4;

/**
 * Um ponto marcado sobre a esfera.
 *
 * `u`/`v` são coordenadas UV do equirretangular, 0–1 — exatamente o par que o
 * `PanoramicViewerComponent` já emite em `hotspotPlaced` e que o servidor grava
 * em `positionX`/`positionY`. O handoff de design fala em percentuais do
 * retângulo do viewer; ignore, aquilo valia para o protótipo, que era uma
 * imagem estática. Aqui não há conversão a fazer.
 */
export interface WizardHotspot {
  /** uuid local. Nunca é o id do servidor — esse é o `serverId`. */
  id: string;
  /**
   * Id do hotspot no servidor, quando ele já foi gravado.
   *
   * Previsto em §4.2 desde o commit-zero — "preenchido no diff do publicar" —
   * e nunca implementado, porque até agora o publicar apagava todos os
   * hotspots do tour e recriava, e para isso não era preciso saber qual é
   * qual.
   *
   * Apagar-e-recriar era aceitável rodando uma vez, no publicar: a janela sem
   * hotspot no banco durava milissegundos e ninguém a via. Deixou de ser
   * quando o salvamento passou a rodar a cada troca de etapa — uma queda de
   * rede dentro dessa janela devolve o rascunho sem os pontos que o corretor
   * marcou.
   *
   * Ausente em ponto recém-criado e em cena que nunca foi salva.
   */
  serverId?: string;
  /** 0–1, longitude na projeção equirretangular. */
  u: number;
  /** 0–1, latitude na projeção equirretangular. */
  v: number;
  label: string;
  /**
   * `id` local da cena de destino, ou `null` enquanto o corretor não escolheu.
   *
   * `null` é um estado normal e frequente: é como todo hotspot nasce, no
   * instante do toque na imagem. Ele não persiste — no publicar, hotspot sem
   * destino é descartado com aviso (§2.1), porque é inerte de qualquer forma.
   */
  target: string | null;
}

/** Estado do arquivo dentro do card de ambiente da etapa 1. */
export type WizardSceneState = 'reading' | 'ready' | 'rejected';

/**
 * Onde a cena está na montagem por IA, que roda em segundo plano enquanto o
 * corretor fotografa os outros cômodos.
 *
 * Eixo separado de `WizardSceneState`: a cena fica `ready` — utilizável,
 * publicável, com foto à vista — durante todo o tratamento. As duas coisas
 * caminham juntas de propósito, porque falhar aqui degrada a qualidade do tour
 * e nunca o derruba.
 *
 * `idle` é o estado de quem nunca vai ser tratado: foto vinda de arquivo, sem
 * as fotos originais que servem de referência ao modelo. Diferente de
 * `skipped`, que é o servidor dizendo que olhou e dispensou.
 *
 * SÓ ESTADO TERMINAL. `uploading` e `processing` moravam aqui e saíram: nada
 * no cliente os produz mais.
 *
 * O tratamento deixou de rodar em segundo plano no store e passou a acontecer
 * DENTRO do modal de captura, aguardado por quem chamou — quando o cômodo
 * aparece na etapa 1, ele já chegou tratado. O único escritor vivo hoje é o
 * `step-images`, gravando `done` quando o modal devolve foto tratada; os
 * demais valores só aparecem numa retomada, traduzidos do `treatmentStatus`.
 *
 * Enquanto os dois existiam, a retomada os produzia a partir do `PENDING` que
 * é o `@default` da coluna — e como nenhuma tela do wizard acompanha montagem,
 * o selo "Melhorando com IA…" acendia em foto que nunca seria tratada e não
 * saía mais. Um estado que ninguém alcança e ninguém encerra é onde a mentira
 * cabe.
 */
export type WizardSceneAiState = 'idle' | 'done' | 'failed' | 'skipped';

/**
 * Por que o arquivo foi RECUSADO. Só o que é impossível de aproveitar: um PDF
 * não vira panorama, e 40 MB o servidor não aceita.
 */
export type WizardSceneRejection = 'type' | 'size';

/**
 * Ressalva sobre um arquivo aceito — a cena segue `ready` e é publicada.
 *
 * Proporção fora de 2:1 é AVISO, não recusa: o handoff pede "avisar antes de
 * subir quando a proporção estiver fora", e recusar bloquearia imagens
 * legítimas. Uma foto quase-2:1 de uma câmera 360° real ainda produz um tour
 * utilizável; quem decide se vale a pena é o corretor, que viu o imóvel.
 */
export type WizardSceneWarning = 'ratio';

/** Um ambiente do tour: uma foto 360° e os pontos marcados sobre ela. */
export interface WizardScene {
  /** uuid local. Vira o `tempId` do payload no publicar. */
  id: string;
  /** Nome editável. Default: nome do arquivo sem extensão, cortado em 28 chars. */
  room: string;
  fileName: string;
  fileSize: number;
  /**
   * dataURL — mesmo formato que `PanoramaUpload.imageData` espera.
   *
   * **Vazio numa cena retomada**, até alguém precisar da foto. O rascunho lido
   * do servidor traz os cômodos sem imagem de propósito: a equirect é TOAST de
   * dezenas de MB e reidratar seis deles no 4G, antes de mostrar qualquer
   * coisa, seria pior do que não retomar. A foto chega por URL, sob demanda,
   * pelo `PanoramaImageCache`.
   *
   * Logo: `imageData` vazio **e** `serverPanoramaId` presente é uma cena
   * íntegra, não uma cena quebrada. Quem consumir este campo precisa dos dois
   * para decidir.
   */
  imageData: string;
  /** 0 é a capa. */
  order: number;
  hotspots: WizardHotspot[];
  /**
   * Ambientes ligados a este, na ORDEM EM QUE FORAM ESCOLHIDOS.
   *
   * O índice do array é a ordem — não há campo paralelo de ordenação, porque
   * duas fontes para a mesma sequência é como uma delas fica para trás. Essa
   * ordem é a que a etapa de passagens percorre.
   *
   * SIMÉTRICO: escolher Cozinha dentro do card da Sala escreve `cozinha` aqui
   * e `sala` na Cozinha. É o que torna "conecta com Cozinha" verdadeiro nos
   * dois cards — e a conexão é recíproca, então as duas pontas viram passagem
   * a posicionar. Ver `ligar`/`desligar` em `passagens/fila.ts`.
   *
   * Opcional porque cena antiga não tem, e porque obrigatório quebraria na
   * compilação as fábricas de cena de dezenas de testes de uma vez; ausente
   * lê-se como lista vazia.
   *
   * Cena RETOMADA TEM. Esta é a única parte do wizard que não se deduz do
   * resto — nome, ordem e capa são colunas, a passagem posicionada é um
   * `Hotspot` —, e por isso ela viaja numa coluna própria,
   * `Panorama.draftConnections`. Quem faz a travessia é `passagens/conexoes.ts`,
   * que também completa o que os pontos já posicionados provarem: rascunho
   * gravado antes daquela coluna existir tem só essa segunda fonte.
   */
  connections?: string[];
  /** Fotos originais; só existe quando veio da captura guiada. */
  frames?: CaptureFrameUpload[];
  /** O que a costura mediu; só existe quando veio da captura guiada. */
  geometry?: CaptureGeometry | null;
  state: WizardSceneState;
  rejectedReason?: WizardSceneRejection;
  /** Ressalva que não impede o uso da cena. Ver `WizardSceneWarning`. */
  warning?: WizardSceneWarning;

  /**
   * Id do panorama no servidor.
   *
   * Existe desde a confirmação da captura, não do publicar: o rascunho sobe
   * cômodo a cômodo para que a montagem por IA possa começar enquanto o
   * corretor ainda está no imóvel. Ausente enquanto o envio não terminou, e em
   * cena vinda de arquivo enquanto o publicar não roda.
   */
  serverPanoramaId?: string;
  /** Ver `WizardSceneAiState`. Ausente equivale a `idle`. */
  aiState?: WizardSceneAiState;
  /**
   * Endereço da imagem tratada no servidor, quando ela existe.
   *
   * É o que a etapa 2 troca no visualizador para revelar o antes e depois. Fica
   * separado de `imageData` porque o original continua servindo o card e o
   * botão de comparar — o tratamento nunca sobrescreve o que foi fotografado.
   */
  treatedImageUrl?: string;
}

/**
 * Valores que a API aceita — reexportados de `models/property.model.ts`.
 *
 * Eles moravam aqui, mas são vocabulário do domínio, e não do wizard: o wizard
 * escolhe um deles ao cadastrar, a home filtra por eles. Duas listas que
 * precisam concordar é defeito esperando um sétimo tipo de imóvel entrar num
 * lugar só.
 *
 * O reexport preserva a superfície pública deste arquivo byte a byte — todo
 * import que já existia continua valendo —, que é o que o CONGELADO do topo
 * protege. A tradução dos rótulos segue no i18n, sob `UPLOAD.TYPE.*` e
 * `UPLOAD.PURPOSE.*`.
 */
export { PROPERTY_TYPES, PROPERTY_PURPOSES } from '../models/property.model';
export type { PropertyType, PropertyPurpose } from '../models/property.model';

/** Endereço é opcional inteiro — ou vem completo, ou não vem. */
export interface AddressDraft {
  zip: string;
  street: string;
  number: string;
  district: string;
  complement: string;
  city: string;
  state: string;
}

export interface PropertyDraft {
  name: string;
  type: PropertyType | '';
  purpose: PropertyPurpose | '';
  address: AddressDraft;
}

export const EMPTY_ADDRESS: AddressDraft = {
  zip: '',
  street: '',
  number: '',
  district: '',
  complement: '',
  city: '',
  state: '',
};

export const EMPTY_PROPERTY: PropertyDraft = {
  name: '',
  type: '',
  purpose: '',
  address: { ...EMPTY_ADDRESS },
};

/** Limite de arquivo aceito pela etapa 1 (handoff: "até 25 MB por foto"). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Um equirretangular é exatamente 2:1 — 360° na horizontal por 180° na
 * vertical. A tolerância existe para não incomodar quem tem uma câmera que
 * corta alguns pixels; fora dela, a imagem quase certamente não é um panorama
 * (uma foto comum de celular fica perto de 1.33) e o tour sairia distorcido.
 */
export const EQUIRECTANGULAR_RATIO = 2;
export const RATIO_TOLERANCE = 0.2;

/** Quanto do nome do arquivo vira nome de ambiente por padrão. */
export const ROOM_NAME_MAX = 28;
