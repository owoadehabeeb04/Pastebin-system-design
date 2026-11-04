import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { PastesService } from './pastes.service';
import { RateLimitGuard } from './rate-limit.guard';
import { validateCreate } from './validate';

@Controller('pastes')
export class PastesController {
  constructor(private pastes: PastesService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @HttpCode(201)
  create(@Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    return this.pastes.create(validateCreate(body), userAgent);
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.pastes.get(code);
  }
}
