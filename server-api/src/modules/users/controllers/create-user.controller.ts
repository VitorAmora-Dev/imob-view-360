import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { JwtAccessGuard } from '../../../common/guards/jwt-access.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../../common/strategies/jwt-access.strategy';
import { CreateUserDto, CreateUserSchema } from '../dto/create-user.dto';
import { CreateUserService } from '../services/create-user.service';

@ApiTags('Users')
@Controller('users')
export class CreateUserController {
  constructor(private readonly createUserService: CreateUserService) {}

  @Post()
  @UseGuards(JwtAccessGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cria um novo usuário na imobiliária' })
  @ApiCreatedResponse({ description: 'Usuário criado' })
  @ApiConflictResponse({ description: 'Email já em uso' })
  create(
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.createUserService.execute(dto, user);
  }
}
