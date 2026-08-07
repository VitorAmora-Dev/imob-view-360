import { z } from 'zod';

export const MeasurementInputSchema = z.object({
  description: z.string().min(1),
  value: z.number().positive(),
  unit: z.string().min(1).default('m'),
});

export const CreatePanoramaSchema = z.object({
  tourId: z.string().uuid(),
  roomName: z.string().min(1),
  imageData: z.string().min(1),
  order: z.number().int().min(0).default(0),
  initialPanorama: z.boolean().default(false),
  measurements: z.array(MeasurementInputSchema).default([]),
  // Geometria da captura guiada; ausente quando o panorama veio de um arquivo.
  fittedVfovDeg: z.number().min(10).max(180).optional(),
  bandTopDeg: z.number().min(-90).max(90).optional(),
  bandBottomDeg: z.number().min(-90).max(90).optional(),
});

export type CreatePanoramaDto = z.infer<typeof CreatePanoramaSchema>;
