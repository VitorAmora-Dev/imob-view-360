import { z } from 'zod';

export const SignupSchema = z.object({
  agencyName: z.string().min(1),
  cnpj: z.string().optional(),
  agencyEmail: z.email().optional(),
  phone: z.string().optional(),
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(6),
});

export type SignupDto = z.infer<typeof SignupSchema>;
