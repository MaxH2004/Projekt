import { Module } from "@nestjs/common";
import { createFileStorage } from "@hv/integrations";
import { APP_CONFIG, type AppConfig } from "../../common/config.js";
import { IdentityModule } from "../identity/index.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService, FILE_STORAGE } from "./documents.service.js";

export { DocumentsService } from "./documents.service.js";

@Module({
  imports: [IdentityModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    { provide: FILE_STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createFileStorage(config.fileStorage, config.fileStorageDir) },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
