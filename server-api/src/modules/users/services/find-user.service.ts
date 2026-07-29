import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';

const USER_SELECT = {
  id: true, name: true, email: true, type: true,
  licenseNumber: true, agencyId: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class FindUserService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, currentUser: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: { id, agencyId: currentUser.agencyId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
