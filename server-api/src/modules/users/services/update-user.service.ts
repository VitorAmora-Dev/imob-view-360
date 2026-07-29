import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { UpdateUserDto } from '../dto/update-user.dto';

const SALT_ROUNDS = 10;

const USER_SELECT = {
  id: true, name: true, email: true, type: true,
  licenseNumber: true, agencyId: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class UpdateUserService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdateUserDto, currentUser: JwtPayload) {
    const exists = await this.prisma.user.findFirst({
      where: { id, agencyId: currentUser.agencyId },
    });
    if (!exists) throw new NotFoundException('User not found');

    const { password, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (password) data.password = await bcrypt.hash(password, SALT_ROUNDS);

    return this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
  }
}
