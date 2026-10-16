import { Body, Controller, Delete, HttpCode, HttpStatus, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { AuthCookiesService } from '../auth/auth-cookies.service';
import { ChangePasswordDto, DeleteAccountDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.changePassword(user.id, dto);
    this.cookies.clear(res);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.deleteAccount(user.id, dto);
    this.cookies.clear(res);
  }
}
