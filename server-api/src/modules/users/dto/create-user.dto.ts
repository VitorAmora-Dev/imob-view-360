import { z } from 'zod';

export const UserRole = z.enum(['ADMINISTRATOR', 'AGENT']);
export type UserRole = z.infer<typeof UserRole>;

export const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(6),
  role: UserRole,
  licenseNumber: z.string().optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
