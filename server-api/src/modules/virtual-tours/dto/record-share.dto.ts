import { z } from 'zod';

export const RecordShareSchema = z.object({
  sessionId: z.string().min(1),
  channel: z.string().min(1),
});

export type RecordShareDto = z.infer<typeof RecordShareSchema>;
