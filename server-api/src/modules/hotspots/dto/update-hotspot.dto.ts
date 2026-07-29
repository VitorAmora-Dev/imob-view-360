import { z } from 'zod';

export const UpdateHotspotSchema = z.object({
  label: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  targetId: z.string().uuid().optional(),
});

export type UpdateHotspotDto = z.infer<typeof UpdateHotspotSchema>;
