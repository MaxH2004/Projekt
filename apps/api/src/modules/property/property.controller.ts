import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import {
  buildingInputSchema,
  propertyInputSchema,
  unitAreaInputSchema,
  unitInputSchema,
  unitPatchSchema,
  type Building,
  type Property,
  type Unit,
  type UnitAreaVersion,
} from "@hv/contracts";
import { parseBody } from "../../common/api-error.js";
import { parseId } from "../../common/tenant-db.js";
import { Auth, SessionGuard, type AuthContext } from "../identity/index.js";
import { PropertyService } from "./property.service.js";

@Controller()
@UseGuards(SessionGuard)
export class PropertyController {
  constructor(private readonly properties: PropertyService) {}

  @Get("properties")
  list(@Auth() auth: AuthContext): Promise<Property[]> {
    return this.properties.listProperties(auth.tenantId);
  }

  @Post("properties")
  create(@Auth() auth: AuthContext, @Body() body: unknown): Promise<Property> {
    return this.properties.createProperty(auth.tenantId, parseBody(propertyInputSchema, body));
  }

  @Patch("properties/:id")
  update(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Property> {
    return this.properties.updateProperty(auth.tenantId, parseId(id), parseBody(propertyInputSchema, body));
  }

  @Delete("properties/:id")
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.properties.deleteProperty(auth.tenantId, parseId(id));
  }

  @Get("properties/:id/buildings")
  listBuildings(@Auth() auth: AuthContext, @Param("id") id: string): Promise<Building[]> {
    return this.properties.listBuildings(auth.tenantId, parseId(id));
  }

  @Post("properties/:id/buildings")
  createBuilding(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Building> {
    return this.properties.createBuilding(auth.tenantId, parseId(id), parseBody(buildingInputSchema, body));
  }

  @Patch("buildings/:id")
  updateBuilding(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Building> {
    return this.properties.updateBuilding(auth.tenantId, parseId(id), parseBody(buildingInputSchema, body));
  }

  @Delete("buildings/:id")
  @HttpCode(204)
  removeBuilding(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.properties.deleteBuilding(auth.tenantId, parseId(id));
  }

  @Get("buildings/:id/units")
  listUnits(@Auth() auth: AuthContext, @Param("id") id: string): Promise<Unit[]> {
    return this.properties.listUnits(auth.tenantId, parseId(id));
  }

  @Post("buildings/:id/units")
  createUnit(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Unit> {
    return this.properties.createUnit(auth.tenantId, parseId(id), parseBody(unitInputSchema, body));
  }

  @Patch("units/:id")
  updateUnit(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<Unit> {
    return this.properties.updateUnit(auth.tenantId, parseId(id), parseBody(unitPatchSchema, body));
  }

  @Delete("units/:id")
  @HttpCode(204)
  removeUnit(@Auth() auth: AuthContext, @Param("id") id: string): Promise<void> {
    return this.properties.deleteUnit(auth.tenantId, parseId(id));
  }

  @Get("units/:id/areas")
  listAreas(@Auth() auth: AuthContext, @Param("id") id: string): Promise<UnitAreaVersion[]> {
    return this.properties.listUnitAreas(auth.tenantId, parseId(id));
  }

  @Put("units/:id/area")
  setArea(@Auth() auth: AuthContext, @Param("id") id: string, @Body() body: unknown): Promise<UnitAreaVersion[]> {
    return this.properties.setUnitArea(auth.tenantId, parseId(id), parseBody(unitAreaInputSchema, body));
  }
}
