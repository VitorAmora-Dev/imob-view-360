import { z } from 'zod';

export const RecordViewSchema = z.object({
  sessionId: z.string().min(1),
  durationSeconds: z.number().int().positive().optional(),
  device: z.string().optional(),
});

export type RecordViewDto = z.infer<typeof RecordViewSchema>;
