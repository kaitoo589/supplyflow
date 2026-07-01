import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "./supabase";
import { springSnappy, springSoft, pressable, collapse } from "./motion";
import Fox from "./Fox";

// Pagina waar de "wachtwoord vergeten"-maillink naartoe leidt (/reset-password).
export function ResetPassword({ session }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const handleReset = async () => {
    setError(null);
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) setError(error.message);
    else setDone(true);
  };

  const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E8E6E0", fontSize: 14, outline: "none", boxSizing: "border-box", background: "#fff" };

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: "#F8F7F4", minHeight: "100dvh", width: "100%", maxWidth: 430, margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ background: "#0F0E0C", padding: "32px 24px 28px", textAlign: "center" }}>
        <div style={{ color: "#FF5C00", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Flowva</div>
        <div style={{ color: "#fff", fontSize: 22, fontWeight: 700 }}>New password</div>
      </div>
      <div style={{ padding: "24px" }}>
        {!session ? (
          <div style={{ background: "#FEF3C7", color: "#B45309", borderRadius: 10, padding: "12px 14px", fontSize: 13 }}>
            This link has expired or is invalid. Request a new reset link from the login screen.
          </div>
        ) : done ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}><Fox /></div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0F0E0C", marginBottom: 6 }}>Password changed!</div>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => { window.location.href = "/"; }}
              style={{ marginTop: 14, width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
              To Flowva →
            </motion.button>
          </motion.div>
        ) : (
          <>
            {error && <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4, display: "block" }}>New password</label>
              <input style={inputStyle} type="password" placeholder="At least 6 characters" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4, display: "block" }}>Repeat password</label>
              <input style={inputStyle} type="password" placeholder="Once more" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
            <motion.button whileTap={loading ? undefined : { scale: 0.97 }} onClick={handleReset} disabled={loading}
              style={{ width: "100%", background: loading ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
              {loading ? "One moment..." : "Save password"}
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Auth() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [form, setForm] = useState({
    email: "",
    password: "",
    voornaam: "",
    achternaam: "",
  });

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleLogin = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError(null); setSuccess(null);
    if (!form.email) { setError("Enter your email address first, then we'll send a reset link."); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSuccess("Reset link sent! Check your email to set a new password.");
  };

  const handleRegister = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          voornaam: form.voornaam,
          achternaam: form.achternaam,
        },
      },
    });

    setLoading(false);

    // 1) Expliciete fout van Supabase (bv. wachtwoord te kort, of soms "User already registered").
    if (signUpError) {
      if (/already registered|already exists|user already/i.test(signUpError.message)) {
        setError("This email already has an account. Switch to the “Log in” tab above — or use “Forgot password?”.");
      } else {
        setError(signUpError.message);
      }
      return;
    }

    // 2) Anti-enumeratie: bij een AL bestaand (bevestigd) adres geeft Supabase géén fout, maar
    //    een "lege" gebruiker terug (identities = []). Zo vangen we "account bestaat al" af i.p.v.
    //    misleidend "Account created!" te tonen.
    const alreadyExists =
      data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
    if (alreadyExists) {
      setError("This email already has an account. Switch to the “Log in” tab above — or use “Forgot password?”.");
      return;
    }

    setSuccess("Account created! Check your email to confirm.");
  };

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #E8E6E0",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    background: "#fff",
  };

  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: "#555",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div style={{
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
      background: "#F8F7F4",
      minHeight: "100dvh",
      width: "100%",
      maxWidth: 430,
      margin: "0 auto",
      boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{
        background: "#0F0E0C",
        padding: "32px 24px 28px",
        textAlign: "center",
      }}>
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
          style={{ color: "#FF5C00", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
          Flowva
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: 0.05 }}
          style={{ color: "#fff", fontSize: 22, fontWeight: 700 }}>
          {mode === "login" ? "Welcome back" : "Create account"}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: 0.1 }}
          style={{ color: "#888", fontSize: 13, marginTop: 6 }}>
          {mode === "login"
            ? "Log in to manage your orders"
            : "Create an account to start ordering"}
        </motion.div>
      </div>

      {/* Toggle */}
      <div style={{
        display: "flex",
        margin: "20px 24px 0",
        background: "#E8E6E0",
        borderRadius: 12,
        padding: 4,
      }}>
        {["login", "register"].map((m) => (
          <motion.button
            key={m}
            onClick={() => { setMode(m); setError(null); setSuccess(null); }}
            whileTap={{ scale: 0.95 }}
            transition={springSnappy}
            style={{
              position: "relative",
              flex: 1,
              padding: "10px",
              borderRadius: 9,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              background: "transparent",
              color: mode === m ? "#fff" : "#888",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {mode === m && (
              <motion.div
                layoutId="authPill"
                transition={springSnappy}
                style={{ position: "absolute", inset: 0, background: "#0F0E0C", borderRadius: 9, zIndex: 0 }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1 }}>
              {m === "login" ? "Log in" : "Register"}
            </span>
          </motion.button>
        ))}
      </div>

      {/* Form */}
      <div style={{ padding: "20px 24px 40px" }}>
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto", marginBottom: 16 }}
              exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
              transition={springSoft}
              style={{
                background: "#FEE2E2", color: "#DC2626",
                borderRadius: 10, padding: "12px 14px",
                fontSize: 13, overflow: "hidden",
              }}>
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto", marginBottom: 16 }}
              exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
              transition={springSoft}
              style={{
                background: "#DCFCE7", color: "#166534",
                borderRadius: 10, padding: "12px 14px",
                fontSize: 13, overflow: "hidden",
              }}>
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Registreer velden */}
        <AnimatePresence initial={false}>
        {mode === "register" && (
          <motion.div key="reg" {...collapse} style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>First name</label>
                <input style={inputStyle} placeholder="Sam" value={form.voornaam} onChange={(e) => set("voornaam", e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Last name</label>
                <input style={inputStyle} placeholder="Jansen" value={form.achternaam} onChange={(e) => set("achternaam", e.target.value)} />
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#8A8780", margin: "4px 0 14px", lineHeight: 1.5 }}>
              You can add your shipping address now in your profile, or later at checkout.
            </div>
          </motion.div>
        )}
        </AnimatePresence>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            type="email"
            placeholder="you@email.com"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Password</label>
          <input
            style={inputStyle}
            type="password"
            placeholder="At least 6 characters"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </div>

        <motion.button
          onClick={mode === "login" ? handleLogin : handleRegister}
          disabled={loading}
          whileTap={loading ? undefined : { scale: 0.97 }}
          whileHover={loading ? undefined : { scale: 1.015 }}
          transition={springSnappy}
          style={{
            width: "100%",
            background: loading ? "#E8E6E0" : "#FF5C00",
            color: "#0F0E0C",
            border: "none",
            borderRadius: 12,
            padding: "14px",
            fontSize: 15,
            fontWeight: 700,
            cursor: loading ? "default" : "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {loading ? "One moment..." : mode === "login" ? "Log in" : "Create account"}
        </motion.button>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 11.5, color: "#A8A5A0", lineHeight: 1.5 }}>
          {mode === "register" ? "By creating an account you agree to our " : ""}
          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#8A8780", textDecoration: "underline" }}>Terms</a>
          {" & "}
          <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "#8A8780", textDecoration: "underline" }}>Privacy Policy</a>.
        </div>

        {mode === "login" && (
          <>
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#888" }}>
              No account yet?{" "}
              <span
                onClick={() => setMode("register")}
                style={{ color: "#0F0E0C", fontWeight: 700, cursor: "pointer" }}
              >
                Register
              </span>
            </div>
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <span onClick={handleForgotPassword} style={{ fontSize: 13, color: "#6366F1", fontWeight: 600, cursor: "pointer" }}>
                Forgot password?
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}