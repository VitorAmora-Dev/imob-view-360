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
 * Nada aqui é o que o servidor guarda. Estes tipos existem só enquanto o
 * corretor preenche o wizard; a conversão para o payload da API acontece uma
 * vez, no publicar (`toCreateTourPayload`).
 */

/** Etapas do wizard. Não existe etapa 0 nem 4 — o sucesso é um estado à parte. */
export type WizardStep = 1 | 2 | 3;

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
  /** uuid local. Nunca é o id do servidor — hotspot só existe lá após publicar. */
  id: string;
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
  /** dataURL — mesmo formato que `PanoramaUpload.imageData` espera. */
  imageData: string;
  /** 0 é a capa. */
  order: number;
  hotspots: WizardHotspot[];
  /** Fotos originais; só existe quando veio da captura guiada. */
  frames?: CaptureFrameUpload[];
  /** O que a costura mediu; só existe quando veio da captura guiada. */
  geometry?: CaptureGeometry | null;
  state: WizardSceneState;
  rejectedReason?: WizardSceneRejection;
  /** Ressalva que não impede o uso da cena. Ver `WizardSceneWarning`. */
  warning?: WizardSceneWarning;
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
