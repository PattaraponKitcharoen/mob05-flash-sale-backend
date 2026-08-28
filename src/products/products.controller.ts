import { Controller, Get, Query, Res, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Res() reply: FastifyReply,
  ) {
    const safePage = Math.min(10_000, Math.max(1, page));
    const safeLimit = Math.min(100, Math.max(1, limit));

    // Send the cached string straight through - re-parsing it just to let the
    // framework serialise it again would double the CPU cost of a cache hit.
    const body = await this.products.getPageBody(safePage, safeLimit);
    reply.header('content-type', 'application/json; charset=utf-8').send(body);
  }
}
