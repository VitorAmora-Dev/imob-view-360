import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ListUsersSchema, ListUsersDto } from '../dto/list-users.dto';
import { ListUsersService } from '../services/list-users.service';

@ApiTags('Users')
@Controller('users')
export class ListUsersController {
  constructor(private readonly listUsersService: ListUsersService) {}

  @Get()
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lista usuários da imobiliária com paginação' })
  @ApiOkResponse({ description: 'Lista paginada de usuários' })
  findAll(
    @Query(new ZodValidationPipe(ListUsersSchema)) query: ListUsersDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.listUsersService.execute(query, user);
  }
}
