import { z } from 'zod';
import { PropertyPurpose, PropertyStatus, PropertyType } from './create-property.dto';

export const ListPropertiesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: PropertyType.optional(),
  purpose: PropertyPurpose.optional(),
  status: PropertyStatus.default('AVAILABLE'),
  city: z.string().optional(),
  state: z.string().optional(),
  district: z.string().optional(),
  // Uma caixa só para "onde": casa com bairro, cidade OU estado. Os três campos
  // acima continuam existindo — são API pública e podem ter consumidor.
  location: z.string().optional(),
  priceMin: z.coerce.number().positive().optional(),
  priceMax: z.coerce.number().positive().optional(),
  search: z.string().optional(),
});

export type ListPropertiesDto = z.infer<typeof ListPropertiesSchema>;
