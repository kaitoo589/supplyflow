import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { springMorph } from "./motion";
import {
  ffMyGroups, ffPreview, ffCreateGroup, ffJoinGroup, ffLeaveGroup,
  ffKickMember, ffSetHost, ffSetAdmin, ffSetPrivate, ffUpdateSettings, ffAddItem, ffRemoveItem, ffFetchGroup,
  ffSetReady, ffUnready, checkGroupPrices, estimateMemberFee,
  ffPostMessage, ffShareItem, ffReact, ffNudge, ffFetchMessages, subscribeGroup,
  inviteLink, whatsappShare,
} from "./ffApi";

// Native deel-sheet (Apple/Android eigen icoon) met kopieer-fallback.
async function nativeShare(code, name) {
  const url = inviteLink(code);
  const text = `Join my Flowva group "${name || "Squad"}" — we order together so shipping + fees are way cheaper!`;
  if (navigator.share) { try { await navigator.share({ title: "Flowva Friends", text, url }); return true; } catch { return false; } }
  try { await navigator.clipboard?.writeText(`${text} ${url}`); } catch { /* ignore */ }
  return false;
}
const isApple = typeof navigator !== "undefined" && /iphone|ipad|ipod|mac/i.test(navigator.userAgent);
// Apple-deel-icoon (vierkant met pijl omhoog) vs Android (drie verbonden punten).
function ShareGlyph({ size = 16, color = "#9C9893" }) {
  return isApple
    ? <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>
    : <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>;
}

const REACTIONS = ["❤️", "🔥", "😂", "👍"];

const AV_COLORS = ["#FF5C00", "#378ADD", "#16A34A", "#D4537E", "#7F77DD", "#E0A500", "#1D9E75"];

function hashSeed(s) {
  let h = 0; const str = String(s || "?");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function Avatar({ name, url, size = 38, seed }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  // Kleur op een stabiele seed (user_id) zodat twee naamloze leden verschillen.
  const color = AV_COLORS[hashSeed(seed || name || "?") % AV_COLORS.length];
  if (url && url.startsWith("http")) {
    return <img src={url} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initial}</div>
  );
}
// Naam-label: naamloze leden krijgen een kort, stabiel onderscheid i.p.v. allemaal "Friend".
function memberLabel(m, self) {
  if (self) return "You";
  return m.display_name || `Friend ${String(m.user_id || "").slice(0, 4).toUpperCase()}`;
}
// Klein "+"-knopje dat de emoji-keuzes uitklapt om op een bericht te reageren.
function ReactPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} style={{ background: "#1E1D1A", border: "none", borderRadius: 10, padding: "1px 7px", fontSize: 11, cursor: "pointer", color: "#9C9893" }}>＋</button>;
  return <span style={{ display: "flex", gap: 2 }}>{REACTIONS.map((e) => <button key={e} onClick={() => { onPick(e); setOpen(false); }} style={{ background: "#1E1D1A", border: "none", borderRadius: 10, padding: "1px 5px", fontSize: 12, cursor: "pointer" }}>{e}</button>)}</span>;
}

const sheet = { position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#111111", borderRadius: "24px 24px 0 0", zIndex: 401, maxHeight: "90vh", overflowY: "auto", color: "#fff" };
const backdrop = { position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" };
const primaryBtn = { width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" };
const ghostBtn = { width: "100%", background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "12px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" };
const input = { width: "100%", boxSizing: "border-box", background: "#1A1917", border: "1px solid #2c2b29", borderRadius: 12, padding: "12px 14px", fontSize: 14, color: "#fff", outline: "none" };
const label = { fontSize: 12, color: "#9C9893", margin: "0 2px 6px", display: "block" };

// Fee-overzicht (popover via het %-icoon): de tier-tabel + jouw huidige fee.
function FeeInfo({ onClose, members, myTotal, myFee }) {
  const tiers = [
    { n: "Solo", pct: "8%", min: "€5" }, { n: "2", pct: "5%", min: "€4" }, { n: "3", pct: "4%", min: "€3.50" },
    { n: "4", pct: "3.5%", min: "€3" }, { n: "5", pct: "3%", min: "€3" }, { n: "6", pct: "3%", min: "€2.50" }, { n: "7", pct: "2.5%", min: "€2.50" },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 410, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#161513", borderRadius: "20px 20px 0 0", padding: "18px 18px 28px", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800 }}>How the group fee works</div>
          <button onClick={onClose} style={{ background: "#1E1D1A", border: "none", color: "#9C9893", width: 30, height: 30, borderRadius: "50%", fontSize: 14, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55, marginBottom: 14 }}>
          Everyone pays a small service fee on their <b>own</b> items — but the more friends in the group, the lower the % and the lower the minimum. So per person it's cheaper than ordering solo.
        </div>
        <div style={{ background: "#1A1917", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          {tiers.map((t, i) => {
            const active = (t.n === "Solo" && members <= 1) || t.n === String(members);
            return (
              <div key={t.n} style={{ display: "flex", padding: "9px 14px", background: active ? "rgba(255,92,0,0.12)" : "transparent", borderTop: i ? "1px solid #211f1c" : "none" }}>
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "#FF8A3D" : "#C9C6C1" }}>{t.n === "Solo" ? "Just you" : `${t.n} friends`}{active ? " · you" : ""}</div>
                <div style={{ width: 64, fontSize: 12.5, color: "#9C9893", textAlign: "right" }}>{t.pct}</div>
                <div style={{ width: 72, fontSize: 12.5, color: "#9C9893", textAlign: "right" }}>min {t.min}</div>
              </div>
            );
          })}
        </div>
        {myTotal > 0 && (
          <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.5 }}>
            Your items: <b style={{ color: "#fff" }}>€{myTotal.toFixed(2)}</b> · your fee now: <b style={{ color: "#FF8A3D" }}>€{myFee.toFixed(2)}</b>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: "#6b6862", marginTop: 12, lineHeight: 1.5 }}>Shipping is separate and split by weight when the parcel ships — that's where a group saves the most.</div>
      </div>
    </div>
  );
}

export default function Friends({ session, onClose, initialJoinCode, onShopForGroup, activeGroupId }) {
  const myUid = session?.user?.id;
  const [view, setView] = useState(initialJoinCode ? "join" : "list");
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // create
  const [newName, setNewName] = useState("");
  const [newMax, setNewMax] = useState(5);
  // join
  const [code, setCode] = useState(initialJoinCode || "");
  const [preview, setPreview] = useState(null);
  // lobby
  const [openId, setOpenId] = useState(null);
  const [lobby, setLobby] = useState(null); // { group, members, items }
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editMax, setEditMax] = useState(5);
  // ready-up (Fase 3)
  const [readyBusy, setReadyBusy] = useState(false);
  const [flaggedUrls, setFlaggedUrls] = useState([]);
  // social (Fase 4)
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [nudgedAt, setNudgedAt] = useState({});   // userId → epoch ms (cooldown)
  // redesign
  const [showFeeInfo, setShowFeeInfo] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const doShare = async (code, name) => {
    const shared = await nativeShare(code, name);
    if (!shared) { setShareCopied(true); setTimeout(() => setShareCopied(false), 1800); }   // desktop → naar klembord
  };

  const loadGroups = useCallback(async () => {
    setLoading(true);
    const r = await ffMyGroups();
    if (r.ok) setGroups(r.groups || []);
    else setErr(r.error || "Could not load your groups");
    setLoading(false);
  }, []);

  const openIdRef = useRef(null);
  const loadMessages = useCallback(async (id) => {
    const msgs = await ffFetchMessages(id);
    if (openIdRef.current === id) setMessages(msgs);
  }, []);
  const openLobby = useCallback(async (id) => {
    openIdRef.current = id;
    setOpenId(id); setView("lobby"); setLobby(null); setErr(""); setFlaggedUrls([]); setMessages([]);
    const r = await ffFetchGroup(id);
    if (openIdRef.current !== id) return;            // navigatie veranderde tijdens fetch
    if (r.error) { setErr(r.error); return; }
    setLobby(r);
    setEditName(r.group?.name || ""); setEditMax(r.group?.max_size || 5);
    loadMessages(id);
  }, [loadMessages]);
  const refreshLobby = useCallback(async () => {
    const id = openId;
    if (!id) return;
    const r = await ffFetchGroup(id);
    if (!r.error && openIdRef.current === id) setLobby(r);   // negeer late/stale fetch
  }, [openId]);

  useEffect(() => {
    if (initialJoinCode) { setCode(initialJoinCode); doPreview(initialJoinCode); }
    else loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // De busy-vlaggen lezen we via refs, zodat het realtime-kanaal NIET bij elke actie
  // afbreekt+heropent (dat liet events vallen en kon realtime stilleggen).
  const readyBusyRef = useRef(false); const busyRef = useRef(false);
  useEffect(() => { readyBusyRef.current = readyBusy; }, [readyBusy]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Realtime: live updates van leden/items/status/chat (Fase 4). Eén kanaal per groep;
  // bij elke wijziging halen we de groep (en bij een chat-event de berichten) opnieuw op.
  // Een trage fallback-poll (15s) vangt het zeldzame geval op dat realtime wegvalt.
  const lobbyStatus = lobby?.group?.status;
  useEffect(() => {
    if (view !== "lobby" || !openId) return;
    const unsub = subscribeGroup(openId, (table) => {
      if (table === "flowva_group_messages") loadMessages(openId);
      else refreshLobby();
    });
    const t = setInterval(() => { if (!readyBusyRef.current && !busyRef.current) refreshLobby(); }, 15000);
    return () => { unsub(); clearInterval(t); };
  }, [view, openId, refreshLobby, loadMessages]);

  // Groep niet meer in 'gathering' (geplaatst/geannuleerd) → de "Shopping for X"-pil
  // mag weg; je kunt niet meer voor deze groep shoppen.
  useEffect(() => {
    if (lobbyStatus && lobbyStatus !== "gathering" && activeGroupId && lobby?.group?.id === activeGroupId) {
      onShopForGroup?.(null);
    }
  }, [lobbyStatus, activeGroupId, lobby?.group?.id, onShopForGroup]);

  async function doPreview(c) {
    setErr(""); setPreview(null);
    const r = await ffPreview((c ?? code).trim());
    if (!r.ok) { setErr(r.error || "Group not found"); return; }
    setPreview(r);
  }
  async function doCreate() {
    setBusy(true); setErr("");
    const r = await ffCreateGroup(newName.trim() || "Squad", Number(newMax));
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not create group"); return; }
    await openLobby(r.group_id);
  }
  async function doJoin() {
    setBusy(true); setErr("");
    const r = await ffJoinGroup(code.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not join"); return; }
    await openLobby(r.group_id);
  }
  async function doLeave() {
    if (!lobby?.group) return;
    setBusy(true);
    const r = await ffLeaveGroup(lobby.group.id);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not leave"); return; }
    if (activeGroupId === lobby.group.id) onShopForGroup?.(null);
    setView("list"); setOpenId(null); setLobby(null); loadGroups();
  }
  async function doSaveSettings() {
    if (!lobby?.group) return;
    setBusy(true);
    const r = await ffUpdateSettings(lobby.group.id, { name: editName.trim(), maxSize: Number(editMax) });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    setEditing(false); refreshLobby();
  }

  // "Confirm & pay": eerst de price-guard (zoals solo-checkout), dan ff_set_ready
  // (server-side prijs + geld vasthouden; plaatst de groep zodra iedereen ready is).
  async function doReady() {
    if (!lobby?.group) return;
    setErr(""); setReadyBusy(true);
    try {
      const myItems = (lobby.items || []).filter((it) => it.owner_id === myUid);
      const chk = await checkGroupPrices(myItems);
      setFlaggedUrls(chk.urls);   // vervang (niet stapelen) → on-hold verdwijnt zodra de prijs weer klopt
      if (chk.changed) {
        setErr("A supplier price just changed — that item is on hold. Remove it (or check back soon) and try again. You haven't been charged.");
        return;
      }
      const r = await ffSetReady(lobby.group.id);
      if (!r.ok) {
        setErr(r.error === "Insufficient balance"
          ? `Insufficient balance — you need €${Number(r.needed || 0).toFixed(2)}. Top up first, then confirm.`
          : r.error || "Could not confirm");
        return;
      }
      await refreshLobby();   // haalt het echte held_amount op vóór de knop weer aangaat
    } finally {
      setReadyBusy(false);
    }
  }
  async function doUnready() {
    if (!lobby?.group) return;
    setErr(""); setReadyBusy(true);
    try {
      const r = await ffUnready(lobby.group.id);
      if (!r.ok) { setErr(r.error || "Could not cancel"); return; }
      await refreshLobby();
    } finally {
      setReadyBusy(false);
    }
  }

  // ── Social (Fase 4) ──────────────────────────────────────────────────────
  async function doNudge(targetUserId) {
    setNudgedAt((p) => ({ ...p, [targetUserId]: Date.now() }));   // optimistische cooldown
    const r = await ffNudge(lobby.group.id, targetUserId);
    if (!r.ok) { setErr(r.error || "Could not nudge"); setNudgedAt((p) => ({ ...p, [targetUserId]: 0 })); }
  }
  async function doPostMessage() {
    const body = chatInput.trim();
    if (!body || !lobby?.group) return;
    setChatInput("");
    const r = await ffPostMessage(lobby.group.id, body);
    if (!r.ok) { setErr(r.error || "Could not send"); setChatInput((cur) => cur ? cur : body); return; }
    loadMessages(lobby.group.id);
  }
  async function doShareItem(itemId) {
    if (!lobby?.group) return;
    const r = await ffShareItem(lobby.group.id, itemId);
    if (!r.ok) setErr(r.error || "Could not share");
    else loadMessages(lobby.group.id);
  }
  async function doReact(messageId, emoji) {
    const r = await ffReact(messageId, emoji);
    if (r.ok) loadMessages(lobby.group.id);
  }
  // Een gedeeld item overnemen in je eigen mand.
  async function doAddShared(it) {
    if (!lobby?.group || !it) return;
    const r = await ffAddItem(lobby.group.id, {
      source_url: it.source_url, product_title: it.product_title, platform: it.platform,
      price: it.price, qty: 1, kleur: it.kleur, variant_image: it.variant_image,
    });
    if (!r.ok) setErr(r.error || "Could not add"); else refreshLobby();
  }

  const copyLink = (c) => { try { navigator.clipboard?.writeText(inviteLink(c)); } catch { /* ignore */ } };

  // ── Views ──────────────────────────────────────────────────────────────────
  const iconBtn = (key, onClick, label, child) => (
    <button key={key} onClick={onClick} aria-label={label} title={label}
      style={{ background: "#1E1D1A", border: "none", color: "#9C9893", width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>{child}</button>
  );
  const header = (title, back, extra) => (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "16px 18px 8px" }}>
      {back && <button onClick={back} style={{ background: "none", border: "none", color: "#9C9893", fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0 }}>‹</button>}
      <div style={{ fontSize: 18, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      {extra}
      {iconBtn("close", onClose, "close", "✕")}
    </div>
  );
  const errLine = err ? <div style={{ background: "#3a1414", color: "#F0997B", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, margin: "0 18px 10px" }}>{err}</div> : null;

  let body;
  if (view === "list") {
    body = (
      <>
        {header("🦊 Flowva Friends")}
        <div style={{ padding: "0 18px 4px", fontSize: 12.5, color: "#9C9893", lineHeight: 1.5 }}>Order together with friends — share one delivery so shipping and fees get way cheaper per person.</div>
        {errLine}
        <div style={{ padding: "12px 18px 6px" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "#777", padding: "20px 0", fontSize: 13 }}>Loading…</div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: "center", color: "#777", padding: "16px 0", fontSize: 13 }}>No groups yet — create one or join with a link.</div>
          ) : groups.map((g) => (
            <button key={g.group_id} onClick={() => openLobby(g.group_id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#1A1917", border: "none", borderRadius: 14, padding: "12px 14px", marginBottom: 8, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🦊</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{g.name}{g.role === "admin" ? " · admin" : ""}</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>{g.member_count}/{g.max_size} friends{activeGroupId === g.group_id ? " · shopping now" : ""}</div>
              </div>
              <span style={{ color: "#555", fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
        <div style={{ padding: "8px 18px 28px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button style={primaryBtn} onClick={() => { setErr(""); setNewName(""); setNewMax(5); setView("create"); }}>+ Create a group</button>
          <button style={ghostBtn} onClick={() => { setErr(""); setCode(""); setPreview(null); setView("join"); }}>Join with a code</button>
        </div>
      </>
    );
  } else if (view === "create") {
    body = (
      <>
        {header("Create a group", () => setView("list"))}
        {errLine}
        <div style={{ padding: "8px 18px 28px" }}>
          <label style={label}>Group name</label>
          <input style={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Squad" maxLength={40} />
          <label style={{ ...label, marginTop: 16 }}>Max friends</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} onClick={() => setNewMax(n)}
                style={{ flex: 1, background: newMax === n ? "#FF5C00" : "#1A1917", color: newMax === n ? "#fff" : "#9C9893", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{n}</button>
            ))}
          </div>
          <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doCreate}>{busy ? "Creating…" : "Create group →"}</button>
        </div>
      </>
    );
  } else if (view === "join") {
    body = (
      <>
        {header("Join a group", initialJoinCode ? onClose : () => setView("list"))}
        {errLine}
        <div style={{ padding: "8px 18px 28px" }}>
          <label style={label}>Invite code</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...input, textTransform: "uppercase" }} value={code} onChange={(e) => { setCode(e.target.value); setPreview(null); }} placeholder="ABC123" maxLength={6} />
            <button style={{ background: "#1E1D1A", border: "1px solid #2c2b29", color: "#FF5C00", borderRadius: 12, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => doPreview()}>Check</button>
          </div>
          {preview && (
            <div style={{ background: "#1A1917", borderRadius: 14, padding: "14px", marginTop: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{preview.name}</div>
              <div style={{ fontSize: 12.5, color: "#9C9893", marginTop: 2 }}>{preview.member_count}/{preview.max_size} friends · {preview.is_private ? "🔒 private — invite only" : preview.status === "gathering" ? "open to join" : "closed"}</div>
              <button style={{ ...primaryBtn, marginTop: 14, opacity: busy || preview.is_full || preview.is_private || preview.status !== "gathering" ? 0.5 : 1 }}
                disabled={busy || preview.is_full || preview.is_private || preview.status !== "gathering"} onClick={doJoin}>
                {preview.is_private ? "Private group" : preview.is_full ? "Group is full" : preview.status !== "gathering" ? "Group is closed" : busy ? "Joining…" : `Join ${preview.name} →`}
              </button>
            </div>
          )}
        </div>
      </>
    );
  } else if (view === "lobby") {
    const g = lobby?.group;
    const isAdmin = g && g.admin_id === myUid;
    const itemsByOwner = (lobby?.items || []).reduce((acc, it) => { (acc[it.owner_id] ||= []).push(it); return acc; }, {});
    const isPlaced = g && g.status !== "gathering";
    const members = lobby?.members || [];
    const readyCount = members.filter((m) => m.ready).length;
    const myItems = (lobby?.items || []).filter((it) => it.owner_id === myUid);
    const myTotal = myItems.reduce((s, it) => s + (Number(it.price) || 0) * Math.max(Number(it.qty) || 1, 1), 0);
    const myFee = estimateMemberFee(members.length, myTotal);
    const myCharge = Math.round((myTotal + myFee) * 100) / 100;
    const meMember = members.find((m) => m.user_id === myUid);
    const iAmReady = !!meMember?.ready;
    const meHeld = Number(meMember?.held_amount) || 0;   // het ECHTE vastgehouden bedrag (server-side)
    const priceUnknown = myItems.some((it) => it.price == null || isNaN(Number(it.price)));  // prijs nog niet bekend → niet laten betalen
    const isSolo = members.length === 1;
    const someFlagged = myItems.some((it) => flaggedUrls.includes(it.source_url));
    // JOUW fee-besparing: wat je solo aan fee zou betalen vs. in deze groep (exact).
    const myFeeSavings = myTotal > 0 ? Math.round((estimateMemberFee(1, myTotal) - myFee) * 100) / 100 : 0;
    body = (
      <>
        {header(g ? g.name : "Group", () => { setErr(""); openIdRef.current = null; setView("list"); loadGroups(); },
          g && (
            <>
              {iconBtn("fee", () => setShowFeeInfo(true), "Fee breakdown", <span style={{ fontWeight: 800, fontSize: 13 }}>%</span>)}
              {iconBtn("share", () => doShare(g.invite_code, g.name), "Share invite", <ShareGlyph />)}
              {isAdmin && !isPlaced && iconBtn("settings", () => setEditing((v) => !v), "Group settings", <span style={{ fontSize: 14 }}>⚙️</span>)}
            </>
          ))}
        {errLine}
        {!g ? (
          <div style={{ textAlign: "center", color: "#777", padding: "30px 0", fontSize: 13 }}>Loading group…</div>
        ) : (
          <div style={{ padding: "0 18px 28px" }}>
            {/* invite */}
            <div style={{ background: "#1A1917", borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: "#9C9893", marginBottom: 8 }}>Invite link · code <b style={{ color: "#fff", letterSpacing: 1 }}>{g.invite_code}</b></div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={whatsappShare(g.invite_code, g.name)} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: "center", background: "#FF5C00", color: "#fff", borderRadius: 10, padding: "10px", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>Share on WhatsApp</a>
                <button onClick={() => copyLink(g.invite_code)} style={{ background: "#1E1D1A", border: "1px solid #2c2b29", color: "#C9C6C1", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Copy link</button>
              </div>
            </div>

            {/* members */}
            <div style={{ fontSize: 12, color: "#9C9893", margin: "0 2px 8px" }}>
              Squad · {members.length}/{g.max_size}
              <span style={{ color: readyCount === members.length && members.length > 0 ? "#34D17B" : "#9C9893" }}> · {readyCount} ready</span>
            </div>
            {members.map((m) => {
              const self = m.user_id === myUid;
              const mCount = (itemsByOwner[m.user_id] || []).length;
              const nudgeCooled = Date.now() - (nudgedAt[m.user_id] || 0) < 60000;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 0" }}>
                  <Avatar name={m.display_name} url={m.avatar_url} seed={m.user_id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {memberLabel(m, self)}
                      {m.role === "admin" && <span style={{ color: "#FF5C00", fontSize: 11, marginLeft: 6 }}>admin</span>}
                      {g.host_id === m.user_id && <span style={{ color: "#9C9893", fontSize: 11, marginLeft: 6 }}>🏠 host</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#9C9893" }}>{mCount} item{mCount === 1 ? "" : "s"}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {m.ready
                      ? <span style={{ background: "rgba(22,163,74,0.16)", color: "#34D17B", borderRadius: 8, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>✓ ready</span>
                      : (!isPlaced && mCount === 0)
                        ? <span style={{ background: "rgba(224,165,0,0.14)", color: "#E0A500", borderRadius: 8, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>needs items</span>
                        : <span style={{ color: "#6b6862", fontSize: 11 }}>not ready</span>}
                    {!self && !isPlaced && !m.ready && mCount > 0 && (
                      <button disabled={nudgeCooled} onClick={() => doNudge(m.user_id)}
                        style={{ background: nudgeCooled ? "#1E1D1A" : "rgba(255,92,0,0.14)", border: "none", color: nudgeCooled ? "#6b6862" : "#FF5C00", borderRadius: 8, padding: "5px 9px", fontSize: 11, fontWeight: 700, cursor: nudgeCooled ? "default" : "pointer" }}>
                        {nudgeCooled ? "nudged ✓" : "👋 nudge"}
                      </button>
                    )}
                    {isAdmin && !self && !isPlaced && (
                      <>
                        {g.host_id !== m.user_id && <button onClick={async () => { const r = await ffSetHost(g.id, m.user_id); if (r && !r.ok) setErr(r.error); refreshLobby(); }} style={{ background: "#1E1D1A", border: "none", color: "#9C9893", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>host</button>}
                        <button onClick={async () => { if (!window.confirm(`Make ${memberLabel(m, false)} the admin? You'll hand over control and can't undo this yourself.`)) return; const r = await ffSetAdmin(g.id, m.user_id); if (r && !r.ok) setErr(r.error); refreshLobby(); }} style={{ background: "rgba(255,92,0,0.12)", border: "none", color: "#FF5C00", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>make admin</button>
                        <button onClick={async () => { const r = await ffKickMember(g.id, m.user_id); if (r && !r.ok) setErr(r.error); refreshLobby(); }} style={{ background: "rgba(226,75,74,0.14)", border: "none", color: "#E24B4A", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>remove</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* personal fee savings (exact) */}
            {myFeeSavings > 0 && (
              <div style={{ marginTop: 12, background: "linear-gradient(180deg,#26211c,#1A1917)", border: "1px solid rgba(255,92,0,0.2)", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>💸</span>
                <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.45 }}>
                  <b style={{ color: "#FF8A3D" }}>You save €{myFeeSavings.toFixed(2)}</b> in fees by ordering in this group instead of solo{members.length >= 2 ? "" : " — it grows as friends join"}.
                </div>
              </div>
            )}

            {/* shared cart */}
            <div style={{ fontSize: 12, color: "#9C9893", margin: "16px 2px 8px" }}>Shared cart</div>
            {(lobby.items || []).length === 0 ? (
              <div style={{ background: "#1A1917", borderRadius: 14, padding: "16px", textAlign: "center", color: "#777", fontSize: 12.5 }}>Nothing added yet. Tap "Shop for this group" and add products from the feed.</div>
            ) : (
              members.map((m) => {
                const its = itemsByOwner[m.user_id] || [];
                if (!its.length) return null;
                const self = m.user_id === myUid;
                return (
                  <div key={"items-" + m.id} style={{ background: "#1A1917", borderRadius: 14, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, color: "#9C9893", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
                      <Avatar name={m.display_name} url={m.avatar_url} size={20} seed={m.user_id} />{memberLabel(m, self)}
                    </div>
                    {its.map((it) => (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: "#26211c", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {it.variant_image?.startsWith("http") ? <img src={it.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 15 }}>📦</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.product_title}</div>
                          <div style={{ fontSize: 11, color: "#9C9893" }}>
                            {it.kleur ? `${it.kleur} · ` : ""}{it.price != null ? `€${Number(it.price).toFixed(2)}` : ""}{it.qty > 1 ? ` · ${it.qty}×` : ""}
                            {flaggedUrls.includes(it.source_url) && <span style={{ color: "#F0997B", marginLeft: 6 }}>· on hold</span>}
                          </div>
                        </div>
                        {self && !isPlaced && <button onClick={() => doShareItem(it.id)} title="Share to chat" style={{ background: "none", border: "none", color: "#777", fontSize: 14, cursor: "pointer" }}>↗</button>}
                        {self && !isPlaced && <button onClick={async () => { const r = await ffRemoveItem(it.id); if (r && !r.ok) setErr(r.error); refreshLobby(); }} style={{ background: "none", border: "none", color: "#777", fontSize: 14, cursor: "pointer" }}>✕</button>}
                      </div>
                    ))}
                  </div>
                );
              })
            )}

            {/* admin settings — geopend via het ⚙️-icoon in de header */}
            {isAdmin && !isPlaced && editing && (
              <div style={{ marginTop: 12, background: "#1A1917", borderRadius: 14, padding: "12px 14px" }}>
                <label style={label}>Group name</label>
                <input style={input} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={40} />
                <label style={{ ...label, marginTop: 12 }}>Max friends (min {lobby.members.length})</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <button key={n} disabled={n < lobby.members.length} onClick={() => setEditMax(n)}
                      style={{ flex: 1, background: editMax === n ? "#FF5C00" : "#26211c", color: n < lobby.members.length ? "#555" : editMax === n ? "#fff" : "#9C9893", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: n < lobby.members.length ? "default" : "pointer" }}>{n}</button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0 12px", borderTop: "1px solid #2c2b29", marginTop: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Private group</div>
                    <div style={{ fontSize: 11, color: "#9C9893" }}>{g.is_private ? "Locked — no one new can join" : "Anyone with the link can join"}</div>
                  </div>
                  <div onClick={async () => { const r = await ffSetPrivate(g.id, !g.is_private); if (r && !r.ok) setErr(r.error); refreshLobby(); }}
                    role="switch" aria-checked={!!g.is_private}
                    style={{ width: 44, height: 26, borderRadius: 999, background: g.is_private ? "#FF5C00" : "#3a3a37", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .2s" }}>
                    <div style={{ position: "absolute", top: 3, left: g.is_private ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...primaryBtn, padding: "11px" }} disabled={busy} onClick={doSaveSettings}>Save name & size</button>
                  <button style={{ ...ghostBtn, width: "auto", padding: "11px 16px" }} onClick={() => setEditing(false)}>Close</button>
                </div>
                <div style={{ fontSize: 10.5, color: "#6b6862", marginTop: 10, lineHeight: 1.5 }}>Tip: hand over admin or host on any member above. Make someone else admin and these settings move to them.</div>
              </div>
            )}

            {/* actions */}
            {isPlaced ? (
              <div style={{ marginTop: 18, background: "linear-gradient(180deg,#1f2a20,#1A1917)", border: "1px solid rgba(52,209,123,0.25)", borderRadius: 16, padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 32 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>Order placed!</div>
                <div style={{ fontSize: 12.5, color: "#C9C6C1", marginTop: 6, lineHeight: 1.55 }}>
                  Everyone confirmed and paid — your group order is locked in and being prepared. You can still look back at what everyone ordered here.
                </div>
              </div>
            ) : (
              <>
                {/* confirm & pay */}
                <div style={{ marginTop: 18, background: "#1A1917", borderRadius: 16, padding: "14px" }}>
                  <div style={{ fontSize: 12, color: "#9C9893", marginBottom: 10 }}>{readyCount} of {members.length} ready</div>
                  {myItems.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55 }}>
                      Add at least one item to the shared cart before you confirm — tap <b style={{ color: "#fff" }}>Shop for this group</b> below.
                    </div>
                  ) : iAmReady ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#34D17B", fontWeight: 700, fontSize: 14 }}>✓ You're ready — waiting for your friends</div>
                      <div style={{ fontSize: 11.5, color: "#9C9893", marginTop: 6, lineHeight: 1.55 }}>
                        €{(meHeld || myCharge).toFixed(2)} is taken from your balance and held for the group — refunded automatically the moment anyone joins, leaves or edits a cart. The order places by itself once everyone's ready.
                      </div>
                      <button style={{ ...ghostBtn, marginTop: 12 }} disabled={readyBusy} onClick={doUnready}>{readyBusy ? "…" : "Cancel & get my money back"}</button>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#C9C6C1", marginBottom: 5 }}><span>Your items</span><span>{priceUnknown ? "…" : `€${myTotal.toFixed(2)}`}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#C9C6C1", marginBottom: 8 }}><span>{isSolo ? "Service fee (just you)" : `Group fee · ${members.length} friends`}</span><span>€{myFee.toFixed(2)}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: "#fff", borderTop: "1px solid #2c2b29", paddingTop: 8 }}><span>You pay</span><span>{priceUnknown ? "…" : `€${myCharge.toFixed(2)}`}</span></div>
                      {isSolo && <div style={{ fontSize: 10.5, color: "#9C9893", marginTop: 6, lineHeight: 1.5 }}>The fee drops as friends join — invite someone before you confirm to split it cheaper.</div>}
                      {priceUnknown ? (
                        <button style={{ ...primaryBtn, marginTop: 12, opacity: 0.6 }} disabled>Updating prices — try again in a moment</button>
                      ) : (
                        <button style={{ ...primaryBtn, marginTop: 12, opacity: readyBusy ? 0.6 : 1, background: someFlagged ? "#E0A500" : "#FF5C00" }} disabled={readyBusy} onClick={doReady}>
                          {readyBusy ? "Confirming…" : someFlagged ? "Price changed — re-check & pay" : `Confirm & pay €${myCharge.toFixed(2)}`}
                        </button>
                      )}
                      <div style={{ fontSize: 10.5, color: "#6b6862", marginTop: 8, textAlign: "center", lineHeight: 1.5 }}>Taken from your balance and held for the group — refunded automatically if anything changes before the order locks.</div>
                    </>
                  )}
                </div>

                <button style={{ ...ghostBtn, marginTop: 12, color: activeGroupId === g.id ? "#34D17B" : "#FF5C00", borderColor: activeGroupId === g.id ? "rgba(52,209,123,0.3)" : "rgba(255,92,0,0.3)" }}
                  onClick={() => { if (activeGroupId === g.id) { onShopForGroup?.(null); } else { onShopForGroup?.({ id: g.id, name: g.name }); onClose?.(); } }}>
                  {activeGroupId === g.id ? "✓ Shopping here — tap to stop" : "+ Shop for this group"}
                </button>
                <button style={{ ...ghostBtn, marginTop: 8, color: "#E24B4A", borderColor: "rgba(226,75,74,0.3)" }} disabled={busy} onClick={doLeave}>Leave group</button>
              </>
            )}

            {/* squad chat — morphing icoon ↔ paneel */}
            <div style={{ marginTop: 22 }}>
              <AnimatePresence initial={false}>
                {!chatOpen ? (
                  <motion.button key="chatpill" layoutId="ff-chat" transition={springMorph} onClick={() => setChatOpen(true)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "#161513", border: "1px solid #2c2b29", borderRadius: 14, padding: "12px 14px", cursor: "pointer", color: "#fff" }}>
                    <span style={{ fontSize: 18 }}>💬</span>
                    <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Squad chat</div>
                      <div style={{ fontSize: 11, color: "#9C9893" }}>{messages.length ? `${messages.length} message${messages.length === 1 ? "" : "s"} — tap to open` : "Say hi to your squad 👋"}</div>
                    </div>
                    <span style={{ color: "#6b6862", fontSize: 15 }}>▾</span>
                  </motion.button>
                ) : (
                  <motion.div key="chatpanel" layoutId="ff-chat" transition={springMorph}
                    style={{ background: "#161513", borderRadius: 14, padding: "10px 12px", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#fff" }}>💬 Squad chat</div>
                      <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", color: "#9C9893", fontSize: 16, cursor: "pointer" }}>▴</button>
                    </div>
                    <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 9, marginBottom: 9 }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#6b6862", fontSize: 12, padding: "12px 0" }}>No messages yet — say hi 👋</div>
                ) : messages.map((msg) => {
                  const mine = msg.user_id === myUid;
                  const author = members.find((m) => m.user_id === msg.user_id);
                  const name = msg.user_id ? (author ? memberLabel(author, mine) : "Friend") : "Flowva";
                  const sharedItem = msg.kind === "share" ? ((msg.item_id && (lobby.items || []).find((it) => it.id === msg.item_id)) || msg.product || null) : null;
                  return (
                    <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 3 }}>
                      <div style={{ fontSize: 10, color: "#6b6862", padding: "0 4px" }}>{name}</div>
                      {msg.kind === "share" && sharedItem ? (
                        <div style={{ background: "#221d18", border: "1px solid #2c2b29", borderRadius: 12, padding: 8, maxWidth: "88%", display: "flex", gap: 9, alignItems: "center" }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: "#26211c", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {sharedItem.variant_image?.startsWith("http") ? <img src={sharedItem.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{sharedItem.product_title}</div>
                            <div style={{ fontSize: 10.5, color: "#9C9893" }}>{sharedItem.price != null ? `€${Number(sharedItem.price).toFixed(2)}` : "shared an item"}</div>
                            {!isPlaced && sharedItem.owner_id !== myUid && <button onClick={() => doAddShared(sharedItem)} style={{ marginTop: 5, background: "rgba(255,92,0,0.16)", border: "none", color: "#FF5C00", borderRadius: 8, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Add to my cart</button>}
                          </div>
                        </div>
                      ) : (
                        <div style={{ background: mine ? "#FF5C00" : "#222", color: mine ? "#fff" : "#eee", borderRadius: 12, padding: "7px 11px", fontSize: 13, maxWidth: "80%", wordBreak: "break-word" }}>{msg.body}</div>
                      )}
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        {Object.entries(msg.reactions || {}).map(([emoji, uids]) => (
                          <button key={emoji} onClick={() => doReact(msg.id, emoji)}
                            style={{ background: (uids || []).includes(myUid) ? "rgba(255,92,0,0.2)" : "#1E1D1A", border: "none", borderRadius: 10, padding: "1px 6px", fontSize: 11, cursor: "pointer", color: "#ddd" }}>{emoji} {(uids || []).length}</button>
                        ))}
                        <ReactPicker onPick={(e) => doReact(msg.id, e)} />
                      </div>
                    </div>
                  );
                })}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input style={{ ...input, padding: "10px 12px" }} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doPostMessage(); }} placeholder="Message your squad…" maxLength={500} />
                      <button onClick={doPostMessage} style={{ background: "#FF5C00", border: "none", color: "#fff", borderRadius: 12, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Send</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {showFeeInfo && <FeeInfo onClose={() => setShowFeeInfo(false)} members={members.length} myTotal={myTotal} myFee={myFee} />}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div style={backdrop} onClick={onClose} />
      <div style={sheet}>
        <div style={{ padding: "8px 0 0", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2 }} />
        </div>
        {body}
      </div>
      {shareCopied && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 420, background: "#0F0E0C", color: "#fff", borderRadius: 999, padding: "10px 18px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>🔗 Invite link copied!</div>
      )}
    </>
  );
}
