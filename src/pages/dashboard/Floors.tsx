import { useEffect, useState } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { offlineQuery, offlineMutate, offlineDelete } from '@/services/offlineDataService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Layers, Plus, Pencil, Trash2, Users } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';

interface Table {
  id: string;
  table_number: string;
  capacity: number;
  is_occupied: boolean;
}

interface Floor {
  id: string;
  name: string;
  floor_number: number;
  tables: Table[];
}

export default function Floors() {
  const { currentRestaurant } = useRestaurant();
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);
  const [floorDialogOpen, setFloorDialogOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [editingFloor, setEditingFloor] = useState<Floor | null>(null);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');

  // Floor form
  const [floorName, setFloorName] = useState('');
  const [floorNumber, setFloorNumber] = useState('0');

  // Table form
  const [tableNumber, setTableNumber] = useState('');
  const [tableCapacity, setTableCapacity] = useState('4');
  const [tableFloorId, setTableFloorId] = useState('');

  const fetchFloors = async () => {
    if (!currentRestaurant) return;

    try {
      const result = await offlineQuery(
        async () => {
          const res = await supabase
            .from('floors')
            .select('*, tables(*)')
            .eq('restaurant_id', currentRestaurant.id)
            .order('floor_number', { ascending: true });
          return res;
        },
        { table: 'floors', filters: { restaurant_id: currentRestaurant.id } }
      );

      if (result.error && !result.fromCache) throw result.error;

      let floorsData: Floor[] = [];
      if (result.fromCache) {
        // Cache returns flat floors, need to attach tables
        const rawFloors = (result.data || []) as any[];
        // Use localQuery which is LAN-aware
        const { localQuery } = await import('@/services/localDataService');
        for (const floor of rawFloors) {
          const tablesResult = await localQuery('tables', { floor_id: floor.id });
          floorsData.push({ ...floor, tables: tablesResult.data || [] });
        }
      } else {
        floorsData = (result.data || []) as Floor[];
      }

      setFloors(floorsData);
      if (floorsData.length > 0 && !selectedFloorId) {
        setSelectedFloorId(floorsData[0].id);
      }
    } catch (error) {
      console.error('Error fetching floors:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFloors();
  }, [currentRestaurant]);

  const resetFloorForm = () => {
    setFloorName('');
    setFloorNumber('0');
    setEditingFloor(null);
  };

  const resetTableForm = () => {
    setTableNumber('');
    setTableCapacity('4');
    setTableFloorId('');
    setEditingTable(null);
  };

  const handleOpenFloorDialog = (floor?: Floor) => {
    if (floor) {
      setEditingFloor(floor);
      setFloorName(floor.name);
      setFloorNumber(floor.floor_number.toString());
    } else {
      resetFloorForm();
    }
    setFloorDialogOpen(true);
  };

  const handleOpenTableDialog = (table?: Table, floorId?: string) => {
    if (table) {
      setEditingTable(table);
      setTableNumber(table.table_number);
      setTableCapacity(table.capacity.toString());
    } else {
      resetTableForm();
      if (floorId) setTableFloorId(floorId);
    }
    setTableDialogOpen(true);
  };

  const handleFloorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRestaurant) return;

    try {
      const floorData = {
        restaurant_id: currentRestaurant.id,
        name: floorName,
        floor_number: parseInt(floorNumber),
        ...(editingFloor ? { id: editingFloor.id } : {}),
      };

      if (editingFloor) {
        const { error } = await offlineMutate(
          'floors',
          floorData,
          async () => {
            const res = await supabase
              .from('floors')
              .update({ name: floorName, floor_number: parseInt(floorNumber) })
              .eq('id', editingFloor.id)
              .select()
              .single();
            return res;
          }
        );
        if (error) throw error;
        toast.success('Floor updated successfully');
      } else {
        const { error } = await offlineMutate(
          'floors',
          floorData,
          async () => {
            const res = await supabase.from('floors').insert(floorData).select().single();
            return res;
          }
        );
        if (error) throw error;
        toast.success('Floor created successfully');
      }

      setFloorDialogOpen(false);
      resetFloorForm();
      fetchFloors();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleTableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const floorId = editingTable ? floors.find(f => f.tables.some(t => t.id === editingTable.id))?.id : tableFloorId;
    if (!floorId) return;

    try {
      const tableData = {
        floor_id: floorId,
        table_number: tableNumber,
        capacity: parseInt(tableCapacity),
        ...(editingTable ? { id: editingTable.id } : {}),
      };

      if (editingTable) {
        const { error } = await offlineMutate(
          'tables',
          tableData,
          async () => {
            const res = await supabase
              .from('tables')
              .update({ table_number: tableNumber, capacity: parseInt(tableCapacity) })
              .eq('id', editingTable.id)
              .select()
              .single();
            return res;
          }
        );
        if (error) throw error;
        toast.success('Table updated successfully');
      } else {
        const { error } = await offlineMutate(
          'tables',
          tableData,
          async () => {
            const res = await supabase.from('tables').insert(tableData).select().single();
            return res;
          }
        );
        if (error) throw error;
        toast.success('Table created successfully');
      }

      setTableDialogOpen(false);
      resetTableForm();
      fetchFloors();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteFloor = async (id: string) => {
    if (!confirm('Are you sure? This will delete all tables on this floor.')) return;

    try {
      const { error } = await offlineDelete('floors', id, async () => {
        const res = await supabase.from('floors').delete().eq('id', id);
        return res;
      });
      if (error) throw error;
      toast.success('Floor deleted');
      fetchFloors();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteTable = async (id: string) => {
    if (!confirm('Are you sure you want to delete this table?')) return;

    try {
      const { error } = await offlineDelete('tables', id, async () => {
        const res = await supabase.from('tables').delete().eq('id', id);
        return res;
      });
      if (error) throw error;
      toast.success('Table deleted');
      fetchFloors();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (!currentRestaurant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <Layers className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">No Restaurant Selected</h2>
          <p className="text-muted-foreground">Please select or create a restaurant first</p>
        </div>
      </DashboardLayout>
    );
  }

  const selectedFloor = floors.find(f => f.id === selectedFloorId);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Floors & Tables</h1>
          <p className="text-muted-foreground">Manage your restaurant layout</p>
        </div>
        <Dialog open={floorDialogOpen} onOpenChange={setFloorDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="gradient" onClick={() => handleOpenFloorDialog()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Floor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingFloor ? 'Edit Floor' : 'Add New Floor'}</DialogTitle>
              <DialogDescription>
                {editingFloor ? 'Update floor details' : 'Create a new floor for your restaurant'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleFloorSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="floorName">Floor Name *</Label>
                <Input
                  id="floorName"
                  value={floorName}
                  onChange={(e) => setFloorName(e.target.value)}
                  placeholder="Ground Floor"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="floorNumber">Floor Number</Label>
                <Input
                  id="floorNumber"
                  type="number"
                  value={floorNumber}
                  onChange={(e) => setFloorNumber(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFloorDialogOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" variant="gradient" className="flex-1">
                  {editingFloor ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table Dialog */}
      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTable ? 'Edit Table' : 'Add New Table'}</DialogTitle>
            <DialogDescription>
              {editingTable ? 'Update table details' : 'Add a new table to the floor'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTableSubmit} className="space-y-4 mt-4">
            {!editingTable && (
              <div className="space-y-2">
                <Label>Floor *</Label>
                <Select value={tableFloorId} onValueChange={setTableFloorId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select floor" />
                  </SelectTrigger>
                  <SelectContent>
                    {floors.map((floor) => (
                      <SelectItem key={floor.id} value={floor.id}>
                        {floor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="tableNumber">Table Number *</Label>
              <Input
                id="tableNumber"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="T1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tableCapacity">Capacity</Label>
              <Input
                id="tableCapacity"
                type="number"
                min="1"
                value={tableCapacity}
                onChange={(e) => setTableCapacity(e.target.value)}
                placeholder="4"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTableDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" variant="gradient" className="flex-1">
                {editingTable ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? (
        <Card className="animate-pulse">
          <CardContent className="p-6">
            <div className="h-8 bg-muted rounded w-1/3 mb-4" />
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-muted rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : floors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Layers className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Floors Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your first floor to start creating tables
            </p>
            <Button variant="gradient" onClick={() => handleOpenFloorDialog()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Floor
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={selectedFloorId} onValueChange={setSelectedFloorId}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              {floors.map((floor) => (
                <TabsTrigger key={floor.id} value={floor.id}>
                  {floor.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {selectedFloor && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenFloorDialog(selectedFloor)}
                >
                  <Pencil className="w-4 h-4 mr-1" />
                  Edit Floor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDeleteFloor(selectedFloor.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {floors.map((floor) => (
            <TabsContent key={floor.id} value={floor.id}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">{floor.name} Tables</CardTitle>
                  <Button onClick={() => handleOpenTableDialog(undefined, floor.id)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Table
                  </Button>
                </CardHeader>
                <CardContent>
                  {floor.tables.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No tables on this floor yet. Add your first table!
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                      {floor.tables
                        .sort((a, b) => a.table_number.localeCompare(b.table_number))
                        .map((table) => (
                          <div
                            key={table.id}
                            className={`relative p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer group hover:shadow-md ${
                              table.is_occupied
                                ? 'border-destructive/50 bg-destructive/5'
                                : 'border-success/50 bg-success/5 hover:border-success'
                            }`}
                          >
                            <div className="text-center">
                              <p className="text-lg font-bold">{table.table_number}</p>
                              <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mt-1">
                                <Users className="w-3 h-3" />
                                <span>{table.capacity}</span>
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded-full mt-2 inline-block ${
                                table.is_occupied
                                  ? 'bg-destructive/10 text-destructive'
                                  : 'bg-success/10 text-success'
                              }`}>
                                {table.is_occupied ? 'Occupied' : 'Available'}
                              </span>
                            </div>
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenTableDialog(table);
                                }}
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTable(table.id);
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
      </div>
    </DashboardLayout>
  );
}
