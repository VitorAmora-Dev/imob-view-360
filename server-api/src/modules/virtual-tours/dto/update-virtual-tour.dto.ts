import { z } from 'zod';

export const UpdateVirtualTourSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});

export type UpdateVirtualTourDto = z.infer<typeof UpdateVirtualTourSchema>;
