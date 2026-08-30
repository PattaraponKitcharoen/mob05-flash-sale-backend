import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthedRequest } from '../auth/authed-request';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) { }

    /**
     * Write path. Everything here is O(1) in-memory work: verify the JWT, run
     * one Lua script against Redis, push a job, answer 202. No SQL is issued on
     * this thread - the worker owns the durable write.
     */
    @Post()
    @UseGuards(JwtAuthGuard)
    @HttpCode(202)
    async create(
        @Req() req: AuthedRequest,
        @Body() body: { productId?: string },
    ) {
        const productId = body?.productId;
        if (typeof productId !== 'string' || productId.length === 0) {
            throw new BadRequestException('productId is required');
        }
        const userId = req.userId;

        return this.ordersService.createOrder(productId, userId);
    }
}
