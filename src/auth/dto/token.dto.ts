import { IsNotEmpty, IsString } from 'class-validator';

export class TokenDto {
    @IsString()
    @IsNotEmpty()
    userId: string;
}
