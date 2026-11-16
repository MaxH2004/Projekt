import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { meterInputSchema, meterReadingInputSchema, type Meter, type MeterReading } from "@hv/contracts";
import { parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { MeteringService } from "./metering.service.js";

@Controller()
@UseGuards(SessionGuard)
export class MeteringController {
  constructor(private readonly metering: MeteringService) {}

  @Get("meters")
  list(@Auth() auth: AuthContext, @Query("unitId") unitId?: string, @Query("buildingId") buildingId?: string): Promise<Meter[]> {
    return this.metering.listMeters(auth.tenantId, {
      unitId: unitId === undefined ? undefined : parseId(unitId),
      buildingId: buildingId === undefined ? undefined : parseId(buildingId),
    });
  }

  @Post("meters")
  create(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Meter> {
    return this.metering.createMeter(auth.tenantId, parseBody(meterInputSchema, body));
  }

  @Delete("meters/:id")
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.metering.deleteMeter(auth.tenantId, parseId(id));
  }

  @Get("meters/:id/readings")
  listReadings(@Auth() auth: AuthContext, @Param("id") id: string): Promise<MeterReading[]> {
    return this.metering.listReadings(auth.tenantId, parseId(id));
  }

  @Post("meters/:id/readings")
  addReading(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<MeterReading> {
    return this.metering.addReading(auth.tenantId, parseId(id), parseBody(meterReadingInputSchema, body));
  }

  @Delete("meter-readings/:id")
  @HttpCode(204)
  removeReading(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.metering.deleteReading(auth.tenantId, parseId(id));
  }
}
