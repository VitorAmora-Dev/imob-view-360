import { z } from 'zod';

export const UpdatePanoramaSchema = z.object({
  roomName: z.string().min(1).optional(),
  imageData: z.string().min(1).optional(),
  order: z.number().int().min(0).optional(),
  initialPanorama: z.boolean().optional(),
  /**
   * Os ambientes ligados a este na etapa de ordenação. Ver
   * `Panorama.draftConnections` no schema.
   *
   * Lista INTEIRA, e não um acréscimo: o wizard é dono da sequência (o índice
   * do array é a ordem de escolha) e a manda de uma vez. Um endpoint de
   * "adicionar uma conexão" precisaria de um irmão para remover, e os dois
   * teriam de concordar sobre a ordem — duas rotas para escrever uma lista que
   * o cliente já tem pronta.
   *
   * Vazio é um valor legítimo, e por isso `.optional()` e não um vazio-como-
   * ausente: desligar o último ambiente precisa chegar ao banco.
   */
  draftConnections: z.array(z.string().uuid()).optional(),
});

export type UpdatePanoramaDto = z.infer<typeof UpdatePanoramaSchema>;
