import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { documentListQuerySchema, documentUploadQuerySchema, type DocumentInfo } from "@hv/contracts";
import type { Response } from "express";
import { ApiError, parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { DocumentsService } from "./documents.service.js";

@Controller("documents")
@UseGuards(SessionGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** The file is the raw body, sent as application/octet-stream; everything else is in the query. */
  @Post("upload")
  upload(@Auth() auth: AuthContext, @Query() query: Record<string, string>, @Body() body: unknown): Promise<DocumentInfo> {
    if (!Buffer.isBuffer(body)) throw new ApiError("validation_failed", ["file"]);
    return this.documents.upload(auth.tenantId, parseBody(documentUploadQuerySchema, query), new Uint8Array(body));
  }

  @Get()
  list(@Auth() auth: AuthContext, @Query() query: Record<string, string>): Promise<DocumentInfo[]> {
    return this.documents.list(auth.tenantId, parseBody(documentListQuerySchema, query));
  }

  /** Always as a download; the browser never renders an uploaded file in our origin. */
  @Get(":id/content")
  async content(@Auth() auth: AuthContext, @Param("id") id: string, @Res() res: Response): Promise<void> {
    const { info, bytes } = await this.documents.content(auth.tenantId, parseId(id));
    res.setHeader("Content-Type", info.contentType);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(info.fileName)}`);
    res.end(Buffer.from(bytes));
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.documents.delete(auth.tenantId, parseId(id));
  }
}
