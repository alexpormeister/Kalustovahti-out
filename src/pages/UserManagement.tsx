import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Users, Edit2, Trash2, UserPlus, Search, ChevronDown, History, KeyRound } from "lucide-react";
import { useCanEdit } from "@/components/auth/ProtectedPage";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { ProtectedPage } from "@/components/auth/ProtectedPage";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { fi } from "date-fns/locale";

type AppRole = string;

interface UserProfile {
  id: string;
  full_name: string | null;
  driver_number: string | null;
  phone: string | null;
  email?: string;
  role?: AppRole;
}

interface AuditLog {
  id: string;
  action: string;
  table_name: string;
  record_id: string;
  old_data: any;
  new_data: any;
  description: string | null;
  created_at: string;
}

const systemRoleColors: Record<string, string> = {
  system_admin: "bg-destructive text-destructive-foreground",
  contract_manager: "bg-primary text-primary-foreground",
  hardware_ops: "bg-status-maintenance text-status-maintenance-foreground",
  support: "bg-muted text-muted-foreground",
};

const actionLabels: Record<string, string> = {
  create: "Luonti",
  update: "Muokkaus",
  delete: "Poisto",
};

const actionColors: Record<string, string> = {
  create: "bg-status-active text-status-active-foreground",
  update: "bg-primary text-primary-foreground",
  delete: "bg-destructive text-destructive-foreground",
};

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { isSystemAdmin } = usePermissions();
  const canEdit = useCanEdit("kayttajat");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    full_name: "",
    driver_number: "",
    phone: "",
    role: "support" as AppRole,
  });
  const [newUserData, setNewUserData] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "support" as AppRole,
  });
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  // Fetch available roles
  const { data: dbRoles = [] } = useQuery({
    queryKey: ["available-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roles")
        .select("name, display_name")
        .order("display_name");
      if (error) throw error;
      return data || [];
    },
  });

  const roleLabels: Record<string, string> = {};
  const roleColors: Record<string, string> = {};
  
  dbRoles.forEach((r) => {
    roleLabels[r.name] = r.display_name;
    roleColors[r.name] = systemRoleColors[r.name] || "bg-secondary text-secondary-foreground";
  });

  // KORJATTU: Haetaan sähköpostit suoraan profiles-taulusta (vaatii että sarake on olemassa)
  const { data: emailMap = {} } = useQuery({
    queryKey: ["admin-user-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email");
      
      if (error) {
        console.warn("Could not fetch emails directly, might be missing email column");
        return {};
      }
      
      const map: Record<string, string> = {};
      data?.forEach(p => { if (p.id && p.email) map[p.id] = p.email; });
      return map;
    },
  });

  // Fetch all users
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users", emailMap],
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");
      
      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");
      
      if (rolesError) throw rolesError;

      const rolesMap = new Map(roles?.map((r: any) => [r.user_id, r.role]));

      return profiles.map((p: any) => ({
        ...p,
        email: p.email || emailMap[p.id] || "",
        role: rolesMap.get(p.id) || "support",
      })) as UserProfile[];
    },
  });

  const { data: userLogs = [] } = useQuery({
    queryKey: ["user-audit-logs", expandedUserId],
    queryFn: async () => {
      if (!expandedUserId) return [];
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("user_id", expandedUserId)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data as AuditLog[];
    },
    enabled: !!expandedUserId,
  });

  const filteredUsers = users.filter((user) =>
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.driver_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data, newRole }: { userId: string; data: any; newRole: AppRole }) => {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: data.full_name,
          driver_number: data.driver_number || null,
          phone: data.phone || null,
        })
        .eq("id", userId);
      
      if (profileError) throw profileError;

      const { error: roleError } = await supabase
        .from("user_roles")
        .update({ role: newRole })
        .eq("user_id", userId);
      
      if (roleError) throw roleError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Käyttäjä päivitetty");
      setSelectedUser(null);
    },
    onError: () => toast.error("Virhe päivitettäessä käyttäjää"),
  });

  // HUOM: Create, Reset Password ja Delete vaativat joko Edge Functionin 
  // tai koodin muuttamisen käyttämään suoraan supabase.auth.admin API:a (vaatii service_role avaimen)
  const createUserMutation = useMutation({
    mutationFn: async (data: typeof newUserData) => {
      // TÄSSÄ: Jos funktiota ei ole, tämä epäonnistuu. Suositeltu tapa on antaa Lovablen 
      // vaihtaa tämä suoraan auth.signUp kutsuun jos service rolea ei ole käytössä.
      const { data: result, error } = await supabase.functions.invoke("admin-create-user", {
        body: data,
      });
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Käyttäjä luotu!");
      setIsAddUserDialogOpen(false);
    },
    onError: (error: any) => toast.error("Virhe: " + error.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { user_id: userId, new_password: newPassword },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Salasana vaihdettu");
      setResetPasswordUserId(null);
    },
    onError: (error: any) => toast.error("Virhe: " + error.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.functions.invoke("admin-delete-user", {
        body: { user_id: userId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Käyttäjä poistettu");
    },
    onError: () => toast.error("Virhe poistettaessa"),
  });

  const resetForm = () => setFormData({ full_name: "", driver_number: "", phone: "", role: "support" });

  const handleEdit = (user: UserProfile) => {
    setSelectedUser(user);
    setFormData({
      full_name: user.full_name || "",
      driver_number: user.driver_number || "",
      phone: user.phone || "",
      role: (user.role as AppRole) || "support",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUser) {
      updateUserMutation.mutate({ userId: selectedUser.id, data: formData, newRole: formData.role });
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserData.email || !newUserData.password) return toast.error("Täytä tiedot");
    createUserMutation.mutate(newUserData);
  };

  const getChangedFields = (oldData: any, newData: any) => {
    if (!oldData || !newData) return [];
    return Object.keys(newData).filter(k => k !== 'updated_at' && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]))
      .map(k => ({ field: k, oldValue: oldData[k], newValue: newData[k] }));
  };

  return (
    <ProtectedPage pageKey="kayttajat">
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Käyttäjien hallinta</h1>
              <p className="text-muted-foreground mt-1">Hallitse käyttäjiä ja oikeuksia</p>
            </div>
            {canEdit && (
              <Dialog open={isAddUserDialogOpen} onOpenChange={setIsAddUserDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2"><UserPlus className="h-4 w-4" /> Lisää käyttäjä</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Lisää uusi käyttäjä</DialogTitle></DialogHeader>
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div>
                      <Label>Sähköposti *</Label>
                      <Input type="email" value={newUserData.email} onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })} required />
                    </div>
                    <div>
                      <Label>Salasana *</Label>
                      <Input type="password" value={newUserData.password} onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })} required />
                    </div>
                    <div>
                      <Label>Nimi *</Label>
                      <Input value={newUserData.full_name} onChange={(e) => setNewUserData({ ...newUserData, full_name: e.target.value })} required />
                    </div>
                    <div>
                      <Label>Rooli</Label>
                      <Select value={newUserData.role} onValueChange={(v) => setNewUserData({ ...newUserData, role: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{dbRoles.map(r => <SelectItem key={r.name} value={r.name}>{r.display_name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full" disabled={createUserMutation.isPending}>Luo käyttäjä</Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Hae käyttäjiä..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
          </div>

          <Card className="glass-card">
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Käyttäjät ({filteredUsers.length})</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <div className="text-center py-4">Ladataan...</div> : (
                <div className="space-y-2">
                  {filteredUsers.map((user) => (
                    <Collapsible key={user.id} open={expandedUserId === user.id} onOpenChange={(open) => setExpandedUserId(open ? user.id : null)}>
                      <div className="border rounded-lg">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-2">
                          <div>
                            <p className="font-medium">{user.full_name || "Ei nimeä"}</p>
                            <p className="text-sm text-muted-foreground">{user.email || user.phone || "Ei yhteystietoja"}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={user.role ? roleColors[user.role] : ""}>{user.role ? roleLabels[user.role] : "Support"}</Badge>
                            {canEdit && (
                              <>
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}><Edit2 className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={() => { setResetPasswordUserId(user.id); setResetPasswordValue(""); }}><KeyRound className="h-4 w-4" /></Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Poista käyttäjä?</AlertDialogTitle></AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Peruuta</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteUserMutation.mutate(user.id)} className="bg-destructive">Poista</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                            <CollapsibleTrigger asChild><Button variant="ghost" size="icon"><ChevronDown className={`h-4 w-4 transition-transform ${expandedUserId === user.id ? "rotate-180" : ""}`} /></Button></CollapsibleTrigger>
                          </div>
                        </div>
                        <CollapsibleContent className="border-t p-4 bg-muted/30">
                          <h4 className="font-medium text-sm flex items-center gap-2 mb-2"><History className="h-4 w-4" /> Viimeisimmät lokit</h4>
                          {userLogs.length === 0 ? <p className="text-xs text-muted-foreground">Ei lokeja</p> : (
                            <div className="space-y-1">
                              {userLogs.map(log => (
                                <div key={log.id} className="text-xs p-2 bg-background border rounded">
                                  <span className="font-bold uppercase mr-2">{log.action}</span> {log.description || log.table_name} - {format(new Date(log.created_at), "d.M. HH:mm")}
                                </div>
                              ))}
                            </div>
                          )}
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Edit & Reset Dialogit (Samat kuin aiemmin mutta optimoidut) */}
        <Dialog open={!!selectedUser} onOpenChange={(o) => !o && setSelectedUser(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Muokkaa käyttäjää</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><Label>Nimi</Label><Input value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} /></div>
              <div>
                <Label>Rooli</Label>
                <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{dbRoles.map(r => <SelectItem key={r.name} value={r.name}>{r.display_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full">Tallenna</Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={!!resetPasswordUserId} onOpenChange={(o) => !o && setResetPasswordUserId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Vaihda salasana</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); resetPasswordMutation.mutate({ userId: resetPasswordUserId!, newPassword: resetPasswordValue }); }} className="space-y-4">
              <Input type="password" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} placeholder="Uusi salasana" required />
              <Button type="submit" className="w-full">Päivitä salasana</Button>
            </form>
          </DialogContent>
        </Dialog>
      </DashboardLayout>
    </ProtectedPage>
  );
}