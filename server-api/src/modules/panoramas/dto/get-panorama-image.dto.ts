import { z } from 'zod';

/**
 * `v` é a versão da imagem e não é lida pelo servidor: ela existe para o cache
 * do navegador. A URL que o tour devolve carrega o `updatedAt` do panorama, de
 * modo que uma foto nova é um endereço novo — e um cache longo deixa de
 * significar "foto velha para sempre".
 */
export const GetPanoramaImageSchema = z.object({
  w: z.coerce.number().int().positive().optional(),
  v: z.string().optional(),
});

export type GetPanoramaImageDto = z.infer<typeof GetPanoramaImageSchema>;
