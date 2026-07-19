import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'

import { Roles } from '@app/common/decorators/roles.decorator'
import { CurrentUser } from '@app/common/decorators/current-user.decorator'
import { UserRole } from '@app/common/types/roles.enum'
import { UserDocument } from '@app/users/schemas/user.schema'

import { OrganizationsService } from './organizations.service'
import { CreateOrganizationDto } from './dto/create-organization.dto'
import { UpdateOrganizationDto } from './dto/update-organization.dto'

/**
 * Admin-only management of connected Azure DevOps organizations and their
 * encrypted PATs. The class-level @Roles scopes every route to admins.
 */
@Controller('organizations')
@Roles(UserRole.ADMIN)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: UserDocument, @Body() dto: CreateOrganizationDto) {
    const org = await this.organizationsService.create(dto, user._id.toString())
    return org.toJSON()
  }

  @Get()
  async findAll() {
    const orgs = await this.organizationsService.findAll()
    return orgs.map((o) => o.toJSON())
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const org = await this.organizationsService.findOne(id)
    return org.toJSON()
  }

  @Get(':id/projects')
  async listProjects(@Param('id') id: string) {
    const projects = await this.organizationsService.listProjects(id)
    return projects.map((p) => p.toJSON())
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    const org = await this.organizationsService.update(id, dto, user._id.toString())
    return org.toJSON()
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  async sync(@Param('id') id: string) {
    return this.organizationsService.sync(id)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.organizationsService.deactivate(id)
  }
}
