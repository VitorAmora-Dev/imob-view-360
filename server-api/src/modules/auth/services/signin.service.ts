import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { TokenService } from './token.service';
import { SigninDto } from '../dto/signin.dto';

const USER_SELECT = {
  id: true, name: true, email: true, type: true,
  licenseNumber: true, agencyId: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class SigninService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async execute(dto: SigninDto) {
    const raw = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, type: true, agencyId: true, password: true },
    });
    if (!raw) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, raw.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.tokenService.issue({
      sub: raw.id,
      email: raw.email,
      role: raw.type,
      agencyId: raw.agencyId ?? '',
    });

    const user = await this.prisma.user.findUnique({
      where: { id: raw.id },
      select: USER_SELECT,
    });

    return { user, ...tokens };
  }
}
