import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common'
import { Roles } from '@app/common/decorators/roles.decorator'
import { UserRole } from '@app/common/types/roles.enum'
import { DevelopersService, DeveloperProfileDto } from './developers.service'

@Controller('developers')
export class DevelopersController {
  constructor(private readonly developersService: DevelopersService) {}

  /**
   * POST /developers/sync-azure
   * Pull current Azure DevOps org membership into the developers collection.
   * Requires ADMIN role.
   */
  @Post('sync-azure')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  syncAzure(): Promise<{ created: number; updated: number }> {
    return this.developersService.syncFromAzureDevOps()
  }

  /**
   * GET /developers/:azureId
   * Public-facing developer profile for the developer detail page.
   * Any authenticated user (Admin or Manager) may read it.
   */
  @Get(':azureId')
  async findByAzureId(@Param('azureId') azureId: string): Promise<DeveloperProfileDto> {
    const developer = await this.developersService.findByAzureId(azureId)
    if (!developer) throw new NotFoundException('Developer not found')
    return this.developersService.toProfile(developer)
  }
}
