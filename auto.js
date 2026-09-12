function cfg(name) {
  return window.VOP_CONFIG[name];
}


/* ==========================================
   SUPABASE CLIENT
========================================== */

function getClient() {

  if (!window.supabase) {
    throw new Error(
      "Supabase library not loaded."
    );
  }

  if (!window.__vopSupabase) {

    window.__vopSupabase =
      window.supabase.createClient(
        cfg("SUPABASE_URL"),
        cfg("SUPABASE_ANON_KEY")
      );

  }

  return window.__vopSupabase;
}


/* ==========================================
   REDIRECT
========================================== */

function go(page) {

  window.location.href =
    cfg("BASE_URL") + page;

}


/* ==========================================
   PASSWORD CLEANUP
========================================== */

function cleanPassword(value) {

  return String(value || "")
    .normalize("NFKC")
    .trim();

}


/* ==========================================
   GET CURRENT USER + PROFILE
========================================== */

async function currentProfile() {

  const client =
    getClient();


  const {
    data: { user },
    error
  } =
    await client.auth.getUser();


  if (error || !user) {

    return {
      user: null,
      profile: null
    };

  }


  const {
    data: profile,
    error: profileError
  } =
    await client
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();


  if (profileError) {
    throw profileError;
  }


  return {
    user,
    profile
  };

}


/* ==========================================
   PAYMENT / TRIAL CHECK
========================================== */

function subscriptionAllowed(profile) {

  if (!profile) {
    return false;
  }


  if (
    profile.payment_status ===
    "active"
  ) {

    return true;

  }


  if (
    profile.payment_status ===
    "trial" &&
    profile.trial_ends_at
  ) {

    return (
      new Date(
        profile.trial_ends_at
      ).getTime()
      >
      Date.now()
    );

  }


  return false;

}


/* ==========================================
   MEMBER SECURITY
========================================== */

async function requireMember() {

  const client =
    getClient();


  const {
    user,
    profile
  } =
    await currentProfile();


  if (!user || !profile) {

    await client.auth.signOut();

    go(
      cfg("LOGIN_PAGE")
    );

    return null;

  }


  if (
    profile.status !==
    "approved"
  ) {

    await client.auth.signOut();


    window.location.href =
      cfg("BASE_URL") +
      cfg("LOGIN_PAGE") +
      "?reason=" +
      encodeURIComponent(
        profile.status ||
        "pending"
      );


    return null;

  }


  if (
    !subscriptionAllowed(profile)
  ) {

    await client.auth.signOut();


    go(
      cfg("PAYMENT_PAGE")
    );


    return null;

  }


  return {
    user,
    profile
  };

}


/* ==========================================
   ADMIN SECURITY
========================================== */

async function requireAdmin() {

  const client =
    getClient();


  const {
    user,
    profile
  } =
    await currentProfile();


  if (
    !user ||
    !profile ||
    profile.role !== "admin" ||
    profile.status !== "approved"
  ) {

    await client.auth.signOut();


    go(
      cfg("ADMIN_LOGIN_PAGE")
    );


    return null;

  }


  return {
    user,
    profile
  };

}


/* ==========================================
   LOGOUT
========================================== */

async function logout(
  toAdmin = false
) {

  const client =
    getClient();


  await client.auth.signOut();


  if (toAdmin) {

    go(
      cfg("ADMIN_LOGIN_PAGE")
    );

  }

  else {

    go(
      cfg("LOGIN_PAGE")
    );

  }

}
