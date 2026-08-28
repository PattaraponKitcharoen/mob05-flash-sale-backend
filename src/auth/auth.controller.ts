import {
    Body,
    Controller,
    HttpCode,
    Post,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenDto } from './dto/token.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly jwt: JwtService) { }

    /**
     * Simulated login. No database lookup on purpose: this endpoint is only a
     * fixture for the load test and must never become a bottleneck.
     */
    @Post('token')
    @HttpCode(200)
    async token(@Body() dto: TokenDto) {
        const userId = dto.userId;
        return {
            status: 'success',
            accessToken: await this.jwt.signAsync({ sub: userId }),
        };
    }
}
