import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue } from "framer-motion";
import { MessageCircle, X, Send } from "lucide-react";
import { supabase } from "./supabase";
import { theme } from "./theme";
import { springSoft, springSnappy, pressable } from "./motion";
import Fox from "./Fox";
import { tr, useLangVersion } from "./i18n";

const POS_KEY = "supportWidget:pos";
const HIDE_KEY = "supportWidget:hidden";

export default function SupportWidget({ session }) {
  useLangVersion(); // her-render bij taalwissel
  const [open, setOpen] = useState(false);
  // Wegtikbaar (Kaito 25-08): kruisje op het bolletje → compact uitleg-kaartje →
  // "Hide" verbergt het per apparaat; de schakelaar in Profiel zet het weer aan.
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  const [confirmHide, setConfirmHide] = useState(false);
  // Positie van het verberg-kaartje: klapt vanaf het bolletje naar RECHTSONDER uit,
  // maar geklemd binnen het scherm — waar het bolletje ook naartoe gesleept is,
  // het kaartje is altijd volledig leesbaar (Kaito 25-08).
  const [cardPos, setCardPos] = useState({ left: 12, top: 12 });
  const openConfirmHide = () => {
    const B = 232, H = 190, M = 12;
    const rect = btnRef.current?.getBoundingClientRect();
    const left = Math.min(Math.max(rect ? rect.left : M, M), window.innerWidth - B - M);
    const top = Math.min(Math.max(rect ? rect.top : M, M), window.innerHeight - H - M);
    setCardPos({ left, top });
    setConfirmHide(true);
  };
  useEffect(() => {
    const sync = () => { try { setHidden(localStorage.getItem(HIDE_KEY) === "1"); } catch { /* private mode */ } };
    window.addEventListener("flowva:supportHiddenChanged", sync);
    return () => window.removeEventListener("flowva:supportHiddenChanged", sync);
  }, []);
  const hideForever = () => {
    try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* private mode */ }
    setConfirmHide(false);
    setOpen(false);
    setHidden(true);
    try { window.dispatchEvent(new Event("flowva:supportHiddenChanged")); } catch { /* geen window */ }
  };
  const [panelPos, setPanelPos] = useState({ bottom: 92, right: 20 });
  const [questions, setQuestions] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const dragArea = useRef(null);
  const btnRef = useRef(null);
  const suppressClick = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const userId = session?.user?.id;

  // Bewaarde sleep-positie terugzetten (geclamped, voor als het venster kleiner werd)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
      if (saved) {
        x.set(Math.min(0, Math.max(-(window.innerWidth - 96), saved.x ?? 0)));
        y.set(Math.min(0, Math.max(-(window.innerHeight - 96), saved.y ?? 0)));
      }
    } catch {
      /* geen geldige opgeslagen positie */
    }
  }, [x, y]);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("support_questions")
      .select("id, question, status, answer, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(30);
    if (data) setQuestions(data);
  }, [userId]);

  useEffect(() => {
    if (open) loadHistory();
  }, [open, loadHistory]);

  // Live meeluisteren: als support (AI of mens) antwoordt, verschijnt het direct
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`support-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_questions", filter: `user_id=eq.${userId}` },
        (payload) =>
          setQuestions((qs) => qs.map((q) => (q.id === payload.new.id ? { ...q, ...payload.new } : q)))
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [questions, open]);

  const toggle = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!open && btnRef.current) {
      // Paneel openen aan de kant waar het bolletje nu hangt
      const rect = btnRef.current.getBoundingClientRect();
      const panelW = Math.min(360, window.innerWidth - 24);
      const pos = {};
      if (rect.top > window.innerHeight / 2) {
        pos.bottom = Math.max(12, window.innerHeight - rect.top + 12);
      } else {
        pos.top = Math.max(12, rect.bottom + 12);
      }
      const preferLeft = rect.left + rect.width / 2 < window.innerWidth / 2;
      const left = preferLeft ? rect.left : rect.right - panelW;
      pos.left = Math.min(Math.max(12, left), window.innerWidth - panelW - 12);
      setPanelPos(pos);
    }
    setOpen((o) => !o);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !userId) return;
    setSending(true);
    setDraft("");
    try {
      // Mens-flow (geen AI): de vraag blijft "pending" tot Kaito 'm in de
      // admin-inbox beantwoordt; het antwoord komt live binnen via realtime.
      const { data: row, error } = await supabase
        .from("support_questions")
        .insert({ user_id: userId, question: text, page_context: window.location.pathname })
        .select()
        .single();
      if (error) throw error;
      setQuestions((qs) => [...qs, row]);
    } catch (err) {
      console.error("Support send error:", err);
      setQuestions((qs) => [
        ...qs,
        { id: `err-${Date.now()}`, question: text, status: "error", answer: null, created_at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  const bubbleBase = {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: theme.radiusMd,
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  };

  const replyFor = (q) => {
    if (q.status === "answered" || q.status === "closed") return q.answer;
    if (q.status === "error") return tr("support.error", "Something went wrong — please try again in a moment.");
    return null; // pending/escalated: wacht op een echt mens
  };

  if (hidden) return null;

  return (
    <div style={{ fontFamily: theme.font }}>
      <div ref={dragArea} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 999 }} />

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={springSoft}
            style={{
              position: "fixed",
              ...panelPos,
              width: 360,
              maxWidth: "calc(100vw - 24px)",
              height: 480,
              maxHeight: "70vh",
              background: theme.card,
              borderRadius: theme.radiusXl,
              boxShadow: theme.shadow,
              border: `1px solid ${theme.line}`,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: theme.ink,
                color: theme.onDark,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tr("support.title", "Flowva support")} <Fox /></div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{tr("support.subtitle", "Talk to a human — a real person replies")}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close support"
                style={{ background: "none", border: "none", color: theme.onDark, cursor: "pointer", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {!userId && (
                <div style={{ color: theme.ink, fontSize: 13.5, textAlign: "center", marginTop: 24, lineHeight: 1.6, padding: "0 8px" }}>
                  {tr("support.guestBody", "Ask us anything — a real person reads and answers every message. Log in or create a free account (Profile tab) to start chatting.")}
                </div>
              )}
              {userId && questions.length === 0 && (
                <div style={{ color: theme.inkFaint, fontSize: 13, textAlign: "center", marginTop: 24 }}>
                  {tr("support.empty", "Ask us anything — a real person reads and answers every message.")}
                </div>
              )}
              {questions.map((q) => (
                <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={springSnappy}
                    style={{ ...bubbleBase, alignSelf: "flex-end", background: theme.accent, color: theme.onAccent }}
                  >
                    {q.question}
                  </motion.div>
                  {replyFor(q) ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={springSnappy}
                      style={{ ...bubbleBase, alignSelf: "flex-start", background: theme.field, color: theme.ink }}
                    >
                      {replyFor(q)}
                    </motion.div>
                  ) : (
                    <div style={{ ...bubbleBase, alignSelf: "flex-start", background: theme.field, color: theme.inkFaint, fontSize: 12.5 }}>
                      {tr("support.pending", "✓ Sent — a real person will reply right here, usually within a few hours.")}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {userId && (
            <div style={{ borderTop: `1px solid ${theme.line}`, padding: 12, display: "flex", gap: 8 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={tr("support.placeholder", "Type your message…")}
                style={{
                  flex: 1,
                  border: "none",
                  background: theme.field,
                  borderRadius: theme.radiusSm,
                  padding: "10px 14px",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: theme.font,
                }}
              />
              <motion.button
                {...pressable}
                onClick={send}
                disabled={sending || !draft.trim()}
                aria-label="Send question"
                style={{
                  background: theme.accent,
                  color: theme.onAccent,
                  border: "none",
                  borderRadius: theme.radiusSm,
                  width: 42,
                  cursor: sending ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: sending || !draft.trim() ? 0.5 : 1,
                }}
              >
                <Send size={16} />
              </motion.button>
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {confirmHide ? (
        /* Kruisje getikt → het bolletje morpht (layoutId) naar dit compacte kaartje:
           wat het is, hoe je het verbergt, en waar het terug te vinden is. */
        <motion.div layoutId="support-orb" transition={springSoft}
          style={{ position: "fixed", left: cardPos.left, top: cardPos.top, width: 232, background: "#fff", borderRadius: 18, padding: "12px 14px", border: `1px solid ${theme.line}`, boxShadow: theme.shadow, zIndex: 1001 }}>
          <div style={{ fontSize: 12, color: theme.ink, lineHeight: 1.5 }}>
            <Fox /> {tr("support.hideBody", "This is Flowva support — a real person answers here. Don't need the bubble? Hide it; you can turn it back on anytime in your Profile.")}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button onClick={hideForever}
              style={{ flex: 1, background: theme.ink, color: "#fff", border: "none", borderRadius: 10, padding: "8px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: theme.font }}>
              {tr("support.hideBtn", "Hide")}
            </button>
            <button onClick={() => setConfirmHide(false)}
              style={{ flex: 1, background: theme.field, color: theme.ink, border: "none", borderRadius: 10, padding: "8px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: theme.font }}>
              {tr("support.keepBtn", "Keep")}
            </button>
          </div>
        </motion.div>
      ) : (
      <motion.button
        ref={btnRef}
        layoutId="support-orb"
        drag
        dragConstraints={dragArea}
        dragMomentum={false}
        dragElastic={0.08}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        transition={springSnappy}
        onDragEnd={(_e, info) => {
          if (Math.hypot(info.offset.x, info.offset.y) > 6) suppressClick.current = true;
          try {
            localStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }));
          } catch {
            /* opslag niet beschikbaar */
          }
        }}
        onClick={toggle}
        aria-label="Open support chat"
        style={{
          x,
          y,
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: theme.accent,
          color: theme.onAccent,
          border: "none",
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: theme.shadow,
          zIndex: 1001,
          touchAction: "none",
        }}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {/* ✕-badge (Kaito 25-08): opent het verberg-kaartje. stopPropagation op pointerdown
            zodat het tikken niet als slepen of als chat-openen telt. */}
        {!open && (
          <span
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); openConfirmHide(); }}
            aria-label="Hide support bubble"
            style={{ position: "absolute", top: -4, right: -4, width: 19, height: 19, borderRadius: 10, background: "#0F0E0C", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", cursor: "pointer" }}>
            <X size={11} strokeWidth={3} />
          </span>
        )}
      </motion.button>
      )}
    </div>
  );
}
