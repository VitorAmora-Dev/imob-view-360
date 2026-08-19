import { z } from 'zod';
import { UserRole } from './create-user.dto';

export const ListUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // O mesmo teto de `list-properties.dto.ts`. Sem ele, `?limit=1000000` era
  // aceito e virava a tabela inteira da agência numa resposta só — e `limit` é
  // entrada de quem chama, não decisão nossa.
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: UserRole.optional(),
  search: z.string().optional(),
});

export type ListUsersDto = z.infer<typeof ListUsersSchema>;
