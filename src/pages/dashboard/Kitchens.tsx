import { useEffect, useState } from 'react';
import { useRestaurant } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { offlineQuery, offlineMutate, offlineDelete } from '@/services/offlineDataService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ChefHat, Plus, Pencil, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';

interface Kitchen {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export default function Kitchens() {
  const { currentRestaurant } = useRestaurant();
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKitchen, setEditingKitchen] = useState<Kitchen | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const fetchKitchens = async () => {
    if (!currentRestaurant) return;

    try {
      const res = await offlineQuery(
        async () => {
          const r = await supabase
            .from('kitchens')
            .select('*')
            .eq('restaurant_id', currentRestaurant.id)
            .order('created_at', { ascending: true });
          return r;
        },
        { table: 'kitchens', filters: { restaurant_id: currentRestaurant.id } }
      );

      if (res.error && !res.fromCache) throw res.error;
      setKitchens((res.data || []) as Kitchen[]);
    } catch (error) {
      console.error('Error fetching kitchens:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKitchens();
  }, [currentRestaurant]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setIsActive(true);
    setEditingKitchen(null);
  };

  const handleOpenDialog = (kitchen?: Kitchen) => {
    if (kitchen) {
      setEditingKitchen(kitchen);
      setName(kitchen.name);
      setDescription(kitchen.description || '');
      setIsActive(kitchen.is_active);
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRestaurant) return;

    try {
      if (editingKitchen) {
        const updatedData = {
          id: editingKitchen.id,
          name,
          description: description || null,
          is_active: isActive,
        };
        await offlineMutate(
          'kitchens',
          updatedData,
          async () => {
            const res = await supabase
              .from('kitchens')
              .update({ name, description: description || null, is_active: isActive })
              .eq('id', editingKitchen.id)
              .select()
              .single();
            return res;
          }
        );
        toast.success('Kitchen updated successfully');
      } else {
        const newId = crypto.randomUUID();
        const newKitchen = {
          id: newId,
          restaurant_id: currentRestaurant.id,
          name,
          description: description || null,
          is_active: isActive,
        };
        await offlineMutate(
          'kitchens',
          newKitchen,
          async () => {
            const res = await supabase
              .from('kitchens')
              .insert(newKitchen)
              .select()
              .single();
            return res;
          }
        );
        toast.success('Kitchen created successfully');
      }

      setDialogOpen(false);
      resetForm();
      fetchKitchens();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this kitchen?')) return;

    try {
      await offlineDelete(
        'kitchens',
        id,
        async () => {
          const res = await supabase.from('kitchens').delete().eq('id', id).select().single();
          return res;
        }
      );
      toast.success('Kitchen deleted');
      fetchKitchens();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggleActive = async (kitchen: Kitchen) => {
    try {
      await offlineMutate(
        'kitchens',
        { id: kitchen.id, is_active: !kitchen.is_active },
        async () => {
          const res = await supabase
            .from('kitchens')
            .update({ is_active: !kitchen.is_active })
            .eq('id', kitchen.id)
            .select()
            .single();
          return res;
        }
      );
      toast.success(`Kitchen ${!kitchen.is_active ? 'activated' : 'deactivated'}`);
      fetchKitchens();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (!currentRestaurant) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <ChefHat className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">No Restaurant Selected</h2>
          <p className="text-muted-foreground">Please select or create a restaurant first</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kitchens</h1>
          <p className="text-muted-foreground">Manage your restaurant kitchens</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="gradient" onClick={() => handleOpenDialog()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Kitchen
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingKitchen ? 'Edit Kitchen' : 'Add New Kitchen'}</DialogTitle>
              <DialogDescription>
                {editingKitchen ? 'Update kitchen details' : 'Create a new kitchen for your restaurant'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Kitchen Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Main Kitchen"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Handles main course dishes..."
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="active">Active</Label>
                <Switch
                  id="active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" variant="gradient" className="flex-1">
                  {editingKitchen ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-6 bg-muted rounded w-1/2 mb-4" />
                <div className="h-4 bg-muted rounded w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : kitchens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <ChefHat className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Kitchens Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your first kitchen to start organizing your menu items
            </p>
            <Button variant="gradient" onClick={() => handleOpenDialog()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Kitchen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kitchens.map((kitchen) => (
            <Card key={kitchen.id} className="group hover:shadow-lg transition-all duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      kitchen.is_active ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      <ChefHat className={`w-5 h-5 ${
                        kitchen.is_active ? 'text-primary' : 'text-muted-foreground'
                      }`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{kitchen.name}</CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          kitchen.is_active
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {kitchen.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleOpenDialog(kitchen)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(kitchen.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {kitchen.description && (
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{kitchen.description}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
      </div>
    </DashboardLayout>
  );
}
