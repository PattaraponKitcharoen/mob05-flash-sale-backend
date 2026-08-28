import {
    Body,
    Controller,
    HttpCode,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthedRequest } from '../auth/authed-request';
import { CreateOrderDto } from './dto/create-order.dto';
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
        @Body() dto: CreateOrderDto,
    ) {
        return this.ordersService.createOrder(dto.productId, req.userId);
    }
}
