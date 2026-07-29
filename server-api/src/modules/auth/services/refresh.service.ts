import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { TokenService } from './token.service';
import { RefreshContext } from '../../../common/strategies/jwt-refresh.strategy';

@Injectable()
export class RefreshService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async execute(context: RefreshContext) {
    await this.prisma.session.delete({ where: { id: context.sessionId } });

    const { sessionId: _, ...payload } = context;
    return this.tokenService.issue(payload);
  }
}
