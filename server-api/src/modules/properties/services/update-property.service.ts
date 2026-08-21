import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { UpdatePropertyDto } from '../dto/update-property.dto';

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
export class UpdatePropertyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(id: string, dto: UpdatePropertyDto, currentUser: JwtPayload) {
    const property = await this.prisma.property.findFirst({
      where: { id, agencyId: currentUser.agencyId },
      // Só a existência importa aqui, e o imóvel não carrega coluna grande —
      // mas o `select` mantém o padrão do módulo e sobrevive a um campo novo.
      select: { id: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    // Mesma checagem do create: um `agentId` de outra imobiliária passaria pela
    // FK do banco sem erro e vazaria o imóvel para fora do escopo da agência.
    if (dto.agentId) {
      const agent = await this.prisma.user.findFirst({
        where: { id: dto.agentId, agencyId: currentUser.agencyId },
        select: { id: true },
      });
      if (!agent)
        throw new BadRequestException('Agent not found in this agency');
    }

    const { address, ...campos } = dto;

    return this.prisma.property.update({
      where: { id },
      data: {
        ...campos,
        // `upsert` e não `update`: o imóvel do wizard nasce sem endereço, então
        // a primeira gravação precisa criar. Com `update` puro, o Prisma erra
        // com registro inexistente logo no caminho mais comum desta rota.
        ...(address && {
          address: { upsert: { create: address, update: address } },
        }),
      },
      select: PROPERTY_SELECT,
    });
  }
}
