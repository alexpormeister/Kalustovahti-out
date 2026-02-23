import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { CompanySearchSelect } from "@/components/shared/CompanySearchSelect";
import { toast } from "sonner";
import { Plus, Trash2, Copy, Key, AlertTriangle, Info, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { fi } from "date-fns/locale";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const ALL_PERMISSIONS = [
  { key: "read_drivers", label: "Kuljettajatiedot", description: "Kuljettajien perustiedot" },
  { key: "read_vehicles", label: "Autotiedot", description: "Ajoneuvojen perustiedot" },
  { key: "read_hardware", label: "Laitetiedot", description: "Laitevarasto ja laitteet" },
  { key: "read_documents", label: "Dokumenttitiedot", description: "Dokumenttien metatiedot" },
  { key: "read_quality", label: "Laatupoikkeamat", description: "Laatupoikkeamien tiedot" },
  { key: "read_fleets", label: "Fleettitiedot", description: "Fleet-kokonaisuudet ja linkitykset" },
];

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "sk_live_";
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const defaultPermissions: Record<string, boolean> = {
  read_drivers: true,
  read_vehicles: true,
  read_hardware: false,
  read_documents: false,
  read_quality: false,
  read_fleets: false,
};

export function ApiKeyManager() {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newCompanyId, setNewCompanyId] = useState<string | null>(null);
  const [allCompanies, setAllCompanies] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({ ...defaultPermissions });
  const [copied, setCopied] = useState(false);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, key_prefix, label, company_id, permissions, created_by, created_at, last_used_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-for-api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Ei kirjautunut sisään");

      const plainKey = generateApiKey();
      const keyHash = await sha256(plainKey);
      const keyPrefix = plainKey.substring(0, 12) + "...";

      const { error } = await supabase.from("api_keys").insert({
        key_hash: keyHash,
        key_prefix: keyPrefix,
        label: newLabel,
        permissions: permissions as any,
        created_by: user.id,
        company_id: !allCompanies && newCompanyId ? newCompanyId : null,
      });
      if (error) throw error;
      return plainKey;
    },
    onSuccess: (plainKey) => {
      setGeneratedKey(plainKey);
      setShowCreateDialog(false);
      setShowKeyDialog(true);
      setNewLabel("");
      setNewCompanyId(null);
      setAllCompanies(false);
      setPermissions({ ...defaultPermissions });
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API-avain luotu onnistuneesti");
    },
    onError: (error: any) => {
      toast.error("Virhe luotaessa API-avainta: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API-avain poistettu");
      setShowDeleteDialog(false);
      setDeleteKeyId(null);
    },
    onError: (error: any) => {
      toast.error("Virhe poistettaessa: " + error.message);
    },
  });

  const getCompanyName = (id: string | null) => {
    if (!id) return "Kaikki yritykset";
    return companies.find((c) => c.id === id)?.name || "Tuntematon";
  };
  const getProfileName = (id: string) => profiles.find((p) => p.id === id)?.full_name || "Tuntematon";

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    toast.success("API-avain kopioitu leikepöydälle");
    setTimeout(() => setCopied(false), 2000);
  };

  const getPermissionLabels = (perms: Record<string, boolean> | null) => {
    if (!perms) return "-";
    const active = ALL_PERMISSIONS.filter((p) => perms[p.key]).map((p) => p.label);
    return active.length > 0 ? active.join(", ") : "-";
  };

  const canCreate = newLabel && (allCompanies || newCompanyId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Hallitse API-avaimia ulkoisia integraatioita varten.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowGuide(!showGuide)}>
            <BookOpen className="h-4 w-4 mr-1" /> Käyttöohje
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Luo uusi API-avain
          </Button>
        </div>
      </div>

      {/* Usage Guide */}
      <Collapsible open={showGuide} onOpenChange={setShowGuide}>
        <CollapsibleContent>
          <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
            <h4 className="font-semibold flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" /> API-avaimen käyttöohje
            </h4>
            <div className="space-y-2">
              <p>
                <strong>1. Kutsu API:a</strong> lähettämällä HTTP GET -pyyntö:
              </p>
              <pre className="bg-muted rounded p-2 text-xs overflow-x-auto font-mono">
                {`GET https://vbpzcyurwokjhrgkicvu.supabase.co/functions/v1/api-export?api_key=avain
Headers:
  X-API-Key: sk_live_sinun_avaimesi_tähän`}
              </pre>
              <p>
                <strong>2. Vaihtoehtoiset tavat välittää avain:</strong>
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer sk_live_...</code> header
                </li>
                <li>
                  <code className="text-xs bg-muted px-1 rounded">?api_key=sk_live_...</code> query-parametri
                </li>
              </ul>
              <p>
                <strong>3. Vastaus:</strong> JSON joka sisältää yrityksen datan avaimen oikeuksien mukaan.
              </p>
              <p>
                <strong>Esimerkki (cURL):</strong>
              </p>
              <pre className="bg-muted rounded p-2 text-xs overflow-x-auto font-mono">
                {`curl -H "X-API-Key: sk_live_abc123..." \\
  https://vbpzcyurwokjhrgkicvu.supabase.co/functions/v1/api-export`}
              </pre>
              <p className="text-muted-foreground">
                <strong>Huom:</strong> Virheellinen avain palauttaa <code className="text-xs">401 Unauthorized</code>.
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Ladataan...</p>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Key className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>Ei API-avaimia. Luo ensimmäinen avain painamalla yllä olevaa painiketta.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nimi</TableHead>
                <TableHead>Avain (alku)</TableHead>
                <TableHead>Yritys</TableHead>
                <TableHead>Oikeudet</TableHead>
                <TableHead>Luoja</TableHead>
                <TableHead>Luotu</TableHead>
                <TableHead>Viimeksi käytetty</TableHead>
                <TableHead className="w-[80px]">Toiminnot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((key) => {
                const perms = key.permissions as Record<string, boolean> | null;
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.label}</TableCell>
                    <TableCell className="font-mono text-xs">{key.key_prefix}</TableCell>
                    <TableCell>{getCompanyName(key.company_id)}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{getPermissionLabels(perms)}</TableCell>
                    <TableCell>{getProfileName(key.created_by)}</TableCell>
                    <TableCell>{format(new Date(key.created_at), "d.M.yyyy HH:mm", { locale: fi })}</TableCell>
                    <TableCell>
                      {key.last_used_at
                        ? format(new Date(key.last_used_at), "d.M.yyyy HH:mm", { locale: fi })
                        : "Ei käytetty"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setDeleteKeyId(key.id);
                          setShowDeleteDialog(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Luo uusi API-avain</DialogTitle>
            <DialogDescription>
              Määrittele avaimelle nimi, kohde ja oikeudet. Avain näytetään vain kerran luonnin jälkeen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nimi / Kuvaus</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="esim. Kolmannen osapuolen integraatio"
              />
            </div>

            <div className="space-y-2">
              <Label>Yritys</Label>
              <div className="flex items-center space-x-2 mb-2">
                <Checkbox
                  id="all_companies"
                  checked={allCompanies}
                  onCheckedChange={(v) => {
                    setAllCompanies(!!v);
                    if (v) setNewCompanyId(null);
                  }}
                />
                <label htmlFor="all_companies" className="text-sm font-medium">
                  Kaikki yritykset
                </label>
              </div>
              {!allCompanies && (
                <CompanySearchSelect
                  value={newCompanyId || ""}
                  onChange={(id) => setNewCompanyId(id || null)}
                  placeholder="Hae yritystä nimellä tai Y-tunnuksella..."
                />
              )}
            </div>

            <div className="space-y-2">
              <Label>Oikeudet</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALL_PERMISSIONS.map((perm) => (
                  <div key={perm.key} className="flex items-start space-x-2">
                    <Checkbox
                      id={`perm_${perm.key}`}
                      checked={permissions[perm.key] || false}
                      onCheckedChange={(v) => setPermissions((p) => ({ ...p, [perm.key]: !!v }))}
                    />
                    <div>
                      <label htmlFor={`perm_${perm.key}`} className="text-sm font-medium leading-none">
                        {perm.label}
                      </label>
                      <p className="text-xs text-muted-foreground">{perm.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const all: Record<string, boolean> = {};
                    ALL_PERMISSIONS.forEach((p) => (all[p.key] = true));
                    setPermissions(all);
                  }}
                >
                  Valitse kaikki
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const none: Record<string, boolean> = {};
                    ALL_PERMISSIONS.forEach((p) => (none[p.key] = false));
                    setPermissions(none);
                  }}
                >
                  Poista valinnat
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Peruuta
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={!canCreate || createMutation.isPending}>
              {createMutation.isPending ? "Luodaan..." : "Luo avain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Key Dialog (one time only) */}
      <Dialog
        open={showKeyDialog}
        onOpenChange={(open) => {
          if (!open) setGeneratedKey("");
          setShowKeyDialog(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              API-avain luotu
            </DialogTitle>
            <DialogDescription>
              <strong className="text-destructive">Tärkeää:</strong> Kopioi tämä avain nyt. Sitä ei näytetä enää
              uudelleen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 bg-muted rounded-md font-mono text-sm break-all select-all border">{generatedKey}</div>
            <Button onClick={handleCopy} variant="outline" className="w-full">
              <Copy className="h-4 w-4 mr-2" />
              {copied ? "Kopioitu!" : "Kopioi leikepöydälle"}
            </Button>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowKeyDialog(false);
                setGeneratedKey("");
              }}
            >
              Olen kopioinut avaimen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Poista API-avain?</AlertDialogTitle>
            <AlertDialogDescription>
              Tämä poistaa avaimen pysyvästi. Kaikki tätä avainta käyttävät integraatiot lakkaavat toimimasta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Peruuta</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteKeyId && deleteMutation.mutate(deleteKeyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Poista avain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
