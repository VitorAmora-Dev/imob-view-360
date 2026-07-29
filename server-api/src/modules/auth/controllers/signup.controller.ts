import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiConflictResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SignupService } from '../services/signup.service';
import { SignupSchema, SignupDto } from '../dto/signup.dto';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';

@ApiTags('Auth')
@Controller('auth')
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Cria imobiliária e primeiro usuário (ADMINISTRADOR)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['agencyName', 'name', 'email', 'password'],
      properties: {
        agencyName: { type: 'string', example: 'Imobiliária Central' },
        cnpj: { type: 'string', example: '12.345.678/0001-90' },
        agencyEmail: { type: 'string', format: 'email', example: 'contato@central.com' },
        phone: { type: 'string', example: '(51) 99999-0000' },
        name: { type: 'string', example: 'João Silva' },
        email: { type: 'string', format: 'email', example: 'joao@central.com' },
        password: { type: 'string', minLength: 6, example: 'senha123' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Imobiliária e administrador criados com sucesso' })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  signup(@Body(new ZodValidationPipe(SignupSchema)) dto: SignupDto) {
    return this.signupService.execute(dto);
  }
}
