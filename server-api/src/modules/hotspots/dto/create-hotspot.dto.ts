import { z } from 'zod';

export const CreateHotspotSchema = z.object({
  panoramaId: z.string().uuid(),
  label: z.string().optional(),
  positionX: z.number(),
  positionY: z.number(),
  targetId: z.string().uuid(),
});

export type CreateHotspotDto = z.infer<typeof CreateHotspotSchema>;
