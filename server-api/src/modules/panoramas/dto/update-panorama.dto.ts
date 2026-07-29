import { z } from 'zod';

export const UpdatePanoramaSchema = z.object({
  roomName: z.string().min(1).optional(),
  imageData: z.string().min(1).optional(),
  order: z.number().int().min(0).optional(),
  initialPanorama: z.boolean().optional(),
});

export type UpdatePanoramaDto = z.infer<typeof UpdatePanoramaSchema>;
