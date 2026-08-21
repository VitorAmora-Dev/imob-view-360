import { z } from 'zod';

/**
 * `variant` escolhe qual das duas imagens do panorama servir.
 *
 * `treated` cai para a original quando o tratamento ainda não terminou, e é o
 * que faz a etapa 2 do wizard funcionar sem saber de estado: ela pede a tratada
 * e recebe o que existir, trocando sozinha quando a montagem por IA grava a
 * coluna. `original` é o que o botão de comparar pede — e não pode cair na
 * tratada, senão o antes e o depois viram a mesma imagem.
 */
export const GetPanoramaPreviewSchema = z.object({
  variant: z.enum(['treated', 'original']).default('treated'),
  w: z.coerce.number().int().positive().optional(),
  v: z.string().optional(),
});

export type GetPanoramaPreviewDto = z.infer<typeof GetPanoramaPreviewSchema>;
