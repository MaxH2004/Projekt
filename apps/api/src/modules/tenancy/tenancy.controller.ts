import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  isoDateSchema,
  personInputSchema,
  rentChangeSchema,
  tenancyEndSchema,
  tenancyInputSchema,
  type Person,
  type Tenancy,
} from "@hv/contracts";
import { ApiError, parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { TenancyService } from "./tenancy.service.js";

@Controller()
@UseGuards(SessionGuard)
export class TenancyController {
  constructor(private readonly tenancies: TenancyService) {}

  @Get("persons")
  listPersons(@Auth() auth: AuthContext): Promise<Person[]> {
    return this.tenancies.listPersons(auth.tenantId);
  }

  @Post("persons")
  createPerson(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Person> {
    return this.tenancies.createPerson(auth.tenantId, parseBody(personInputSchema, body));
  }

  @Put("persons/:id")
  updatePerson(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Person> {
    return this.tenancies.updatePerson(auth.tenantId, parseId(id), parseBody(personInputSchema, body));
  }

  @Delete("persons/:id")
  @HttpCode(204)
  deletePerson(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.tenancies.deletePerson(auth.tenantId, parseId(id));
  }

  /** `on` selects the day whose rent is reported; it defaults to today. */
  @Get("tenancies")
  list(@Auth() auth: AuthContext, @Query("unitId") unitId?: string, @Query("on") on?: string): Promise<Tenancy[]> {
    const day = on === undefined ? new Date().toISOString().slice(0, 10) : isoDateSchema.safeParse(on).data;
    if (!day) throw new ApiError("validation_failed", ["on"]);
    return this.tenancies.listTenancies(auth.tenantId, day, unitId === undefined ? undefined : parseId(unitId));
  }

  @Post("tenancies")
  create(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Tenancy> {
    return this.tenancies.createTenancy(auth.tenantId, parseBody(tenancyInputSchema, body));
  }

  @Post("tenancies/:id/end")
  @HttpCode(200)
  end(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Tenancy> {
    return this.tenancies.endTenancy(auth.tenantId, parseId(id), parseBody(tenancyEndSchema, body).endDate);
  }

  @Put("tenancies/:id/rent")
  changeRent(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Tenancy> {
    return this.tenancies.changeRent(auth.tenantId, parseId(id), parseBody(rentChangeSchema, body));
  }
}
