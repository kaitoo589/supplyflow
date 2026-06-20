import { useState, useEffect, useCallback } from "react";
import {
  ffMyGroups, ffPreview, ffCreateGroup, ffJoinGroup, ffLeaveGroup,
  ffKickMember, ffSetHost, ffUpdateSettings, ffRemoveItem, ffFetchGroup,
  inviteLink, whatsappShare,
} from "./ffApi";

const AV_COLORS = ["#FF5C00", "#378ADD", "#16A34A", "#D4537E", "#7F77DD", "#E0A500", "#1D9E75"];

function Avatar({ name, url, size = 38 }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const color = AV_COLORS[(initial.charCodeAt(0) || 0) % AV_COLORS.length];
  if (url && url.startsWith("http")) {
    return <img src={url} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initial}</div>
  );
}

const sheet = { position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#111111", borderRadius: "24px 24px 0 0", zIndex: 401, maxHeight: "90vh", overflowY: "auto", color: "#fff" };
const backdrop = { position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" };
const primaryBtn = { width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" };
const ghostBtn = { width: "100%", background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "12px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" };
const input = { width: "100%", boxSizing: "border-box", background: "#1A1917", border: "1px solid #2c2b29", borderRadius: 12, padding: "12px 14px", fontSize: 14, color: "#fff", outline: "none" };
const label = { fontSize: 12, color: "#9C9893", margin: "0 2px 6px", display: "block" };

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

  const loadGroups = useCallback(async () => {
    setLoading(true);
    const r = await ffMyGroups();
    if (r.ok) setGroups(r.groups || []);
    else setErr(r.error || "Could not load your groups");
    setLoading(false);
  }, []);

  const openLobby = useCallback(async (id) => {
    setOpenId(id); setView("lobby"); setLobby(null); setErr("");
    const r = await ffFetchGroup(id);
    if (r.error) { setErr(r.error); return; }
    setLobby(r);
    setEditName(r.group?.name || ""); setEditMax(r.group?.max_size || 5);
  }, []);
  const refreshLobby = useCallback(async () => {
    if (!openId) return;
    const r = await ffFetchGroup(openId);
    if (!r.error) setLobby(r);
  }, [openId]);

  useEffect(() => {
    if (initialJoinCode) { setCode(initialJoinCode); doPreview(initialJoinCode); }
    else loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const copyLink = (c) => { try { navigator.clipboard?.writeText(inviteLink(c)); } catch { /* ignore */ } };

  // ── Views ──────────────────────────────────────────────────────────────────
  const header = (title, back) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 8px" }}>
      {back && <button onClick={back} style={{ background: "none", border: "none", color: "#9C9893", fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1 }}>‹</button>}
      <div style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{title}</div>
      <button onClick={onClose} aria-label="close" style={{ background: "#1E1D1A", border: "none", color: "#9C9893", width: 30, height: 30, borderRadius: "50%", fontSize: 15, cursor: "pointer" }}>✕</button>
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
              <div style={{ fontSize: 12.5, color: "#9C9893", marginTop: 2 }}>{preview.member_count}/{preview.max_size} friends · {preview.status === "gathering" ? "open to join" : "closed"}</div>
              <button style={{ ...primaryBtn, marginTop: 14, opacity: busy || preview.is_full || preview.status !== "gathering" ? 0.5 : 1 }}
                disabled={busy || preview.is_full || preview.status !== "gathering"} onClick={doJoin}>
                {preview.is_full ? "Group is full" : preview.status !== "gathering" ? "Group is closed" : busy ? "Joining…" : `Join ${preview.name} →`}
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
    body = (
      <>
        {header(g ? g.name : "Group", () => { setView("list"); loadGroups(); })}
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
            <div style={{ fontSize: 12, color: "#9C9893", margin: "0 2px 8px" }}>Squad · {lobby.members.length}/{g.max_size}</div>
            {lobby.members.map((m) => {
              const self = m.user_id === myUid;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 0" }}>
                  <Avatar name={m.display_name} url={m.avatar_url} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {self ? "You" : (m.display_name || "Friend")}
                      {m.role === "admin" && <span style={{ color: "#FF5C00", fontSize: 11, marginLeft: 6 }}>admin</span>}
                      {g.host_id === m.user_id && <span style={{ color: "#9C9893", fontSize: 11, marginLeft: 6 }}>🏠 host</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#9C9893" }}>{(itemsByOwner[m.user_id] || []).length} item{(itemsByOwner[m.user_id] || []).length === 1 ? "" : "s"}</div>
                  </div>
                  {isAdmin && !self && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {g.host_id !== m.user_id && <button onClick={async () => { await ffSetHost(g.id, m.user_id); refreshLobby(); }} style={{ background: "#1E1D1A", border: "none", color: "#9C9893", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>host</button>}
                      <button onClick={async () => { await ffKickMember(g.id, m.user_id); refreshLobby(); }} style={{ background: "rgba(226,75,74,0.14)", border: "none", color: "#E24B4A", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>remove</button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* shared cart */}
            <div style={{ fontSize: 12, color: "#9C9893", margin: "16px 2px 8px" }}>Shared cart</div>
            {(lobby.items || []).length === 0 ? (
              <div style={{ background: "#1A1917", borderRadius: 14, padding: "16px", textAlign: "center", color: "#777", fontSize: 12.5 }}>Nothing added yet. Tap "Shop for this group" and add products from the feed.</div>
            ) : (
              lobby.members.map((m) => {
                const its = itemsByOwner[m.user_id] || [];
                if (!its.length) return null;
                const self = m.user_id === myUid;
                return (
                  <div key={"items-" + m.id} style={{ background: "#1A1917", borderRadius: 14, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, color: "#9C9893", marginBottom: 6, display: "flex", alignItems: "center", gap: 7 }}>
                      <Avatar name={m.display_name} url={m.avatar_url} size={20} />{self ? "You" : (m.display_name || "Friend")}
                    </div>
                    {its.map((it) => (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: "#26211c", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {it.variant_image?.startsWith("http") ? <img src={it.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 15 }}>📦</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.product_title}</div>
                          <div style={{ fontSize: 11, color: "#9C9893" }}>{it.kleur ? `${it.kleur} · ` : ""}{it.price != null ? `€${Number(it.price).toFixed(2)}` : ""}{it.qty > 1 ? ` · ${it.qty}×` : ""}</div>
                        </div>
                        {self && <button onClick={async () => { await ffRemoveItem(it.id); refreshLobby(); }} style={{ background: "none", border: "none", color: "#777", fontSize: 14, cursor: "pointer" }}>✕</button>}
                      </div>
                    ))}
                  </div>
                );
              })
            )}

            {/* admin settings */}
            {isAdmin && (
              <div style={{ marginTop: 12 }}>
                {!editing ? (
                  <button style={{ ...ghostBtn, padding: "10px" }} onClick={() => setEditing(true)}>Group settings</button>
                ) : (
                  <div style={{ background: "#1A1917", borderRadius: 14, padding: "12px 14px" }}>
                    <label style={label}>Group name</label>
                    <input style={input} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={40} />
                    <label style={{ ...label, marginTop: 12 }}>Max friends (min {lobby.members.length})</label>
                    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                      {[2, 3, 4, 5, 6, 7].map((n) => (
                        <button key={n} disabled={n < lobby.members.length} onClick={() => setEditMax(n)}
                          style={{ flex: 1, background: editMax === n ? "#FF5C00" : "#26211c", color: n < lobby.members.length ? "#555" : editMax === n ? "#fff" : "#9C9893", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: n < lobby.members.length ? "default" : "pointer" }}>{n}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={{ ...primaryBtn, padding: "11px" }} disabled={busy} onClick={doSaveSettings}>Save</button>
                      <button style={{ ...ghostBtn, width: "auto", padding: "11px 16px" }} onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* actions */}
            <button style={{ ...primaryBtn, marginTop: 18 }}
              onClick={() => { onShopForGroup?.({ id: g.id, name: g.name }); onClose?.(); }}>
              {activeGroupId === g.id ? "✓ Shopping for this group" : "Shop for this group →"}
            </button>
            <button style={{ ...ghostBtn, marginTop: 8, color: "#E24B4A", borderColor: "rgba(226,75,74,0.3)" }} disabled={busy} onClick={doLeave}>Leave group</button>
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
    </>
  );
}
