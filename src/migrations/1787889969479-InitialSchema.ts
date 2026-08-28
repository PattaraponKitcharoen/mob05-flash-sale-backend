import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1787889969479 implements MigrationInterface {
    name = 'InitialSchema1787889969479'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "products" ("product_id" character varying(32) NOT NULL, "name" character varying(255) NOT NULL, "description" text NOT NULL DEFAULT '', "price" numeric(12,2) NOT NULL, "available_stock" integer NOT NULL, "remaining_stock" integer NOT NULL, "is_flash_sale_active" boolean NOT NULL DEFAULT false, "version" integer NOT NULL, CONSTRAINT "PK_a8940a4bf3b90bd7ac15c8f4dd9" PRIMARY KEY ("product_id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying(64) NOT NULL, "product_id" character varying(32) NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "status" character varying(32) NOT NULL DEFAULT 'CONFIRMED', "job_id" character varying(64), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "uq_orders_user_product" UNIQUE ("user_id", "product_id"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a922b820eeef29ac1c6800e826" ON "orders" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ac832121b6c331b084ecc4121f" ON "orders" ("product_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ac832121b6c331b084ecc4121f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a922b820eeef29ac1c6800e826"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "products"`);
    }

}
