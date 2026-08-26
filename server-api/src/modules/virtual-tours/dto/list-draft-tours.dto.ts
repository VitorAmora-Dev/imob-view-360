import { z } from 'zod';

export const ListDraftToursSchema = z.object({
  // Obrigatório, e só DRAFT por enquanto. `GET /virtual-tours` sem filtro
  // devolveria o catálogo inteiro por uma rota que ninguém pediu para isso —
  // e a listagem de imóveis, que já faz esse trabalho, tem paginação e filtros
  // que esta não tem.
  status: z.literal('DRAFT'),
});

export type ListDraftToursDto = z.infer<typeof ListDraftToursSchema>;
