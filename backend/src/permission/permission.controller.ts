import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { PermissionService } from './permission.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { AssignRoleDto } from './dto/assign-role.dto';

/**
 * Admin-only management of per-school custom roles and permission grants.
 * Guarded by AdminGuard (not PermissionGuard) - admins are the authority over
 * roles; gating this with PermissionGuard would be circular.
 */
@ApiTags('Permissions')
@ApiBearerAuth()
@UseGuards(AuthGuard, AdminGuard)
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get('catalog')
  getCatalog() {
    return this.permissionService.listCatalog();
  }

  @Get('roles')
  listRoles(@Req() req: any) {
    return this.permissionService.listRoles(req.user.id);
  }

  @Post('roles')
  createRole(@Req() req: any, @Body() dto: CreateRoleDto) {
    return this.permissionService.createRole(req.user.id, dto);
  }

  @Patch('roles/:roleId')
  updateRole(
    @Req() req: any,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.permissionService.updateRole(req.user.id, roleId, dto);
  }

  @Delete('roles/:roleId')
  deleteRole(@Req() req: any, @Param('roleId') roleId: string) {
    return this.permissionService.deleteRole(req.user.id, roleId);
  }

  @Get('roles/:roleId/permissions')
  getRolePermissions(@Req() req: any, @Param('roleId') roleId: string) {
    return this.permissionService.getRolePermissions(req.user.id, roleId);
  }

  @Put('roles/:roleId/permissions')
  setRolePermissions(
    @Req() req: any,
    @Param('roleId') roleId: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.permissionService.setRolePermissions(
      req.user.id,
      roleId,
      dto.keys,
    );
  }

  @Get('members/:membershipId/roles')
  getMemberRoles(@Req() req: any, @Param('membershipId') membershipId: string) {
    return this.permissionService.getMemberRoles(req.user.id, membershipId);
  }

  @Post('members/:membershipId/roles')
  assignRole(
    @Req() req: any,
    @Param('membershipId') membershipId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.permissionService.assignRoleToMember(
      req.user.id,
      membershipId,
      dto.roleId,
    );
  }

  @Delete('members/:membershipId/roles/:roleId')
  unassignRole(
    @Req() req: any,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.permissionService.unassignRoleFromMember(
      req.user.id,
      membershipId,
      roleId,
    );
  }
}
