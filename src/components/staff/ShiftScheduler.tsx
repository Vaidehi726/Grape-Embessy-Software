import { useState, useMemo } from 'react';
import { format, startOfWeek, addDays, isSameDay, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, ChevronRight, Plus, Trash2, Loader2 } from 'lucide-react';
import { Shift, StaffMember } from '@/hooks/useStaffMembers';
import { cn } from '@/lib/utils';

interface ShiftSchedulerProps {
  shifts: Shift[];
  staffMembers: StaffMember[];
  loading: boolean;
  onAddShift: (data: {
    staff_member_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }) => Promise<{ error: Error | null }>;
  onDeleteShift: (id: string) => Promise<{ error: Error | null }>;
}

export function ShiftScheduler({
  shifts,
  staffMembers,
  loading,
  onAddShift,
  onDeleteShift,
}: ShiftSchedulerProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [formData, setFormData] = useState({
    staff_member_id: '',
    start_time: '09:00',
    end_time: '17:00',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const shiftsGroupedByDate = useMemo(() => {
    const grouped: Record<string, Shift[]> = {};
    shifts.forEach((shift) => {
      const dateStr = shift.shift_date;
      if (!grouped[dateStr]) grouped[dateStr] = [];
      grouped[dateStr].push(shift);
    });
    return grouped;
  }, [shifts]);

  const activeStaff = staffMembers.filter((s) => s.is_active);

  const handlePrevWeek = () => setWeekStart((prev) => addDays(prev, -7));
  const handleNextWeek = () => setWeekStart((prev) => addDays(prev, 7));

  const handleOpenAddShift = (date: Date) => {
    setSelectedDate(date);
    setFormData({
      staff_member_id: '',
      start_time: '09:00',
      end_time: '17:00',
      notes: '',
    });
    setDialogOpen(true);
  };

  const handleAddShift = async () => {
    if (!selectedDate || !formData.staff_member_id) return;

    setSaving(true);
    const { error } = await onAddShift({
      staff_member_id: formData.staff_member_id,
      shift_date: format(selectedDate, 'yyyy-MM-dd'),
      start_time: formData.start_time,
      end_time: formData.end_time,
      notes: formData.notes || undefined,
    });

    setSaving(false);
    if (!error) {
      setDialogOpen(false);
    }
  };

  const handleDeleteShift = async (shiftId: string) => {
    await onDeleteShift(shiftId);
  };

  const getStaffName = (staffMemberId: string) => {
    const staff = staffMembers.find((s) => s.id === staffMemberId);
    return staff?.full_name || 'Unknown';
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Shift Schedule</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handlePrevWeek}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium min-w-[180px] text-center">
                {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d, yyyy')}
              </span>
              <Button variant="outline" size="icon" onClick={handleNextWeek}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const dayShifts = shiftsGroupedByDate[dateStr] || [];
                const isToday = isSameDay(day, new Date());

                return (
                  <div
                    key={dateStr}
                    className={cn(
                      "min-h-[150px] border rounded-lg p-2 transition-colors",
                      isToday && "border-primary bg-primary/5"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">{format(day, 'EEE')}</p>
                        <p className={cn(
                          "text-sm font-medium",
                          isToday && "text-primary"
                        )}>
                          {format(day, 'd')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleOpenAddShift(day)}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>

                    <div className="space-y-1">
                      {dayShifts.map((shift) => (
                        <div
                          key={shift.id}
                          className="group relative bg-secondary/50 rounded p-1.5 text-xs"
                        >
                          <p className="font-medium truncate">{getStaffName(shift.staff_member_id)}</p>
                          <p className="text-muted-foreground">
                            {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-0 right-0 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDeleteShift(shift.id)}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              Add Shift - {selectedDate ? format(selectedDate, 'EEEE, MMM d') : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Staff Member</Label>
              <Select
                value={formData.staff_member_id}
                onValueChange={(v) => setFormData((p) => ({ ...p, staff_member_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {activeStaff.map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.full_name} ({staff.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData((p) => ({ ...p, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData((p) => ({ ...p, end_time: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Any special instructions..."
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddShift} disabled={saving || !formData.staff_member_id}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add Shift
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
