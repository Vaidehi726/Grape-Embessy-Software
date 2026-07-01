import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { useStaffMembers, useShifts, StaffMember, StaffRole } from '@/hooks/useStaffMembers';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StaffMemberCard } from '@/components/staff/StaffMemberCard';
import { StaffMemberDialog } from '@/components/staff/StaffMemberDialog';
import { ShiftScheduler } from '@/components/staff/ShiftScheduler';
import { UserPlus, Search, Users, Calendar } from 'lucide-react';

export default function Staff() {
  const { currentRestaurant } = useRestaurant();
  const { toast } = useToast();
  const {
    staffMembers,
    loading: staffLoading,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
  } = useStaffMembers(currentRestaurant?.id);
  const { shifts, loading: shiftsLoading, addShift, deleteShift } = useShifts(currentRestaurant?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filteredStaff = staffMembers.filter(
    (member) =>
      member.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenAdd = () => {
    setEditingMember(null);
    setDialogOpen(true);
  };

  const handleEdit = (member: StaffMember) => {
    setEditingMember(member);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: {
    full_name: string;
    email: string;
    phone?: string;
    role: Exclude<StaffRole, 'owner'>;
  }) => {
    setSubmitting(true);

    if (editingMember) {
      const { error } = await updateStaffMember(editingMember.id, {
        full_name: data.full_name,
        phone: data.phone || null,
        role: data.role,
      });

      if (error) {
        toast({
          title: 'Error',
          description: error.message || 'Failed to update staff member',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Updated', description: 'Staff member updated successfully' });
        setDialogOpen(false);
      }
    } else {
      const { error } = await addStaffMember(data);

      if (error) {
        toast({
          title: 'Error',
          description: error.message || 'Failed to add staff member',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Added', description: 'Staff member added successfully' });
        setDialogOpen(false);
      }
    }

    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await deleteStaffMember(id);
    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete staff member',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Deleted', description: 'Staff member removed' });
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    const { error } = await updateStaffMember(id, { is_active: isActive });
    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to update staff status',
        variant: 'destructive',
      });
    } else {
      toast({
        title: isActive ? 'Activated' : 'Deactivated',
        description: `Staff member has been ${isActive ? 'activated' : 'deactivated'}`,
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Staff Management</h1>
            <p className="text-muted-foreground">Manage your restaurant staff and schedules</p>
          </div>
          <Button onClick={handleOpenAdd}>
            <UserPlus className="w-4 h-4 mr-2" />
            Add Staff
          </Button>
        </div>

        <Tabs defaultValue="members" className="space-y-6">
          <TabsList>
            <TabsTrigger value="members" className="gap-2">
              <Users className="w-4 h-4" />
              Staff Members
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-2">
              <Calendar className="w-4 h-4" />
              Shift Schedule
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search staff..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {staffLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : filteredStaff.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? 'No staff members match your search' : 'No staff members yet. Add your first staff member!'}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredStaff.map((member) => (
                  <StaffMemberCard
                    key={member.id}
                    member={member}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleActive={handleToggleActive}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="schedule">
            <ShiftScheduler
              shifts={shifts}
              staffMembers={staffMembers}
              loading={shiftsLoading}
              onAddShift={addShift}
              onDeleteShift={deleteShift}
            />
          </TabsContent>
        </Tabs>
      </div>

      <StaffMemberDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        member={editingMember}
        onSubmit={handleSubmit}
        loading={submitting}
      />
    </DashboardLayout>
  );
}
