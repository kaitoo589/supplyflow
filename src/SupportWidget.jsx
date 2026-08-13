import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue } from "framer-motion";
import { MessageCircle, X, Send } from "lucide-react";
import { supabase } from "./supabase";
import { theme } from "./theme";
import { springSoft, springSnappy, pressable } from "./motion";
import Fox from "./Fox";
import { tr, useLangVersion } from "./i18n";

const POS_KEY = "supportWidget:pos";

export default function SupportWidget({ session }) {
  useLangVersion(); // her-render bij taalwissel
  const [open, setOpen] = useState(false);
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

      <motion.button
        ref={btnRef}
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
      </motion.button>
    </div>
  );
}
