import { useState, useEffect, useRef } from "react";

const SAMPLE_DATA = {
  "Bench Press": [
    { date: "2026-02-24", sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }, { reps: 7, weight: 135 }] },
    { date: "2026-03-02", sets: [{ reps: 8, weight: 140 }, { reps: 8, weight: 140 }, { reps: 8, weight: 140 }] },
  ],
  "Squat": [
    { date: "2026-02-25", sets: [{ reps: 5, weight: 185 }, { reps: 5, weight: 185 }, { reps: 4, weight: 185 }] },
    { date: "2026-03-03", sets: [{ reps: 5, weight: 190 }, { reps: 5, weight: 190 }, { reps: 5, weight: 190 }] },
  ],
  "Deadlift": [
    { date: "2026-02-26", sets: [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225 }] },
  ],
};

function getSuggestion(history) {
  if (!history || history.length === 0) return null;
  const last = history[history.length - 1];
  const allCompleted = last.sets.every(s => s.reps >= last.sets[0].reps);
  const avgWeight = Math.round(last.sets.reduce((a, s) => a + s.weight, 0) / last.sets.length);
  const avgReps = Math.round(last.sets.reduce((a, s) => a + s.reps, 0) / last.sets.length);

  if (allCompleted) {
    return { type: "increase", weight: avgWeight + 5, reps: avgReps, msg: `All sets completed — add 5 lbs` };
  } else {
    return { type: "maintain", weight: avgWeight, reps: avgReps, msg: `Didn't hit all reps — hold weight` };
  }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@300;400;500&family=Share+Tech+Mono&display=swap');`;

// ─── SUPABASE CONFIG ───────────────────────────────────────────────────────────
// 1. Create a free project at https://supabase.com
// 2. Go to Project Settings → API and copy these two values:
const SUPABASE_URL    = "https://REPLACE.supabase.co";
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY";
// 3. In Supabase → Auth → URL Configuration, add your deployed URL to "Site URL"
// ───────────────────────────────────────────────────────────────────────────────

// ─── STRIPE CONFIG ─────────────────────────────────────────────────────────────
// 1. Replace with your Stripe publishable key (starts with pk_live_ or pk_test_)
const STRIPE_PUBLISHABLE_KEY = "pk_test_REPLACE_WITH_YOUR_KEY";
// 2. Replace with your $9/mo subscription Price ID from Stripe dashboard
const STRIPE_PRICE_ID = "price_REPLACE_WITH_YOUR_PRICE_ID";
// 3. Set these to your actual deployed URLs
const SUCCESS_URL = `${window.location.origin}${window.location.pathname}?checkout=success`;
const CANCEL_URL  = `${window.location.origin}${window.location.pathname}?checkout=cancelled`;
// ───────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [exercises, setExercises] = useState(() => {
    try { const s = localStorage.getItem("overload_exercises"); return s ? JSON.parse(s) : SAMPLE_DATA; } catch { return SAMPLE_DATA; }
  });
  const [view, setView] = useState("dashboard");
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [newExName, setNewExName] = useState("");
  const [logState, setLogState] = useState({ exercise: "", sets: [{ reps: "", weight: "" }] });
  const [flash, setFlash] = useState(null);
  const [timer, setTimer] = useState({ active: false, total: 90, remaining: 90 });
  const timerRef = useRef(null);
  const [coachMessages, setCoachMessages] = useState([]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [isPro, setIsPro] = useState(() => {
    try { return localStorage.getItem("overload_pro") === "true"; } catch { return false; }
  });
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const chatEndRef = useRef(null);
  const [showLanding, setShowLanding] = useState(() => {
    try { return localStorage.getItem("overload_visited") !== "true"; } catch { return true; }
  });
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [prModal, setPrModal] = useState(null);
  const prCanvasRef = useRef(null);
  const [guestMode, setGuestMode] = useState(() => {
    try { return localStorage.getItem("overload_guest") === "true"; } catch { return false; }
  });

  // ── Auth state ───────────────────────────────────────────────────────────────
  const [user, setUser]           = useState(null);   // null = not signed in
  const [authReady, setAuthReady] = useState(false);  // true once session checked
  const [authEmail, setAuthEmail] = useState("");
  const [authSent, setAuthSent]   = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const supabaseRef = useRef(null);

  // Load Supabase JS and initialise once
  useEffect(() => {
    const init = async () => {
      if (!window.supabase) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      supabaseRef.current = client;

      // Handle existing session on mount
      const { data: { session } } = await client.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setShowLanding(false);
        await loadFromSupabase(client);
      }
      setAuthReady(true);

      // Listen for sign-in / sign-out events
      client.auth.onAuthStateChange(async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          setShowLanding(false);
          if (window.location.hash.includes("access_token")) {
            window.history.replaceState({}, "", window.location.pathname);
          }
          await loadFromSupabase(client);
        }
      });
    };
    init().catch(console.error);
  }, []);

  const sendMagicLink = async () => {
    if (!authEmail.trim()) return;
    setAuthLoading(true); setAuthError("");
    try {
      const { error } = await supabaseRef.current.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: window.location.href }
      });
      if (error) throw error;
      setAuthSent(true);
    } catch (e) {
      setAuthError(e.message || "Something went wrong. Check your Supabase config.");
    }
    setAuthLoading(false);
  };

  const signOut = async () => {
    await supabaseRef.current?.auth.signOut();
    setUser(null);
    setGuestMode(false);
    setShowLanding(false); // go to auth screen
    try { localStorage.removeItem("overload_guest"); } catch {}
    triggerFlash("Signed out");
  };

  const getPR = (name) => {
    const hist = exercises[name];
    if (!hist || hist.length === 0) return null;
    let best = { weight: 0, reps: 0, date: "" };
    hist.forEach(session => {
      session.sets.forEach(s => {
        if (s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) {
          best = { weight: s.weight, reps: s.reps, date: session.date };
        }
      });
    });
    return best;
  };

  const generatePRCard = (name) => {
    const pr = getPR(name);
    if (!pr) return;
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 480;
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, 800, 480);

    // Accent bar
    ctx.fillStyle = "#e8ff47";
    ctx.fillRect(0, 0, 6, 480);

    // Grid lines
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      ctx.beginPath(); ctx.moveTo(i * 44, 0); ctx.lineTo(i * 44, 480); ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * 44); ctx.lineTo(800, i * 44); ctx.stroke();
    }

    // PR badge
    ctx.fillStyle = "rgba(232,255,71,0.12)";
    ctx.fillRect(40, 36, 100, 30);
    ctx.fillStyle = "#e8ff47";
    ctx.font = "bold 13px monospace";
    ctx.letterSpacing = "3px";
    ctx.fillText("PERSONAL RECORD", 52, 56);

    // Exercise name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 72px Arial Narrow, Arial";
    ctx.fillText(name.toUpperCase(), 40, 160);

    // Weight — big
    ctx.fillStyle = "#e8ff47";
    ctx.font = "bold 120px Arial Narrow, Arial";
    ctx.fillText(`${pr.weight}`, 40, 300);

    // lbs label
    ctx.fillStyle = "#666";
    ctx.font = "bold 36px Arial Narrow, Arial";
    ctx.fillText("LBS", 40 + ctx.measureText(`${pr.weight}`).width + 12, 290);

    // Reps
    ctx.fillStyle = "#aaa";
    ctx.font = "bold 32px Arial Narrow, Arial";
    ctx.fillText(`${pr.reps} reps`, 42, 350);

    // Date
    ctx.fillStyle = "#444";
    ctx.font = "14px monospace";
    ctx.fillText(new Date(pr.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase(), 42, 390);

    // App name watermark
    ctx.fillStyle = "#222";
    ctx.font = "bold 22px Arial Narrow, Arial";
    ctx.textAlign = "right";
    ctx.fillText("OVERLOAD", 760, 450);

    setPrModal({ exercise: name, ...pr, dataUrl: canvas.toDataURL("image/png") });
  };

  const sharePR = async (dataUrl, name) => {
    // Try Web Share API first (mobile)
    if (navigator.share && navigator.canShare) {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], `${name}-PR.png`, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `My ${name} PR`, text: `Check out my new ${name} personal record! 💪` });
          return;
        }
      } catch {}
    }
    // Fallback: download
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${name.replace(/\s+/g, "-")}-PR.png`;
    a.click();
  };

  // ── Check for Stripe redirect on mount ──────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      setIsPro(true);
      setShowLanding(false);
      triggerFlash("🎉 Pro unlocked! Welcome.");
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("checkout") === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // ── Load Stripe.js and redirect to checkout ──────────────────────────────────
  const handleStripeCheckout = async () => {
    setStripeLoading(true);
    try {
      // Dynamically load Stripe.js if not already loaded
      if (!window.Stripe) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://js.stripe.com/v3/";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
      const { error } = await stripe.redirectToCheckout({
        lineItems: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
        mode: "subscription",
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      });
      if (error) { alert(error.message); }
    } catch (e) {
      alert("Couldn't load Stripe. Check your publishable key.");
    }
    setStripeLoading(false);
  };

  // Persist exercises whenever they change
  useEffect(() => {
    try { localStorage.setItem("overload_exercises", JSON.stringify(exercises)); } catch {}
  }, [exercises]);

  // Persist pro status
  useEffect(() => {
    try { localStorage.setItem("overload_pro", isPro); } catch {}
  }, [isPro]);

  // ── PWA Setup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // 1. Inject mobile/PWA meta tags into <head>
    const metas = [
      { name: "viewport",                content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "mobile-web-app-capable",  content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Overload" },
      { name: "theme-color",             content: "#0a0a0a" },
    ];
    metas.forEach(({ name, content }) => {
      if (!document.querySelector(`meta[name="${name}"]`)) {
        const m = document.createElement("meta");
        m.name = name; m.content = content;
        document.head.appendChild(m);
      }
    });
    document.title = "Overload — Progressive Strength Tracker";

    // 2. Inject Web App Manifest as a blob
    const manifest = {
      name: "Overload",
      short_name: "Overload",
      description: "Progressive overload strength tracker with AI coach",
      start_url: "/",
      display: "standalone",
      background_color: "#0a0a0a",
      theme_color: "#0a0a0a",
      orientation: "portrait",
      icons: [
        { src: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect width='192' height='192' fill='%230a0a0a'/><rect x='0' y='0' width='8' height='192' fill='%23e8ff47'/><text x='24' y='130' font-family='Arial Black,Arial' font-weight='900' font-size='80' fill='%23ffffff'>OL</text></svg>`), sizes: "192x192", type: "image/svg+xml" },
        { src: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><rect width='512' height='512' fill='%230a0a0a'/><rect x='0' y='0' width='20' height='512' fill='%23e8ff47'/><text x='60' y='340' font-family='Arial Black,Arial' font-weight='900' font-size='210' fill='%23ffffff'>OL</text></svg>`), sizes: "512x512", type: "image/svg+xml" },
      ],
      screenshots: [],
      categories: ["health", "fitness", "sports"],
    };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    const existingLink = document.querySelector("link[rel='manifest']");
    if (existingLink) existingLink.href = manifestUrl;
    else {
      const link = document.createElement("link");
      link.rel = "manifest"; link.href = manifestUrl;
      document.head.appendChild(link);
    }

    // 3. Register Service Worker (cache-first for offline support)
    if ("serviceWorker" in navigator) {
      const swCode = `
const CACHE = "overload-v1";
const PRECACHE = ["/"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Network-first for API calls, cache-first for everything else
  const url = new URL(e.request.url);
  const isApi = url.hostname.includes("supabase") || url.hostname.includes("stripe") || url.hostname.includes("anthropic");
  if (isApi || e.request.method !== "GET") return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
      `;
      const swBlob = new Blob([swCode], { type: "application/javascript" });
      const swUrl = URL.createObjectURL(swBlob);
      navigator.serviceWorker.register(swUrl, { scope: "/" })
        .then(reg => console.log("SW registered:", reg.scope))
        .catch(err => console.warn("SW registration failed (blob SW requires HTTPS in production):", err));
    }

    return () => URL.revokeObjectURL(manifestUrl);
  }, []);

  // ── Install prompt (Add to Home Screen) ──────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setShowInstallBanner(false); triggerFlash("App installed! 🎉"); }
    setInstallPrompt(null);
  };

  // Mark as visited when landing CTA is clicked (goes to auth screen)
  const handleStart = () => {
    try { localStorage.setItem("overload_visited", "true"); } catch {}
    setShowLanding(false);
  };

  const continueAsGuest = () => {
    try {
      localStorage.setItem("overload_visited", "true");
      localStorage.setItem("overload_guest", "true");
    } catch {}
    setShowLanding(false);
    setGuestMode(true);
  };

  const startTimer = (secs) => {
    clearInterval(timerRef.current);
    setTimer({ active: true, total: secs, remaining: secs });
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t.remaining <= 1) { clearInterval(timerRef.current); return { ...t, active: false, remaining: 0 }; }
        return { ...t, remaining: t.remaining - 1 };
      });
    }, 1000);
  };

  const stopTimer = () => { clearInterval(timerRef.current); setTimer(t => ({ ...t, active: false })); };

  useEffect(() => () => clearInterval(timerRef.current), []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [coachMessages]);

  // ── Mobile keyboard handling ─────────────────────────────────────────────────
  const logWrapRef = useRef(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // When keyboard opens, visualViewport height shrinks
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
      if (logWrapRef.current) {
        logWrapRef.current.style.paddingBottom = keyboardHeight > 50
          ? `${keyboardHeight + 16}px`
          : "";
      }
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => { vv.removeEventListener("resize", onResize); vv.removeEventListener("scroll", onResize); };
  }, []);

  const scrollInputIntoView = (e) => {
    // Small delay lets the keyboard finish opening before scrolling
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 320);
  };

  // ── Supabase data sync ────────────────────────────────────────────────────────
  const loadFromSupabase = async (client) => {
    try {
      const { data, error } = await client
        .from("Overload_workouts")
        .select("exercise, date, sets")
        .order("date", { ascending: true });
      if (error) { console.error("Load error:", error.message); return; }
      if (!data || data.length === 0) return;
      // Rebuild exercises state: { [exercise]: [{ date, sets }] }
      const rebuilt = {};
      data.forEach(row => {
        if (!rebuilt[row.exercise]) rebuilt[row.exercise] = [];
        rebuilt[row.exercise].push({ date: row.date, sets: row.sets });
      });
      setExercises(rebuilt);
    } catch (e) { console.error("Supabase load failed:", e); }
  };

  const saveToSupabase = async (exercise, date, sets) => {
    const client = supabaseRef.current;
    if (!client) return;
    const { data: { user: currentUser } } = await client.auth.getUser();
    if (!currentUser) return;
    const { error } = await client
      .from("Overload_workouts")
      .insert({ user_id: currentUser.id, exercise, date, sets });
    if (error) console.error("Save error:", error.message);
  };

  const buildDataSummary = () => {
    return Object.entries(exercises).map(([name, sessions]) => {
      const vols = sessions.map(s => ({ date: s.date, vol: s.sets.reduce((a, x) => a + x.reps * x.weight, 0), topWeight: Math.max(...s.sets.map(x => x.weight)), sets: s.sets.length }));
      return `${name}: ${sessions.length} sessions, latest ${sessions[sessions.length-1].date}, top weight ${vols[vols.length-1].topWeight}lbs, recent volumes: ${vols.slice(-3).map(v => v.vol).join(' → ')}`;
    }).join('\n');
  };

  const generateWeeklyReport = async () => {
    setReportLoading(true);
    setWeeklyReport(null);
    const summary = buildDataSummary();
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: "You are an expert strength coach. Be direct, specific, and motivating. Use data to back up every recommendation. Keep responses concise — use short paragraphs, no bullet points unless listing exercises. Address the athlete directly.",
          messages: [{ role: "user", content: `Here is my workout data:\n${summary}\n\nGive me a weekly coaching report. Cover: (1) what's going well, (2) where I'm stalling or at risk of stalling, (3) one concrete change to make this week. Be specific about exercises and numbers.` }]
        })
      });
      const data = await res.json();
      setWeeklyReport(data.content?.[0]?.text || "Couldn't generate report.");
    } catch { setWeeklyReport("Error connecting to coach. Try again."); }
    setReportLoading(false);
  };

  const sendCoachMessage = async () => {
    if (!coachInput.trim() || coachLoading) return;
    const userMsg = { role: "user", content: coachInput.trim() };
    const newMessages = [...coachMessages, userMsg];
    setCoachMessages(newMessages);
    setCoachInput("");
    setCoachLoading(true);
    const summary = buildDataSummary();
    const systemPrompt = `You are an expert strength coach with access to the athlete's full workout history:\n${summary}\n\nBe direct, specific, and back up advice with their actual numbers. Keep responses concise.`;
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "No response.";
      setCoachMessages(m => [...m, { role: "assistant", content: reply }]);
    } catch { setCoachMessages(m => [...m, { role: "assistant", content: "Connection error. Try again." }]); }
    setCoachLoading(false);
  };

  const triggerFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2200);
  };

  const addSet = () => setLogState(s => ({ ...s, sets: [...s.sets, { reps: "", weight: "" }] }));
  const removeSet = (i) => setLogState(s => ({ ...s, sets: s.sets.filter((_, idx) => idx !== i) }));
  const updateSet = (i, field, val) => setLogState(s => ({
    ...s, sets: s.sets.map((set, idx) => idx === i ? { ...set, [field]: val } : set)
  }));

  const saveLog = async () => {
    if (!logState.exercise.trim()) return;
    const today = new Date().toISOString().split("T")[0];
    const entry = {
      date: today,
      sets: logState.sets.filter(s => s.reps && s.weight).map(s => ({ reps: +s.reps, weight: +s.weight }))
    };
    if (entry.sets.length === 0) return;
    // Update local state immediately (optimistic)
    setExercises(prev => ({
      ...prev,
      [logState.exercise]: [...(prev[logState.exercise] || []), entry]
    }));
    // Persist to Supabase if signed in, localStorage for guests
    if (user) {
      await saveToSupabase(logState.exercise, today, entry.sets);
    }
    triggerFlash(`✓ ${logState.exercise} logged`);
    setLogState({ exercise: "", sets: [{ reps: "", weight: "" }] });
    setView("dashboard");
  };

  const exNames = Object.keys(exercises);
  const lastSessions = exNames.map(name => {
    const hist = exercises[name];
    const last = hist[hist.length - 1];
    const suggestion = getSuggestion(hist);
    const totalVol = last.sets.reduce((a, s) => a + s.reps * s.weight, 0);
    return { name, last, suggestion, totalVol };
  });

  return (
    <>
      <style>{FONT}{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0a; color: #f0ede8; font-family: 'Barlow', sans-serif; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; }

        .app { min-height: 100vh; background: #0a0a0a; max-width: 480px; margin: 0 auto; position: relative; padding-bottom: 130px; }

        .header { padding: 28px 20px 16px; border-bottom: 1px solid #1e1e1e; display: flex; align-items: flex-end; justify-content: space-between; }
        .logo { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 32px; letter-spacing: -0.5px; text-transform: uppercase; line-height: 1; }
        .logo span { color: #e8ff47; }
        .header-sub { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 2px; }

        .flash { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #e8ff47; color: #0a0a0a; padding: 10px 20px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; z-index: 999; border-radius: 2px; animation: fadeFlash 2.2s ease forwards; }
        @keyframes fadeFlash { 0%{opacity:0;transform:translateX(-50%) translateY(-6px)} 10%{opacity:1;transform:translateX(-50%) translateY(0)} 80%{opacity:1} 100%{opacity:0} }

        .nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; background: #111; border-top: 1px solid #1e1e1e; display: flex; z-index: 100; }
        .nav-btn { flex: 1; padding: 14px 8px; background: none; border: none; color: #555; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; cursor: pointer; transition: color 0.15s; }
        .nav-btn.active { color: #e8ff47; border-top: 2px solid #e8ff47; margin-top: -1px; }
        .nav-btn:hover:not(.active) { color: #aaa; }

        .section-label { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 3px; padding: 20px 20px 10px; }
        .ex-card { margin: 0 16px 10px; background: #111; border: 1px solid #1e1e1e; border-radius: 3px; padding: 16px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
        .ex-card:hover { border-color: #333; background: #141414; }
        .ex-name { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 22px; text-transform: uppercase; letter-spacing: 0.5px; }
        .ex-meta { display: flex; gap: 16px; margin-top: 8px; align-items: center; }
        .ex-stat { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #666; }
        .ex-stat strong { color: #ccc; font-size: 13px; }
        .suggestion-pill { margin-top: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 2px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
        .pill-increase { background: rgba(232,255,71,0.1); color: #e8ff47; border: 1px solid rgba(232,255,71,0.25); }
        .pill-maintain { background: rgba(255,165,0,0.08); color: #ffa533; border: 1px solid rgba(255,165,0,0.2); }
        .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

        .log-wrap { padding: 0 16px; }
        .field-label { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; margin-top: 20px; display: block; }
        .ex-select { width: 100%; background: #111; border: 1px solid #222; color: #f0ede8; padding: 12px 14px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; border-radius: 2px; appearance: none; cursor: pointer; }
        .ex-select:focus { outline: none; border-color: #e8ff47; }
        .new-ex-row { display: flex; gap: 8px; margin-top: 8px; }
        .input-sm { flex: 1; background: #111; border: 1px solid #222; color: #f0ede8; padding: 10px 12px; font-family: 'Barlow', sans-serif; font-size: 14px; border-radius: 2px; }
        .input-sm:focus { outline: none; border-color: #e8ff47; }
        .btn-ghost { background: none; border: 1px solid #333; color: #999; padding: 10px 14px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; border-radius: 2px; cursor: pointer; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #e8ff47; color: #e8ff47; }

        .sets-header { display: grid; grid-template-columns: 32px 1fr 1fr 32px; gap: 8px; align-items: center; margin-top: 20px; }
        .sets-header span { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 2px; }
        .set-row { display: grid; grid-template-columns: 32px 1fr 1fr 32px; gap: 8px; align-items: center; margin-top: 8px; }
        .set-num { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 20px; color: #333; text-align: center; }
        .set-input { background: #111; border: 1px solid #222; color: #f0ede8; padding: 12px; font-family: 'Share Tech Mono', monospace; font-size: 16px; text-align: center; border-radius: 2px; width: 100%; }
        .set-input:focus { outline: none; border-color: #e8ff47; }
        .remove-btn { background: none; border: none; color: #333; font-size: 18px; cursor: pointer; text-align: center; transition: color 0.15s; }
        .remove-btn:hover { color: #ff4444; }

        .add-set-btn { width: 100%; margin-top: 12px; background: none; border: 1px dashed #222; color: #555; padding: 12px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; border-radius: 2px; transition: all 0.15s; }
        .add-set-btn:hover { border-color: #555; color: #999; }

        .save-btn { width: 100%; margin-top: 24px; background: #e8ff47; color: #0a0a0a; border: none; padding: 16px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 20px; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; border-radius: 2px; transition: background 0.15s; }
        .save-btn:hover { background: #f5ff8a; }

        .prev-hint { background: #0f1a00; border: 1px solid #2a3a00; border-radius: 2px; padding: 12px 14px; margin-top: 12px; }
        .prev-hint-title { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #6a8a00; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
        .prev-sets { display: flex; flex-wrap: wrap; gap: 6px; }
        .prev-set-tag { font-family: 'Share Tech Mono', monospace; font-size: 12px; color: #a8c800; background: rgba(168,200,0,0.1); padding: 3px 8px; border-radius: 2px; }
        .suggest-badge { margin-top: 8px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; color: #e8ff47; text-transform: uppercase; letter-spacing: 1px; }

        .hist-ex-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px 8px; }
        .hist-ex-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 26px; text-transform: uppercase; }
        .hist-back { background: none; border: 1px solid #222; color: #777; padding: 6px 12px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; }
        .hist-back:hover { color: #ccc; border-color: #444; }

        .hist-list { padding: 0 16px; }
        .hist-entry { border-left: 2px solid #1e1e1e; padding: 0 0 20px 16px; margin-left: 4px; position: relative; }
        .hist-entry:last-child { border-left-color: transparent; }
        .hist-dot { position: absolute; left: -5px; top: 3px; width: 8px; height: 8px; border-radius: 50%; background: #333; border: 2px solid #1e1e1e; }
        .hist-entry.latest .hist-dot { background: #e8ff47; border-color: #e8ff47; }
        .hist-date { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .hist-sets-grid { display: flex; gap: 8px; flex-wrap: wrap; }
        .hist-set { background: #111; border: 1px solid #1e1e1e; padding: 8px 12px; border-radius: 2px; }
        .hist-set-weight { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 20px; }
        .hist-set-reps { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; margin-top: 2px; }
        .vol-chip { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; margin-top: 8px; }

        .ex-list-hist { padding: 0 16px; }
        .ex-hist-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: #111; border: 1px solid #1e1e1e; border-radius: 2px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
        .ex-hist-row:hover { border-color: #333; }
        .ex-hist-name { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 20px; text-transform: uppercase; }
        .ex-hist-count { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #555; }
        .arrow { color: #333; font-size: 16px; }

        .empty { text-align: center; padding: 48px 20px; color: #333; }
        .empty-icon { font-size: 40px; margin-bottom: 12px; }
        .empty-text { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; color: #444; }

        /* Timer */
        .timer-bar { position: fixed; bottom: 57px; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; background: #0d1500; border-top: 1px solid #2a3a00; z-index: 99; padding: 10px 16px; display: flex; align-items: center; gap: 12px; }
        .timer-time { font-family: 'Share Tech Mono', monospace; font-size: 28px; color: #e8ff47; min-width: 64px; line-height: 1; }
        .timer-time.done { color: #ff4444; animation: pulse 0.6s ease infinite alternate; }
        @keyframes pulse { from{opacity:1} to{opacity:0.4} }
        .timer-progress { flex: 1; height: 3px; background: #1a2a00; border-radius: 2px; overflow: hidden; }
        .timer-fill { height: 100%; background: #e8ff47; transition: width 1s linear; border-radius: 2px; }
        .timer-fill.done { background: #ff4444; }
        .timer-presets { display: flex; gap: 6px; }
        .timer-preset { background: none; border: 1px solid #2a3a00; color: #6a8a00; padding: 5px 9px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; transition: all 0.15s; }
        .timer-preset:hover, .timer-preset.sel { border-color: #e8ff47; color: #e8ff47; background: rgba(232,255,71,0.06); }
        .timer-stop { background: none; border: 1px solid #2a1010; color: #663333; padding: 5px 9px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; transition: all 0.15s; }
        .timer-stop:hover { border-color: #ff4444; color: #ff4444; }
        .timer-trigger { width: 100%; margin-top: 10px; background: none; border: 1px solid #2a3a00; color: #6a8a00; padding: 11px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; border-radius: 2px; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .timer-trigger:hover { border-color: #e8ff47; color: #e8ff47; background: rgba(232,255,71,0.04); }

        /* AI Coach */
        .coach-wrap { padding: 0 16px 16px; }
        .pro-banner { margin: 16px 0; background: linear-gradient(135deg, #1a1200, #0d1a00); border: 1px solid #3a2a00; border-radius: 3px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .pro-label { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #e8a020; background: rgba(232,160,32,0.15); border: 1px solid rgba(232,160,32,0.3); padding: 3px 8px; border-radius: 2px; display: inline-block; margin-bottom: 4px; }
        .pro-text { font-family: 'Barlow', sans-serif; font-size: 13px; color: #888; line-height: 1.4; }
        .pro-btn { background: #e8a020; border: none; color: #0a0a0a; padding: 10px 16px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; white-space: nowrap; transition: background 0.15s; }
        .pro-btn:hover { background: #ffb830; }
        .pro-btn.active { background: #555; color: #aaa; }

        .report-card { background: #0d1200; border: 1px solid #2a3a00; border-radius: 3px; padding: 18px; margin-bottom: 16px; }
        .report-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .report-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; color: #e8ff47; }
        .gen-btn { background: #e8ff47; border: none; color: #0a0a0a; padding: 8px 14px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; transition: background 0.15s; }
        .gen-btn:hover { background: #f5ff8a; }
        .gen-btn:disabled { background: #2a3a00; color: #6a8a00; cursor: not-allowed; }
        .report-body { font-family: 'Barlow', sans-serif; font-size: 14px; color: #ccc; line-height: 1.7; white-space: pre-wrap; }
        .report-placeholder { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #444; text-align: center; padding: 20px 0; }
        .typing-dot { display: inline-block; animation: blink 1s infinite; } @keyframes blink { 0%,100%{opacity:0} 50%{opacity:1} }

        .chat-section { margin-top: 8px; }
        .chat-label { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 10px; }
        .chat-messages { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
        .chat-msg { padding: 11px 13px; border-radius: 3px; font-family: 'Barlow', sans-serif; font-size: 14px; line-height: 1.6; }
        .chat-msg.user { background: #151515; border: 1px solid #222; color: #f0ede8; align-self: flex-end; max-width: 85%; }
        .chat-msg.assistant { background: #0d1200; border: 1px solid #2a3a00; color: #ccc; align-self: flex-start; max-width: 92%; }
        .chat-msg.assistant .msg-label { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #6a8a00; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px; }
        .chat-input-row { display: flex; gap: 8px; }
        .chat-input { flex: 1; background: #111; border: 1px solid #222; color: #f0ede8; padding: 12px 14px; font-family: 'Barlow', sans-serif; font-size: 14px; border-radius: 2px; resize: none; }
        .chat-input:focus { outline: none; border-color: #e8ff47; }
        .chat-send { background: #e8ff47; border: none; color: #0a0a0a; padding: 12px 16px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 16px; cursor: pointer; border-radius: 2px; transition: background 0.15s; }
        .chat-send:hover { background: #f5ff8a; }
        .chat-send:disabled { background: #222; color: #444; cursor: not-allowed; }
        .lock-overlay { position: relative; }
        .lock-overlay::after { content: '🔒 PRO'; position: absolute; inset: 0; background: rgba(10,10,10,0.85); display: flex; align-items: center; justify-content: center; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 18px; color: #e8a020; letter-spacing: 2px; border-radius: 3px; pointer-events: none; }

        /* Upgrade Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 300; display: flex; align-items: flex-end; justify-content: center; }
        .modal-sheet { background: #0f0f0f; border: 1px solid #222; border-bottom: none; border-radius: 6px 6px 0 0; width: 100%; max-width: 480px; padding: 32px 24px 40px; animation: slideUp 0.25s ease; }
        @keyframes slideUp { from{transform:translateY(40px);opacity:0} to{transform:translateY(0);opacity:1} }
        .modal-pill { width: 36px; height: 4px; background: #333; border-radius: 2px; margin: 0 auto 28px; }
        .modal-badge { display: inline-block; background: rgba(232,160,32,0.15); border: 1px solid rgba(232,160,32,0.4); color: #e8a020; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; padding: 4px 10px; border-radius: 2px; margin-bottom: 12px; }
        .modal-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 36px; text-transform: uppercase; letter-spacing: -0.5px; line-height: 1; margin-bottom: 6px; }
        .modal-title em { color: #e8ff47; font-style: normal; }
        .modal-price { font-family: 'Share Tech Mono', monospace; font-size: 13px; color: #555; margin-bottom: 28px; }
        .modal-price strong { color: #aaa; font-size: 16px; }
        .modal-features { display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
        .modal-feat { display: flex; align-items: center; gap: 12px; }
        .modal-feat-check { width: 20px; height: 20px; border-radius: 50%; background: rgba(232,255,71,0.1); border: 1px solid rgba(232,255,71,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0; color: #e8ff47; }
        .modal-feat-text { font-family: 'Barlow', sans-serif; font-size: 14px; color: #aaa; }
        .modal-feat-text strong { color: #f0ede8; font-weight: 500; }
        .stripe-btn { width: 100%; background: #e8ff47; color: #0a0a0a; border: none; padding: 17px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 20px; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; border-radius: 3px; margin-bottom: 10px; transition: background 0.15s, transform 0.1s; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .stripe-btn:hover { background: #f5ff8a; transform: translateY(-1px); }
        .stripe-btn:active { transform: translateY(0); }
        .stripe-btn:disabled { background: #333; color: #666; cursor: not-allowed; transform: none; }
        .stripe-lock { font-size: 14px; }
        .modal-fine { text-align: center; font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #333; text-transform: uppercase; letter-spacing: 2px; line-height: 1.6; }
        .modal-close { position: absolute; top: 16px; right: 20px; background: none; border: none; color: #444; font-size: 20px; cursor: pointer; padding: 4px; }
        .modal-close:hover { color: #aaa; }
        .pro-active-row { display: flex; align-items: center; gap: 8px; background: rgba(232,255,71,0.06); border: 1px solid rgba(232,255,71,0.2); border-radius: 2px; padding: 10px 14px; }
        .pro-active-dot { width: 8px; height: 8px; border-radius: 50%; background: #e8ff47; box-shadow: 0 0 8px #e8ff47; flex-shrink: 0; }
        .pro-active-text { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; color: #e8ff47; text-transform: uppercase; letter-spacing: 1px; }
        .pro-manage { margin-left: auto; font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; cursor: pointer; text-decoration: underline; }
        .pro-manage:hover { color: #aaa; }

        /* Coach empty state */
        .coach-empty { padding: 48px 8px 32px; display: flex; flex-direction: column; align-items: center; text-align: center; }
        .coach-empty-icon { font-size: 48px; margin-bottom: 20px; filter: grayscale(0.3); }
        .coach-empty-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 28px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
        .coach-empty-body { font-family: 'Barlow', sans-serif; font-size: 14px; color: #666; line-height: 1.6; max-width: 300px; margin-bottom: 28px; }
        .coach-empty-cta { background: #e8ff47; color: #0a0a0a; border: none; padding: 14px 24px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 17px; text-transform: uppercase; letter-spacing: 1.5px; cursor: pointer; border-radius: 2px; margin-bottom: 36px; transition: background 0.15s, transform 0.1s; }
        .coach-empty-cta:hover { background: #f5ff8a; transform: translateY(-1px); }
        .coach-empty-steps { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 260px; }
        .coach-empty-step { display: flex; align-items: center; gap: 12px; font-family: 'Barlow', sans-serif; font-size: 13px; color: #555; text-align: left; }
        .coach-empty-step span { width: 22px; height: 22px; border-radius: 50%; border: 1px solid #2a2a2a; display: flex; align-items: center; justify-content: center; font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #444; flex-shrink: 0; }

        /* PR share */
        .share-pr-btn { background: rgba(232,160,32,0.1); border: 1px solid rgba(232,160,32,0.3); color: #e8a020; padding: 6px 12px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; border-radius: 2px; cursor: pointer; transition: all 0.15s; }
        .share-pr-btn:hover { background: rgba(232,160,32,0.2); border-color: #e8a020; }
        .pr-strip { margin: 0 16px 16px; background: linear-gradient(135deg, #1a1200, #0d1000); border: 1px solid rgba(232,160,32,0.25); border-radius: 3px; padding: 14px 16px; display: flex; align-items: center; gap: 16px; }
        .pr-strip-label { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #e8a020; text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; }
        .pr-strip-val { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 28px; color: #e8ff47; line-height: 1; }
        .pr-strip-val span { font-size: 14px; color: #666; font-weight: 400; }
        .pr-strip-reps { font-family: 'Share Tech Mono', monospace; font-size: 12px; color: #888; }
        .pr-strip-date { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; margin-left: auto; white-space: nowrap; }

        /* Landing */
        .landing { min-height: 100vh; background: #0a0a0a; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; overflow: hidden; }
        .landing-hero { padding: 56px 28px 36px; flex: 1; display: flex; flex-direction: column; justify-content: center; }
        .landing-eyebrow { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 4px; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
        .landing-eyebrow::before { content: ''; display: block; width: 24px; height: 1px; background: #333; }
        .landing-logo { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 72px; line-height: 0.9; text-transform: uppercase; letter-spacing: -2px; margin-bottom: 8px; }
        .landing-logo em { color: #e8ff47; font-style: normal; }
        .landing-tagline { font-family: 'Barlow', sans-serif; font-weight: 300; font-size: 18px; color: #666; line-height: 1.5; margin-bottom: 48px; max-width: 300px; }
        .landing-tagline strong { color: #aaa; font-weight: 400; }

        .landing-features { display: flex; flex-direction: column; gap: 0; margin-bottom: 48px; }
        .landing-feat { display: flex; align-items: flex-start; gap: 16px; padding: 16px 0; border-bottom: 1px solid #141414; }
        .landing-feat:first-child { border-top: 1px solid #141414; }
        .feat-icon { width: 36px; height: 36px; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; margin-top: 2px; }
        .feat-icon.yellow { background: rgba(232,255,71,0.08); }
        .feat-icon.orange { background: rgba(255,165,51,0.08); }
        .feat-icon.blue { background: rgba(100,180,255,0.08); }
        .feat-icon.green { background: rgba(100,220,150,0.08); }
        .feat-name { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 17px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
        .feat-desc { font-family: 'Barlow', sans-serif; font-size: 13px; color: #555; line-height: 1.4; }

        .landing-cta { padding: 0 28px 48px; }
        .cta-main { width: 100%; background: #e8ff47; color: #0a0a0a; border: none; padding: 18px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 22px; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; border-radius: 2px; margin-bottom: 10px; transition: background 0.15s, transform 0.1s; }
        .cta-main:hover { background: #f5ff8a; transform: translateY(-1px); }
        .cta-main:active { transform: translateY(0); }
        .cta-sub { text-align: center; font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #333; text-transform: uppercase; letter-spacing: 2px; }

        .landing-stat-row { display: flex; gap: 0; margin-bottom: 48px; }
        .landing-stat { flex: 1; text-align: center; padding: 16px 8px; border-right: 1px solid #141414; }
        .landing-stat:last-child { border-right: none; }
        .stat-num { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 32px; color: #e8ff47; line-height: 1; }
        .stat-lbl { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #444; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px; }

        /* Auth screen */
        .auth-screen { min-height: 100vh; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; padding: 40px 28px; background: #0a0a0a; }
        .auth-logo { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 48px; text-transform: uppercase; letter-spacing: -1px; margin-bottom: 6px; }
        .auth-logo em { color: #e8ff47; font-style: normal; }
        .auth-sub { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 48px; }
        .auth-label { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; display: block; }
        .auth-input { width: 100%; background: #111; border: 1px solid #222; color: #f0ede8; padding: 14px 16px; font-family: 'Barlow', sans-serif; font-size: 16px; border-radius: 2px; margin-bottom: 12px; }
        .auth-input:focus { outline: none; border-color: #e8ff47; }
        .auth-btn { width: 100%; background: #e8ff47; color: #0a0a0a; border: none; padding: 16px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 20px; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; border-radius: 2px; transition: background 0.15s; }
        .auth-btn:hover { background: #f5ff8a; }
        .auth-btn:disabled { background: #333; color: #666; cursor: not-allowed; }
        .auth-sent { background: #0d1a00; border: 1px solid #2a3a00; border-radius: 3px; padding: 20px; text-align: center; }
        .auth-sent-icon { font-size: 32px; margin-bottom: 12px; }
        .auth-sent-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 22px; text-transform: uppercase; color: #e8ff47; margin-bottom: 8px; }
        .auth-sent-body { font-family: 'Barlow', sans-serif; font-size: 13px; color: #666; line-height: 1.6; }
        .auth-sent-email { color: #aaa; font-weight: 500; }
        .auth-error { font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #ff6666; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,68,68,0.06); border: 1px solid rgba(255,68,68,0.2); border-radius: 2px; }
        .auth-divider { display: flex; align-items: center; gap: 12px; margin: 32px 0 20px; }
        .auth-divider-line { flex: 1; height: 1px; background: #1e1e1e; }
        .auth-divider-text { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #333; text-transform: uppercase; letter-spacing: 2px; }
        .auth-guest { width: 100%; background: none; border: 1px solid #222; color: #555; padding: 13px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 16px; text-transform: uppercase; letter-spacing: 1.5px; cursor: pointer; border-radius: 2px; transition: all 0.15s; }
        .auth-guest:hover { border-color: #444; color: #888; }
        .auth-note { font-family: 'Share Tech Mono', monospace; font-size: 9px; color: #2a2a2a; text-transform: uppercase; letter-spacing: 2px; text-align: center; margin-top: 24px; line-height: 1.8; }

        /* Signed-in header badge */
        .user-badge { display: flex; align-items: center; gap: 8px; }
        .user-email { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #444; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .signout-btn { background: none; border: 1px solid #1e1e1e; color: #333; padding: 4px 8px; font-family: 'Share Tech Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; transition: all 0.15s; white-space: nowrap; }
        .signout-btn:hover { border-color: #444; color: #777; }

        /* Install banner */
        .install-banner { position: fixed; top: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 480px; background: #111; border-bottom: 1px solid #2a3a00; z-index: 500; padding: 12px 16px; display: flex; align-items: center; gap: 12px; animation: slideDown 0.3s ease; }
        @keyframes slideDown { from{transform:translateX(-50%) translateY(-100%)} to{transform:translateX(-50%) translateY(0)} }
        .install-icon { font-size: 24px; flex-shrink: 0; }
        .install-text { flex: 1; }
        .install-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
        .install-desc { font-family: 'Share Tech Mono', monospace; font-size: 10px; color: #555; margin-top: 2px; }
        .install-btn { background: #e8ff47; color: #0a0a0a; border: none; padding: 8px 14px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 2px; white-space: nowrap; }
        .install-dismiss { background: none; border: none; color: #333; font-size: 18px; cursor: pointer; padding: 4px; }
      `}</style>

      <div className="app">
        {flash && <div className="flash">{flash}</div>}

        {/* Add to Home Screen banner */}
        {showInstallBanner && (
          <div className="install-banner">
            <div className="install-icon">💪</div>
            <div className="install-text">
              <div className="install-title">Add to Home Screen</div>
              <div className="install-desc">Use like a native app — works offline</div>
            </div>
            <button className="install-btn" onClick={handleInstall}>Install</button>
            <button className="install-dismiss" onClick={() => setShowInstallBanner(false)}>✕</button>
          </div>
        )}

        {/* 1. Loading — while Supabase initialises */}
        {!authReady && (
          <div style={{minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0a0a'}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:'#333', textTransform:'uppercase', letterSpacing:'3px'}}>Loading<span className="typing-dot">▮</span></div>
          </div>
        )}

        {/* 2. Landing — first-time visitors (authed or not) */}
        {authReady && showLanding && (
          <div className="landing">
            <div className="landing-hero">
              <div className="landing-eyebrow">Strength tracker</div>
              <div className="landing-logo">Over<em>load</em></div>
              <div className="landing-tagline">
                The simple tracker that tells you <strong>exactly what to lift next session</strong> — and gets smarter over time.
              </div>

              <div className="landing-stat-row">
                <div className="landing-stat">
                  <div className="stat-num">+5</div>
                  <div className="stat-lbl">lbs / week</div>
                </div>
                <div className="landing-stat">
                  <div className="stat-num">3</div>
                  <div className="stat-lbl">taps to log</div>
                </div>
                <div className="landing-stat">
                  <div className="stat-num">AI</div>
                  <div className="stat-lbl">coaching</div>
                </div>
              </div>

              <div className="landing-features">
                {[
                  { icon: '📈', cls: 'yellow', name: 'Progressive Overload', desc: 'Auto-calculates your next target weight based on performance' },
                  { icon: '⏱', cls: 'orange', name: 'Rest Timer', desc: 'Built-in countdown so you never cut rest short' },
                  { icon: '🤖', cls: 'blue', name: 'AI Coach', desc: 'Weekly analysis + chat coach that knows your actual numbers' },
                  { icon: '📋', cls: 'green', name: 'Session History', desc: 'Full timeline of every set, rep, and PR you\'ve hit' },
                ].map(f => (
                  <div className="landing-feat" key={f.name}>
                    <div className={`feat-icon ${f.cls}`}>{f.icon}</div>
                    <div>
                      <div className="feat-name">{f.name}</div>
                      <div className="feat-desc">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-cta">
              <button className="cta-main" onClick={handleStart}>
                Start Training — Free
              </button>
              <div className="cta-sub">No account needed · AI Coach from $9/mo</div>
            </div>
          </div>
        )}

        {/* 3. Auth screen — after landing, before app, if not signed in and not guest */}
        {authReady && !showLanding && !user && !guestMode && (
          <div className="auth-screen">
            <div className="auth-logo">Over<em>load</em></div>
            <div className="auth-sub">Sign in to sync your data</div>

            {!authSent ? (<>
              <label className="auth-label">Your email</label>
              <input
                className="auth-input"
                type="email"
                inputMode="email"
                placeholder="athlete@example.com"
                value={authEmail}
                onChange={e => { setAuthEmail(e.target.value); setAuthError(""); }}
                onKeyDown={e => e.key === "Enter" && sendMagicLink()}
                autoFocus
              />
              {authError && <div className="auth-error">{authError}</div>}
              <button className="auth-btn" disabled={authLoading || !authEmail.trim()} onClick={sendMagicLink}>
                {authLoading ? "Sending..." : "Send Magic Link →"}
              </button>
              <div className="auth-divider">
                <div className="auth-divider-line" />
                <div className="auth-divider-text">or</div>
                <div className="auth-divider-line" />
              </div>
              <button className="auth-guest" onClick={continueAsGuest}>
                Continue as guest
              </button>
              <div className="auth-note">
                Magic link = no password needed · Click the link we email you<br/>
                Your data syncs across all your devices when signed in
              </div>
            </>) : (
              <div className="auth-sent">
                <div className="auth-sent-icon">📬</div>
                <div className="auth-sent-title">Check your inbox</div>
                <div className="auth-sent-body">
                  We sent a magic link to <span className="auth-sent-email">{authEmail}</span>.<br/>
                  Click it to sign in — no password needed.<br/><br/>
                  <span style={{color:'#444'}}>Wrong email?</span>{" "}
                  <span style={{color:'#e8ff47', cursor:'pointer', fontWeight:500}} onClick={() => { setAuthSent(false); setAuthEmail(""); }}>Start over</span>
                  <br/><br/>
                  <span style={{color:'#555', fontSize:12}}>Can't wait? </span>
                  <span style={{color:'#888', cursor:'pointer', fontSize:12, textDecoration:'underline'}} onClick={continueAsGuest}>Continue as guest</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. Main app — signed in OR guest */}
        {authReady && !showLanding && (user || guestMode) && (<>

        <div className="header">
          <div>
            <div className="logo">Over<span>load</span></div>
            <div className="header-sub" style={{marginTop: 4}}>Progressive strength tracker</div>
          </div>
          <div className="user-badge">
            {user ? (<>
              <div className="user-email">{user.email}</div>
              <button className="signout-btn" onClick={signOut}>Sign out</button>
            </>) : (
              <button className="signout-btn" onClick={() => { setGuestMode(false); try { localStorage.removeItem("overload_guest"); } catch {} }}>Sign in</button>
            )}
          </div>
        </div>

        {view === "dashboard" && (
          <div>
            <div className="section-label">Next session targets</div>
            {lastSessions.length === 0 && (
              <div className="empty">
                <div className="empty-icon">🏋️</div>
                <div className="empty-text">No exercises logged yet</div>
              </div>
            )}
            {lastSessions.map(({ name, last, suggestion, totalVol }) => (
              <div className="ex-card" key={name} onClick={() => { setSelectedExercise(name); setView("history"); }}>
                <div className="ex-name">{name}</div>
                <div className="ex-meta">
                  <div className="ex-stat">Last: <strong>{formatDate(last.date)}</strong></div>
                  <div className="ex-stat">Sets: <strong>{last.sets.length}</strong></div>
                  <div className="ex-stat">Vol: <strong>{totalVol.toLocaleString()} lbs</strong></div>
                </div>
                {suggestion && (
                  <div className={`suggestion-pill ${suggestion.type === 'increase' ? 'pill-increase' : 'pill-maintain'}`}>
                    <span className="pill-dot"></span>
                    {suggestion.type === 'increase' ? `↑ ${suggestion.weight} lbs × ${suggestion.reps}` : `Hold at ${suggestion.weight} lbs`}
                    <span style={{opacity:.6, fontSize:11, marginLeft:4}}>{suggestion.msg}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {view === "log" && (
          <div className="log-wrap" ref={logWrapRef}>
            <div style={{padding:'20px 0 0'}}>
              <span className="field-label">Exercise</span>
              <select
                className="ex-select"
                value={logState.exercise}
                onChange={e => setLogState(s => ({...s, exercise: e.target.value}))}
              >
                <option value="">— Select exercise —</option>
                {exNames.map(n => <option key={n} value={n}>{n}</option>)}
                <option value="__new__">+ Add new exercise</option>
              </select>

              {logState.exercise === "__new__" && (
                <div className="new-ex-row">
                  <input
                    className="input-sm"
                    placeholder="Exercise name"
                    value={newExName}
                    onChange={e => setNewExName(e.target.value)}
                    onFocus={scrollInputIntoView}
                    onKeyDown={e => {
                      if (e.key === "Enter" && newExName.trim()) {
                        setLogState(s => ({...s, exercise: newExName.trim()}));
                        setNewExName("");
                      }
                    }}
                  />
                  <button className="btn-ghost" onClick={() => {
                    if (newExName.trim()) {
                      setLogState(s => ({...s, exercise: newExName.trim()}));
                      setNewExName("");
                    }
                  }}>Add</button>
                </div>
              )}

              {logState.exercise && logState.exercise !== "__new__" && exercises[logState.exercise] && (
                (() => {
                  const hist = exercises[logState.exercise];
                  const last = hist[hist.length - 1];
                  const sug = getSuggestion(hist);
                  return (
                    <div className="prev-hint">
                      <div className="prev-hint-title">Last session · {formatDate(last.date)}</div>
                      <div className="prev-sets">
                        {last.sets.map((s, i) => (
                          <span className="prev-set-tag" key={i}>{s.weight}lbs × {s.reps}</span>
                        ))}
                      </div>
                      {sug && <div className="suggest-badge">→ Today: aim for {sug.weight} lbs × {sug.reps}</div>}
                    </div>
                  );
                })()
              )}
            </div>

            <div className="sets-header">
              <span>#</span>
              <span>Weight (lbs)</span>
              <span>Reps</span>
              <span></span>
            </div>

            {logState.sets.map((set, i) => (
              <div className="set-row" key={i}>
                <div className="set-num">{i + 1}</div>
                <input
                  className="set-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="135"
                  value={set.weight}
                  onChange={e => updateSet(i, "weight", e.target.value)}
                  onFocus={scrollInputIntoView}
                />
                <input
                  className="set-input"
                  type="number"
                  inputMode="numeric"
                  placeholder="8"
                  value={set.reps}
                  onChange={e => updateSet(i, "reps", e.target.value)}
                  onFocus={scrollInputIntoView}
                />
                <button className="remove-btn" onClick={() => removeSet(i)}>×</button>
              </div>
            ))}

            <button className="add-set-btn" onClick={addSet}>+ Add Set</button>

            <button className="timer-trigger" onClick={() => startTimer(timer.total)}>
              ⏱ Start Rest Timer · {timer.total === 60 ? '1 min' : timer.total === 90 ? '90 sec' : '2 min'}
            </button>
            <button className="save-btn" onClick={saveLog}>Log Session</button>
          </div>
        )}

        {view === "history" && !selectedExercise && (
          <div>
            <div className="section-label">All exercises</div>
            <div className="ex-list-hist">
              {exNames.map(name => (
                <div className="ex-hist-row" key={name} onClick={() => setSelectedExercise(name)}>
                  <div>
                    <div className="ex-hist-name">{name}</div>
                    <div className="ex-hist-count">{exercises[name].length} session{exercises[name].length !== 1 ? 's' : ''}</div>
                  </div>
                  <span className="arrow">›</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "history" && selectedExercise && (
          <div>
            <div className="hist-ex-header">
              <div className="hist-ex-title">{selectedExercise}</div>
              <div style={{display:'flex', gap:8}}>
                <button className="share-pr-btn" onClick={() => generatePRCard(selectedExercise)}>🏆 Share PR</button>
                <button className="hist-back" onClick={() => setSelectedExercise(null)}>← Back</button>
              </div>
            </div>
            {/* PR summary strip */}
            {(() => { const pr = getPR(selectedExercise); return pr ? (
              <div className="pr-strip">
                <div className="pr-strip-label">Personal Record</div>
                <div className="pr-strip-val">{pr.weight} <span>lbs</span></div>
                <div className="pr-strip-reps">× {pr.reps} reps</div>
                <div className="pr-strip-date">{formatDate(pr.date)}</div>
              </div>
            ) : null; })()}
            <div className="hist-list">
              {[...exercises[selectedExercise]].reverse().map((entry, i) => {
                const vol = entry.sets.reduce((a, s) => a + s.reps * s.weight, 0);
                return (
                  <div className={`hist-entry ${i === 0 ? 'latest' : ''}`} key={i}>
                    <div className="hist-dot"></div>
                    <div className="hist-date">{formatDate(entry.date)}{i === 0 ? ' · Most recent' : ''}</div>
                    <div className="hist-sets-grid">
                      {entry.sets.map((s, j) => (
                        <div className="hist-set" key={j}>
                          <div className="hist-set-weight">{s.weight}<span style={{fontSize:13,fontWeight:400,color:'#555'}}> lbs</span></div>
                          <div className="hist-set-reps">{s.reps} reps</div>
                        </div>
                      ))}
                    </div>
                    <div className="vol-chip">Total volume: {vol.toLocaleString()} lbs</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === "coach" && (
          <div className="coach-wrap">

            {/* ── Empty state ── */}
            {exNames.length === 0 && (
              <div className="coach-empty">
                <div className="coach-empty-icon">🤖</div>
                <div className="coach-empty-title">No data yet</div>
                <div className="coach-empty-body">
                  Your AI coach needs workout data to analyze. Log at least one session and come back — the coach will have your numbers, your sticking points, and a concrete plan.
                </div>
                <button className="coach-empty-cta" onClick={() => { setView("log"); setSelectedExercise(null); }}>
                  Log your first session →
                </button>
                <div className="coach-empty-steps">
                  <div className="coach-empty-step"><span>1</span> Log a few sessions</div>
                  <div className="coach-empty-step"><span>2</span> Come back to Coach</div>
                  <div className="coach-empty-step"><span>3</span> Get personalized analysis</div>
                </div>
              </div>
            )}

            {/* ── Normal coach UI (only when data exists) ── */}
            {exNames.length > 0 && (<>
            {/* Pro status row */}
            {isPro ? (
              <div className="pro-active-row" style={{margin:'16px 0'}}>
                <div className="pro-active-dot" />
                <div className="pro-active-text">Pro Active</div>
                <span className="pro-manage" onClick={() => window.open("https://billing.stripe.com", "_blank")}>Manage</span>
              </div>
            ) : (
              <div className="pro-banner">
                <div>
                  <div className="pro-label">Pro Feature</div>
                  <div className="pro-text">Unlock weekly reports + AI chat coach</div>
                </div>
                <button className="pro-btn" onClick={() => setShowUpgrade(true)}>
                  Upgrade $9/mo
                </button>
              </div>
            )}

            {/* Weekly Report */}
            <div className={`report-card${!isPro?' lock-overlay':''}`}>
              <div className="report-header">
                <div className="report-title">Weekly Report</div>
                <button className="gen-btn" disabled={reportLoading || !isPro} onClick={generateWeeklyReport}>
                  {reportLoading ? '...' : 'Generate'}
                </button>
              </div>
              {reportLoading && <div className="report-placeholder">Analyzing your data<span className="typing-dot">▮</span></div>}
              {!reportLoading && weeklyReport && <div className="report-body">{weeklyReport}</div>}
              {!reportLoading && !weeklyReport && <div className="report-placeholder">Hit Generate for your AI coaching report</div>}
            </div>

            {/* Chat */}
            <div className={`chat-section${!isPro?' lock-overlay':''}`}>
              <div className="chat-label">Ask your coach</div>
              <div className="chat-messages">
                {coachMessages.length === 0 && (
                  <div style={{fontFamily:"'Share Tech Mono',monospace", fontSize:11, color:'#333', textAlign:'center', padding:'16px 0'}}>
                    Ask anything — form tips, programming, recovery...
                  </div>
                )}
                {coachMessages.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.role}`}>
                    {m.role === 'assistant' && <div className="msg-label">Coach</div>}
                    {m.content}
                  </div>
                ))}
                {coachLoading && (
                  <div className="chat-msg assistant">
                    <div className="msg-label">Coach</div>
                    <span className="typing-dot">▮</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-row">
                <textarea
                  className="chat-input"
                  rows={2}
                  placeholder="e.g. Why is my bench press stalling?"
                  value={coachInput}
                  onChange={e => setCoachInput(e.target.value)}
                  onFocus={scrollInputIntoView}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); isPro && sendCoachMessage(); }}}
                  disabled={!isPro}
                />
                <button className="chat-send" disabled={!isPro || coachLoading || !coachInput.trim()} onClick={sendCoachMessage}>↑</button>
              </div>
            </div>
            </>)}
          </div>
        )}
        {/* PR Share Modal */}
        {prModal && (
          <div className="modal-overlay" onClick={() => setPrModal(null)}>
            <div className="modal-sheet" style={{position:"relative", padding:"24px 20px 32px"}} onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setPrModal(null)}>✕</button>
              <div className="modal-pill" />
              <div style={{fontFamily:"Share Tech Mono,monospace", fontSize:10, color:"#e8a020", textTransform:"uppercase", letterSpacing:"3px", marginBottom:12}}>🏆 Personal Record</div>
              <div style={{fontFamily:"Barlow Condensed,sans-serif", fontWeight:900, fontSize:28, textTransform:"uppercase", marginBottom:16}}>{prModal.exercise}</div>
              <div style={{borderRadius:3, overflow:"hidden", marginBottom:20, border:"1px solid #222"}}>
                <img src={prModal.dataUrl} alt="PR Card" style={{width:"100%", display:"block"}} />
              </div>
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20}}>
                <div style={{background:"#111", border:"1px solid #1e1e1e", borderRadius:2, padding:"12px", textAlign:"center"}}>
                  <div style={{fontFamily:"Barlow Condensed,sans-serif", fontWeight:900, fontSize:32, color:"#e8ff47"}}>{prModal.weight}</div>
                  <div style={{fontFamily:"Share Tech Mono,monospace", fontSize:10, color:"#555", textTransform:"uppercase"}}>lbs</div>
                </div>
                <div style={{background:"#111", border:"1px solid #1e1e1e", borderRadius:2, padding:"12px", textAlign:"center"}}>
                  <div style={{fontFamily:"Barlow Condensed,sans-serif", fontWeight:900, fontSize:32, color:"#f0ede8"}}>{prModal.reps}</div>
                  <div style={{fontFamily:"Share Tech Mono,monospace", fontSize:10, color:"#555", textTransform:"uppercase"}}>reps</div>
                </div>
              </div>
              <button className="stripe-btn" onClick={() => sharePR(prModal.dataUrl, prModal.exercise)}>📤 Share / Download Card</button>
              <div className="modal-fine">Saves as PNG · Share to Instagram, Twitter, iMessage</div>
            </div>
          </div>
        )}

        {showUpgrade && (
          <div className="modal-overlay" onClick={() => setShowUpgrade(false)}>
            <div className="modal-sheet" style={{position:'relative'}} onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowUpgrade(false)}>✕</button>
              <div className="modal-pill" />
              <div className="modal-badge">Overload Pro</div>
              <div className="modal-title">Level <em>Up</em></div>
              <div className="modal-price"><strong>$9</strong> / month · cancel anytime</div>
              <div className="modal-features">
                {[
                  ["Weekly AI Report", "Personalized analysis of your actual training data"],
                  ["AI Chat Coach", "Ask anything — your coach knows your numbers"],
                  ["Unlimited exercises", "Track every lift in your program"],
                  ["Priority support", "Direct help when you need it"],
                ].map(([title, desc]) => (
                  <div className="modal-feat" key={title}>
                    <div className="modal-feat-check">✓</div>
                    <div className="modal-feat-text"><strong>{title}</strong> — {desc}</div>
                  </div>
                ))}
              </div>
              <button className="stripe-btn" disabled={stripeLoading} onClick={handleStripeCheckout}>
                <span className="stripe-lock">🔒</span>
                {stripeLoading ? "Connecting to Stripe..." : "Subscribe with Stripe"}
              </button>
              <div className="modal-fine">
                Secured by Stripe · SSL encrypted · Cancel anytime<br/>
                You'll be redirected to Stripe's secure checkout
              </div>
            </div>
          </div>
        )}

        {(timer.active || timer.remaining === 0) && (
          <div className="timer-bar">
            <div className={`timer-time ${timer.remaining === 0 ? 'done' : ''}`}>
              {timer.remaining === 0 ? 'GO!' : `${Math.floor(timer.remaining/60)}:${String(timer.remaining%60).padStart(2,'0')}`}
            </div>
            <div className="timer-progress">
              <div className={`timer-fill ${timer.remaining === 0 ? 'done' : ''}`} style={{width: timer.remaining === 0 ? '100%' : `${(timer.remaining/timer.total)*100}%`}} />
            </div>
            <div className="timer-presets">
              {[60,90,120].map(s => (
                <button key={s} className={`timer-preset${timer.total===s?' sel':''}`} onClick={() => startTimer(s)}>
                  {s===60?'1m':s===90?'90s':'2m'}
                </button>
              ))}
            </div>
            <button className="timer-stop" onClick={stopTimer}>✕</button>
          </div>
        )}

        <nav className="nav">
          <button className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setView("dashboard"); setSelectedExercise(null); }}>Dashboard</button>
          <button className={`nav-btn ${view === 'log' ? 'active' : ''}`} onClick={() => { setView("log"); setSelectedExercise(null); }}>Log</button>
          <button className={`nav-btn ${view === 'history' ? 'active' : ''}`} onClick={() => { setView("history"); }}>History</button>
          <button className={`nav-btn ${view === 'coach' ? 'active' : ''}`} style={view !== 'coach' ? {color:'#e8a020', opacity:0.7} : {}} onClick={() => { setView("coach"); setSelectedExercise(null); }}>Coach ✦</button>
        </nav>
        </>)}
      </div>
    </>
  );
}