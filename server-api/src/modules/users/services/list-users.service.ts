import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { ListUsersDto } from '../dto/list-users.dto';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  type: true,
  licenseNumber: true,
  agencyId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ListUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListUsersDto, currentUser: JwtPayload) {
    const { page = 1, limit = 20, role, search } = query;
    const skip = (page - 1) * limit;

    const where = {
      agencyId: currentUser.agencyId,
      ...(role && { type: role }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    // Desempate por `id`: nome não é único, e homônimos numa mesma agência
    // fariam a paginação repetir um e esconder outro. Ver o comentário longo em
    // `list-properties.service.ts`.
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: USER_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
