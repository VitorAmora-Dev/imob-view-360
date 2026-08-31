import { z } from 'zod';
import {
  AddressSchema,
  DraftPlaceholder,
  PropertyPurpose,
  PropertyStatus,
  PropertyType,
} from './create-property.dto';

/**
 * Atualização parcial do imóvel.
 *
 * Existe para o wizard de captura: o imóvel passa a ser criado como marcador na
 * primeira foto, quando o corretor ainda não informou nada além do cômodo, e só
 * recebe título, tipo e finalidade na última etapa. Sem esta rota o rascunho
 * ficaria preso com os dados de marcador.
 *
 * `code` fica de fora: é `@unique` e serve de identificador estável do imóvel na
 * imobiliária. Trocá-lo por aqui esbarraria na colisão com outro imóvel e é
 * decisão de cadastro, não de edição de tour.
 *
 * `address` substitui o endereço inteiro quando vem — um `upsert`, não um merge
 * campo a campo. Endereço meio trocado (rua nova com cidade velha) é pior que
 * exigir o conjunto.
 */
export const UpdatePropertySchema = z
  .object({
    title: z.string().min(1),
    description: z.string(),
    type: PropertyType,
    purpose: PropertyPurpose,
    price: z.number().positive(),
    totalArea: z.number().positive(),
    status: PropertyStatus,
    agentId: z.string().uuid(),
    address: AddressSchema,
    /**
     * Lista INTEIRA, e não um acréscimo: quem sabe quais campos ainda são
     * marcador é o wizard, e ele a recalcula a cada gravacão a partir do que o
     * corretor já preencheu. Ver `Property.draftPlaceholders`.
     */
    draftPlaceholders: z.array(DraftPlaceholder),
  })
  .partial()
  // Um PATCH vazio chegaria aqui como `{}` válido e viraria um UPDATE sem
  // colunas — o Prisma aceita, o banco toca `updatedAt` e o cliente recebe 200
  // achando que gravou algo.
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });

export type UpdatePropertyDto = z.infer<typeof UpdatePropertySchema>;
