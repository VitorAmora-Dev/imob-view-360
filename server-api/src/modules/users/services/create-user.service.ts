import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { CreateUserDto } from '../dto/create-user.dto';

const SALT_ROUNDS = 10;

const USER_SELECT = {
  id: true, name: true, email: true, type: true,
  licenseNumber: true, agencyId: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class CreateUserService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(dto: CreateUserDto, currentUser: JwtPayload) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashedPassword,
        type: dto.role,
        licenseNumber: dto.licenseNumber,
        agencyId: currentUser.agencyId,
      },
      select: USER_SELECT,
    });
  }
}
