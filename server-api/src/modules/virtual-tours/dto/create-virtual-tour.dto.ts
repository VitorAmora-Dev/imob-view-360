import { z } from 'zod';

export const MeasurementInputSchema = z.object({
  description: z.string().min(1),
  value: z.number().positive(),
  unit: z.string().min(1).default('m'),
});

export const HotspotInputSchema = z.object({
  label: z.string().optional(),
  positionX: z.number(),
  positionY: z.number(),
  targetTempId: z.string().min(1),
});

/** Geometria da captura guiada; ausente quando o panorama veio de um arquivo. */
export const CaptureGeometryShape = {
  fittedVfovDeg: z.number().min(10).max(180).optional(),
  bandTopDeg: z.number().min(-90).max(90).optional(),
  bandBottomDeg: z.number().min(-90).max(90).optional(),
};

export const PanoramaInputSchema = z.object({
  tempId: z.string().min(1),
  roomName: z.string().min(1),
  imageData: z.string().min(1),
  order: z.number().int().min(0).default(0),
  initialPanorama: z.boolean().default(false),
  measurements: z.array(MeasurementInputSchema).default([]),
  hotspots: z.array(HotspotInputSchema).default([]),
  ...CaptureGeometryShape,
});

export const CreateVirtualTourSchema = z.object({
  propertyId: z.string().uuid(),
  /**
   * Em que estado o tour nasce. O default é `DRAFT`, que é o mesmo do banco.
   *
   * O serviço gravava `PUBLISHED` fixo, e isso impedia o wizard de existir no
   * servidor durante a captura: um tour incompleto ficava visível na listagem e
   * as rotas públicas o serviam pela metade. Quem cria já pronto — a tela
   * legada, que sobe as panorâmicas todas de uma vez — pede `PUBLISHED` aqui.
   *
   * `ARCHIVED` fica de fora de propósito: arquivar é uma transição, não um
   * ponto de partida, e existe em `PATCH /virtual-tours/:id`.
   */
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  // Teto de cômodos por tour. O único limite que existia era o corpo de 50 MB,
  // o que fazia o número de panorâmicas depender do tamanho das fotos: 50 tours
  // minúsculos passavam, 2 grandes não. Cada uma aqui vira um `create` dentro
  // de uma transação que segura conexão do pool, então o custo cresce com a
  // contagem e não só com os bytes.
  panoramas: z.array(PanoramaInputSchema).max(40).default([]),
});

export type CreateVirtualTourDto = z.infer<typeof CreateVirtualTourSchema>;
