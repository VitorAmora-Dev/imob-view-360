import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { TokenService } from './token.service';
import { SignupDto } from '../dto/signup.dto';

const SALT_ROUNDS = 10;

const USER_SELECT = {
  id: true, name: true, email: true, type: true,
  licenseNumber: true, agencyId: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async execute(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const { agency, user } = await this.prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: {
          name: dto.agencyName,
          taxId: dto.cnpj,
          email: dto.agencyEmail,
          phone: dto.phone,
        },
      });

      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
          type: 'ADMINISTRATOR',
          agencyId: agency.id,
        },
        select: USER_SELECT,
      });

      return { agency, user };
    });

    const tokens = await this.tokenService.issue({
      sub: user.id,
      email: user.email,
      role: user.type,
      agencyId: agency.id,
    });

    return { user, agency, ...tokens };
  }
}
