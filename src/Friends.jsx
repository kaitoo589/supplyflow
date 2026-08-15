import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { springMorph } from "./motion";
import Fox from "./Fox";
import { tr } from "./i18n";
import { exactTopUp, startTopUp, TOPUP_MIN } from "./topup";
import {
  ffMyGroups, ffPreview, ffCreateGroup, ffJoinGroup, ffLeaveGroup,
  ffKickMember, ffSetHost, ffSetAdmin, ffSetPrivate, ffUpdateSettings, ffAddItem, ffRemoveItem, ffFetchGroup,
  ffCartCheckout, ffCartRemove, ffCartSetQty,
  ffSetReady, ffUnready, ffShipLocked, estimateMemberFee, ffSyncProfile,
  ffPostMessage, ffReact, ffNudge, ffFetchMessages, subscribeGroup,
  inviteLink, whatsappShare,
} from "./ffApi";

// Native deel-sheet (Apple/Android eigen icoon) met kopieer-fallback.
async function nativeShare(code, name) {
  const url = inviteLink(code);
  const text = `Join my Flowva squad "${name || "Squad"}" 🧡 We shop factory-direct together, so we both save up to 50% on fees & shipping — tap to join:`;
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

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const AV_COLORS = ["#FF5C00", "#378ADD", "#16A34A", "#D4537E", "#7F77DD", "#E0A500", "#1D9E75"];

function hashSeed(s) {
  let h = 0; const str = String(s || "?");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
// Alleen avatars vanaf onze eigen Supabase-storage renderen — anders kan een lid een
// avatar_url naar een eigen host zetten en zo de IP's van squadgenoten harvesten.
const isStorageUrl = (url) => typeof url === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\//i.test(url);
function Avatar({ name, url, size = 38, seed }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  // Kleur op een stabiele seed (user_id) zodat twee naamloze leden verschillen.
  const color = AV_COLORS[hashSeed(seed || name || "?") % AV_COLORS.length];
  if (isStorageUrl(url)) {
    return <img src={url} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initial}</div>
  );
}
// Naam-label: naamloze leden krijgen een kort, stabiel onderscheid i.p.v. allemaal "Friend".
// Cap op 40 tekens zodat een mega-naam de lobby/chat niet breekt.
function memberLabel(m, self) {
  if (self) return "You";
  const n = m.display_name ? String(m.display_name).slice(0, 40) : "";
  return n || `Friend ${String(m.user_id || "").slice(0, 4).toUpperCase()}`;
}

// Zwevende kaart — identiek aan de solo-mand (Winkelmandje), mét een oranje gloeiende
// rand als squad-cue. Zweeft boven de nav (bottom 86), alle hoeken rond, raakt de
// schermranden nergens. Zo morpht 'ie ook puur omhoog uit de squad-balk (gedeelde layoutId).
const sheet = { position: "fixed", bottom: 86, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 24px)", maxWidth: 404, boxSizing: "border-box", background: "#111111", borderRadius: 28, zIndex: 401, maxHeight: "80vh", overflowY: "auto", overscrollBehavior: "contain", color: "#fff", border: "1px solid rgba(255,92,0,0.55)", boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 16px rgba(255,92,0,0.35)" };
const backdrop = { position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" };
const primaryBtn = { width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" };
const ghostBtn = { width: "100%", background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "12px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" };
const input = { width: "100%", boxSizing: "border-box", background: "#1A1917", border: "1px solid #2c2b29", borderRadius: 12, padding: "12px 14px", fontSize: 14, color: "#fff", outline: "none" };
const label = { fontSize: 12, color: "#9C9893", margin: "0 2px 6px", display: "block" };

// "Why ordering together is cheaper"-popover (via het info-icoon). Twee kopjes:
// 1) verzending (de grootste besparing), 2) de groeps-fee + tier-tabel.
function FeeInfo({ onClose, members, myTotal, myFee }) {
  // Spiegelt public.ff_member_fee (de ECHTE staffel) — houd in sync met estimateMemberFee in ffApi.
  const tiers = [
    { n: "Solo", pct: "8%", min: "€5" }, { n: "2", pct: "7%", min: "€4.50" }, { n: "3", pct: "6%", min: "€4.50" },
    { n: "4", pct: "5.5%", min: "€4" }, { n: "5", pct: "5%", min: "€4" }, { n: "6", pct: "4.5%", min: "€4" }, { n: "7", pct: "4%", min: "€3.50" },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 410, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={springMorph}
        onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#161513", borderRadius: "20px 20px 0 0", padding: "18px 18px 28px", color: "#fff", maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800 }}>Why ordering together is cheaper</div>
          <button onClick={onClose} style={{ background: "#1E1D1A", border: "none", color: "#9C9893", width: 30, height: 30, borderRadius: "50%", fontSize: 14, cursor: "pointer" }}>✕</button>
        </div>

        {/* 1 — verzending: de grootste besparing */}
        <div style={{ background: "linear-gradient(180deg,#2a2118,#1A1917)", border: "1px solid rgba(255,92,0,0.28)", borderRadius: 14, padding: "14px", marginBottom: 16 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "#FF8A3D", lineHeight: 1.35 }}>📦 The heavier the parcel, the cheaper shipping gets per item</div>
          <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.6, marginTop: 9 }}>
            International shipping is priced <b>per parcel</b>, not per item — a fixed first-weight block plus a rate for every extra kilo. Order solo and you pay that whole first block by yourself. Order together and your squad ships in <b>one combined parcel</b>, so that single first block is split across everyone by weight. The more friends join and the more you all add, the less each kilo costs <b style={{ color: "#fff" }}>you</b>. This is where a group saves the most.
          </div>
        </div>

        {/* 2 — de fee */}
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>How the group fee works</div>
        <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55, marginBottom: 12 }}>
          Everyone pays a small service fee on their <b>own</b> items — but the more friends in the group, the lower the % and the lower the minimum. So per person it's cheaper than solo.
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
      </motion.div>
    </div>
  );
}

// "About the admin"-popover (via het admin-icoon). De admin beheert de groep én ontvangt het pakket.
function AdminInfo({ onClose, adminName }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 410, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={springMorph}
        onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#161513", borderRadius: "20px 20px 0 0", padding: "18px 18px 28px", color: "#fff", maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800 }}>The group admin</div>
          <button onClick={onClose} style={{ background: "#1E1D1A", border: "none", color: "#9C9893", width: 30, height: 30, borderRadius: "50%", fontSize: 14, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ background: "linear-gradient(180deg,#2a2118,#1A1917)", border: "1px solid rgba(255,92,0,0.28)", borderRadius: 14, padding: "14px", marginBottom: 14 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "#FF8A3D", lineHeight: 1.35 }}>🏠 The admin receives the parcel</div>
          <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.6, marginTop: 9 }}>
            Everyone's items ship in <b>one combined parcel</b> to the <b style={{ color: "#fff" }}>admin</b>{adminName ? <> (<b style={{ color: "#fff" }}>{adminName}</b>)</> : null}. The admin collects it and hands everyone their items — so the admin should be someone the group trusts with the delivery address.
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>What the admin can do</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.75 }}>
          <li>Change the group's <b style={{ color: "#fff" }}>name</b> and <b style={{ color: "#fff" }}>size</b></li>
          <li><b style={{ color: "#fff" }}>Nudge</b> or <b style={{ color: "#fff" }}>remove</b> members and hand over admin</li>
          <li>Is the <b style={{ color: "#fff" }}>host</b> — receives the combined parcel for the whole squad</li>
        </ul>
        <div style={{ fontSize: 11.5, color: "#6b6862", marginTop: 14, lineHeight: 1.5 }}>Hand over by tapping a member and choosing "make admin" — the new admin then receives the parcel.</div>
      </motion.div>
    </div>
  );
}

export default function Friends({ session, onClose, initialJoinCode, initialGroupId, onShopForGroup, onOpenProduct, activeGroupId, balance }) {
  const myUid = session?.user?.id;
  const myAvatar = session?.user?.user_metadata?.avatar_url || null;   // mijn live foto (member-rij kan verouderd zijn)
  const avatarOf = (m) => (m && m.user_id === myUid ? (myAvatar || m.avatar_url) : (m && m.avatar_url));
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
  const [cartBusy, setCartBusy] = useState(false);   // gedeelde-mand checkout bezig
  const [cartErr, setCartErr] = useState("");        // checkout-foutmelding
  const [cartNeeded, setCartNeeded] = useState(null); // wat ff_cart_checkout server-side nodig had (te weinig saldo)
  // BUG-FIX 15-08: "Go to checkout" betaalde DIRECT — ffCartCheckout schrijft meteen af,
  // er was nooit een tussenstap. Nu een echte bevestigingsstap, net als de solo-mand:
  // klik 1 klapt het akkoord-blok uit (Terms + retour + 14 dagen), klik 2 betaalt pas.
  const [cartConfirm, setCartConfirm] = useState(false);
  const [cartAgree, setCartAgree] = useState(false);
  const [topping, setTopping] = useState(false);      // opwaarderen midden in de checkout
  const [topErr, setTopErr] = useState("");
  // Verzend-lock (user 2026-07-22): zodra de admin de verzending lockt is de mand dicht —
  // geen checkout meer (server weigert 't sowieso; hier tonen we 't proactief). De groep-
  // status blijft 'gathering', dus dit is het enige betrouwbare signaal.
  const [shipLocked, setShipLocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editMax, setEditMax] = useState(5);
  const [editWindow, setEditWindow] = useState(15);
  // ready-up (Fase 3)
  const [readyBusy, setReadyBusy] = useState(false);
  // social (Fase 4)
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [nudgedAt, setNudgedAt] = useState({});   // userId → epoch ms (cooldown)
  const [reactingId, setReactingId] = useState(null);   // bericht-id met open WhatsApp-reactiebalk
  const pressTimer = useRef(null);
  const pressStart = useRef({ x: 0, y: 0 });
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  const startPress = (id, e) => { endPress(); pressStart.current = { x: e.clientX, y: e.clientY }; pressTimer.current = setTimeout(() => setReactingId(id), 380); };
  const movePress = (e) => { if (pressTimer.current && (Math.abs(e.clientX - pressStart.current.x) > 10 || Math.abs(e.clientY - pressStart.current.y) > 10)) endPress(); };
  // Long-press-handlers (scroll/drag annuleert de press → geen reactiebalk bij scrollen).
  const pressProps = (id) => ({ onPointerDown: (e) => startPress(id, e), onPointerMove: movePress, onPointerUp: endPress, onPointerLeave: endPress, onPointerCancel: endPress, onContextMenu: (e) => e.preventDefault() });
  useEffect(() => () => endPress(), []);                        // timer opruimen bij unmount
  // redesign
  const [showFeeInfo, setShowFeeInfo] = useState(false);
  const [showAdminInfo, setShowAdminInfo] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  useEffect(() => { if (!chatOpen) setReactingId(null); }, [chatOpen]);   // chat dicht → reactiebalk weg
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
    if (r.error || !r.group) {
      // Niet meer beschikbaar (geen lid meer / weg) → niet vastlopen: terug naar de lijst.
      setErr("That group is no longer available.");
      if (initialGroupId) onShopForGroup?.(null);    // verouderde actieve groep opruimen
      openIdRef.current = null; setOpenId(null); setView("list"); loadGroups();
      return;
    }
    setLobby(r);
    setEditName(r.group?.name || ""); setEditMax(r.group?.max_size || 5); setEditWindow(r.group?.order_window_days || 15);
    loadMessages(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMessages, initialGroupId]);
  const refreshLobby = useCallback(async () => {
    const id = openId;
    if (!id) return;
    const r = await ffFetchGroup(id);
    if (!r.error && openIdRef.current === id) setLobby(r);   // negeer late/stale fetch
  }, [openId]);
  // Verzend-lock ophalen zodra de lobby een groep heeft (en bij elke refresh).
  useEffect(() => {
    const id = lobby?.group?.id;
    if (!id) { setShipLocked(false); return; }
    let on = true;
    ffShipLocked(id).then((v) => { if (on) setShipLocked(v); });
    return () => { on = false; };
  }, [lobby?.group?.id, lobby?.items?.length]);

  useEffect(() => {
    ffSyncProfile();   // mijn naam/foto bijwerken op m'n member-rijen (fire-and-forget)
    if (initialGroupId) openLobby(initialGroupId);                                   // direct naar de lobby (vanaf de groeps-cart)
    else if (initialJoinCode) { setCode(initialJoinCode); doPreview(initialJoinCode); }
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
    if (initialGroupId) { onClose?.(); return; }   // direct vanaf de groeps-cart → sheet sluiten i.p.v. lijst tonen
    setView("list"); setOpenId(null); setLobby(null); loadGroups();
  }
  async function doSaveSettings() {
    if (!lobby?.group) return;
    setBusy(true);
    const r = await ffUpdateSettings(lobby.group.id, { name: editName.trim(), maxSize: Number(editMax), orderWindowDays: Number(editWindow) });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Could not save"); return; }
    setEditing(false); refreshLobby();
  }

  // "Confirm & pay": ff_set_ready (server-side prijs + geld vasthouden; plaatst de
  // groep zodra iedereen ready is). De automatische price-guard vooraf is bewust
  // verwijderd (user 2026-07-21, simpel houden) — admin ververst prijzen handmatig.
  async function doReady() {
    if (!lobby?.group) return;
    setErr(""); setReadyBusy(true);
    try {
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
  async function doReact(messageId, emoji) {
    const r = await ffReact(messageId, emoji);
    if (r.ok) loadMessages(lobby.group.id);
  }
  // Een gedeeld item DIRECT kopen in de groep (fee valt pas bij verzenden).
  async function doAddShared(it) {
    if (!lobby?.group || !it) return;
    const r = await ffAddItem(lobby.group.id, {
      source_url: it.source_url, product_title: it.product_title, platform: it.platform,
      price: it.price, qty: 1, kleur: it.kleur, variant_image: it.variant_image,
    });
    if (!r.ok) {
      setErr(r.error === "Insufficient balance"
        ? `Insufficient balance — you need €${Number(r.needed || 0).toFixed(2)}. Top up first.`
        : (r.error || "Could not buy"));
      return;
    }
    refreshLobby();
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
        {header(<><Fox /> Flowva Friends</>)}
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
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Fox /></div>
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
        {header(initialJoinCode ? "You're invited 🧡" : "Join a group", initialJoinCode ? onClose : () => setView("list"))}
        {errLine}
        <div style={{ padding: "8px 18px 28px" }}>
          {/* Via een link binnenkomen = geen kaal codeveld; die tonen we alleen bij handmatig joinen. */}
          {!initialJoinCode && (
            <>
              <label style={label}>Invite code</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...input, textTransform: "uppercase" }} value={code} onChange={(e) => { setCode(e.target.value); setPreview(null); }} placeholder="ABC123" maxLength={6} />
                <button style={{ background: "#1E1D1A", border: "1px solid #2c2b29", color: "#FF5C00", borderRadius: 12, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => doPreview()}>Check</button>
              </div>
            </>
          )}
          {preview ? (
            // Verleidelijke uitnodiging: verkoopt de groep + de besparing i.p.v. een kale regel.
            <div style={{ background: "linear-gradient(160deg, #221f1b, #1A1917)", border: "1px solid #2c2b29", borderRadius: 18, padding: "22px 18px", marginTop: initialJoinCode ? 4 : 16, textAlign: "center" }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,92,0,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 12px" }}><Fox /></div>
              <div style={{ fontSize: 12, color: "#9C9893", marginBottom: 3 }}>You've been invited to join</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", marginBottom: 6 }}>{preview.name}</div>
              <div style={{ fontSize: 12.5, color: "#9C9893", marginBottom: 14 }}>{preview.member_count}/{preview.max_size} friends · {preview.is_private ? "🔒 private — invite only" : preview.status === "gathering" ? "open to join" : "closed"}</div>
              <div style={{ display: "inline-block", background: "linear-gradient(135deg, #FF7A1A, #FF5C00)", color: "#fff", fontSize: 12.5, fontWeight: 800, padding: "8px 16px", borderRadius: 999, marginBottom: 16, boxShadow: "0 5px 16px rgba(255,92,0,0.3)" }}>💸 You both save up to 50% on fees &amp; shipping</div>
              {/* Wie de host is en waar het pakket heen gaat — VOOR de knop. Door mee te doen
                  wijs je die persoon aan om jouw spullen in ontvangst te nemen; dat is wat het
                  risico bij hem laat overgaan en de bedenktijd laat starten bij zijn ontvangst.
                  Zonder dit blijft Flowva aansprakelijk als een host spullen houdt. */}
              {preview.host_name && (
                <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #2c2b29", borderRadius: 12, padding: "11px 13px", marginBottom: 14, textAlign: "left" }}>
                  <div style={{ fontSize: 11.5, color: "#9C9893", lineHeight: 1.5 }}>
                    {tr("ff.join.hostIntro", "The whole group ships in one parcel to")}{" "}
                    <b style={{ color: "#fff" }}>{preview.host_name}</b>
                    {preview.host_place ? <span style={{ color: "#c9c6c1" }}> · {preview.host_place}</span> : null}.
                  </div>
                  <div style={{ fontSize: 11, color: "#7d7a75", lineHeight: 1.5, marginTop: 5 }}>
                    {tr("ff.join.hostConsent", "By joining you ask them to receive your items for you, and they'll see your name and what you ordered so they can hand it over. Only join a group whose host you trust.")}
                  </div>
                </div>
              )}
              <button style={{ ...primaryBtn, opacity: busy || preview.is_full || preview.is_private || preview.status !== "gathering" ? 0.5 : 1 }}
                disabled={busy || preview.is_full || preview.is_private || preview.status !== "gathering"} onClick={doJoin}>
                {preview.is_private ? "Private group" : preview.is_full ? "Group is full" : preview.status !== "gathering" ? "Group is closed" : busy ? "Joining…" : `Join ${preview.name} →`}
              </button>
            </div>
          ) : initialJoinCode ? (
            <div style={{ textAlign: "center", color: "#9C9893", padding: "26px 0", fontSize: 13 }}>Loading your invite…</div>
          ) : null}
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
    // Gedeelde-mand checkout: ik betaal MIJN items = product + China-verzending (¥5/stuk) +
    // QC (¥6/stuk), GEEN fee (die valt bij verzenden). 1:1 met ff_cart_checkout (server).
    const myUnits = myItems.reduce((s, it) => s + Math.max(Number(it.qty) || 1, 1), 0);
    const myCartCharge = Math.round((myTotal + (myUnits * 5 / 7.8) + (myUnits * 6 / 7.8)) * 100) / 100;
    const doCartQty = async (it, q) => { if (q < 1) { await ffCartRemove(it.id); } else { await ffCartSetQty(it.id, q); } refreshLobby(); };
    const doCheckout = async () => {
      if (cartBusy || !cartAgree) return;   // betalen kan alleen mét het akkoord-vinkje
      setCartBusy(true); setCartErr(""); setCartNeeded(null);
      const r = await ffCartCheckout(g.id);
      setCartBusy(false);
      setCartConfirm(false); setCartAgree(false);
      if (!r || !r.ok) {
        if (r?.error === "Insufficient balance") {
          // Geen doodlopende melding meer: het blok hieronder biedt "waardeer
          // precies €X op" aan, net als in de solo-mand.
          setCartNeeded(Number(r.needed) || null);
        } else {
          setCartErr(r?.error === "group_locked"
            ? "The group is shipping a parcel right now — you can order again once it's on its way."
            : (r?.error || "Checkout failed"));
        }
        return;
      }
      refreshLobby();   // mand nu leeg voor mij; items zijn groeps-orders (zie Orders · squad)
    };
    // Saldo-tekort voor MIJN deel van de gedeelde mand — live, en na een echte
    // weigering met het server-bedrag (dat is gezaghebbend).
    const myBal = Number(balance) || 0;
    const myDue = Number(cartNeeded) > 0 ? Number(cartNeeded) : myCartCharge;
    const myShort = Math.max(0, Math.round((myDue - myBal) * 100) / 100);
    const myTopUp = exactTopUp(myShort);
    const myTopUpOver = Math.round((myTopUp - myShort) * 100) / 100;
    const doTopUp = async () => {
      if (topping) return;
      setTopping(true); setTopErr("");
      // Na iDEAL terug in déze lobby, zodat je alleen nog op checkout hoeft te drukken.
      try { await startTopUp(myTopUp, `/?resume=friends&g=${g.id}`); }
      catch (e) { setTopErr(e?.message || "Something went wrong. Please try again."); setTopping(false); }
    };
    const meMember = members.find((m) => m.user_id === myUid);
    const iAmReady = !!meMember?.ready;
    const meHeld = Number(meMember?.held_amount) || 0;   // het ECHTE vastgehouden bedrag (server-side)
    const priceUnknown = myItems.some((it) => it.price == null || isNaN(Number(it.price)));  // prijs nog niet bekend → niet laten betalen
    const isSolo = members.length === 1;
    // JOUW fee-besparing: wat je solo aan fee zou betalen vs. in deze groep (exact).
    const myFeeSavings = myTotal > 0 ? Math.round((estimateMemberFee(1, myTotal) - myFee) * 100) / 100 : 0;
    // Uitnodig-balk: hoeveel plekken vrij + of de groep vol is.
    const isFull = !!g && members.length >= (g.max_size || 7);
    const spotsLeft = g ? Math.max(0, (g.max_size || 7) - members.length) : 0;
    body = (
      <>
        {header(g ? g.name : "Group", initialGroupId ? onClose : () => { setErr(""); openIdRef.current = null; setView("list"); loadGroups(); },
          g && (
            <>
              {iconBtn("admin", () => setShowAdminInfo(true), "About the admin", <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9C9893" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3z" /><path d="M9.5 12l1.7 1.7L15 10" /></svg>)}
              {iconBtn("fee", () => setShowFeeInfo(true), "Why it's cheaper", <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9C9893" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11.5v4.5" /><path d="M12 8h.01" /></svg>)}
              {isAdmin && !isPlaced && iconBtn("settings", () => setEditing((v) => !v), "Group settings", <span style={{ fontSize: 14 }}>⚙️</span>)}
              {!isPlaced && iconBtn("leave", () => setShowLeaveConfirm(true), "Leave group", <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E24B4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>)}
            </>
          ))}
        {errLine}
        {!g ? (
          <div style={{ textAlign: "center", color: "#777", padding: "30px 0", fontSize: 13 }}>Loading group…</div>
        ) : (
          <div style={{ padding: "0 18px 28px" }}>
            {/* GROEIMOTOR — de belangrijkste actie krijgt eigen ruimte + het enige kleuraccent:
                een volle-breedte uitnodig-balk. Eén tik = de native deel-sheet (WhatsApp/TikTok/
                Insta/alles). Secundaire opties (WhatsApp-direct / kopieer / code) klappen eronder uit. */}
            {!isPlaced && !isFull && (
              <div style={{ marginBottom: 14 }}>
                <motion.button whileTap={{ scale: 0.98 }} onClick={() => doShare(g.invite_code, g.name)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg, #FF7A1A, #FF5C00)", color: "#fff", border: "none", borderRadius: 14, padding: "14px 16px", cursor: "pointer", boxShadow: "0 6px 18px rgba(255,92,0,0.34)", textAlign: "left" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ShareGlyph size={18} color="#fff" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>Invite friends</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.92)", marginTop: 2 }}>{spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left · you all save up to 50%</div>
                  </div>
                  <div style={{ fontSize: 18, opacity: 0.9 }}>→</div>
                </motion.button>
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <button onClick={() => setShowInvite((v) => !v)} style={{ background: "none", border: "none", color: "#9C9893", fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 4 }}>{showInvite ? "Hide options ▴" : "More ways to share ▾"}</button>
                </div>
                <AnimatePresence initial={false}>
                  {showInvite && (
                    <motion.div initial={{ height: 0, opacity: 0, marginTop: 0 }} animate={{ height: "auto", opacity: 1, marginTop: 8 }} exit={{ height: 0, opacity: 0, marginTop: 0 }} transition={springMorph} style={{ overflow: "hidden" }}>
                      <div style={{ background: "#1A1917", borderRadius: 14, padding: "14px" }}>
                        <div style={{ fontSize: 11.5, color: "#9C9893", marginBottom: 10 }}>Invite code <b style={{ color: "#fff", letterSpacing: 1 }}>{g.invite_code}</b></div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <a href={whatsappShare(g.invite_code, g.name)} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: "center", background: "#1E1D1A", border: "1px solid #2c2b29", color: "#C9C6C1", borderRadius: 10, padding: "10px", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>WhatsApp</a>
                          <button onClick={() => { copyLink(g.invite_code); setShareCopied(true); setTimeout(() => setShareCopied(false), 1800); }} style={{ flex: 1, background: "#1E1D1A", border: "1px solid #2c2b29", color: "#C9C6C1", borderRadius: 10, padding: "10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Copy link</button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {isFull && !isPlaced && (
              <div style={{ textAlign: "center", background: "#1A1917", border: "1px solid #2c2b29", borderRadius: 12, padding: "11px", marginBottom: 14, fontSize: 12.5, fontWeight: 700, color: "#34D17B" }}>🎉 Squad full — {members.length}/{g.max_size} friends</div>
            )}

            {/* Ledenlijst is weg (user-keuze 2026-07-12): namen staan al bij hun items in de
                gedeelde mand; de teller staat naast "Shared cart". Nudge-UI mee verwijderd
                (doNudge/ff-nudge-plumbing blijft bestaan voor later). LET OP: "make admin" en
                "remove member" hebben hierdoor tijdelijk geen knop — komt terug bij de
                admin-herinrichting waar de user later op terugkomt. */}

            {/* "You save €X in fees"-banner VERWIJDERD (user 2026-07-20) — de besparing
                staat al in de invite-kaart ("you all save up to 50%"). */}

            {/* shared cart — met de squad-teller ernaast (de losse ledenlijst is weg) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 2px 8px" }}>
              <span style={{ fontSize: 12, color: "#9C9893" }}>Shared cart · Squad · {members.length}/{g.max_size}</span>
              <motion.button whileTap={{ scale: 0.9 }} transition={springMorph} onClick={() => setChatOpen((v) => !v)} aria-label="Squad chat"
                style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, background: chatOpen ? "#FF5C00" : "#1A1917", border: "1px solid #2c2b29", borderRadius: 999, padding: "5px 11px", cursor: "pointer", color: chatOpen ? "#fff" : "#C9C6C1", WebkitTapHighlightColor: "transparent" }}>
                <span style={{ fontSize: 13, lineHeight: 1 }}>💬</span>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>Chat{messages.length ? ` · ${messages.length}` : ""}</span>
              </motion.button>
            </div>
            {/* squad chat — opent direct onder de chat-knop (accordion) */}
            <div style={{ background: "#161513", borderRadius: 14, overflow: "hidden", marginBottom: chatOpen ? 10 : 0 }}>
              <AnimatePresence initial={false}>
                {chatOpen && (
                  <motion.div key="chatbody" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={springMorph} style={{ overflow: "hidden" }}>
                    <div style={{ padding: "12px 12px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>💬</span>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#fff" }}>Squad chat</div>
                      <button onClick={() => setChatOpen(false)} aria-label="Close chat" style={{ background: "none", border: "none", color: "#9C9893", fontSize: 15, cursor: "pointer" }}>✕</button>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 4px", flexDirection: mine ? "row-reverse" : "row" }}>
                        {author && <Avatar name={author.display_name} url={avatarOf(author)} seed={msg.user_id} size={17} />}
                        <span style={{ fontSize: 10, color: "#6b6862" }}>{name}</span>
                      </div>
                      {msg.kind === "share" && sharedItem ? (
                        <div {...pressProps(msg.id)}
                          style={{ background: "#221d18", border: "1px solid #2c2b29", borderRadius: 12, padding: 8, maxWidth: "88%", display: "flex", gap: 9, alignItems: "center" }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: "#26211c", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {sharedItem.variant_image?.startsWith("http") ? <img src={sharedItem.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{sharedItem.product_title}</div>
                            <div style={{ fontSize: 10.5, color: "#9C9893" }}>{sharedItem.price != null ? `€${Number(sharedItem.price).toFixed(2)}` : "shared an item"}</div>
                            <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                              {sharedItem.source_url && <button onClick={() => onOpenProduct?.(sharedItem)} style={{ background: "#1E1D1A", border: "none", color: "#C9C6C1", borderRadius: 8, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>↗ View</button>}
                              {sharedItem.source_url && <button onClick={() => doAddShared(sharedItem)} style={{ background: "rgba(255,92,0,0.16)", border: "none", color: "#FF5C00", borderRadius: 8, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Buy</button>}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div {...pressProps(msg.id)}
                          style={{ background: mine ? "#FF5C00" : "#222", color: mine ? "#fff" : "#eee", borderRadius: 12, padding: "7px 11px", fontSize: 13, maxWidth: "80%", wordBreak: "break-word", WebkitUserSelect: "none", userSelect: "none", cursor: "pointer" }}>{msg.body}</div>
                      )}
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        {Object.entries(msg.reactions || {}).map(([emoji, uids]) => (
                          <button key={emoji} onClick={() => doReact(msg.id, emoji)}
                            style={{ background: (uids || []).includes(myUid) ? "rgba(255,92,0,0.2)" : "#1E1D1A", border: "none", borderRadius: 10, padding: "1px 6px", fontSize: 11, cursor: "pointer", color: "#ddd" }}>{emoji} {(uids || []).length}</button>
                        ))}
                        {reactingId === msg.id ? (
                          <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springMorph}
                            style={{ display: "flex", alignItems: "center", gap: 1, background: "#2c2c2c", borderRadius: 999, padding: "3px 5px", boxShadow: "0 6px 18px rgba(0,0,0,0.5)" }}>
                            {REACTIONS.map((e) => (
                              <motion.button key={e} whileTap={{ scale: 0.8 }} whileHover={{ scale: 1.25 }} onClick={() => { doReact(msg.id, e); setReactingId(null); }}
                                style={{ background: "none", border: "none", borderRadius: "50%", padding: "2px 3px", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>{e}</motion.button>
                            ))}
                            <button onClick={() => setReactingId(null)} aria-label="close" style={{ background: "none", border: "none", color: "#9C9893", fontSize: 12, cursor: "pointer", padding: "0 3px" }}>✕</button>
                          </motion.div>
                        ) : (
                          <button onClick={() => setReactingId(msg.id)} aria-label="React" style={{ background: "#1E1D1A", border: "none", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", opacity: 0.8 }}>🙂</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input style={{ ...input, padding: "10px 12px" }} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doPostMessage(); }} placeholder="Message your squad…" maxLength={500} />
                      <button onClick={doPostMessage} style={{ background: "#FF5C00", border: "none", color: "#fff", borderRadius: 12, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Send</button>
                    </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {/* GEDEELDE MAND — items van ALLE leden; ieder rekent z'n eigen af bij checkout.
                Ook bij een LEGE mand tonen we de ledenlijst (user 2026-07-20), met de
                uitleg-regel eronder — geen aparte lege-staat meer zonder namen. */}
            {(lobby.items || []).length === 0 && (
              <div style={{ background: "#1A1917", borderRadius: 14, padding: "13px 15px", marginBottom: 8, textAlign: "center", color: "#9C9893", fontSize: 12, lineHeight: 1.55 }}>
                🛍️ Everyone shops the feed and taps <b style={{ color: "#C9C6C1" }}>+ Add to {g.name}</b> — items land in this shared cart. You only pay at checkout.
              </div>
            )}
            {(
              <div style={{ background: "#1A1917", borderRadius: 16, padding: "12px 12px 14px" }}>
                {/* Per lid gegroepeerd: naam (+ admin-embleem) als kopje, daaronder z'n items.
                    ÁLLE leden staan er altijd (user 2026-07-20) — een lid zonder items krijgt
                    "nothing in the basket yet" i.p.v. onzichtbaar te zijn. */}
                {members.map((owner) => {
                  const ownerSelf = owner.user_id === myUid;
                  const ownerItems = itemsByOwner[owner.user_id] || [];
                  return (
                    <div key={"grp-" + owner.user_id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 2px 7px" }}>
                        <Avatar name={owner.display_name} url={avatarOf(owner)} size={22} seed={owner.user_id} />
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>{memberLabel(owner, ownerSelf)}</span>
                        {owner.role === "admin" && <span style={{ color: "#FF5C00", fontSize: 10.5, fontWeight: 700 }}>admin</span>}
                      </div>
                      {ownerItems.length === 0 && (
                        <div style={{ background: "#161513", borderRadius: 12, padding: "10px 12px", marginBottom: 7, fontSize: 11.5, color: "#6b6862" }}>
                          {ownerSelf ? "You have nothing in the basket yet" : "Nothing in the basket yet"}
                        </div>
                      )}
                      {ownerItems.map((it) => {
                        const mine = it.owner_id === myUid;
                        return (
                          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#161513", borderRadius: 12, padding: "9px 11px", marginBottom: 7 }}>
                            <div style={{ width: 42, height: 42, borderRadius: 9, background: "#26211c", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {it.variant_image?.startsWith("http") ? <img src={it.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 18 }}>📦</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.product_title}</div>
                              <div style={{ fontSize: 10.5, color: "#9C9893", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.kleur ? `${it.kleur} · ` : ""}€{(Number(it.price) || 0).toFixed(2)}</div>
                            </div>
                            {mine ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                <button onClick={() => doCartQty(it, (it.qty || 1) - 1)} style={{ width: 25, height: 25, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#C9C6C1", fontSize: 15, cursor: "pointer", lineHeight: 1 }}>−</button>
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", minWidth: 12, textAlign: "center" }}>{it.qty || 1}</span>
                                <button onClick={() => doCartQty(it, (it.qty || 1) + 1)} style={{ width: 25, height: 25, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#C9C6C1", fontSize: 15, cursor: "pointer", lineHeight: 1 }}>+</button>
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: "#6b6862", flexShrink: 0 }}>×{it.qty || 1}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {myItems.length > 0 ? (
                  <>
                    {/* Zelfde kosten-uitsplitsing als de solo-cart (user 2026-07-20):
                        Items / Domestic (¥5/stuk) / QC (¥6/stuk) — 1:1 met ff_cart_checkout. */}
                    <div style={{ background: "#161513", borderRadius: 14, padding: "12px 14px", marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12.5, color: "#9C9893" }}>Your items ({myItems.length})</span>
                        <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{myTotal.toFixed(2)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12.5, color: "#9C9893" }}>Domestic shipping (¥5 × {myUnits})</span>
                        <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{(myUnits * 5 / 7.8).toFixed(2)} <span style={{ color: "#9C9893", fontWeight: 400 }}>· ¥{myUnits * 5}</span></span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12.5, color: "#9C9893" }}>Quality-control (¥6 × {myUnits})</span>
                        <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{(myUnits * 6 / 7.8).toFixed(2)} <span style={{ color: "#9C9893", fontWeight: 400 }}>· ¥{myUnits * 6}</span></span>
                      </div>
                      {/* Saldo erbij, zodat je hier al ziet of het genoeg is (en straks dat
                          een opwaardering geland is) — zelfde signaalkleuren als bij verzenden. */}
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, paddingTop: 9, borderTop: "1px solid #262421" }}>
                        <span style={{ fontSize: 12.5, color: myShort > 0 ? "#F0B45B" : "#10B981" }}>{tr("group.cart.balance", "Your balance")}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: myShort > 0 ? "#F0B45B" : "#10B981" }}>€{myBal.toFixed(2)}</span>
                      </div>
                    </div>
                    {shipLocked ? (
                      /* Groep-verzending gelockt (user 2026-07-22): geen checkout meer —
                         doorgestreept met dezelfde "your admin locked the group"-melding. */
                      <div style={{ marginTop: 8, background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "13px", textAlign: "center" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#8A8780", textDecoration: "line-through" }}>Go to checkout</span>
                        <div style={{ fontSize: 11.5, color: "#9C9893", marginTop: 4 }}>🔒 Your admin locked the group</div>
                      </div>
                    ) : myShort > 0 ? (
                      /* Te weinig saldo voor jouw deel: precies het tekort opwaarderen via
                         iDEAL. Je komt daarna terug in deze lobby (?resume=friends) en drukt
                         alsnog op checkout. Zelfde flow als de solo-mand. */
                      <>
                        <div style={{ marginTop: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "10px 12px", fontSize: 11.5, color: "#F0B45B", lineHeight: 1.5 }}>
                          {tr("group.cart.shortExplain", "Your balance is €{short} short — top up exactly that and you're set.", { short: myShort.toFixed(2) })}
                          {myTopUpOver > 0 && <> {tr("cart.shortMinimum", "The minimum top-up is €{min}, so €{rest} stays on your balance for next time.", { min: TOPUP_MIN.toFixed(2), rest: myTopUpOver.toFixed(2) })}</>}
                        </div>
                        <button onClick={doTopUp} disabled={topping} style={{ ...primaryBtn, marginTop: 8, opacity: topping ? 0.6 : 1 }}>
                          {topping ? tr("cart.openingIdeal", "Opening iDEAL…") : tr("cart.topUpExact", "Top up €{amount} & continue →", { amount: myTopUp.toFixed(2) })}
                        </button>
                        {topErr && <div style={{ color: "#F0997B", fontSize: 11.5, marginTop: 6, textAlign: "center" }}>{topErr}</div>}
                      </>
                    ) : !cartConfirm ? (
                    /* Stap 1: klapt alleen het bevestigingsblok uit — betaalt NIETS. */
                    <button onClick={() => { setCartConfirm(true); setCartErr(""); }} style={{ ...primaryBtn, marginTop: 8 }}>
                      {`${tr("ff.cart.goToCheckout", "Go to checkout")} → €${myCartCharge.toFixed(2)}`}
                    </button>
                    ) : (
                    /* Stap 2: akkoord-vinkje (Terms + retour + 14 dagen, zoals solo) en pas dán betalen. */
                    <>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 10, cursor: "pointer", fontSize: 11, color: "#8A8780", lineHeight: 1.55 }}>
                        <input type="checkbox" checked={cartAgree} onChange={(e) => setCartAgree(e.target.checked)}
                          style={{ marginTop: 1, width: 16, height: 16, accentColor: "#FF5C00", flexShrink: 0 }} />
                        <span>
                          {tr("ff.cart.agree", "I agree to the")}{" "}
                          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#A5B4FC" }}>{tr("ff.cart.agreeTerms", "Terms")}</a>{" "}
                          {tr("ff.cart.agreeAnd", "and")}{" "}
                          <a href="/returns-policy" target="_blank" rel="noreferrer" style={{ color: "#A5B4FC" }}>{tr("ff.cart.agreeReturns", "Returns & withdrawal policy")}</a>.{" "}
                          {tr("ff.cart.agreeRest", "Refunds go to my Flowva balance, and I have a 14-day right of withdrawal.")}{" "}
                          {tr("cart.returnCost", "If I change my mind, I pay for sending the item back — usually €5–€8 within the EU.")}
                        </span>
                      </label>
                      <button onClick={doCheckout} disabled={cartBusy || !cartAgree}
                        style={{ ...primaryBtn, marginTop: 8, opacity: cartBusy || !cartAgree ? 0.6 : 1 }}>
                        {cartBusy ? "…" : !cartAgree ? tr("cart.tickBoxToContinue", "Tick the box to continue") : `${tr("ff.cart.confirmPay", "Confirm & pay")} €${myCartCharge.toFixed(2)} →`}
                      </button>
                      <button onClick={() => { setCartConfirm(false); setCartAgree(false); }}
                        style={{ width: "100%", marginTop: 6, background: "none", border: "none", color: "#8A8780", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 6 }}>
                        {tr("common.back", "← Back")}
                      </button>
                    </>
                    )}
                    <div style={{ fontSize: 10.5, color: "#6b6862", textAlign: "center", marginTop: 6, lineHeight: 1.4 }}>You pay only your own items now. The group fee + shipping are split by weight later, when the parcel ships.</div>
                    {cartErr && <div style={{ color: "#F0997B", fontSize: 11.5, marginTop: 6, textAlign: "center" }}>{cartErr}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 11.5, color: "#6b6862", textAlign: "center", padding: "6px 0 2px" }}>You have no items yet — add some from the feed.</div>
                )}
              </div>
            )}


            <AnimatePresence>{showFeeInfo && <FeeInfo onClose={() => setShowFeeInfo(false)} members={members.length} myTotal={myTotal} myFee={myFee} />}</AnimatePresence>
            <AnimatePresence>{showAdminInfo && <AdminInfo onClose={() => setShowAdminInfo(false)} adminName={(members.find((m) => m.role === "admin") || {}).display_name} />}</AnimatePresence>
            <AnimatePresence>
              {editing && isAdmin && !isPlaced && (
                <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
                  onClick={() => setEditing(false)} style={{ position: "fixed", inset: 0, zIndex: 412, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={springMorph}
                    onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#161513", borderRadius: "20px 20px 0 0", padding: "18px 18px 28px", color: "#fff", maxHeight: "86vh", overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ flex: 1, fontSize: 16, fontWeight: 800 }}>Group settings</div>
                      <button onClick={() => setEditing(false)} style={{ background: "#1E1D1A", border: "none", color: "#9C9893", width: 30, height: 30, borderRadius: "50%", fontSize: 14, cursor: "pointer" }}>✕</button>
                    </div>
                    <label style={label}>Group name</label>
                    <input style={input} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={40} />
                    <label style={{ ...label, marginTop: 14 }}>Max friends (min {lobby.members.length})</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[2, 3, 4, 5, 6, 7].map((n) => (
                        <button key={n} disabled={n < lobby.members.length} onClick={() => setEditMax(n)}
                          style={{ flex: 1, background: editMax === n ? "#FF5C00" : "#26211c", color: n < lobby.members.length ? "#555" : editMax === n ? "#fff" : "#9C9893", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: n < lobby.members.length ? "default" : "pointer" }}>{n}</button>
                      ))}
                    </div>
                    <label style={{ ...label, marginTop: 14 }}>Ordering window · {editWindow} day{editWindow === 1 ? "" : "s"}</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[5, 7, 10, 14, 15].map((n) => (
                        <button key={n} onClick={() => setEditWindow(n)}
                          style={{ flex: 1, background: editWindow === n ? "#FF5C00" : "#26211c", color: editWindow === n ? "#fff" : "#9C9893", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{n}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: "#6b6862", marginTop: 6, lineHeight: 1.5 }}>From the group's first purchase, your squad has this many days to buy items into the same parcel. After that (plus a 5-day grace) storage starts adding up on items already waiting.</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", borderTop: "1px solid #2c2b29", marginTop: 16 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>Private group</div>
                        <div style={{ fontSize: 11.5, color: "#9C9893" }}>{g.is_private ? "Locked — no one new can join" : "Anyone with the link can join"}</div>
                      </div>
                      <div onClick={async () => { const r = await ffSetPrivate(g.id, !g.is_private); if (r && !r.ok) setErr(r.error); refreshLobby(); }}
                        role="switch" aria-checked={!!g.is_private}
                        style={{ width: 46, height: 27, borderRadius: 999, background: g.is_private ? "#FF5C00" : "#3a3a37", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .2s" }}>
                        <div style={{ position: "absolute", top: 3, left: g.is_private ? 22 : 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                      </div>
                    </div>
                    <button style={{ ...primaryBtn }} disabled={busy} onClick={async () => { await doSaveSettings(); }}>Save changes</button>
                    <div style={{ fontSize: 11, color: "#6b6862", marginTop: 12, lineHeight: 1.5 }}>Hand over <b style={{ color: "#9C9893" }}>admin</b> by tapping a member in the lobby and choosing "make admin". The new admin also becomes the <b style={{ color: "#9C9893" }}>host</b> who receives the parcel, and these settings move to them.</div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} style={backdrop} onClick={onClose} />
      <motion.div layoutId="squad-pop" layoutRoot transition={springMorph}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={sheet}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.2 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
          <div style={{ padding: "8px 0 0", display: "flex", justifyContent: "center" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2 }} />
          </div>
          {body}
        </motion.div>
      </motion.div>
      {shareCopied && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 420, background: "#0F0E0C", color: "#fff", borderRadius: 999, padding: "10px 18px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>🔗 Invite link copied!</div>
      )}
      <AnimatePresence>
        {showLeaveConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            onClick={() => setShowLeaveConfirm(false)}
            style={{ position: "fixed", inset: 0, zIndex: 430, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <motion.div initial={{ scale: 0.82, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.82, opacity: 0, y: 12 }} transition={springMorph}
              onClick={(e) => e.stopPropagation()}
              style={{ background: "#1A1917", borderRadius: 20, padding: "22px 20px", width: "100%", maxWidth: 320, boxSizing: "border-box", textAlign: "center", color: "#fff" }}>
              <div style={{ fontSize: 30 }}>👋</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 6 }}>Leave {lobby?.group?.name || "this group"}?</div>
              <div style={{ fontSize: 12.5, color: "#9C9893", marginTop: 8, lineHeight: 1.5 }}>You'll leave the group. If you've already bought items into it, cancel those first (you get refunded) — you can't leave while items are still in progress.</div>
              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button onClick={() => setShowLeaveConfirm(false)} style={{ ...ghostBtn, padding: "12px" }}>Stay</button>
                <button onClick={async () => { setShowLeaveConfirm(false); await doLeave(); }} style={{ flex: 1, background: "#E24B4A", color: "#fff", border: "none", borderRadius: 14, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Leave</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
