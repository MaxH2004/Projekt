import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureHttp } from "./common/http.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureHttp(app);
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? "127.0.0.1");
