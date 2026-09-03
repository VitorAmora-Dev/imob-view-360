import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  agencyId: string;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload) {
    // Roda em TODA requisição autenticada, e o único uso do resultado é o `if`
    // abaixo. Sem `select` isto trazia a linha inteira do usuário, hash de
    // senha incluído, em cada chamada da API.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!user) throw new UnauthorizedException();

    // A CLAIM DE AGÊNCIA É OBRIGATÓRIA, e a razão não é higiene de tipo.
    //
    // Meia dúzia de consultas do produto escopam por `agencyId` vindo daqui, e o
    // Prisma APAGA silenciosamente uma condição cujo valor é `undefined`: um
    // `where: { property: { agencyId: undefined } }` não filtra nada, e a
    // consulta que existia para ver só uma imobiliária passa a ver todas. Sem
    // erro, sem log, sem nada na tela.
    //
    // Hoje os três pontos que emitem token preenchem a claim, mas a garantia
    // mora lá, longe de quem depende dela: uma quarta via de emissão, uma
    // renomeação de claim ou um token antigo de antes da migração abrem tudo de
    // uma vez. A trava fica na FRONTEIRA, onde é uma linha só.
    //
    // `typeof` e não um teste de vazio: string vazia é o que as emissões usam
    // para usuário sem imobiliária (`User.agencyId` é nulável), e ela filtra
    // corretamente — não casa com nenhuma agência e rende 404. Quem precisa
    // morrer aqui é só `undefined`.
    if (typeof payload.agencyId !== 'string') throw new UnauthorizedException();

    return payload;
  }
}
