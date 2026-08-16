// Oasis Care — account deletion Edge Function.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a disposable test account before trusting it with a
// real one — see the deployment note at the bottom of this comment block.
//
// Why this has to be server-side: deleting the auth user itself requires
// the service_role key (Supabase's admin API), which must never exist in
// the iOS app or in Git. This function reads it from an Edge Function
// secret instead, and only acts on the identity proven by the caller's
// own JWT — it can never be used to delete a different user's account.
//
// What it deletes: every workspace the caller owns (Storage photos under
// that workspace's path, then the workspace row itself — Postgres FK
// cascades take care of gardens/zones/plants/photos/events/schedules
// automatically from there), the caller's profile row, and finally the
// auth user. Nothing here soft-deletes or deactivates; per the spec this
// must be a real, irreversible deletion.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "delete-account" → paste this file's contents → Deploy.
// (The service_role key needed here is already available to every Edge
// Function automatically, as SUPABASE_SERVICE_ROLE_KEY — no extra secret
// to configure.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "plant-photos";

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Authentification manquante." }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Scoped to the caller's own JWT, purely to find out who is calling -
  // never used for anything privileged.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Session invalide." }), { status: 401 });
  }
  const userId = userData.user.id;

  // Admin client - the service_role key never leaves this server-side
  // function, and every call below is scoped to exactly this userId.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: workspaces, error: workspacesError } = await admin
      .from("workspaces")
      .select("id")
      .eq("owner_id", userId);
    if (workspacesError) throw workspacesError;

    for (const workspace of workspaces ?? []) {
      await removeWorkspacePhotos(admin, workspace.id);
      const { error: deleteWorkspaceError } = await admin.from("workspaces").delete().eq("id", workspace.id);
      if (deleteWorkspaceError) throw deleteWorkspaceError;
    }

    const { error: profileError } = await admin.from("profiles").delete().eq("id", userId);
    if (profileError) throw profileError;

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// storage.list() is not recursive, and photos live one folder deeper
// (workspaceId/plantId/photo.jpg) than the top-level list() call sees, so
// this walks one level down before removing anything.
async function removeWorkspacePhotos(admin: ReturnType<typeof createClient>, workspaceId: string) {
  const { data: entries } = await admin.storage.from(BUCKET).list(workspaceId, { limit: 1000 });
  const paths: string[] = [];
  for (const entry of entries ?? []) {
    if (entry.id === null) {
      const { data: subEntries } = await admin.storage
        .from(BUCKET)
        .list(`${workspaceId}/${entry.name}`, { limit: 1000 });
      for (const sub of subEntries ?? []) {
        paths.push(`${workspaceId}/${entry.name}/${sub.name}`);
      }
    } else {
      paths.push(`${workspaceId}/${entry.name}`);
    }
  }
  if (paths.length > 0) {
    await admin.storage.from(BUCKET).remove(paths);
  }
}
