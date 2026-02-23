import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let apiKey = url.searchParams.get("api_key");
    const authHeader = req.headers.get("Authorization");
    const xApiKey = req.headers.get("X-API-Key");

    if (xApiKey) {
      apiKey = xApiKey;
    } else if (authHeader?.startsWith("Bearer sk_live_")) {
      apiKey = authHeader.replace("Bearer ", "");
    }

    if (!apiKey || !apiKey.startsWith("sk_live_")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "Virheellinen tai puuttuva API-avain" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const keyHash = await sha256(apiKey);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: keyData, error: keyError } = await supabaseAdmin
      .rpc("validate_api_key", { p_key_hash: keyHash });

    if (keyError || !keyData || keyData.length === 0) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "Virheellinen API-avain" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { company_id, permissions } = keyData[0];

    // Update last_used_at
    await supabaseAdmin.rpc("touch_api_key", { p_key_hash: keyHash });

    const result: Record<string, unknown> = {};
    const isAllCompanies = !company_id;

    if (isAllCompanies) {
      result.scope = "all_companies";
    } else {
      result.company_id = company_id;
    }

    // Helper to build query with optional company filter
    const withCompanyFilter = (query: any, companyCol = "company_id") => {
      if (!isAllCompanies) {
        return query.eq(companyCol, company_id);
      }
      return query;
    };

    // Drivers
    if (permissions?.read_drivers) {
      const q = supabaseAdmin
        .from("drivers")
        .select("id, driver_number, full_name, phone, email, city, province, status, driver_license_valid_until, company_id, company:companies(name)");
      const { data, error } = await withCompanyFilter(q);
      if (error) throw error;
      result.drivers = (data || []).map((d: any) => ({
        ...d,
        company_name: d.company?.name || null,
        company: undefined,
      }));
    }

    // Vehicles
    if (permissions?.read_vehicles) {
      const q = supabaseAdmin
        .from("vehicles")
        .select("id, vehicle_number, registration_number, brand, model, year_model, fuel_type, status, city, company_id, company:companies(name)");
      const { data, error } = await withCompanyFilter(q);
      if (error) throw error;
      result.vehicles = (data || []).map((v: any) => ({
        ...v,
        company_name: v.company?.name || null,
        company: undefined,
      }));
    }

    // Hardware
    if (permissions?.read_hardware) {
      const q = supabaseAdmin
        .from("hardware_devices")
        .select("id, serial_number, device_type, sim_number, status, vehicle_id, company_id, description, vehicle:vehicles(vehicle_number, registration_number), company:companies(name)");
      const { data, error } = await withCompanyFilter(q);
      if (error) throw error;
      result.hardware = (data || []).map((h: any) => ({
        ...h,
        vehicle_number: h.vehicle?.vehicle_number || null,
        vehicle_registration: h.vehicle?.registration_number || null,
        company_name: h.company?.name || null,
        vehicle: undefined,
        company: undefined,
      }));
    }

    // Documents (company + driver)
    if (permissions?.read_documents) {
      const q = supabaseAdmin
        .from("company_documents")
        .select("id, file_name, status, valid_from, valid_until, company_id, document_type_id, company:companies(name), document_type:document_types(name)");
      const { data, error } = await withCompanyFilter(q);
      if (error) throw error;
      result.company_documents = (data || []).map((d: any) => ({
        ...d,
        company_name: d.company?.name || null,
        document_type_name: d.document_type?.name || null,
        company: undefined,
        document_type: undefined,
      }));

      // Driver documents
      const ddSelect = "id, file_name, status, valid_from, valid_until, driver_id, document_type_id, driver:drivers(driver_number, full_name), document_type:document_types(name)";
      if (isAllCompanies) {
        const { data: dd, error: dde } = await supabaseAdmin
          .from("driver_documents")
          .select(ddSelect);
        if (dde) throw dde;
        result.driver_documents = (dd || []).map((d: any) => ({
          ...d,
          driver_number: d.driver?.driver_number || null,
          driver_name: d.driver?.full_name || null,
          document_type_name: d.document_type?.name || null,
          driver: undefined,
          document_type: undefined,
        }));
      } else {
        const { data: driverIds } = await supabaseAdmin
          .from("drivers")
          .select("id")
          .eq("company_id", company_id);
        if (driverIds && driverIds.length > 0) {
          const ids = driverIds.map((d: any) => d.id);
          const { data: dd, error: dde } = await supabaseAdmin
            .from("driver_documents")
            .select(ddSelect)
            .in("driver_id", ids);
          if (dde) throw dde;
          result.driver_documents = (dd || []).map((d: any) => ({
            ...d,
            driver_number: d.driver?.driver_number || null,
            driver_name: d.driver?.full_name || null,
            document_type_name: d.document_type?.name || null,
            driver: undefined,
            document_type: undefined,
          }));
        } else {
          result.driver_documents = [];
        }
      }
    }

    // Quality incidents
    if (permissions?.read_quality) {
      const q = supabaseAdmin
        .from("quality_incidents")
        .select("id, incident_type, incident_date, status, description, action_taken, driver_id, vehicle_id, source, driver:drivers(driver_number, full_name), vehicle:vehicles(vehicle_number, registration_number, company_id, company:companies(name))");
      const { data, error } = await q;
      if (error) throw error;
      result.quality_incidents = (data || []).map((qi: any) => ({
        ...qi,
        driver_number: qi.driver?.driver_number || null,
        driver_name: qi.driver?.full_name || null,
        vehicle_number: qi.vehicle?.vehicle_number || null,
        vehicle_registration: qi.vehicle?.registration_number || null,
        company_id: qi.vehicle?.company_id || null,
        company_name: qi.vehicle?.company?.name || null,
        driver: undefined,
        vehicle: undefined,
      }));
    }

    // Fleets
    if (permissions?.read_fleets) {
      const { data: fleets, error: fe } = await supabaseAdmin
        .from("fleets")
        .select("id, name, description");
      if (fe) throw fe;
      result.fleets = fleets;

      const { data: links, error: le } = await supabaseAdmin
        .from("vehicle_fleet_links")
        .select("id, vehicle_id, fleet_id");
      if (le) throw le;
      result.vehicle_fleet_links = links;
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("API export error:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
