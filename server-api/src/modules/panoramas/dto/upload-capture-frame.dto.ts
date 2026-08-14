import { z } from 'zod';

export const UploadCaptureFrameSchema = z.object({
  index: z.number().int().min(0),
  imageData: z.string().min(1),
  /** Orientação da câmera no disparo, no referencial da sessão de captura. */
  quaternion: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    w: z.number(),
  }),
});

export type UploadCaptureFrameDto = z.infer<typeof UploadCaptureFrameSchema>;
