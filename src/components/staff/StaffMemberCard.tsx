import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MoreVertical, Pencil, Trash2, UserCheck, UserX, Crown, ChefHat, ConciergeBell, User } from 'lucide-react';
import { StaffMember, StaffRole } from '@/hooks/useStaffMembers';
import { cn } from '@/lib/utils';

interface StaffMemberCardProps {
  member: StaffMember;
  onEdit: (member: StaffMember) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
}

const roleConfig: Record<StaffRole, { label: string; icon: typeof Crown; color: string }> = {
  owner: { label: 'Owner', icon: Crown, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  manager: { label: 'Manager', icon: User, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  waiter: { label: 'Waiter', icon: ConciergeBell, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  chef: { label: 'Chef', icon: ChefHat, color: 'bg-orange-500/10 text-orange-600 border-orange-500/20' },
};

export function StaffMemberCard({ member, onEdit, onDelete, onToggleActive }: StaffMemberCardProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const config = roleConfig[member.role];
  const RoleIcon = config.icon;
  const isOwner = member.role === 'owner';

  return (
    <>
      <Card className={cn("transition-all", !member.is_active && "opacity-60")}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                member.is_active ? "bg-primary/10" : "bg-muted"
              )}>
                <RoleIcon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium truncate">{member.full_name}</h3>
                  {!member.is_active && (
                    <Badge variant="secondary" className="text-xs">Inactive</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                {member.phone && (
                  <p className="text-sm text-muted-foreground">{member.phone}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={cn("text-xs font-medium", config.color)}>
                {config.label}
              </Badge>
              
              {!isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(member)}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onToggleActive(member.id, !member.is_active)}>
                      {member.is_active ? (
                        <>
                          <UserX className="w-4 h-4 mr-2" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-4 h-4 mr-2" />
                          Activate
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteDialogOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Staff Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {member.full_name}? This will also remove all their scheduled shifts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(member.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
