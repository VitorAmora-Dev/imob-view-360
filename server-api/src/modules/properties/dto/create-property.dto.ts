import { z } from 'zod';

export const PropertyType = z.enum(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'RURAL', 'OFFICE']);
export const PropertyPurpose = z.enum(['SALE', 'RENT', 'SALE_OR_RENT']);
export const PropertyStatus = z.enum(['AVAILABLE', 'SOLD', 'RENTED', 'UNAVAILABLE']);

export const AddressSchema = z.object({
  street: z.string().min(1),
  number: z.string().optional(),
  complement: z.string().optional(),
  district: z.string().optional(),
  city: z.string().min(1),
  state: z.string().length(2),
  zipCode: z.string().optional(),
});

export const CreatePropertySchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  type: PropertyType,
  purpose: PropertyPurpose,
  price: z.number().positive().optional(),
  totalArea: z.number().positive().optional(),
  status: PropertyStatus.default('AVAILABLE'),
  agentId: z.string().uuid().optional(),
  address: AddressSchema.optional(),
});

export type CreatePropertyDto = z.infer<typeof CreatePropertySchema>;
