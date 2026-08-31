import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreatePropertyDto } from '../dto/create-property.dto';

const PROPERTY_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  type: true,
  purpose: true,
  price: true,
  totalArea: true,
  status: true,
  agencyId: true,
  agentId: true,
  createdAt: true,
  updatedAt: true,
  address: true,
} as const;

@Injectable()
export class CreatePropertyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(dto: CreatePropertyDto, currentUser: JwtPayload) {
    const existing = await this.prisma.property.findUnique({
      where: { code: dto.code },
    });
    if (existing)
      throw new ConflictException('Property code already registered');

    if (dto.agentId) {
      const agent = await this.prisma.user.findFirst({
        where: { id: dto.agentId, agencyId: currentUser.agencyId },
      });
      if (!agent)
        throw new BadRequestException('Agent not found in this agency');
    }

    return this.prisma.property.create({
      data: {
        code: dto.code,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        purpose: dto.purpose,
        price: dto.price,
        totalArea: dto.totalArea,
        status: dto.status,
        agencyId: currentUser.agencyId,
        agentId: dto.agentId,
        // Campo a campo como o resto deste `data`, e não por spread do dto:
        // ausente vira `[]` pelo default da coluna, que é a resposta certa para
        // imóvel de cadastro normal. Ver `Property.draftPlaceholders`.
        draftPlaceholders: dto.draftPlaceholders,
        ...(dto.address && { address: { create: dto.address } }),
      },
      select: PROPERTY_SELECT,
    });
  }
}
