import { z } from 'zod';
import { UserRole } from './create-user.dto';

export const ListUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  role: UserRole.optional(),
  search: z.string().optional(),
});

export type ListUsersDto = z.infer<typeof ListUsersSchema>;
