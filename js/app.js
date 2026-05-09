// ===================== SUPABASE INITIALIZATION =====================
// Supabase client - loaded from CDN: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const SUPABASE_URL = 'https://wzdjjtttszukvfdbxluf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6ZGpqdHR0c3p1a3ZmZGJ4bHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Mzg3ODcsImV4cCI6MjA5MzMxNDc4N30.iD4pEnD0Rm_XRGIcdg-M_4UgSYw7nqFnVNbzmojQXGM';

const { createClient } = supabase; // supabase global from CDN
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // main client for auth + db

// Quick connectivity test
sb.from('founditems').select('id').limit(1)
  .then(({ data, error }) => {
    if (error) console.error('Supabase connection error:', error.message);
    else console.log('Supabase connected OK');
  });

const STORAGE_KEY = "gclf_student_portal_v2";
const EMAIL_DOMAIN = "gordoncollege.edu.ph";

// ===================== LOCAL ACCOUNTS (Fallback if Supabase Auth not configured) =====================
const ACCOUNTS = [
  { email: "admin@gc.edu", password: "admin123", role: "admin", name: "System Admin", dept: "Administration" },
  { email: "student@gc.edu", password: "password123", role: "student", name: "JOHN ASHLEE M. MALIGA", dept: "CCS / BSIT" },
  { email: "student2@gc.edu", password: "pass2024", role: "student", name: "MARIA SANTOS", dept: "CCS / BSCS" }
];
const ADMIN_EMAILS = ["admin@gc.edu", "admin@gordoncollege.edu.ph"];
// Cloudinary unsigned upload config (free tier-friendly).
// Fill these two values from your Cloudinary dashboard.
const CLOUDINARY_CLOUD_NAME = "dx4cgsmaa";
const CLOUDINARY_UPLOAD_PRESET = "GCLF iMAGES";

const seedItems = [];
const PLACEHOLDER_ITEM_NAMES = new Set([
  "Black Samsung Galaxy A54",
  "Blue Jansport Backpack",
  "GC Student ID Card",
  "Silver Apple AirPods Pro",
  "Maroon GC Jacket",
  "Black Casio Digital Watch",
  "Blue Pilot Ballpen Set",
  "Black Leather Wallet",
  "Pink Water Tumbler"
]);

let itemsData = [];
let allClaims = [];
let myClaimsByEmail = {};
let myClaims = [];
let studentProfiles = {};
let lostReports = [];
let pendingFoundReports = [];
let lostItemLeads = [];
let currentUser = null;
let claimTabFilter = "all";
let reportTabFilter = "pending";
let auditLogPage = 0;
let auditLogs = [];
let notifications = [];
let systemConfig = {
  categories: ["Electronics", "Accessories", "Clothing", "Documents", "Bags", "Others"],
  matchingMinOverlap: 1,
  notificationsEnabled: true
};

// Minimal RBAC layer (safe default behavior: existing admin users keep access).
const ROLE_PERMISSIONS = {
  student: [],
  finder: [],
  reporter: [],
  custodian: [
    "admin.reports.review",
    "admin.claims.review",
    "admin.items.edit",
    "admin.items.delete",
    "admin.logs.view",
    "admin.analytics.view",
    "admin.view"
  ],
  admin: [
    "admin.reports.review",
    "admin.claims.review",
    "admin.items.edit",
    "admin.items.delete",
    "admin.logs.view",
    "admin.analytics.view",
    "admin.backup.manage",
    "admin.view"
  ],
  sysadmin: ["*"]
};

function inferRoleFromUser(user) {
  if (!user) return "student";
  const explicit = String(user.role || "").toLowerCase();
  if (explicit && ROLE_PERMISSIONS[explicit]) return explicit;
  const email = String(user.email || "").toLowerCase();
  if (ADMIN_EMAILS.includes(email) || email.startsWith("admin")) return "admin";
  return "student";
}

function canPerform(permission) {
  const role = inferRoleFromUser(currentUser);
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes("*") || perms.includes(permission);
}

function requirePermission(permission, deniedMessage = "You do not have permission for this action.") {
  if (canPerform(permission)) return true;
  showToast(deniedMessage, "warn");
  return false;
}

function getConfiguredCategories() {
  const fromConfig = Array.isArray(systemConfig?.categories) ? systemConfig.categories : [];
  const cleaned = fromConfig.map((x) => String(x || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned : ["Electronics", "Accessories", "Clothing", "Documents", "Bags", "Others"];
}

function addAuditLog(action, details = {}) {
  const entry = {
    id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
    at: new Date().toLocaleString(),
    actorEmail: currentUser?.email || "system",
    actorRole: inferRoleFromUser(currentUser),
    action,
    details
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > 600) auditLogs.splice(600);
  saveToSupabase("auditlogs", entry).catch(e => console.warn("Supabase save failed:", e));
}

function addNotification(message, type = "info", targetEmail = null) {
  if (!systemConfig?.notificationsEnabled) return;
  const entry = {
    id: Date.now().toString() + Math.floor(Math.random() * 1000).toString(),
    message: String(message || ""),
    type,
    targetEmail,
    createdAt: new Date().toLocaleString(),
    readBy: []
  };
  notifications.unshift(entry);
  if (notifications.length > 800) notifications.splice(800);
  saveToSupabase("notifications", entry).catch(e => console.warn("Supabase save failed:", e));
}

// ===================== INDEXEDDB STORAGE (50MB+ FREE) =====================
const DB_NAME = "gclf_portal_db";
const DB_VERSION = 1;
const STORE_NAME = "app_data";
let db = null;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getFromIndexedDB(key) {
  if (!db) await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function setToIndexedDB(key, value) {
  if (!db) await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// ===================== PERSISTENCE FUNCTIONS =====================

async function loadPersisted() {
  try {
    // Always load from IndexedDB first (fast, local)
    const data = await getFromIndexedDB(STORAGE_KEY);
    if (data) return data;
    // Fallback to localStorage migration
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      await setToIndexedDB(STORAGE_KEY, parsed);
      localStorage.removeItem(STORAGE_KEY);
      return parsed;
    }
    return null;
  } catch (e) {
    console.warn("Failed to load from IndexedDB:", e);
    return null;
  }
}

/** Max rows kept (newest first) so localStorage stays under quota. */
const MAX_PERSISTED_ITEMS = 280;
const MAX_PERSISTED_REPORTS = 220;
const MAX_PERSISTED_CLAIMS = 450;
const MAX_PERSISTED_LEADS = 220;

function persistPayload() {
  return JSON.stringify({
    itemsData,
    allClaims,
    myClaimsByEmail,
    studentProfiles,
    lostReports,
    pendingFoundReports,
    lostItemLeads,
    auditLogs,
    notifications,
    systemConfig
  });
}

/** Remove all base64 image payloads — they dominate quota; https URLs stay. */
function stripAllDataUrlImagesFromState() {
  let freed = false;
  const stripRow = (r) => {
    if (r.image && String(r.image).startsWith("data:")) {
      r.image = null;
      if ("imageStoredRemotely" in r) r.imageStoredRemotely = false;
      freed = true;
    }
  };
  [itemsData, lostReports, pendingFoundReports].forEach((arr) => arr.forEach(stripRow));
  lostItemLeads.forEach((l) => {
    if (l.proofImage && String(l.proofImage).startsWith("data:")) {
      l.proofImage = null;
      if ("proofStoredRemotely" in l) l.proofStoredRemotely = false;
      freed = true;
    }
  });
  allClaims.forEach((c) => {
    if (c.proofImage && String(c.proofImage).startsWith("data:")) {
      c.proofImage = null;
      c.proofImageMissing = true;
      freed = true;
    }
    if (c.itemImage && String(c.itemImage).startsWith("data:")) {
      c.itemImage = null;
      freed = true;
    }
  });
  return freed;
}

function rebuildMyClaimsByEmail() {
  myClaimsByEmail = {};
  for (const c of allClaims) {
    const em = c.claimantEmail;
    if (!em) continue;
    if (!myClaimsByEmail[em]) myClaimsByEmail[em] = [];
    myClaimsByEmail[em].push(c);
  }
  syncMyClaims();
}

/** Drop oldest rows when arrays grow without bound (unshift = newest at front). */
function capPersistedHistory() {
  let capped = false;
  const cap = (arr, max) => {
    if (arr.length > max) {
      arr.splice(max);
      capped = true;
    }
  };
  cap(itemsData, MAX_PERSISTED_ITEMS);
  cap(lostReports, MAX_PERSISTED_REPORTS);
  cap(pendingFoundReports, MAX_PERSISTED_REPORTS);
  cap(allClaims, MAX_PERSISTED_CLAIMS);
  cap(lostItemLeads, MAX_PERSISTED_LEADS);
  if (capped) rebuildMyClaimsByEmail();
  return capped;
}

async function savePersisted() {
  try {
    // Always save to IndexedDB as local backup (fast, reliable)
    const data = JSON.parse(persistPayload());
    await setToIndexedDB(STORAGE_KEY, data);
    // Note: We do NOT auto-sync to Supabase here anymore
    // Supabase is the source of truth - we only push to it when explicitly adding/updating items
    // This prevents old local data from overwriting deletions made on other devices
    return true;
  } catch (e) {
    console.warn("Failed to save:", e);
    return false;
  }
}

async function bootstrapData() {
  const p = await loadPersisted();
  if (p) {
    itemsData = Array.isArray(p.itemsData) && p.itemsData.length ? p.itemsData : [...seedItems];
    allClaims = Array.isArray(p.allClaims) ? p.allClaims : [];
    myClaimsByEmail = p.myClaimsByEmail && typeof p.myClaimsByEmail === "object" ? p.myClaimsByEmail : {};
    studentProfiles = p.studentProfiles && typeof p.studentProfiles === "object" ? p.studentProfiles : {};
    lostReports = Array.isArray(p.lostReports) ? p.lostReports : [];
    pendingFoundReports = Array.isArray(p.pendingFoundReports) ? p.pendingFoundReports : [];
    lostItemLeads = Array.isArray(p.lostItemLeads) ? p.lostItemLeads : [];
    auditLogs = Array.isArray(p.auditLogs) ? p.auditLogs : [];
    notifications = Array.isArray(p.notifications) ? p.notifications : [];
    systemConfig = p.systemConfig && typeof p.systemConfig === "object" ? { ...systemConfig, ...p.systemConfig } : systemConfig;
  } else {
    itemsData = [...seedItems];
    allClaims = [];
    myClaimsByEmail = {};
    studentProfiles = {};
    lostReports = [];
    pendingFoundReports = [];
    lostItemLeads = [];
    auditLogs = [];
    notifications = [];
    await savePersisted();
  }
  // Remove old placeholder/seed items so listings are fully report-based.
  itemsData = itemsData.filter((x) => !PLACEHOLDER_ITEM_NAMES.has(String(x?.name || "").trim()));
  // Normalize lost report statuses to keep old entries visible in admin/review flow.
  lostReports = lostReports.map((r) => ({
    ...r,
    status: normalizeLostReportStatus(r.status, "Pending Review")
  }));
  // Normalize pending found reports.
  pendingFoundReports = pendingFoundReports.map((r) => ({
    ...r,
    status: normalizeReviewStatus(r.status, "Pending Review")
  }));
  await savePersisted();
}

function syncMyClaims() {
  if (!currentUser || !currentUser.email) {
    myClaims = [];
    return;
  }
  myClaims = myClaimsByEmail[currentUser.email] || [];
}

function getCurrentProfile() {
  if (!currentUser || !currentUser.email) return null;
  if (!studentProfiles[currentUser.email]) {
    studentProfiles[currentUser.email] = {
      fullName: currentUser.name || "",
      studentId: "",
      courseYear: currentUser.dept || "",
      contactNumber: ""
    };
  }
  return studentProfiles[currentUser.email];
}

function htmlEsc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeText(s) {
  // Fix garbled UTF-8 characters that may be stored in old data
  return String(s || "")
    .replace(/â€¢/g, "•")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€"/g, '"')
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€¦/g, "…")
    .replace(/Â/g, "");
}

function readFileAsDataURL(file, opts = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      const maxSide = Number(opts.maxSide) || 1280;
      const quality = typeof opts.quality === "number" ? opts.quality : 0.72;
      // Compress images so localStorage does not overflow easily.
      if (!file.type || !file.type.startsWith("image/")) {
        resolve(raw);
        return;
      }
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxSide) {
          h = Math.round((h * maxSide) / w);
          w = maxSide;
        } else if (h >= w && h > maxSide) {
          w = Math.round((w * maxSide) / h);
          h = maxSide;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(raw);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL("image/jpeg", quality);
        resolve(out);
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || "").split(",");
  if (parts.length < 2) return null;
  const meta = parts[0];
  const b64 = parts[1];
  const mimeMatch = /data:([^;]+);base64/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function uploadImageToCloudinary(file, folder, opts = {}) {
  const dataUrl = await readFileAsDataURL(file, opts);
  try {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      throw new Error("Cloudinary config is missing.");
    }
    const safeFolder = String(folder || "uploads").replace(/[^a-zA-Z0-9/_-]/g, "");
    const emailKey = String(currentUser?.email || "guest").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
    const publicId = `${safeFolder}/${Date.now()}_${emailKey}`;
    const uploadUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/image/upload`;
    const form = new FormData();
    const blob = dataUrlToBlob(dataUrl);
    form.append("file", blob || dataUrl);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("folder", safeFolder);
    form.append("public_id", publicId);
    const resp = await fetch(uploadUrl, { method: "POST", body: form });
    if (!resp.ok) throw new Error(`Cloudinary upload failed (${resp.status})`);
    const payload = await resp.json();
    const url = payload.secure_url || payload.url;
    if (!url) throw new Error("Cloudinary did not return URL.");
    return { src: url, remote: true };
  } catch (e) {
    console.warn("Cloudinary upload failed. Using local data URL.", e);
    // Re-compress more aggressively for localStorage fallback
    const smallDataUrl = await readFileAsDataURL(file, { maxSide: 640, quality: 0.4 });
    return { src: smallDataUrl, remote: false };
  }
}

function statusBadge(status) {
  const map = { Unclaimed: "unclaimed", Claimed: "claimed", Pending: "pending", "Pending Review": "pending", Rejected: "rejected", Approved: "claimed" };
  const key = map[status] || "unclaimed";
  const label = status === "Pending Review" ? "Pending" : status;
  return `<span class="s-badge ${key}">${label}</span>`;
}

function normalizeReviewStatus(status, fallback = "Pending Review") {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  if (s === "pending review" || s === "pending") return "Pending Review";
  return fallback;
}

/** Status values for lost reports (student + admin + handoff). */
function normalizeLostReportStatus(status, fallback = "Pending Review") {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  if (s === "claiming") return "Claiming";
  if (s === "pending validation" || s === "pending admin validation") return "Pending Validation";
  if (s === "claimed") return "Claimed";
  if (s === "pending review" || s === "pending") return "Pending Review";
  return fallback;
}

function lostReportBadgeClass(status) {
  const s = String(status || "");
  if (s === "Pending Review") return "pending";
  if (s === "Approved") return "approved";
  if (s === "Claiming") return "claiming";
  if (s === "Pending Validation") return "pending";
  if (s === "Claimed") return "claimed";
  if (s === "Rejected") return "rejected";
  return "pending";
}

function lostReportBadgeLabel(status) {
  const s = String(status || "");
  if (s === "Pending Review") return "Pending";
  if (s === "Pending Validation") return "Pending Admin Validation";
  return s || "—";
}

function ensureLostRecoveryClaim(report, lead) {
  const existing = allClaims.find(
    (c) =>
      c.sourceType === "lost-recovery" &&
      Number(c.relatedLostReportId) === Number(report.id) &&
      c.status === "Pending Review"
  );
  if (existing) return existing;
  const claim = {
    id: Date.now().toString(),
    itemId: null,
    itemName: report.name,
    itemEmoji: "🔎",
    claimantEmail: report.reporterEmail || "",
    claimantName: report.reporterName || "Reporter",
    studentId: "LOST-REPORT",
    contact: report.contact || (lead?.finderContact || ""),
    proofDesc: lead?.proofDesc || "Recovered via finder-reporter chat flow.",
    marks: report.marks || "",
    proofImage: lead?.proofImage || null,
    proofStoredRemotely: !!lead?.proofStoredRemotely,
    photoName: lead?.proofImage ? "finder-proof" : "",
    adminNote: "",
    claimWhere: "",
    claimWhen: "",
    status: "Pending Review",
    submittedAt: new Date().toLocaleString(),
    sourceType: "lost-recovery",
    relatedLostReportId: report.id,
    relatedLeadId: lead?.id || null
  };
  allClaims.unshift(claim);
  return claim;
}

function finderHasLostLead(lostReportId, finderEmail) {
  if (!finderEmail) return false;
  return lostItemLeads.some(
    (l) => Number(l.lostReportId) === Number(lostReportId) && l.finderEmail === finderEmail
  );
}

function fmtDate(d) {
  const t = Date.parse(d);
  if (isNaN(t)) return String(d || "—");
  return new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function emojiFor(cat) {
  return { Electronics: "📱", Accessories: "⌚", Clothing: "🧥", Documents: "🗂️", Bags: "🎒", Others: "📦", Wallet: "👛", Keys: "🔑" }[cat] || "📦";
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function itemMatchesLostReport(item, lost) {
  if (!item || !lost) return false;
  const catMatch = String(item.category || "").toLowerCase() === String(lost.category || "").toLowerCase();
  if (!catMatch) return false;
  const itemTokens = new Set(
    tokenize(`${item.name} ${item.description} ${(item.identifiers || []).join(" ")} ${item.location}`)
  );
  const lostTokens = tokenize(`${lost.name} ${lost.description} ${lost.marks} ${lost.location}`);
  let overlaps = 0;
  for (const t of lostTokens) {
    if (itemTokens.has(t)) overlaps++;
  }
  const threshold = Math.max(1, Number(systemConfig?.matchingMinOverlap) || 1);
  return overlaps >= threshold;
}

function getCurrentUserLostReports() {
  if (!currentUser?.email) return [];
  return lostReports.filter((r) => r.reporterEmail === currentUser.email && r.status !== "Rejected");
}

function isItemMatchedForCurrentUser(item) {
  const mine = getCurrentUserLostReports();
  return mine.some((r) => itemMatchesLostReport(item, r));
}

// ===================== SUPABASE HELPERS =====================
async function loadFromSupabase(tableName) {
  const { data, error } = await sb.from(tableName).select('*');
  if (error) {
    console.warn('Supabase load error on ' + tableName + ':', error.message);
    return [];
  }
  // Extract data from JSONB column
  return (data || []).map(row => {
    const item = row.data || {};
    if (tableName === 'studentprofiles') {
      item.id = row.email; // PK for studentprofiles is email
      item.email = row.email;
    } else {
      item.id = row.id; // ensure id is at top level
    }
    return item;
  });
}

async function saveToSupabase(tableName, item) {
  try {
    const now = new Date().toISOString();
    const isStudentProfile = tableName === 'studentprofiles';
    const docId = String(item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9));
    let record;
    if (isStudentProfile) {
      record = {
        email: item.email,
        data: { ...item, email: undefined, id: undefined },
        created_at: item.created_at || now,
        updated_at: now
      };
    } else {
      record = {
        id: docId,
        data: { ...item, id: undefined },
        created_at: item.created_at || now,
        updated_at: now
      };
    }

    const { data, error } = await sb.from(tableName).upsert(record).select();
    if (error) {
      console.warn('Supabase save error on ' + tableName + ':', error.message);
      return null;
    }
    if (isStudentProfile) return data?.[0]?.email || item.email;
    return data?.[0]?.id || docId;
  } catch(e) {
    console.warn('Supabase save exception on ' + tableName + ':', e.message);
    return null;
  }
}

async function updateInSupabase(tableName, item) {
  try {
    const isStudentProfile = tableName === 'studentprofiles';
    const pkField = isStudentProfile ? 'email' : 'id';
    const pkValue = isStudentProfile ? item.email : item.id;
    const { error } = await sb.from(tableName)
      .update({
        data: { ...item, id: undefined, email: undefined },
        updated_at: new Date().toISOString()
      })
      .eq(pkField, pkValue);
    if (error) {
      console.warn('Supabase update error on ' + tableName + ':', error.message);
    }
  } catch(e) {
    console.warn('Supabase update exception on ' + tableName + ':', e.message);
  }
}

async function deleteFromSupabase(tableName, docId) {
  // Normalize ID - could be number or string
  const idStr = String(docId);
  const idNum = Number(docId);
  console.log('Deleting from Supabase:', tableName, 'id:', docId, 'str:', idStr, 'num:', idNum);
  
  try {
    // Try string ID first
    let { data, error } = await sb.from(tableName).delete().eq('id', idStr).select();
    
    // If no rows deleted and ID is numeric, try as number
    if ((!data || data.length === 0) && !isNaN(idNum) && idStr !== String(idNum)) {
      console.log('Trying numeric ID:', idNum);
      const result = await sb.from(tableName).delete().eq('id', idNum).select();
      data = result.data;
      error = result.error;
    }
    
    if (error) {
      console.error('Supabase delete ERROR on ' + tableName + ':', error.message, error);
      throw error;
    }
    console.log('Supabase delete SUCCESS on ' + tableName + ':', data, 'rows deleted:', data?.length || 0);
    if (!data || data.length === 0) {
      console.warn('No rows were deleted - ID may not exist:', docId);
    }
    return data;
  } catch(e) {
    console.error('Supabase delete EXCEPTION on ' + tableName + ':', e.message, e);
    throw e;
  }
}

function listenToSupabase(tableName, callback) {
  const channel = sb.channel('public:' + tableName)
    .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
      loadFromSupabase(tableName).then(data => callback(data));
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Subscribed to ' + tableName);
      }
    });
  return () => sb.removeChannel(channel);
}

// ===================== SUPABASE DATA SYNC =====================
let unsubscribers = []; // Store unsubscribe functions for listeners
let lastDeleteTimestamp = 0; // Track last delete to prevent race condition with real-time sync

async function loadAllDataFromSupabase() {
  try {
    // Load data from Supabase
    [itemsData, allClaims, lostReports, pendingFoundReports, lostItemLeads] = await Promise.all([
      loadFromSupabase("founditems"),
      loadFromSupabase("claims"),
      loadFromSupabase("lostreports"),
      loadFromSupabase("pendingfoundreports"),
      loadFromSupabase("lostitemleads")
    ]);
    // Load student profiles - extract only profile fields, not DB metadata
    const { data: profilesData } = await sb.from("studentprofiles").select('*');
    studentProfiles = {};
    (profilesData || []).forEach(profile => {
      const email = profile.email || profile.id;
      if (email) {
        // Only extract the actual profile fields, ignore DB metadata like created_at
        studentProfiles[email] = {
          fullName: profile.fullName || profile.data?.fullName || "",
          studentId: profile.studentId || profile.data?.studentId || "",
          courseYear: profile.courseYear || profile.data?.courseYear || "",
          contactNumber: profile.contactNumber || profile.data?.contactNumber || ""
        };
      }
    });
    // Load audit logs and notifications
    auditLogs = await loadFromSupabase("auditlogs");
    notifications = await loadFromSupabase("notifications");
    // Load system config (ignore errors if table doesn't exist)
    try {
      const { data: configData, error: configError } = await sb.from("system_config").select('*').eq('id', 1).maybeSingle();
      if (configData && !configError) systemConfig = configData;
    } catch (e) {
      console.warn("system_config table not available, using defaults");
    }
    rebuildMyClaimsByEmail();
    // Save fresh Supabase data to IndexedDB to ensure all devices stay in sync
    // This is critical: when phone loads after PC deleted items, phone gets the deletions
    await setToIndexedDB(STORAGE_KEY, JSON.parse(persistPayload())).catch(e => 
      console.warn("Failed to save fresh data to IndexedDB:", e)
    );
    console.log("Synced fresh Supabase data to IndexedDB");
    return true;
  } catch (e) {
    console.error("Failed to load from Supabase:", e.message);
    return false;
  }
}

async function saveAllDataToSupabase() {
  try {
    var saveOps = [];
    // foundItems
    for (var i = 0; i < itemsData.length; i++) {
      saveOps.push(saveToSupabase("founditems", itemsData[i]));
    }
    // claims
    for (var j = 0; j < allClaims.length; j++) {
      saveOps.push(saveToSupabase("claims", allClaims[j]));
    }
    // lostReports
    for (var k = 0; k < lostReports.length; k++) {
      saveOps.push(saveToSupabase("lostreports", lostReports[k]));
    }
    // pendingFoundReports
    for (var l = 0; l < pendingFoundReports.length; l++) {
      saveOps.push(saveToSupabase("pendingfoundreports", pendingFoundReports[l]));
    }
    // lostItemLeads
    for (var m = 0; m < lostItemLeads.length; m++) {
      saveOps.push(saveToSupabase("lostitemleads", lostItemLeads[m]));
    }
    // auditLogs
    for (var n = 0; n < auditLogs.length; n++) {
      saveOps.push(saveToSupabase("auditlogs", auditLogs[n]));
    }
    // notifications
    for (var p = 0; p < notifications.length; p++) {
      saveOps.push(saveToSupabase("notifications", notifications[p]));
    }
    await Promise.all(saveOps);
    // Save student profiles
    const profileOps = Object.keys(studentProfiles).map(email =>
    saveToSupabase("studentprofiles", { ...studentProfiles[email], email })
    );
    await Promise.all(profileOps);
    // Save system config (ignore errors if table doesn't exist)
    try {
      await sb.from("system_config").upsert({ id: 1, ...systemConfig });
    } catch (e) {
      console.warn("system_config save failed, continuing...");
    }
    return true;
  } catch (e) {
    console.error("Failed to save to Supabase:", e.message);
    return false;
  }
}

function setupRealTimeListeners() {
  // Unsubscribe existing listeners first
  for (var i = 0; i < unsubscribers.length; i++) {
    if (typeof unsubscribers[i] === "function") unsubscribers[i]();
  }
  unsubscribers = [];

  // Listen to found items
  var unsub1 = listenToSupabase("founditems", function(data) {
    // Skip update if we just deleted something (prevent race condition)
    const timeSinceDelete = Date.now() - lastDeleteTimestamp;
    if (timeSinceDelete < 3000) {
      console.log('Skipping real-time update, recent delete detected (' + timeSinceDelete + 'ms ago)');
      return;
    }
    itemsData = data;
    if (typeof renderItems === "function") renderItems();
    if (typeof updateStudentStats === "function") updateStudentStats();
    if (typeof updateAdminStats === "function") updateAdminStats();
  });
  unsubscribers.push(unsub1);

  // Listen to pending found reports
  var unsub2 = listenToSupabase("pendingfoundreports", function(data) {
    pendingFoundReports = data;
    if (typeof renderAdminFoundReportsList === "function") renderAdminFoundReportsList();
  });
  unsubscribers.push(unsub2);

  // Listen to claims
  var unsub3 = listenToSupabase("claims", function(data) {
    allClaims = data;
    rebuildMyClaimsByEmail();
    if (typeof renderAdminClaims === "function") renderAdminClaims();
  });
  unsubscribers.push(unsub3);

  // Listen to lost item leads (for real-time messaging when reports are accepted)
  var unsub4 = listenToSupabase("lostitemleads", function(data) {
    // Check for new messages before updating data
    const oldLeads = lostItemLeads;
    lostItemLeads = data;
    
    // Refresh UI components
    if (typeof renderMyFoundLeads === "function") renderMyFoundLeads();
    if (typeof renderLostMatches === "function") renderLostMatches();
    if (typeof renderDashboardMixed === "function") renderDashboardMixed();
    
    // Real-time chat update: refresh message displays for open chats
    if (typeof refreshLeadMessages === "function") refreshLeadMessages(oldLeads, data);
  });
  unsubscribers.push(unsub4);

  // Listen to notifications (for real-time alerts when leads are accepted)
  var unsub5 = listenToSupabase("notifications", function(data) {
    notifications = data;
    if (typeof renderNotificationsList === "function") renderNotificationsList();
  });
  unsubscribers.push(unsub5);

  // Listen to lost reports (for real-time status updates)
  var unsub6 = listenToSupabase("lostreports", function(data) {
    lostReports = data;
    if (typeof renderLostReportsList === "function") renderLostReportsList();
    if (typeof renderPublicLostItems === "function") renderPublicLostItems();
    if (typeof renderDashboardMixed === "function") renderDashboardMixed();
    if (typeof renderLostMatches === "function") renderLostMatches();
    if (typeof renderAdminReports === "function") renderAdminReports();
  });
  unsubscribers.push(unsub6);
}

async function doLogin() {
  const emailEl = document.getElementById("loginEmail");
  const passEl = document.getElementById("loginPass");
  const errEl = document.getElementById("loginErr");
  let email = emailEl.value.trim().toLowerCase();
  const pass = passEl.value;

  if (!email || !pass) {
    errEl.style.display = "block";
    errEl.textContent = "Please enter email and password.";
    return;
  }

  // Allow login with just student ID
  if (email && !email.includes("@")) {
    email = `${email}@${EMAIL_DOMAIN}`;
  }

  // Try Supabase Auth first
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: email,
      password: pass
    });

    if (error) {
      console.warn("Supabase auth failed:", error.message);
      // Fall back to local accounts
      await localLoginFallback(email, pass, errEl);
      return;
    }

    // Supabase auth success
    const user = data.user;
    const metadata = user.user_metadata || {};
    
    currentUser = {
      email: user.email,
      role: metadata.role || "student",
      name: metadata.displayName || metadata.name || user.email.split('@')[0],
      dept: metadata.dept || metadata.department || "",
      studentId: metadata.studentId || "",
      supabaseUid: user.id
    };

    errEl.style.display = "none";
    document.getElementById("loginPage").style.display = "none";
    syncMyClaims();
    addAuditLog("auth.login.supabase", { email: currentUser.email, role: currentUser.role });
    
    if (currentUser.role === "admin") await launchAdminApp();
    else await launchStudentApp();
    return;
    
  } catch (e) {
    console.error("Supabase auth error:", e);
    // Fall back to local accounts
    await localLoginFallback(email, pass, errEl);
  }
}

async function localLoginFallback(email, pass, errEl) {
  // Fallback to demo accounts if Supabase auth not set up
  const ACCOUNTS = [
    { email: "admin@gc.edu", password: "admin123", role: "admin", name: "System Admin", dept: "Administration" },
    { email: "student@gc.edu", password: "password123", role: "student", name: "JOHN ASHLEE M. MALIGA", dept: "CCS / BSIT" },
    { email: "student2@gc.edu", password: "pass2024", role: "student", name: "MARIA SANTOS", dept: "CCS / BSCS" }
  ];

  const account = ACCOUNTS.find((a) => {
    const accountEmail = a.email.toLowerCase();
    const inputEmail = email.toLowerCase();
    return (accountEmail === inputEmail || accountEmail.split("@")[0] === inputEmail.split("@")[0]) && a.password === pass;
  });

  if (!account) {
    errEl.style.display = "block";
    errEl.textContent = "Invalid credentials. Please try again.";
    return;
  }

  currentUser = account;
  errEl.style.display = "none";
  document.getElementById("loginPage").style.display = "none";
  syncMyClaims();
  addAuditLog("auth.login.local", { email: account.email, role: account.role });
  if (account.role === "admin") await launchAdminApp();
  else await launchStudentApp();
}

async function launchStudentApp() {
  // Always refresh from persisted storage so newly approved
  // reports/items are visible to any user who logs in next.
  await bootstrapData();
  // Load latest data from Supabase (sync from other users)
  try {
    await loadAllDataFromSupabase();
  } catch(e) { console.warn("Supabase load failed:", e); }
  setupRealTimeListeners();
  const p = getCurrentProfile();
  document.getElementById("sbStudentName").textContent = p?.fullName || currentUser.name;
  document.getElementById("sbStudentRole").textContent = p?.courseYear || currentUser.dept;
  document.getElementById("mainApp").style.display = "block";
  startDateTime("topbarDate");
  updateStudentStats();
  renderDashboardMixed();
  renderItems();
  renderPublicLostItems();
  buildStudentProfileForm();
  buildReportForm("reportPageForm", false);
  buildLostReportForm();
  renderLostReportsList();
  renderLostMatches();
  renderMyFoundLeads();
  renderMyFoundReportsList();
  initSidebarToggle();
}

async function launchAdminApp() {
  if (!canPerform("admin.view")) {
    showToast("This account has no admin access.", "warn");
    return;
  }
  await bootstrapData();
  // Load latest data from Supabase (sync from other users)
  try {
    await loadAllDataFromSupabase();
  } catch(e) { console.warn("Supabase load failed:", e); }
  setupRealTimeListeners();
  document.getElementById("adminApp").style.display = "block";
  startDateTime("adminTopbarDate");
  updateAdminStats();
  renderAdminOverviewLists();
  renderAdminItems();
  renderAdminClaims();
  renderAdminReports();
  renderAdminLostRecoveries();
  renderAdminAnalyticsPanel();
  renderAdminAuditLogs();
  buildReportForm("adminAddItemForm", true);
  initSidebarToggle();
}

async function doLogout() {
  if (currentUser?.email) myClaimsByEmail[currentUser.email] = [...myClaims];
  await savePersisted();
  
  // Clear saved page state so refresh after logout stays on login
  try {
    localStorage.removeItem('gclf_lastPage');
  } catch (e) { console.warn("Failed to clear page state:", e); }
  
  // Sign out from Supabase to clear session
  try {
    await sb.auth.signOut();
  } catch (e) { console.warn("Supabase signOut failed:", e); }
  
  currentUser = null;
  myClaims = [];
  document.getElementById("mainApp").style.display = "none";
  document.getElementById("adminApp").style.display = "none";
  document.getElementById("loginPage").style.display = "flex";
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginPass").value = "";
  document.querySelectorAll(".sb-item").forEach((el) => el.classList.remove("active"));
  const st = document.querySelector("#studentSidebar .sb-item");
  const ad = document.querySelector("#adminSidebar .sb-item");
  if (st) {
    st.classList.add("active");
    studentNav("dashboard", st);
  }
  if (ad) {
    ad.classList.add("active");
    adminNav("overview", ad);
  }
}

function toggleEye() {
  const inp = document.getElementById("loginPass");
  const icon = document.getElementById("eyeToggle");
  if (inp.type === "password") {
    inp.type = "text";
    icon.className = "bi bi-eye-slash eye-btn";
  } else {
    inp.type = "password";
    icon.className = "bi bi-eye eye-btn";
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.getElementById("loginPage").style.display !== "none") doLogin();
});

function startDateTime(elId) {
  function update() {
    const el = document.getElementById(elId);
    if (!el) return;
    
    // Detect mobile screen for shorter date format
    const isMobile = window.innerWidth <= 576;
    const now = new Date();
    
    if (isMobile) {
      // Short format for mobile: "Mon, Jan 1, 2:30 PM"
      el.textContent = now.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } else {
      // Full format for desktop
      el.textContent = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }
  }
  update();
  setInterval(update, 1000);
  
  // Update format when window resizes
  window.addEventListener('resize', update);
}

function studentNav(page, el) {
  document.querySelectorAll("#studentSidebar .sb-item").forEach((i) => i.classList.remove("active"));
  if (el) el.classList.add("active");
  document.querySelectorAll("#mainApp .page-section").forEach((s) => s.classList.remove("active"));
  saveCurrentPage(page, "student");
  const sec = document.getElementById("s-" + page);
  if (sec) sec.classList.add("active");
  if (page === "dashboard") {
    updateStudentStats();
    renderDashboardMixed();
  }
  if (page === "profile") buildStudentProfileForm();
  if (page === "founditems") renderItems();
  if (page === "lostItems") {
    renderPublicLostItems();
    renderMyFoundLeads();
  }
  if (page === "myClaims") renderMyClaims();
  if (page === "report") {
    buildReportForm("reportPageForm", false);
    renderMyFoundReportsList();
  }
  if (page === "reportLost") {
    buildLostReportForm();
    renderLostReportsList();
    renderLostMatches();
    renderMyFoundReportsList();
  }
}

function adminNav(page, el) {
  if (!canPerform("admin.view")) return;
  document.querySelectorAll("#adminSidebar .sb-item").forEach((i) => i.classList.remove("active"));
  if (el) el.classList.add("active");
  document.querySelectorAll("#adminApp .page-section").forEach((s) => s.classList.remove("active"));
  saveCurrentPage(page, "admin");
  const sec = document.getElementById("a-" + page);
  if (sec) sec.classList.add("active");
  if (page === "overview") {
    updateAdminStats();
    renderAdminOverviewLists();
    renderAdminAnalyticsPanel();
    renderAdminAuditLogs();
  }
  if (page === "manageItems") renderAdminItems();
  if (page === "manageClaims") renderAdminClaims();
  if (page === "manageReports") renderAdminReports();
  if (page === "lostRecoveries") renderAdminLostRecoveries();
  if (page === "addItem") buildReportForm("adminAddItemForm", true);
}

function updateStudentStats() {
  document.getElementById("sStatTotal").textContent = itemsData.length;
  document.getElementById("sStatUnclaimed").textContent = itemsData.filter((i) => i.status === "Unclaimed").length;
  document.getElementById("sStatPending").textContent = itemsData.filter((i) => i.status === "Pending").length;
  document.getElementById("sStatClaimed").textContent = itemsData.filter((i) => i.status === "Claimed").length;
}

function updateAdminStats() {
  document.getElementById("aStatTotal").textContent = itemsData.length;
  document.getElementById("aStatUnclaimed").textContent = itemsData.filter((i) => i.status === "Unclaimed").length;
  document.getElementById("aStatPending").textContent = allClaims.filter((c) => c.status === "Pending Review").length + getPendingReportsCount();
  document.getElementById("aStatClaimed").textContent = itemsData.filter((i) => i.status === "Claimed").length;
}

const DEPARTMENTS = [
  // College of Allied Health Studies (CAHS)
  "BSN - Bachelor of Science in Nursing",
  "BSM - Bachelor of Science in Midwifery",
  // College of Business and Accountancy (CBA)
  "BSA - Bachelor of Science in Accountancy",
  "BSBA-FM - Bachelor of Science in Business Administration Major in Financial Management",
  "BSBA-HRM - Bachelor of Science in Business Administration Major in Human Resource Management",
  "BSBA-MM - Bachelor of Science in Business Administration Major in Marketing Management",
  "BSCA - Bachelor of Science in Customs Administration",
  // College of Computer Studies (CCS)
  "BSCS - Bachelor of Science in Computer Science",
  "BSEMC - Bachelor of Science in Entertainment and Multimedia Computing",
  "BSIT - Bachelor of Science in Information Technology",
  // College of Education, Arts, and Sciences (CEAS)
  "BAC - Bachelor of Arts in Communication",
  "BECEd - Bachelor of Early Childhood Education",
  "BPAEd - Bachelor of Physical Education",
  "BCAEd - Bachelor of Culture and Arts Education",
  "BEEd - Bachelor of Elementary Education (General Education)",
  "BSEd-Eng - Bachelor of Secondary Education Major in English",
  "BSEd-Fil - Bachelor of Secondary Education Major in Filipino",
  "BSEd-Math - Bachelor of Secondary Education Major in Mathematics",
  "BSEd-SS - Bachelor of Secondary Education Major in Social Studies",
  "BSEd-Sci - Bachelor of Secondary Education Major in Science",
  "TCP - Teacher Certificate Program",
  // College of Hospitality and Tourism Management (CHTM)
  "BSHM - Bachelor of Science in Hospitality Management",
  "BSTM - Bachelor of Science in Tourism Management",
  "Other"
];

function buildStudentProfileForm() {
  const wrap = document.getElementById("studentProfileFormWrap");
  if (!wrap || !currentUser) return;
  const p = getCurrentProfile();
  const hasProfile = p.studentId && p.contactNumber;
  
  if (hasProfile && !window.profileEditMode) {
    // VIEW MODE
    wrap.innerHTML = `
      <div class="profile-view-card">
        <div class="profile-view-header">
          <i class="bi bi-person-circle" style="font-size:2.5rem;color:#6a5acd;"></i>
          <div class="profile-view-name">${htmlEsc(p.fullName)}</div>
          <div class="profile-view-id">${htmlEsc(p.studentId)}</div>
        </div>
        <div class="profile-view-body">
          <div class="profile-view-row">
            <span class="profile-view-label"><i class="bi bi-building"></i> Department:</span>
            <span class="profile-view-value">${htmlEsc(p.courseYear)}</span>
          </div>
          <div class="profile-view-row">
            <span class="profile-view-label"><i class="bi bi-telephone"></i> Contact:</span>
            <span class="profile-view-value">${htmlEsc(p.contactNumber)}</span>
          </div>
          <div class="profile-view-row">
            <span class="profile-view-label"><i class="bi bi-envelope"></i> Email:</span>
            <span class="profile-view-value">${htmlEsc(currentUser.email)}</span>
          </div>
        </div>
        <button type="button" class="btn-submit" onclick="toggleProfileEditMode()" style="margin-top:12px;">
          <i class="bi bi-pencil-square"></i> Edit Profile
        </button>
      </div>
    `;
  } else {
    // EDIT MODE
    const deptOptions = DEPARTMENTS.map(d => `<option value="${htmlEsc(d)}" ${p.courseYear === d ? 'selected' : ''}>${htmlEsc(d)}</option>`).join('');
    wrap.innerHTML = `
      <div class="profile-edit-form">
        <label class="f-label">Full Name *</label>
        <input class="f-input" id="pf_fullName" value="${htmlEsc(p.fullName)}" placeholder="e.g. Juan Dela Cruz"/>
        <label class="f-label">Student ID *</label>
        <input class="f-input" id="pf_studentId" value="${htmlEsc(p.studentId)}" placeholder="e.g. 2023-BSIT-001"/>
        <label class="f-label">Department / Course *</label>
        <select class="f-input" id="pf_courseYear">
          <option value="">-- Select Department --</option>
          ${deptOptions}
        </select>
        <label class="f-label">Contact Number *</label>
        <input class="f-input" id="pf_contactNumber" value="${htmlEsc(p.contactNumber)}" placeholder="e.g. 09XXXXXXXXX" maxlength="11"/>
        <div class="f-err" id="pf_err"></div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-submit" onclick="saveStudentProfile()"><i class="bi bi-floppy-fill"></i> Save Profile</button>
          ${hasProfile ? `<button type="button" class="btn-secondary" onclick="toggleProfileEditMode()" style="background:#6c757d;"><i class="bi bi-x-circle"></i> Cancel</button>` : ''}
        </div>
      </div>
    `;
  }
}

function toggleProfileEditMode() {
  window.profileEditMode = !window.profileEditMode;
  buildStudentProfileForm();
}

async function saveStudentProfile() {
  const err = document.getElementById("pf_err");
  const fullName = document.getElementById("pf_fullName").value.trim();
  const studentId = document.getElementById("pf_studentId").value.trim();
  const courseYear = document.getElementById("pf_courseYear").value.trim();
  const contactNumber = document.getElementById("pf_contactNumber").value.trim();
  if (!fullName || !studentId || !courseYear || !contactNumber) {
    err.style.display = "block";
    err.textContent = "Please fill in all profile fields.";
    return;
  }
  err.style.display = "none";
  const profileData = { fullName, studentId, courseYear, contactNumber };
  studentProfiles[currentUser.email] = profileData;
  document.getElementById("sbStudentName").textContent = fullName;
  document.getElementById("sbStudentRole").textContent = courseYear;
  await savePersisted();
  
  // Save to Supabase for cross-device persistence
  try {
    await saveToSupabase("studentprofiles", { 
      ...profileData, 
      email: currentUser.email,
      id: currentUser.email  // Use email as ID for profiles
    });
  } catch (e) {
    console.warn("Failed to save profile to Supabase:", e);
  }
  
  showToast("Student profile saved.", "success");
  // Exit edit mode and show view
  window.profileEditMode = false;
  buildStudentProfileForm();
}

function buildCard(item) {
  const name = sanitizeText(item.name);
  const location = sanitizeText(item.location);
  const thumbContent = item.image ? `<img src="${item.image}" alt="${htmlEsc(name)}"/>` : `<span style="font-size:65px;">${item.emoji}</span>`;
  const matchHint = isItemMatchedForCurrentUser(item)
    ? `<div class="item-card-match"><i class="bi bi-stars"></i> Possible match to your lost report</div>`
    : "";
  const isMyFoundItem = currentUser?.email && item.reporterEmail === currentUser.email;
  const yoursBadge = isMyFoundItem ? `<span class="s-badge item-kind--yours">Yours</span>` : "";
  return `
    <div class="col-6 col-md-4 col-lg-3" onclick="openItemModal(${item.id})">
      <div class="item-card">
        <div class="item-card-thumb">
          ${thumbContent}
        </div>
        <div class="item-card-body">
          <div class="d-flex justify-content-between align-items-start">
            <div class="item-card-name">${htmlEsc(name)}</div>
            ${statusBadge(item.status)}
          </div>
          <div class="item-card-loc"><i class="bi bi-geo-alt"></i> ${htmlEsc(location)}</div>
          <div class="item-card-badges mt-1">${yoursBadge}</div>
          ${matchHint}
        </div>
      </div>
    </div>
  `;
}

function renderDashboardMixed() {
  const out = document.getElementById("dashboardMixedGrid");
  if (!out) return;
  const foundRows = itemsData.map((x) => ({
    type: "Found",
    date: x.date,
    id: x.id,
    title: sanitizeText(x.name),
    subtitle: `${sanitizeText(x.category)} • ${sanitizeText(x.location)}`,
    image: x.image,
    emoji: x.emoji,
    status: x.status,
    open: `openItemModal(${x.id})`
  }));
  const lostRows = lostReports
    .filter((x) => x.status === "Approved")
    .map((x) => {
      const own = currentUser?.email && x.reporterEmail === currentUser.email;
      return {
        type: "Lost",
        date: x.dateLost,
        id: x.id,
        title: sanitizeText(x.name),
        subtitle: `${sanitizeText(x.category)} • ${sanitizeText(x.location)}`,
        image: x.image,
        emoji: "🔍",
        own,
        open: own ? "" : `openFoundYourItemModal(${x.id})`
      };
    });
  const mixed = [...foundRows, ...lostRows]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 8);
  if (!mixed.length) {
    out.innerHTML = '<div class="empty-state"><i class="bi bi-inbox"></i><p>No records yet.</p></div>';
    return;
  }
  out.innerHTML = mixed
    .map(
      (r) => `
    <div class="col-6 col-md-4 col-lg-3" style="${r.type === "Lost" && r.own ? "cursor:default;" : "cursor:pointer;"}" ${r.open ? `onclick="${r.open}"` : ""}>
      <div class="item-card">
        <div class="item-card-thumb">
          ${r.image ? `<img src="${r.image}" alt="${htmlEsc(r.title)}"/>` : `<span style="font-size:65px;">${r.emoji}</span>`}
        </div>
        <div class="item-card-body">
          <div class="item-card-head">
            <div class="item-card-name">${htmlEsc(r.title)}</div>
            <div class="item-card-badges">
              ${
                r.type === "Found"
                  ? r.status === "Claimed"
                    ? `<span class="s-badge claimed">Claimed</span>`
                    : `<span class="s-badge item-kind--found">Found</span>`
                  : r.own
                    ? `<span class="s-badge item-kind--lost">Lost</span><span class="s-badge item-kind--yours">Yours</span>`
                    : `<span class="s-badge item-kind--lost">Lost</span>`
              }
            </div>
          </div>
          <div class="item-card-loc">${htmlEsc(r.subtitle)}</div>
          <div class="item-card-date"><i class="bi bi-calendar3"></i> ${fmtDate(r.date)}</div>
        </div>
      </div>
    </div>`
    )
    .join("");
}

function renderRecentGrid() {
  renderDashboardMixed();
}

function renderPublicLostItems() {
  const wrap = document.getElementById("lostPublicList");
  if (!wrap) return;
  const list = lostReports.filter((r) => r.status === "Approved");
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="bi bi-inbox"></i><p>No approved lost reports yet.</p></div>';
    return;
  }
  wrap.innerHTML = `<div class="row g-3">${
    list
      .map((r) => {
        const own = currentUser?.email && r.reporterEmail === currentUser.email;
        const name = sanitizeText(r.name);
        const category = sanitizeText(r.category);
        const location = sanitizeText(r.location);
        const description = sanitizeText(r.description);
        return `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="item-card">
          <div class="item-card-thumb">
            ${r.image ? `<img src="${r.image}" alt="${htmlEsc(name)}"/>` : `<span style="font-size:65px;">🔍</span>`}
          </div>
          <div class="item-card-body">
            <div class="item-card-head">
              <div class="item-card-name">${htmlEsc(name)}</div>
              <div class="item-card-badges">
                <span class="s-badge item-kind--lost">Lost</span>
                ${own ? `<span class="s-badge item-kind--yours">Your report</span>` : ""}
              </div>
            </div>
            <div class="item-card-loc"><i class="bi bi-tag"></i> ${htmlEsc(category)} • ${htmlEsc(location)}</div>
            <div class="item-card-date"><i class="bi bi-calendar3"></i> Lost: ${fmtDate(r.dateLost)}</div>
            <div class="item-card-desc">${htmlEsc(description)}</div>
            ${
              own
                ? ""
                : `<div class="lost-card-action mt-2"><button type="button" class="btn-gc success" onclick="event.stopPropagation();openFoundYourItemModal(${r.id})"><i class="bi bi-patch-check"></i> Found your item</button></div>`
            }
          </div>
        </div>
      </div>`;
      })
      .join("")
  }</div>`;
}
function renderItems() {
  const q = (document.getElementById("searchQ")?.value || "").toLowerCase();
  const st = document.getElementById("filterStat")?.value || "";
  const cat = document.getElementById("filterCat")?.value || "";
  const filtered = itemsData.filter((item) => {
    const ms = item.name.toLowerCase().includes(q) || item.location.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    return ms && (!st || item.status === st) && (!cat || item.category === cat);
  });
  const grid = document.getElementById("itemsGrid");
  grid.innerHTML = filtered.length
    ? filtered.map(buildCard).join("")
    : '<div class="no-results"><i class="bi bi-search" style="font-size:2rem;color:#ccc;display:block;margin-bottom:10px;"></i>No items found.</div>';
}

function filterItems() {
  renderItems();
}

function findItemById(id) {
  return itemsData.find((i) => String(i.id) === String(id));
}

function openItemModal(id) {
  const item = findItemById(id);
  if (!item) return;
  const heroEl = document.getElementById("modalHeroImg");
  heroEl.innerHTML = item.image ? `<img src="${item.image}" alt="${htmlEsc(item.name)}"/>` : `<span style="font-size:95px;">${item.emoji}</span>`;
  const alreadyClaimed = myClaims.find((c) => String(c.itemId) === String(id));
  const isMyFoundItem = currentUser?.email && item.reporterEmail === currentUser.email;
  let claimBtn = "";
  if (isMyFoundItem) {
    claimBtn = `<button class="btn-claim-main" disabled><i class="bi bi-person-check-fill"></i> This is Your Reported Item</button>`;
  } else if (item.status === "Claimed") {
    claimBtn = `<button class="btn-claim-main success" disabled><i class="bi bi-check-circle-fill"></i> This Item Has Been Claimed</button>`;
  } else if (alreadyClaimed) {
    const bc = alreadyClaimed.status === "Approved" ? "success" : alreadyClaimed.status === "Rejected" ? "danger" : "";
    claimBtn = `<button class="btn-claim-main ${bc}" disabled><i class="bi bi-clock-history"></i> Your Claim: ${alreadyClaimed.status}</button>`;
  } else if (item.status === "Pending") {
    claimBtn = `<button class="btn-claim-main" disabled><i class="bi bi-hourglass-split"></i> Currently Under Review</button>`;
  } else {
    claimBtn = `<button class="btn-claim-main" id="btnOpenClaim" onclick="showClaimForm(${id})"><i class="bi bi-hand-index"></i> Claim This Item</button>`;
  }
  const identHtml = (item.identifiers || []).map((t) => `<span class="ident-tag"><i class="bi bi-check2 me-1"></i>${htmlEsc(t)}</span>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
      <div class="modal-title">${item.name}</div>
      ${statusBadge(item.status)}
    </div>
    <div class="modal-section">Item Details</div>
    <div class="detail-row"><i class="bi bi-tag-fill"></i><span class="detail-lbl">Category:</span>${item.category}</div>
    <div class="detail-row"><i class="bi bi-palette-fill"></i><span class="detail-lbl">Color:</span>${item.color}</div>
    <div class="detail-row"><i class="bi bi-award-fill"></i><span class="detail-lbl">Brand:</span>${item.brand}</div>
    <div class="detail-row"><i class="bi bi-geo-alt-fill"></i><span class="detail-lbl">Location:</span>${item.location}</div>
    <div class="detail-row"><i class="bi bi-calendar3"></i><span class="detail-lbl">Date Found:</span>${fmtDate(item.date)}</div>
    <div class="detail-row"><i class="bi bi-person-badge-fill"></i><span class="detail-lbl">Found By:</span>${item.foundBy}</div>
    <div class="detail-row"><i class="bi bi-chat-left-text-fill"></i><span class="detail-lbl">Description:</span>${item.description}</div>
    <div class="modal-section"><i class="bi bi-tags-fill me-1"></i>Identifiers / Stickers / Markings</div>
    <div class="ident-tags">${identHtml}</div>
    ${claimBtn}
    <div id="claimFormSlot" style="margin-top:0;"></div>
  `;
  openModal("itemModal");
}

function showClaimForm(id) {
  const profile = getCurrentProfile();
  const btn = document.getElementById("btnOpenClaim");
  if (btn) btn.style.display = "none";
  document.getElementById("claimFormSlot").innerHTML = `
    <div class="modal-section mt-3"><i class="bi bi-hand-index-fill me-1"></i>Claim Request Form</div>
    <label class="f-label">Full Name *</label>
    <input class="f-input" id="claimName" value="${htmlEsc(profile?.fullName || "")}" placeholder="e.g. Juan Dela Cruz"/>
    <label class="f-label">Student ID Number *</label>
    <input class="f-input" id="claimIdNum" value="${htmlEsc(profile?.studentId || "")}" placeholder="e.g. 2023-BSIT-001"/>
    <label class="f-label">Contact Number *</label>
    <input class="f-input" id="claimContact" value="${htmlEsc(profile?.contactNumber || "")}" placeholder="e.g. 09XXXXXXXXX"/>
    <label class="f-label">Description *</label>
    <textarea class="f-input" id="claimProofDesc" rows="3" placeholder="Describe why this item is yours..."></textarea>
    <label class="f-label">Identifying marks *</label>
    <textarea class="f-input" id="claimMarks" rows="2" placeholder="Stickers, scratches, serial number, etc."></textarea>
    <label class="f-label">Upload Photo Proof *</label>
    <div class="photo-upload-area">
      <input type="file" id="claimPhoto" accept="image/*" onchange="previewPhoto(event,'claimPhotoPreview')"/>
      <i class="bi bi-camera" style="font-size:2rem;color:#b0c4de;display:block;margin-bottom:6px;"></i>
      <div style="color:#888;font-size:0.88rem;">Upload a photo showing identifying marks</div>
      <img id="claimPhotoPreview" class="photo-preview" src="" alt="preview"/>
    </div>
    <div class="f-err" id="claimErr"></div>
    <button type="button" class="btn-submit" onclick="submitClaim(${id})"><i class="bi bi-send-fill"></i> Submit Claim Request</button>
    <button type="button" class="btn-cancel" onclick="cancelClaim()"><i class="bi bi-x-circle me-1"></i> Cancel</button>
  `;
}

function cancelClaim() {
  document.getElementById("claimFormSlot").innerHTML = "";
  const btn = document.getElementById("btnOpenClaim");
  if (btn) btn.style.display = "flex";
}

async function submitClaim(id) {
  const name = document.getElementById("claimName").value.trim();
  const idNum = document.getElementById("claimIdNum").value.trim();
  const contact = document.getElementById("claimContact").value.trim();
  const proof = document.getElementById("claimProofDesc").value.trim();
  const marks = document.getElementById("claimMarks").value.trim();
  const photo = document.getElementById("claimPhoto");
  const errEl = document.getElementById("claimErr");
  if (!name || !idNum || !contact || !proof || !marks) {
    errEl.style.display = "block";
    errEl.textContent = "Please fill in all required fields.";
    return;
  }
  if (!photo.files.length) {
    errEl.style.display = "block";
    errEl.textContent = "Please upload a photo proof of ownership.";
    return;
  }
  errEl.style.display = "none";
  let proofImage = null;
  let proofStoredRemotely = false;
  try {
    const upload = await uploadImageToCloudinary(photo.files[0], "claims", { maxSide: 900, quality: 0.55 });
    proofImage = upload.src;
    proofStoredRemotely = upload.remote;
  } catch {
    errEl.style.display = "block";
    errEl.textContent = "Could not read photo file. Please try another image.";
    return;
  }
  const item = findItemById(id);
  const claimEntry = {
    id: Date.now().toString(),
    itemId: id,
    itemName: item.name,
    itemEmoji: item.emoji,
    itemImage: item.image,
    claimantEmail: currentUser.email,
    claimantName: name,
    studentId: idNum,
    contact,
    proofDesc: proof,
    marks,
    proofImage,
    proofStoredRemotely,
    photoName: photo.files[0].name,
    adminNote: "",
    claimWhere: "",
    claimWhen: "",
    status: "Pending Review",
    submittedAt: new Date().toLocaleString()
  };
  myClaims.push(claimEntry);
  allClaims.push(claimEntry);
  myClaimsByEmail[currentUser.email] = [...myClaims];
  if (item && item.status === "Unclaimed") item.status = "Pending";
  let persisted = await savePersisted();
  if (!persisted) {
    claimEntry.proofImage = null;
    claimEntry.proofImageMissing = true;
    claimEntry.proofStoredRemotely = false;
    persisted = savePersisted();
    if (persisted) showToast("Claim saved without proof image — browser storage was full.", "warning");
  }
  if (!persisted) {
    // Roll back in-memory state if nothing was persisted.
    myClaims = myClaims.filter((c) => c.id !== claimEntry.id);
    allClaims = allClaims.filter((c) => c.id !== claimEntry.id);
    myClaimsByEmail[currentUser.email] = [...myClaims];
    if (item && item.status === "Pending") item.status = "Unclaimed";
    errEl.style.display = "block";
    errEl.textContent = "Could not save claim locally. Please clear old data or use a smaller image.";
    return;
  }
  updateStudentStats();
  updateAdminStats();
  renderItems();
  renderRecentGrid();
  renderAdminItems();
  renderAdminClaims();
  closeModal("itemModal");
  // Sync to Supabase
  saveToSupabase("claims", claimEntry).catch(e => console.warn("Supabase save failed:", e));
  if (item && item.status === "Pending") saveToSupabase("founditems", item).catch(e => console.warn("Supabase save failed:", e));
  addAuditLog("claim.submitted", { itemId: id, itemName: item?.name || "" });
  addNotification(`Claim submitted for "${item?.name || "item"}".`, "info", currentUser.email);
  showToast("Claim request submitted! We will review your request.", "success");
}

function renderMyClaims() {
  syncMyClaims();
  const container = document.getElementById("myClaimsList");
  if (!myClaims.length) {
    container.innerHTML = `<div class="empty-state"><i class="bi bi-bookmark-x"></i><p>No claims submitted yet.<br/>Browse lost items and submit a claim.</p></div>`;
    return;
  }
  container.innerHTML = myClaims
    .map((c) => {
      const st = c.status === "Approved" ? "claimed" : c.status === "Rejected" ? "rejected" : "pending";
      const thumb = c.itemImage ? `<img src="${c.itemImage}" style="width:100%;height:100%;object-fit:cover;"/>` : `<span style="font-size:26px;">${c.itemEmoji}</span>`;
      return `
      <div class="claim-row">
        <div class="claim-thumb">${thumb}</div>
        <div class="claim-info">
          <div class="claim-info-name">${c.itemName}</div>
          <div class="claim-info-sub"><i class="bi bi-person me-1"></i>${c.claimantName} &bull; ID: ${c.studentId}</div>
          <div class="claim-info-sub"><i class="bi bi-telephone me-1"></i>${c.contact}</div>
          <div class="claim-info-sub"><i class="bi bi-clock me-1"></i>Submitted: ${c.submittedAt}</div>
          <div class="claim-info-sub mt-1"><i class="bi bi-file-earmark-text me-1"></i>${htmlEsc(c.proofDesc)}</div>
          ${c.adminNote ? `<div class="claim-info-sub mt-1"><i class="bi bi-chat-left-dots me-1"></i><strong>Admin Note:</strong> ${htmlEsc(c.adminNote)}</div>` : ""}
          ${c.claimWhere ? `<div class="claim-info-sub"><i class="bi bi-geo-alt me-1"></i><strong>Claim Where:</strong> ${htmlEsc(c.claimWhere)}</div>` : ""}
          ${c.claimWhen ? `<div class="claim-info-sub"><i class="bi bi-calendar-event me-1"></i><strong>Claim When:</strong> ${fmtDate(c.claimWhen)} ${new Date(c.claimWhen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>` : ""}
        </div>
        <div class="text-end"><span class="s-badge ${st}">${c.status}</span></div>
      </div>`;
    })
    .join("");
}

function buildReportForm(containerId, isAdmin) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const btnLabel = isAdmin ? "Log Item into System" : "Submit Found Item Report";
  el.innerHTML = `
    <label class="f-label">Item Name *</label>
    <input class="f-input" id="${containerId}_name" placeholder="e.g. Black Samsung Smartphone"/>
    <div class="row g-2">
      <div class="col-6">
        <label class="f-label">Category *</label>
        <select class="f-input" id="${containerId}_cat">
          <option value="">Select Category</option>
          ${getConfiguredCategories().map((c) => `<option>${htmlEsc(c)}</option>`).join("")}
        </select>
      </div>
      <div class="col-6">
        <label class="f-label">Color</label>
        <input class="f-input" id="${containerId}_color" placeholder="e.g. Black, Blue"/>
      </div>
    </div>
    <label class="f-label">Brand / Make</label>
    <input class="f-input" id="${containerId}_brand" placeholder="e.g. Samsung, Apple, Unknown"/>
    <label class="f-label">Location Found *</label>
    <input class="f-input" id="${containerId}_loc" placeholder="e.g. Library 2nd Floor, CCS Room 201"/>
    <label class="f-label">Date Found *</label>
    <input class="f-input" type="date" id="${containerId}_date"/>
    <label class="f-label">Description *</label>
    <textarea class="f-input" id="${containerId}_desc" rows="3"></textarea>
    <label class="f-label">Identifiers / Stickers / Markings * <span style="color:#aaa;font-weight:400;">(comma-separated)</span></label>
    <input class="f-input" id="${containerId}_idents" placeholder="e.g. GC sticker, scratch on corner"/>
    <label class="f-label">${isAdmin ? "Logged By (Staff Name) *" : "Your Name (Finder) *"}</label>
    <input class="f-input" id="${containerId}_finder" placeholder="Your name"/>
    <label class="f-label">Photo of Item *</label>
    <div class="photo-upload-area">
      <input type="file" id="${containerId}_photo" accept="image/*" onchange="previewPhoto(event,'${containerId}_photoPreview')"/>
      <i class="bi bi-image" style="font-size:2rem;color:#b0c4de;display:block;margin-bottom:6px;"></i>
      <div style="color:#888;font-size:0.88rem;">Upload clear photo (required)</div>
      <img id="${containerId}_photoPreview" class="photo-preview" src="" alt="preview"/>
    </div>
    <div class="f-err" id="${containerId}_err"></div>
    <button type="button" class="btn-submit" onclick="submitFoundItem('${containerId}', ${isAdmin})"><i class="bi bi-send-fill"></i> ${btnLabel}</button>
  `;
  document.getElementById(`${containerId}_date`).value = new Date().toISOString().split("T")[0];
}

function previewPhoto(e, previewId) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const p = document.getElementById(previewId);
    if (p) {
      p.src = ev.target.result;
      p.style.display = "block";
    }
  };
  reader.readAsDataURL(file);
}

async function submitFoundItem(cid, isAdmin) {
  const get = (suffix) => (document.getElementById(`${cid}_${suffix}`)?.value || "").trim();
  const errEl = document.getElementById(`${cid}_err`);
  const name = get("name");
  const cat = get("cat");
  const loc = get("loc");
  const date = get("date");
  const desc = get("desc");
  const idents = get("idents");
  const finder = get("finder");
  const photo = document.getElementById(`${cid}_photo`);
  if (!name || !cat || !loc || !date || !desc || !idents || !finder) {
    errEl.style.display = "block";
    errEl.textContent = "Please fill in all required (*) fields.";
    return;
  }
  if (!photo.files.length) {
    errEl.style.display = "block";
    errEl.textContent = "Please upload an item photo.";
    return;
  }
  let imageData = null;
  let imageStoredRemotely = false;
  try {
    const upload = await uploadImageToCloudinary(photo.files[0], "found-reports", { maxSide: 1280, quality: 0.72 });
    imageData = upload.src;
    imageStoredRemotely = upload.remote;
  } catch {
    errEl.style.display = "block";
    errEl.textContent = "Could not read image file.";
    return;
  }
  errEl.style.display = "none";
  const reportPayload = {
    id: Date.now().toString(),
    name,
    category: cat,
    location: loc,
    date,
    status: isAdmin ? "Unclaimed" : "Pending Review",
    description: desc,
    identifiers: idents.split(",").map((s) => s.trim()).filter(Boolean),
    foundBy: finder,
    color: get("color") || "Unknown",
    brand: get("brand") || "Unknown",
    emoji: emojiFor(cat),
    image: imageData,
    imageStoredRemotely,
    reporterEmail: currentUser?.email || "",
    reporterName: getCurrentProfile()?.fullName || finder,
    reportType: isAdmin ? "Admin" : "Student",
    submittedAt: new Date().toLocaleString()
  };
  if (isAdmin) {
    const newItem = { ...reportPayload, status: "Unclaimed" };
    itemsData.unshift(newItem);
    addAuditLog("item.logged.admin", { itemId: newItem.id, name: newItem.name });
    showToast("Item reported and added to the system successfully!", "success");
    // Save to Supabase for cross-browser sync
    saveToSupabase("founditems", newItem).catch(e => console.warn("Supabase save failed:", e));
  } else {
    pendingFoundReports.unshift(reportPayload);
    addAuditLog("found.report.submitted", { reportId: reportPayload.id, name: reportPayload.name });
    addNotification(`Found-item report submitted for "${reportPayload.name}".`, "info", currentUser?.email || null);
    showToast("Found-item report submitted. Waiting for admin approval.", "info");
    // Save to Supabase for cross-browser sync
    saveToSupabase("pendingfoundreports", reportPayload).catch(e => console.warn("Supabase save failed:", e));
  }
  let persisted = await savePersisted();
  if (!persisted) {
    if (isAdmin && itemsData.length) {
      itemsData[0].image = null;
      itemsData[0].imageStoredRemotely = false;
    }
    if (!isAdmin && pendingFoundReports.length) {
      pendingFoundReports[0].image = null;
      pendingFoundReports[0].imageStoredRemotely = false;
    }
    persisted = savePersisted();
    if (persisted) showToast("Report saved without image — browser storage was full.", "warning");
  }
  if (!persisted) {
    errEl.style.display = "block";
    errEl.textContent = "Could not save report locally. Please clear old data or use a smaller image.";
    return;
  }
  updateStudentStats();
  updateAdminStats();
  renderItems();
  renderRecentGrid();
  renderAdminItems();
  renderAdminOverviewLists();
  renderAdminReports();
  closeModal("reportModal");
  buildReportForm(cid, isAdmin);
  if (!isAdmin) {
    renderMyFoundReportsList();
    studentNav("founditems", document.querySelector('#studentSidebar .sb-item[data-page="founditems"]'));
  }
}

function buildLostReportForm() {
  const el = document.getElementById("lostReportFormWrap");
  if (!el) return;
  const p = getCurrentProfile();
  el.innerHTML = `
    <label class="f-label">What did you lose? *</label>
    <input class="f-input" id="lost_name" placeholder="e.g. Blue umbrella"/>
    <div class="row g-2">
      <div class="col-6">
        <label class="f-label">Category *</label>
        <select class="f-input" id="lost_cat">
          <option value="">Select Category</option>
          ${getConfiguredCategories().map((c) => `<option>${htmlEsc(c)}</option>`).join("")}
        </select>
      </div>
      <div class="col-6">
        <label class="f-label">Color</label>
        <input class="f-input" id="lost_color" placeholder="Color"/>
      </div>
    </div>
    <label class="f-label">Where did you last see it? *</label>
    <input class="f-input" id="lost_loc" placeholder="Building / area"/>
    <label class="f-label">Date Lost *</label>
    <input class="f-input" type="date" id="lost_date"/>
    <label class="f-label">Description *</label>
    <textarea class="f-input" id="lost_desc" rows="3"></textarea>
    <label class="f-label">Distinctive marks *</label>
    <input class="f-input" id="lost_marks" placeholder="Stickers, scratches, serial number"/>
    <label class="f-label">Contact Number *</label>
    <input class="f-input" id="lost_contact" value="${htmlEsc(p?.contactNumber || "")}" placeholder="09XXXXXXXXX"/>
    <label class="f-label">Photo of Lost Item *</label>
    <div class="photo-upload-area">
      <input type="file" id="lost_photo" accept="image/*" onchange="previewPhoto(event,'lost_photo_preview')"/>
      <i class="bi bi-image" style="font-size:2rem;color:#b0c4de;display:block;margin-bottom:6px;"></i>
      <div style="color:#888;font-size:0.88rem;">Upload clear photo (required)</div>
      <img id="lost_photo_preview" class="photo-preview" src="" alt="preview"/>
    </div>
    <div class="f-err" id="lost_err"></div>
    <button type="button" class="btn-submit" onclick="submitLostReport()"><i class="bi bi-send-fill"></i> Submit Lost Report</button>
  `;
  document.getElementById("lost_date").value = new Date().toISOString().split("T")[0];
}

async function submitLostReport() {
  const get = (id) => (document.getElementById(id)?.value || "").trim();
  const err = document.getElementById("lost_err");
  const photo = document.getElementById("lost_photo");
  if (!get("lost_name") || !get("lost_cat") || !get("lost_loc") || !get("lost_date") || !get("lost_desc") || !get("lost_marks") || !get("lost_contact")) {
    err.style.display = "block";
    err.textContent = "Please fill in all required fields.";
    return;
  }
  if (!photo.files.length) {
    err.style.display = "block";
    err.textContent = "Please upload a photo of the lost item.";
    return;
  }
  let imageData = null;
  let imageStoredRemotely = false;
  try {
    const upload = await uploadImageToCloudinary(photo.files[0], "lost-reports", { maxSide: 1280, quality: 0.72 });
    imageData = upload.src;
    imageStoredRemotely = upload.remote;
  } catch {
    err.style.display = "block";
    err.textContent = "Could not read image file.";
    return;
  }
  err.style.display = "none";
  const entry = {
    id: Date.now().toString(),
    reporterEmail: currentUser.email,
    reporterName: getCurrentProfile()?.fullName || currentUser.name,
    name: get("lost_name"),
    category: get("lost_cat"),
    color: get("lost_color"),
    location: get("lost_loc"),
    dateLost: get("lost_date"),
    description: get("lost_desc"),
    marks: get("lost_marks"),
    contact: get("lost_contact"),
    image: imageData,
    imageStoredRemotely,
    submittedAt: new Date().toLocaleString(),
    status: "Pending Review",
    adminNote: ""
  };
  lostReports.unshift(entry);
  let persisted = await savePersisted();
  if (!persisted) {
    lostReports[0].image = null;
    lostReports[0].imageStoredRemotely = false;
    persisted = savePersisted();
    if (persisted) showToast("Lost report saved without image — browser storage was full.", "warning");
  }
  if (!persisted) {
    err.style.display = "block";
    err.textContent = "Could not save report locally. Please clear old data or use a smaller image.";
    return;
  }
  // Also save to Supabase so it reflects for other users
  await saveToSupabase("lostreports", entry);
  buildLostReportForm();
  renderLostReportsList();
  renderLostMatches();
  renderAdminReports();
  addAuditLog("lost.report.submitted", { reportId: entry.id, name: entry.name });
  addNotification(`Lost report submitted for "${entry.name}".`, "info", currentUser.email);
  showToast("Lost item report submitted. Waiting for admin approval.", "info");
}

function renderLostReportsList() {
  const wrap = document.getElementById("lostReportsList");
  if (!wrap) return;
  const mine = getCurrentUserLostReports();
  if (!mine.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:24px 12px;"><i class="bi bi-inbox"></i><p>No lost reports yet.</p></div>';
    return;
  }
  wrap.innerHTML = mine
    .map((r) => {
      const st = lostReportBadgeClass(r.status);
      const lb = lostReportBadgeLabel(r.status);
      const name = sanitizeText(r.name);
      const category = sanitizeText(r.category);
      const location = sanitizeText(r.location);
      const description = sanitizeText(r.description);
      const adminNote = sanitizeText(r.adminNote);
      return `
      <div class="claim-row">
        <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : "📄"}</div>
        <div class="claim-info">
          <div class="claim-info-name">${htmlEsc(name)}</div>
          <div class="claim-info-sub">${htmlEsc(category)} • ${htmlEsc(location)}</div>
          <div class="claim-info-sub">Lost: ${fmtDate(r.dateLost)} • Submitted: ${r.submittedAt}</div>
          <div class="claim-info-sub mt-1">${htmlEsc(description)}</div>
          ${r.adminNote ? `<div class="claim-info-sub mt-1"><strong>Admin note:</strong> ${htmlEsc(adminNote)}</div>` : ""}
        </div>
        <div class="text-end"><span class="s-badge ${st}">${htmlEsc(lb)}</span></div>
      </div>`;
    })
    .join("");
}

function renderLostMatches() {
  const box = document.getElementById("lostMatchesList");
  if (!box) return;
  const mine = getCurrentUserLostReports().filter((r) => r.status !== "Rejected" && r.status !== "Claimed");
  const matches = [];
  for (const lost of mine) {
    for (const item of itemsData) {
      if (itemMatchesLostReport(item, lost)) {
        matches.push({ lost, item });
      }
    }
  }
  if (!matches.length) {
    box.innerHTML = '<div class="empty-state" style="padding:24px 12px;"><i class="bi bi-search"></i><p>No possible matches yet.</p></div>';
    return;
  }
  box.innerHTML = matches
    .slice(0, 12)
    .map(
      (m) => `
    <div class="claim-row" style="cursor:pointer;" onclick="openItemModal(${m.item.id})">
      <div class="claim-thumb">${m.item.image ? `<img src="${m.item.image}" style="width:100%;height:100%;object-fit:cover;"/>` : m.item.emoji}</div>
      <div class="claim-info">
        <div class="claim-info-name">${htmlEsc(m.item.name)}</div>
        <div class="claim-info-sub">Matched to your report: ${htmlEsc(m.lost.name)}</div>
        <div class="claim-info-sub">${htmlEsc(m.item.category)} • ${htmlEsc(m.item.location)} • Found: ${fmtDate(m.item.date)}</div>
      </div>
      <div class="text-end"><span class="s-badge pending">Match</span></div>
    </div>`
    )
    .join("");
}

function getCurrentUserFoundReportsCombined() {
  if (!currentUser?.email) return [];
  const email = currentUser.email;
  const pending = pendingFoundReports.filter((r) => r.reporterEmail === email).map((r) => ({ kind: "pending", r }));
  const published = itemsData
    .filter((r) => r.reporterEmail === email && String(r.reportType || "") !== "Admin")
    .map((r) => ({ kind: "published", r }));
  return [...pending, ...published].sort((a, b) => Number(b.r.id) - Number(a.r.id));
}

function renderMyFoundReportsList() {
  const wraps = [document.getElementById("myFoundReportsList"), document.getElementById("myFoundReportsOnReportPage")].filter(Boolean);
  if (!wraps.length || !currentUser?.email) return;
  const rows = getCurrentUserFoundReportsCombined();
  const empty =
    '<div class="empty-state" style="padding:24px 12px;"><i class="bi bi-inbox"></i><p>No found-item reports from you yet.<br/>Use <strong>Report Found</strong> to submit one.</p></div>';
  const inner = !rows.length
    ? empty
    : rows
        .map(({ kind, r }) => {
          const name = sanitizeText(r.name);
          const category = sanitizeText(r.category);
          const location = sanitizeText(r.location);
          const submittedAt = sanitizeText(r.submittedAt);
      if (kind === "pending") {
        return `
      <div class="claim-row">
        <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : r.emoji || "📦"}</div>
        <div class="claim-info">
          <div class="claim-info-name">${htmlEsc(name)} <span class="s-badge pending">Pending review</span></div>
          <div class="claim-info-sub">${htmlEsc(category)} • ${htmlEsc(location)} • ${fmtDate(r.date)}</div>
          <div class="claim-info-sub">Submitted: ${htmlEsc(submittedAt || "—")}</div>
        </div>
      </div>`;
      }
      return `
      <div class="claim-row">
        <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : r.emoji || "📦"}</div>
        <div class="claim-info">
          <div class="claim-info-name">${htmlEsc(name)} ${statusBadge(r.status)}</div>
          <div class="claim-info-sub">${htmlEsc(category)} • ${htmlEsc(location)} • Found: ${fmtDate(r.date)}</div>
          <div class="claim-info-sub">Published listing</div>
        </div>
      </div>`;
        })
        .join("");
  wraps.forEach((w) => {
    w.innerHTML = inner;
  });
}

function renderMyFoundLeads() {
  const wraps = [document.getElementById("myFoundLeadsList")].filter(Boolean);
  if (!wraps.length || !currentUser?.email) return;
  const mine = lostItemLeads.filter((l) => l.finderEmail === currentUser.email || l.reporterEmail === currentUser.email);
  if (!mine.length) {
    const empty = '<div class="empty-state" style="padding:24px 12px;"><i class="bi bi-chat-square-text"></i><p>No responses yet.</p></div>';
    wraps.forEach((w) => {
      w.innerHTML = empty;
    });
    return;
  }
  const html = mine
    .map((l) => {
      const report = lostReports.find((r) => Number(r.id) === Number(l.lostReportId));
      const repStatus = report?.status || "";
      const leadSt = l.status === "Accepted" ? "claimed" : l.status === "Rejected" ? "rejected" : "pending";
      const canMessage = l.status === "Accepted" && repStatus === "Claiming";
      const isClosed = repStatus === "Claimed";
      const showMarkClaimed =
        l.reporterEmail === currentUser.email && l.status === "Accepted" && repStatus === "Claiming";
      const who = l.finderEmail === currentUser.email ? "You responded to this report" : "Someone responded to your report";
      const msgList = l.messages || [];
      const msgs = msgList.length
        ? msgList
            .map(
              (m) =>
                `<div style="font-size:0.8rem;margin-bottom:6px;"><strong>${m.from === currentUser.email ? "You" : htmlEsc(m.from === l.finderEmail ? l.finderName : (lostReports.find(r => r.id === l.lostReportId)?.reporterName || "Other"))}:</strong> ${htmlEsc(m.text)} <span style="color:#aaa;">(${m.at})</span></div>`
            )
            .join("")
        : "";
      const repBadge = report
        ? `<span class="s-badge ${lostReportBadgeClass(repStatus)}" style="margin-left:6px;">${htmlEsc(lostReportBadgeLabel(repStatus))}</span>`
        : "";
      return `
      <div class="claim-row" style="display:block;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div class="claim-info-name">${htmlEsc(l.itemName)} <span class="s-badge ${leadSt}">${htmlEsc(l.status)}</span>${repBadge}</div>
            <div class="claim-info-sub">${who}</div>
          </div>
          ${
            l.status === "Pending Reporter Review" && l.reporterEmail === currentUser.email
              ? `<div class="admin-actions">
                  <button type="button" class="btn-sm-action approve" onclick="acceptLostLead(${l.id})"><i class="bi bi-check-lg"></i> Accept</button>
                  <button type="button" class="btn-sm-action reject" onclick="rejectLostLead(${l.id})"><i class="bi bi-x-lg"></i> Reject</button>
                 </div>`
              : ""
          }
        </div>
        <div class="claim-info-sub mt-2"><strong>Finder proof:</strong> ${htmlEsc(l.proofDesc)}</div>
        ${l.proofImage ? `<img src="${l.proofImage}" style="max-width:220px;max-height:140px;border-radius:8px;margin-top:8px;border:1px solid #e0e6f0;"/>` : ""}
        ${l.status === "Rejected" && l.rejectedReason ? `<div class="claim-info-sub mt-2"><strong>Reporter note:</strong> ${htmlEsc(l.rejectedReason)}</div>` : ""}
        <div id="lead_msgs_${l.id}" style="margin-top:10px;">${msgs ? msgs : '<div class="claim-info-sub">No messages yet.</div>'}</div>
        ${
          isClosed
            ? '<div class="claim-info-sub mt-2"><strong>Handoff complete.</strong> This lost report is marked as claimed.</div>'
            : ""
        }
        ${
          showMarkClaimed
            ? `<div class="mt-2">
                <button type="button" class="btn-gc success" onclick="markLostReportClaimed(${l.lostReportId})"><i class="bi bi-check2-circle"></i> Mark lost report as claimed</button>
                <div class="claim-info-sub mt-1" style="font-size:0.78rem;">Use this after you and the finder finish the exchange in chat.</div>
              </div>`
            : ""
        }
        ${
          canMessage
            ? `<div class="d-flex gap-2 mt-2">
                <input class="f-input" style="margin-bottom:0;" id="lead_msg_${l.id}" placeholder="Type message..." onkeydown="if(event.key==='Enter'){event.preventDefault();sendLeadMessage(${l.id})}"/>
                <button type="button" class="btn-gc" onclick="sendLeadMessage(${l.id})"><i class="bi bi-send"></i> Send</button>
              </div>`
            : !isClosed
              ? '<div class="claim-info-sub mt-2"><em>Chat unlocks after the reporter accepts your response.</em></div>'
              : ""
        }
      </div>`;
    })
    .join("");
  wraps.forEach((w) => {
    w.innerHTML = html;
  });
}

function openFoundYourItemModal(lostReportId) {
  const report = lostReports.find((r) => Number(r.id) === Number(lostReportId) && r.status === "Approved");
  if (!report) {
    showToast("This lost report is not available or is closed.", "warn");
    return;
  }
  if (report.reporterEmail === currentUser?.email) {
    showToast("You cannot respond to your own report.", "warn");
    return;
  }
  if (finderHasLostLead(report.id, currentUser?.email)) {
    showToast("You already submitted a response for this lost report.", "warn");
    return;
  }
  const p = getCurrentProfile();
  document.getElementById("foundYourItemBody").innerHTML = `
    <div class="modal-section" style="margin-top:0;">Lost Report</div>
    <div class="detail-row"><i class="bi bi-search"></i><span class="detail-lbl">Item:</span>${htmlEsc(report.name)}</div>
    <div class="detail-row"><i class="bi bi-geo-alt"></i><span class="detail-lbl">Location:</span>${htmlEsc(report.location)}</div>
    <label class="f-label">Your name *</label>
    <input class="f-input" id="fy_name" value="${htmlEsc(p?.fullName || "")}" />
    <label class="f-label">Your contact *</label>
    <input class="f-input" id="fy_contact" value="${htmlEsc(p?.contactNumber || "")}" />
    <label class="f-label">Proof that this is the same item *</label>
    <textarea class="f-input" id="fy_proof" rows="3" placeholder="Describe exact marks / context where you found it"></textarea>
    <label class="f-label">Photo proof *</label>
    <div class="photo-upload-area">
      <input type="file" id="fy_photo" accept="image/*" onchange="previewPhoto(event,'fy_photo_preview')"/>
      <i class="bi bi-image" style="font-size:2rem;color:#b0c4de;display:block;margin-bottom:6px;"></i>
      <div style="color:#888;font-size:0.88rem;">Required</div>
      <img id="fy_photo_preview" class="photo-preview" src="" alt="preview"/>
    </div>
    <div class="f-err" id="fy_err"></div>
    <button type="button" class="btn-submit" onclick="submitFoundYourItem(${report.id})"><i class="bi bi-send-fill"></i> Send to Reporter</button>
  `;
  openModal("foundYourItemModal");
}

async function submitFoundYourItem(lostReportId) {
  const err = document.getElementById("fy_err");
  const name = document.getElementById("fy_name").value.trim();
  const contact = document.getElementById("fy_contact").value.trim();
  const proof = document.getElementById("fy_proof").value.trim();
  const photo = document.getElementById("fy_photo");
  if (!name || !contact || !proof) {
    err.style.display = "block";
    err.textContent = "Please fill in all required fields.";
    return;
  }
  if (!photo.files.length) {
    err.style.display = "block";
    err.textContent = "Please upload a photo proof.";
    return;
  }
  let proofImage = null;
  let proofStoredRemotely = false;
  try {
    const upload = await uploadImageToCloudinary(photo.files[0], "lead-proofs", { maxSide: 1200, quality: 0.65 });
    proofImage = upload.src;
    proofStoredRemotely = upload.remote;
  } catch {
    err.style.display = "block";
    err.textContent = "Could not read image file.";
    return;
  }
  err.style.display = "none";
  const report = lostReports.find((r) => Number(r.id) === Number(lostReportId));
  if (!report) return;
  if (report.status !== "Approved") {
    err.style.display = "block";
    err.textContent = "This lost report is no longer open for new responses.";
    return;
  }
  if (finderHasLostLead(report.id, currentUser.email)) {
    err.style.display = "block";
    err.textContent = "You already submitted a response for this report.";
    return;
  }
  lostItemLeads.unshift({
    id: Date.now().toString(),
    lostReportId: report.id,
    itemName: report.name,
    reporterEmail: report.reporterEmail,
    finderEmail: currentUser.email,
    finderName: name,
    finderContact: contact,
    proofDesc: proof,
    proofImage,
    proofStoredRemotely,
    status: "Pending Reporter Review",
    messages: [],
    submittedAt: new Date().toLocaleString(),
    rejectedReason: ""
  });
  let persisted = await savePersisted();
  if (!persisted) {
    lostItemLeads[0].proofImage = null;
    lostItemLeads[0].proofStoredRemotely = false;
    persisted = savePersisted();
    if (persisted) showToast("Response saved without image — browser storage was full.", "warning");
  }
  if (!persisted) {
    err.style.display = "block";
    err.textContent = "Could not save response locally. Please clear old data or use a smaller image.";
    return;
  }
  // Also save to Supabase so it reflects for the reporter
  await saveToSupabase("lostitemleads", lostItemLeads[0]);
  renderMyFoundLeads();
  renderLostReportsList();
  closeModal("foundYourItemModal");
  addAuditLog("lost.response.submitted", { lostReportId: report.id, leadId: lostItemLeads[0]?.id || null });
  addNotification(`New finder response for "${report.name}".`, "info", report.reporterEmail);
  showToast("Response sent to the reporter. They can accept, reject, or compare multiple responses.", "success");
}

function acceptLostLead(leadId) {
  const lead = lostItemLeads.find((l) => Number(l.id) === Number(leadId));
  if (!lead || lead.reporterEmail !== currentUser?.email) return;
  const report = lostReports.find((r) => Number(r.id) === Number(lead.lostReportId));
  if (!report) return;
  lead.status = "Accepted";
  lead.messages = lead.messages || [];
  lead.messages.push({ from: currentUser.email, text: "I accepted your response. Let's coordinate item handoff.", at: new Date().toLocaleString() });
  report.status = "Claiming";
  lostItemLeads.forEach((x) => {
    if (
      Number(x.lostReportId) === Number(lead.lostReportId) &&
      Number(x.id) !== Number(leadId) &&
      x.status === "Pending Reporter Review"
    ) {
      x.status = "Rejected";
      x.rejectedReason = "Another response was accepted for this report.";
    }
  });
  savePersisted();
  // Sync changed items to Supabase
  saveToSupabase("lostitemleads", lead).catch(e => console.warn("Supabase save failed:", e));
  saveToSupabase("lostreports", report).catch(e => console.warn("Supabase save failed:", e));
  lostItemLeads.forEach((x) => {
    if (x.status === "Rejected" && Number(x.lostReportId) === Number(lead.lostReportId)) {
      saveToSupabase("lostitemleads", x).catch(e => console.warn("Supabase save failed:", e));
    }
  });
  renderMyFoundLeads();
  renderLostReportsList();
  renderPublicLostItems();
  renderDashboardMixed();
  renderLostMatches();
  addAuditLog("lost.response.accepted", { leadId, lostReportId: lead.lostReportId });
  addNotification(`Your response for "${lead.itemName}" was accepted.`, "success", lead.finderEmail);
  showToast("Response accepted. Lost report is now Claiming — chat is open.", "success");
}

function markLostReportClaimed(lostReportId) {
  const report = lostReports.find((r) => Number(r.id) === Number(lostReportId));
  if (!report || report.reporterEmail !== currentUser?.email) return;
  const acceptedLead = lostItemLeads.find(
    (l) => Number(l.lostReportId) === Number(lostReportId) && l.status === "Accepted"
  );
  if (!acceptedLead) {
    showToast("Accept a finder response before marking this report as claimed.", "warn");
    return;
  }
  if (report.status !== "Claiming") {
    showToast("You can only mark as claimed while the handoff is in progress.", "warn");
    return;
  }
  const pendingValidation = ensureLostRecoveryClaim(report, acceptedLead);
  report.status = "Pending Validation";
  savePersisted();
  saveToSupabase("lostreports", report).catch(e => console.warn("Supabase save failed:", e));
  if (pendingValidation) saveToSupabase("claims", pendingValidation).catch(e => console.warn("Supabase save failed:", e));
  renderMyFoundLeads();
  renderLostReportsList();
  renderPublicLostItems();
  renderDashboardMixed();
  renderLostMatches();
  renderAdminClaims();
  renderAdminReports();
  updateAdminStats();
  addAuditLog("lost.report.pending_validation", { lostReportId, claimId: pendingValidation.id });
  addNotification(`Lost report "${report.name}" is pending admin validation.`, "info", report.reporterEmail);
  showToast("Submitted for admin validation. Waiting for claim approval.", "info");
}

function rejectLostLead(leadId) {
  const lead = lostItemLeads.find((l) => Number(l.id) === Number(leadId));
  if (!lead || lead.reporterEmail !== currentUser?.email) return;
  const report = lostReports.find((r) => Number(r.id) === Number(lead.lostReportId));
  lead.status = "Rejected";
  lead.rejectedReason = "Proof did not match.";
  if (report && report.status === "Claiming") {
    const hasAccepted = lostItemLeads.some(
      (l) =>
        Number(l.lostReportId) === Number(report.id) &&
        Number(l.id) !== Number(leadId) &&
        l.status === "Accepted"
    );
    const hasOtherPending = lostItemLeads.some(
      (l) =>
        Number(l.lostReportId) === Number(report.id) &&
        Number(l.id) !== Number(leadId) &&
        l.status === "Pending Reporter Review"
    );
    if (!hasAccepted && !hasOtherPending) report.status = "Approved";
  }
  savePersisted();
  saveToSupabase("lostitemleads", lead).catch(e => console.warn("Supabase save failed:", e));
  if (report) saveToSupabase("lostreports", report).catch(e => console.warn("Supabase save failed:", e));
  renderMyFoundLeads();
  renderLostReportsList();
  renderPublicLostItems();
  renderDashboardMixed();
  renderLostMatches();
  addAuditLog("lost.response.rejected", { leadId, lostReportId: lead.lostReportId });
  addNotification(`Your response for "${lead.itemName}" was rejected.`, "danger", lead.finderEmail);
  showToast("Response rejected.", "danger");
}

function sendLeadMessage(leadId) {
  const lead = lostItemLeads.find((l) => Number(l.id) === Number(leadId));
  if (!lead) return;
  if (lead.status !== "Accepted") return;
  const report = lostReports.find((r) => Number(r.id) === Number(lead.lostReportId));
  if (!report || report.status !== "Claiming") return;
  const allInputs = document.querySelectorAll(`#lead_msg_${leadId}`);
  let input = null;
  for (const inp of allInputs) {
    if (inp.value.trim()) { input = inp; break; }
  }
  if (!input) return;
  const text = input.value.trim();
  if (lead.finderEmail !== currentUser?.email && lead.reporterEmail !== currentUser?.email) return;
  lead.messages = lead.messages || [];
  lead.messages.push({ from: currentUser.email, text, at: new Date().toLocaleString() });
  savePersisted();
  saveToSupabase("lostitemleads", lead).catch(e => console.warn("Supabase save failed:", e));
  // Re-render the message list inline instead of rebuilding the entire DOM
  // to avoid losing focus/input state
  const wraps = [document.getElementById("myFoundLeadsList")].filter(Boolean);
  wraps.forEach((w) => {
    const msgContainer = w.querySelector(`[id="lead_msgs_${leadId}"]`);
    if (msgContainer) {
      msgContainer.innerHTML = lead.messages
        .map(
          (m) =>
            `<div style="font-size:0.8rem;margin-bottom:6px;"><strong>${m.from === currentUser.email ? "You" : htmlEsc(m.from === lead.finderEmail ? lead.finderName : (lostReports.find(r => r.id === lead.lostReportId)?.reporterName || "Other"))}:</strong> ${htmlEsc(m.text)} <span style="color:#aaa;">(${m.at})</span></div>`
        )
        .join("");
    }
  });
  // Clear all duplicate inputs
  allInputs.forEach((inp) => { inp.value = ""; });
}

// Real-time chat message refresh - called when lostItemLeads update via Supabase
function refreshLeadMessages(oldLeads, newLeads) {
  if (!currentUser?.email) return;
  
  // Find leads that the current user is involved in and have new messages
  newLeads.forEach(newLead => {
    const oldLead = oldLeads.find(l => Number(l.id) === Number(newLead.id));
    if (!oldLead) return;
    
    // Check if this lead involves the current user
    const isInvolved = newLead.finderEmail === currentUser.email || newLead.reporterEmail === currentUser.email;
    if (!isInvolved) return;
    
    // Check if there are new messages
    const oldMsgCount = oldLead.messages?.length || 0;
    const newMsgCount = newLead.messages?.length || 0;
    
    if (newMsgCount > oldMsgCount) {
      // New messages detected - update the chat display
      const msgContainer = document.querySelector(`#lead_msgs_${newLead.id}`);
      if (msgContainer && newLead.messages) {
        msgContainer.innerHTML = newLead.messages
          .map(
            (m) =>
              `<div style="font-size:0.8rem;margin-bottom:6px;"><strong>${m.from === currentUser.email ? "You" : htmlEsc(m.from === newLead.finderEmail ? newLead.finderName : (lostReports.find(r => r.id === newLead.lostReportId)?.reporterName || "Other"))}:</strong> ${htmlEsc(m.text)} <span style="color:#aaa;">(${m.at})</span></div>`
          )
          .join("");
        
        // Auto-scroll to bottom of chat
        msgContainer.scrollTop = msgContainer.scrollHeight;
      }
    }
  });
}

function renderAdminReports() {
  const foundWrap = document.getElementById("adminFoundReportsList");
  const lostWrap = document.getElementById("adminLostReportsList");
  if (!foundWrap || !lostWrap) return;

  const foundRows = pendingFoundReports
    .map(
      (r) => {
        const name = sanitizeText(r.name);
        const category = sanitizeText(r.category);
        const location = sanitizeText(r.location);
        const reporterName = sanitizeText(r.reporterName || r.foundBy);
        const reporterEmail = sanitizeText(r.reporterEmail || "");
        return `
    <div class="claim-row">
      <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : r.emoji || "📦"}</div>
      <div class="claim-info">
        <div class="claim-info-name">${htmlEsc(name)} <span class="s-badge pending">Pending</span></div>
        <div class="claim-info-sub">${htmlEsc(category)} • ${htmlEsc(location)} • ${fmtDate(r.date)}</div>
        <div class="claim-info-sub">By: ${htmlEsc(reporterName)} • ${htmlEsc(reporterEmail)}</div>
      </div>
      <div class="admin-actions">
        <button type="button" class="btn-sm-action approve" onclick="approveFoundReport(${r.id})"><i class="bi bi-check-lg"></i> Approve</button>
        <button type="button" class="btn-sm-action reject" onclick="rejectFoundReport(${r.id})"><i class="bi bi-x-lg"></i> Reject</button>
      </div>
    </div>`;
      }
    )
    .join("");
  foundWrap.innerHTML = foundRows || '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No pending found reports.</p></div>';

  const lostRows = lostReports
    .filter((r) => (reportTabFilter === "all" ? true : r.status === "Pending Review"))
    .map((r) => {
      const st = lostReportBadgeClass(r.status);
      const lb = lostReportBadgeLabel(r.status);
      const actions =
        r.status === "Pending Review"
          ? `<button type="button" class="btn-sm-action approve" onclick="approveLostReport(${r.id})"><i class="bi bi-check-lg"></i> Approve</button>
             <button type="button" class="btn-sm-action reject" onclick="rejectLostReport(${r.id})"><i class="bi bi-x-lg"></i> Reject</button>`
          : "";
      const name = sanitizeText(r.name);
      const category = sanitizeText(r.category);
      const location = sanitizeText(r.location);
      const reporterName = sanitizeText(r.reporterName);
      const contact = sanitizeText(r.contact);
      return `
    <div class="claim-row">
      <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : "📄"}</div>
      <div class="claim-info">
        <div class="claim-info-name">${htmlEsc(name)} <span class="s-badge ${st}">${htmlEsc(lb)}</span></div>
        <div class="claim-info-sub">${htmlEsc(category)} • ${htmlEsc(location)} • Lost: ${fmtDate(r.dateLost)}</div>
        <div class="claim-info-sub">By: ${htmlEsc(reporterName)} • ${htmlEsc(contact)}</div>
      </div>
      <div class="admin-actions">${actions}</div>
    </div>`;
    })
    .join("");
  lostWrap.innerHTML = lostRows || `<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>${reportTabFilter === "all" ? "No lost reports." : "No pending lost reports."}</p></div>`;
}

function setReportTab(tab, el) {
  reportTabFilter = tab;
  document.getElementById("tabReportsPending")?.classList.remove("active");
  document.getElementById("tabReportsAll")?.classList.remove("active");
  if (el) el.classList.add("active");
  renderAdminReports();
}

function renderAdminLostRecoveries() {
  const wrap = document.getElementById("adminLostRecoveriesList");
  if (!wrap) return;
  const rows = allClaims
    .filter((c) => c.sourceType === "lost-recovery" && c.status === "Pending Review")
    .sort((a, b) => Number(b.id) - Number(a.id));
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No pending lost recoveries.</p></div>';
    return;
  }
  wrap.innerHTML = rows
    .map((c) => {
      const report = lostReports.find((r) => Number(r.id) === Number(c.relatedLostReportId));
      const lead = lostItemLeads.find((l) => Number(l.id) === Number(c.relatedLeadId));
      const canAct = c.status === "Pending Review";
      const badgeClass = c.status === "Approved" ? "claimed" : c.status === "Rejected" ? "rejected" : "pending";
      return `
      <div class="claim-row">
        <div class="claim-thumb">${report?.image ? `<img src="${report.image}" style="width:100%;height:100%;object-fit:cover;"/>` : "🔍"}</div>
        <div class="claim-info">
          <div class="claim-info-name">${htmlEsc(c.itemName)} <span class="s-badge ${badgeClass}">${htmlEsc(c.status)}</span></div>
          <div class="claim-info-sub">Reporter: ${htmlEsc(c.claimantName)} • ${htmlEsc(c.claimantEmail || "—")}</div>
          <div class="claim-info-sub">Finder: ${htmlEsc(lead?.finderName || "—")} • ${htmlEsc(lead?.finderEmail || "—")}</div>
          <div class="claim-info-sub">Lead chat accepted and marked claimed by reporter.</div>
          <div class="claim-info-sub">Lost report status: <span class="s-badge ${lostReportBadgeClass(report?.status || "")}">${htmlEsc(lostReportBadgeLabel(report?.status || ""))}</span></div>
        </div>
        <div class="admin-actions">
          <button class="btn-sm-action view" onclick="viewClaimDetails(${c.id})"><i class="bi bi-eye"></i> View</button>
          ${canAct ? `<button class="btn-sm-action approve" onclick="viewClaimDetails(${c.id})"><i class="bi bi-check-lg"></i> Approve</button>
          <button class="btn-sm-action reject" onclick="rejectClaim(${c.id})"><i class="bi bi-x-lg"></i> Reject</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function approveLostRecoveryReport(lostReportId) {
  if (!requirePermission("admin.claims.review")) return;
  const claim = allClaims.find(
    (c) =>
      c.sourceType === "lost-recovery" &&
      Number(c.relatedLostReportId) === Number(lostReportId) &&
      c.status === "Pending Review"
  );
  if (!claim) {
    showToast("No pending lost recovery validation found.", "warn");
    return;
  }
  approveClaim(claim.id);
}

function rejectLostRecoveryReport(lostReportId) {
  if (!requirePermission("admin.claims.review")) return;
  const claim = allClaims.find(
    (c) =>
      c.sourceType === "lost-recovery" &&
      Number(c.relatedLostReportId) === Number(lostReportId) &&
      c.status === "Pending Review"
  );
  if (!claim) {
    showToast("No pending lost recovery validation found.", "warn");
    return;
  }
  rejectClaim(claim.id);
}

function getPendingReportsCount() {
  const pendingLost = lostReports.filter((r) => r.status === "Pending Review").length;
  const pendingFound = pendingFoundReports.length;
  return pendingLost + pendingFound;
}

function approveFoundReport(id) {
  if (!requirePermission("admin.reports.review")) return;
  const idx = pendingFoundReports.findIndex((r) => Number(r.id) === Number(id));
  if (idx < 0) return;
  const r = pendingFoundReports[idx];
  pendingFoundReports.splice(idx, 1);
  const newItem = { ...r, status: "Unclaimed" };
  delete newItem.reportType;
  itemsData.unshift(newItem);
  savePersisted();
  // Sync to Supabase for cross-browser sync
  saveToSupabase("founditems", newItem).catch(e => console.warn("Supabase save failed:", e));
  deleteFromSupabase("pendingfoundreports", String(r.id)).catch(e => console.warn("Supabase delete failed:", e));
  renderAdminReports();
  renderItems();
  renderRecentGrid();
  updateStudentStats();
  updateAdminStats();
  renderAdminItems();
  renderAdminOverviewLists();
  renderLostMatches();
  addAuditLog("report.found.approved", { reportId: id, name: r.name });
  addNotification(`Your found-item report "${r.name}" was approved and published.`, "success", r.reporterEmail || null);
  showToast("Found report approved and published.", "success");
}

function rejectFoundReport(id) {
  if (!requirePermission("admin.reports.review")) return;
  const target = pendingFoundReports.find((r) => Number(r.id) === Number(id));
  pendingFoundReports = pendingFoundReports.filter((r) => Number(r.id) !== Number(id));
  savePersisted();
  // Sync to Supabase for cross-browser sync
  deleteFromSupabase("pendingfoundreports", String(target.id)).catch(e => console.warn("Supabase delete failed:", e));
  renderAdminReports();
  addAuditLog("report.found.rejected", { reportId: id, name: target?.name || "" });
  if (target?.reporterEmail) addNotification(`Your found-item report "${target.name}" was rejected.`, "danger", target.reporterEmail);
  showToast("Found report rejected.", "danger");
}

function approveLostReport(id) {
  if (!requirePermission("admin.reports.review")) return;
  const r = lostReports.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  r.status = "Approved";
  savePersisted();
  saveToSupabase("lostreports", r).catch(e => console.warn("Supabase save failed:", e));
  renderAdminReports();
  renderLostReportsList();
  renderLostMatches();
  addAuditLog("report.lost.approved", { reportId: id, name: r.name });
  addNotification(`Your lost report "${r.name}" was approved and is now visible.`, "success", r.reporterEmail || null);
  showToast("Lost report approved.", "success");
}

function rejectLostReport(id) {
  if (!requirePermission("admin.reports.review")) return;
  const r = lostReports.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  r.status = "Rejected";
  savePersisted();
  saveToSupabase("lostreports", r).catch(e => console.warn("Supabase save failed:", e));
  renderAdminReports();
  renderLostReportsList();
  renderLostMatches();
  addAuditLog("report.lost.rejected", { reportId: id, name: r.name });
  addNotification(`Your lost report "${r.name}" was rejected.`, "danger", r.reporterEmail || null);
  showToast("Lost report rejected.", "danger");
}

function openReportModal() {
  buildReportForm("reportModalBody", false);
  openModal("reportModal");
}

function renderNotificationsList() {
  const wrap = document.getElementById("notificationsList");
  if (!wrap || !currentUser?.email) return;
  const mine = notifications.filter((n) => !n.targetEmail || n.targetEmail === currentUser.email);
  if (!mine.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="bi bi-bell-slash"></i><p>No notifications yet.</p></div>';
    return;
  }
  const readSet = new Set();
  wrap.innerHTML = mine
    .slice(0, 80)
    .map((n) => {
      const isRead = Array.isArray(n.readBy) && n.readBy.includes(currentUser.email);
      readSet.add(n.id);
      return `<div class="claim-row" style="${isRead ? "opacity:.8;" : "border-left:4px solid #1a5fac;"}">
        <div class="claim-info">
          <div class="claim-info-name">${htmlEsc(n.message)}</div>
          <div class="claim-info-sub">${htmlEsc(n.createdAt || "—")}</div>
        </div>
      </div>`;
    })
    .join("");
  notifications.forEach((n) => {
    if (!readSet.has(n.id)) return;
    n.readBy = Array.isArray(n.readBy) ? n.readBy : [];
    if (!n.readBy.includes(currentUser.email)) n.readBy.push(currentUser.email);
  });
  savePersisted();
}

function renderAdminAnalyticsPanel() {
  const wrap = document.getElementById("adminAnalyticsPanel");
  if (!wrap || !canPerform("admin.analytics.view")) return;
  const resolved = itemsData.filter((x) => String(x.status) === "Claimed").length;
  const approvalRate = allClaims.length ? Math.round((allClaims.filter((x) => x.status === "Approved").length / allClaims.length) * 100) : 0;
  const byCategory = {};
  [...itemsData, ...pendingFoundReports].forEach((r) => {
    const k = String(r.category || "Others");
    byCategory[k] = (byCategory[k] || 0) + 1;
  });
  const topCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  wrap.innerHTML = `
    <div class="row g-2 mt-1 mb-2">
      <div class="col-6 col-md-3"><div class="stat-card"><div><div class="stat-num">${resolved}</div><div class="stat-lbl">Resolved Items</div></div></div></div>
      <div class="col-6 col-md-3"><div class="stat-card"><div><div class="stat-num">${allClaims.length}</div><div class="stat-lbl">Total Claims</div></div></div></div>
      <div class="col-6 col-md-3"><div class="stat-card"><div><div class="stat-num">${approvalRate}%</div><div class="stat-lbl">Claim Approval Rate</div></div></div></div>
      <div class="col-6 col-md-3"><div class="stat-card"><div><div class="stat-num">${lostReports.length + pendingFoundReports.length}</div><div class="stat-lbl">Open Reports</div></div></div></div>
    </div>
    <div style="font-size:.86rem;color:#667085;">
      <strong>Top Categories:</strong> ${topCats.length ? topCats.map(([k, v]) => `${htmlEsc(k)} (${v})`).join(" • ") : "No data yet"}
    </div>`;
}

function renderAdminAuditLogs() {
  const wrap = document.getElementById("adminAuditLogsPanel");
  if (!wrap || !canPerform("admin.logs.view")) return;
  if (!auditLogs.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:12px;"><i class="bi bi-journal-x"></i><p>No audit entries yet.</p></div>';
    return;
  }
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(auditLogs.length / pageSize));
  if (auditLogPage > totalPages - 1) auditLogPage = totalPages - 1;
  const start = auditLogPage * pageSize;
  const pageRows = auditLogs.slice(start, start + pageSize);
  wrap.innerHTML = pageRows
    .map((a) => `<div style="padding:8px 0;border-bottom:1px solid #edf1f7;">
      <div style="font-size:.85rem;font-weight:700;color:#1a2a4a;">${htmlEsc(a.action)}</div>
      <div style="font-size:.78rem;color:#667085;">${htmlEsc(a.actorEmail)} (${htmlEsc(a.actorRole)}) • ${htmlEsc(a.at)}</div>
    </div>`)
    .join("") + `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
      <button type="button" class="btn-sm-action view" onclick="prevAuditLogsPage()" ${auditLogPage <= 0 ? "disabled" : ""}>&lt;</button>
      <div style="font-size:.78rem;color:#667085;">Page ${auditLogPage + 1} / ${totalPages}</div>
      <button type="button" class="btn-sm-action view" onclick="nextAuditLogsPage()" ${auditLogPage >= totalPages - 1 ? "disabled" : ""}>&gt;</button>
    </div>`;
}

function prevAuditLogsPage() {
  if (auditLogPage <= 0) return;
  auditLogPage--;
  renderAdminAuditLogs();
}

function nextAuditLogsPage() {
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(auditLogs.length / pageSize));
  if (auditLogPage >= totalPages - 1) return;
  auditLogPage++;
  renderAdminAuditLogs();
}

function exportReportsCsv() {
  if (!requirePermission("admin.analytics.view")) return;
  const rows = [["type", "id", "name", "category", "location", "status", "submittedAt"]];
  itemsData.forEach((x) => rows.push(["found_item", x.id, x.name, x.category, x.location, x.status, x.submittedAt || x.date || ""]));
  lostReports.forEach((x) => rows.push(["lost_report", x.id, x.name, x.category, x.location, x.status, x.submittedAt || x.dateLost || ""]));
  pendingFoundReports.forEach((x) => rows.push(["found_report_pending", x.id, x.name, x.category, x.location, x.status, x.submittedAt || x.date || ""]));
  allClaims.forEach((x) => rows.push(["claim", x.id, x.itemName, "", "", x.status, x.submittedAt || ""]));
  const csvContent = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gclf-report-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  addAuditLog("reports.csv.exported", { rows: rows.length - 1 });
}

function exportBackupJson() {
  if (!requirePermission("admin.backup.manage")) return;
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: JSON.parse(persistPayload())
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gclf-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  addAuditLog("backup.exported");
}

function importBackupJson(event) {
  if (!requirePermission("admin.backup.manage")) return;
  const file = event?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const incoming = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
      itemsData = Array.isArray(incoming.itemsData) ? incoming.itemsData : [];
      allClaims = Array.isArray(incoming.allClaims) ? incoming.allClaims : [];
      myClaimsByEmail = incoming.myClaimsByEmail && typeof incoming.myClaimsByEmail === "object" ? incoming.myClaimsByEmail : {};
      studentProfiles = incoming.studentProfiles && typeof incoming.studentProfiles === "object" ? incoming.studentProfiles : {};
      lostReports = Array.isArray(incoming.lostReports) ? incoming.lostReports : [];
      pendingFoundReports = Array.isArray(incoming.pendingFoundReports) ? incoming.pendingFoundReports : [];
      lostItemLeads = Array.isArray(incoming.lostItemLeads) ? incoming.lostItemLeads : [];
      auditLogs = Array.isArray(incoming.auditLogs) ? incoming.auditLogs : [];
      notifications = Array.isArray(incoming.notifications) ? incoming.notifications : [];
      systemConfig = incoming.systemConfig && typeof incoming.systemConfig === "object" ? { ...systemConfig, ...incoming.systemConfig } : systemConfig;
      await savePersisted();
      addAuditLog("backup.imported", { file: file.name });
      renderAdminOverviewLists();
      renderAdminItems();
      renderAdminClaims();
      renderAdminReports();
      renderAdminAnalyticsPanel();
      renderAdminAuditLogs();
      renderItems();
      renderPublicLostItems();
      renderLostReportsList();
      renderMyClaims();
      showToast("Backup restored successfully.", "success");
    } catch (e) {
      showToast("Invalid backup file.", "danger");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function renderAdminOverviewLists() {
  const recentEl = document.getElementById("adminRecentItems");
  const recent = [...itemsData].slice(0, 5);
  recentEl.innerHTML = recent.length
    ? recent
        .map(
          (item) => {
            const name = sanitizeText(item.name);
            const location = sanitizeText(item.location);
            return `
    <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f5;">
      <div style="width:40px;height:40px;border-radius:8px;background:#eef2fa;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">
        ${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;"/>` : item.emoji}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.85rem;color:#1a2a4a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${htmlEsc(name)}</div>
        <div style="font-size:0.76rem;color:#aaa;">${htmlEsc(location)} &bull; ${fmtDate(item.date)}</div>
      </div>
      ${statusBadge(item.status)}
    </div>`;
          }
        )
        .join("")
    : '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No items yet.</p></div>';

  const claimsEl = document.getElementById("adminRecentClaims");
  const recentClaims = [...allClaims].slice(0, 5);
  claimsEl.innerHTML = recentClaims.length
    ? recentClaims
        .map((c) => {
          const st = c.status === "Approved" ? "claimed" : c.status === "Rejected" ? "rejected" : "pending";
          const itemName = sanitizeText(c.itemName);
          const claimantName = sanitizeText(c.claimantName);
          const studentId = sanitizeText(c.studentId);
          return `
      <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f5;">
        <div style="width:40px;height:40px;border-radius:8px;background:#eef2fa;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${c.itemEmoji}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.85rem;color:#1a2a4a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${htmlEsc(itemName)}</div>
          <div style="font-size:0.76rem;color:#aaa;">${htmlEsc(claimantName)} &bull; ${htmlEsc(studentId)}</div>
        </div>
        <span class="s-badge ${st}">${c.status}</span>
      </div>`;
        })
        .join("")
    : '<div class="empty-state" style="padding:20px;"><i class="bi bi-clipboard2-x"></i><p>No claims yet.</p></div>';

  const lostEl = document.getElementById("adminRecentLostReports");
  if (lostEl) {
    const recentLost = [...lostReports].slice(0, 5);
    lostEl.innerHTML = recentLost.length
      ? recentLost
          .map(
            (r) => {
              const name = sanitizeText(r.name);
              const location = sanitizeText(r.location);
              return `
      <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f5;">
        <div style="width:40px;height:40px;border-radius:8px;background:#eef2fa;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">
          ${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;"/>` : "🔍"}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.85rem;color:#1a2a4a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${htmlEsc(name)}</div>
          <div style="font-size:0.76rem;color:#aaa;">${htmlEsc(location)} &bull; ${fmtDate(r.dateLost)}</div>
        </div>
        <span class="s-badge ${lostReportBadgeClass(r.status)}">${htmlEsc(lostReportBadgeLabel(r.status))}</span>
      </div>`;
            }
          )
          .join("")
      : '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No lost reports yet.</p></div>';
  }
}

function renderAdminItems() {
  const q = (document.getElementById("adminSearchQ")?.value || "").toLowerCase();
  const st = document.getElementById("adminFilterStat")?.value || "";
  const filtered = itemsData.filter((item) => {
    const ms = item.name.toLowerCase().includes(q) || item.location.toLowerCase().includes(q);
    // If no status filter selected, show all items (including claimed)
    // If status filter selected, only show items matching that status
    const statusMatch = !st || item.status === st;
    return ms && statusMatch;
  });
  const tbody = document.getElementById("adminItemsTbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#aaa;">No items found.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered
    .map(
      (item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:38px;height:38px;border-radius:8px;background:#eef2fa;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;overflow:hidden;">
            ${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;"/>` : item.emoji}
          </div>
          <div>
            <div style="font-weight:700;font-size:0.84rem;color:#1a2a4a;">${item.name}</div>
            <div style="font-size:0.75rem;color:#aaa;">${item.brand} &bull; ${item.color}</div>
          </div>
        </div>
      </td>
      <td>${item.category}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.location}</td>
      <td>${fmtDate(item.date)}</td>
      <td>${statusBadge(item.status)}</td>
      <td>
        <div class="admin-actions">
          <button class="btn-sm-action view" onclick="openItemModal(${item.id})"><i class="bi bi-eye"></i> View</button>
          <button class="btn-sm-action edit" onclick="openEditItemModal(${item.id})"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn-sm-action delete" onclick="adminDeleteItem(${item.id})"><i class="bi bi-trash"></i> Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join("");
}

// Filter admin items by status when clicking stat cards
function filterAdminItemsByStatus(status) {
  // Navigate to manage items page if not already there
  const manageItemsSection = document.getElementById("a-manageItems");
  if (!manageItemsSection?.classList.contains("active")) {
    const navEl = document.querySelector('#adminSidebar .sb-item[data-page="manageItems"]');
    if (navEl) adminNav("manageItems", navEl);
  }
  
  // Set the filter dropdown
  const filterSelect = document.getElementById("adminFilterStat");
  if (filterSelect) {
    filterSelect.value = status || "";
    renderAdminItems();
  }
}

async function adminDeleteItem(id) {
  if (!requirePermission("admin.items.delete")) return;
  if (!confirm("Are you sure you want to delete this item? This cannot be undone.")) return;
  
  // Normalize ID to string for consistent comparison
  const idStr = String(id);
  const deleted = findItemById(idStr);
  
  if (!deleted) {
    showToast("Item not found.", "danger");
    return;
  }
  
  console.log("Deleting item:", deleted.name, "ID:", idStr, "(type:", typeof deleted.id, ")");
  
  // First, try to delete from Supabase
  try {
    await deleteFromSupabase("founditems", idStr);
    console.log("Item deleted from Supabase successfully");
    // Mark timestamp to prevent real-time sync from overwriting our deletion
    lastDeleteTimestamp = Date.now();
  } catch (e) {
    console.error("Supabase delete failed:", e);
    showToast("Failed to delete from server: " + (e.message || "Unknown error"), "danger");
    return; // Stop here - don't delete locally if server delete failed
  }
  
  // Only delete locally if Supabase delete succeeded
  // Use loose equality to handle both number and string IDs
  itemsData = itemsData.filter((i) => String(i.id) !== idStr);
  
  // Force save to IndexedDB (without triggering Supabase re-sync immediately)
  await setToIndexedDB(STORAGE_KEY, JSON.parse(persistPayload())).then(() => {
    console.log("Item deleted from IndexedDB");
  }).catch(e => console.warn("IndexedDB delete failed:", e));
  
  // Update local storage
  await savePersisted();
  
  // Force immediate re-render BEFORE any real-time updates can interfere
  console.log("Rendering with", itemsData.length, "items");
  renderAdminItems();
  renderItems();
  renderRecentGrid();
  updateStudentStats();
  updateAdminStats();
  renderAdminOverviewLists();
  
  addAuditLog("item.deleted", { itemId: id, name: deleted?.name || "" });
  showToast("Item deleted from the system.", "danger");
}

function openEditItemModal(id) {
  if (!requirePermission("admin.items.edit")) return;
  const item = findItemById(id);
  if (!item) return;
  document.getElementById("editItemBody").innerHTML = `
    <label class="f-label">Item Name *</label>
    <input class="f-input" id="ei_name" value="${htmlEsc(item.name)}"/>
    <div class="row g-2">
      <div class="col-6">
        <label class="f-label">Status *</label>
        <select class="f-input" id="ei_status">
          <option ${item.status === "Unclaimed" ? "selected" : ""}>Unclaimed</option>
          <option ${item.status === "Pending" ? "selected" : ""}>Pending</option>
          <option ${item.status === "Claimed" ? "selected" : ""}>Claimed</option>
        </select>
      </div>
      <div class="col-6">
        <label class="f-label">Category *</label>
        <select class="f-input" id="ei_cat">
          ${getConfiguredCategories().map((c) => `<option ${item.category === c ? "selected" : ""}>${htmlEsc(c)}</option>`).join("")}
        </select>
      </div>
    </div>
    <label class="f-label">Color</label>
    <input class="f-input" id="ei_color" value="${htmlEsc(item.color)}"/>
    <label class="f-label">Brand</label>
    <input class="f-input" id="ei_brand" value="${htmlEsc(item.brand)}"/>
    <label class="f-label">Location *</label>
    <input class="f-input" id="ei_loc" value="${htmlEsc(item.location)}"/>
    <label class="f-label">Description *</label>
    <textarea class="f-input" id="ei_desc" rows="3">${htmlEsc(item.description)}</textarea>
    <label class="f-label">Identifiers (comma-separated)</label>
    <input class="f-input" id="ei_idents" value="${htmlEsc((item.identifiers || []).join(", "))}"/>
    <div class="f-err" id="ei_err"></div>
    <button type="button" class="btn-submit" onclick="saveEditItem(${id})"><i class="bi bi-check-circle-fill"></i> Save Changes</button>
    <button type="button" class="btn-cancel" onclick="closeModal('editItemModal')">Cancel</button>
  `;
  openModal("editItemModal");
}

function saveEditItem(id) {
  if (!requirePermission("admin.items.edit")) return;
  const item = findItemById(id);
  if (!item) return;
  const before = { name: item.name, status: item.status, category: item.category, location: item.location };
  const errEl = document.getElementById("ei_err");
  const name = document.getElementById("ei_name").value.trim();
  if (!name) {
    errEl.style.display = "block";
    errEl.textContent = "Item name is required.";
    return;
  }
  errEl.style.display = "none";
  item.name = name;
  item.status = document.getElementById("ei_status").value;
  item.category = document.getElementById("ei_cat").value;
  item.color = document.getElementById("ei_color").value.trim() || "Unknown";
  item.brand = document.getElementById("ei_brand").value.trim() || "Unknown";
  item.location = document.getElementById("ei_loc").value.trim();
  item.description = document.getElementById("ei_desc").value.trim();
  item.identifiers = document.getElementById("ei_idents").value.split(",").map((s) => s.trim()).filter(Boolean);
  item.emoji = emojiFor(item.category);
  savePersisted();
  saveToSupabase("founditems", item).catch(e => console.warn("Supabase save failed:", e));
  renderAdminItems();
  renderItems();
  renderRecentGrid();
  updateStudentStats();
  updateAdminStats();
  closeModal("editItemModal");
  addAuditLog("item.updated", { itemId: id, before, after: { name: item.name, status: item.status, category: item.category, location: item.location } });
  showToast("Item updated successfully!", "info");
}

function setClaimTab(tab, el) {
  claimTabFilter = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  renderAdminClaims();
}

function renderAdminClaims() {
  let claims = allClaims.filter((c) => c.sourceType !== "lost-recovery");
  if (claimTabFilter === "pending") claims = claims.filter((c) => c.status === "Pending Review");
  else if (claimTabFilter === "approved") claims = claims.filter((c) => c.status === "Approved");
  else if (claimTabFilter === "rejected") claims = claims.filter((c) => c.status === "Rejected");
  const tbody = document.getElementById("adminClaimsTbody");
  if (!claims.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#aaa;">No claims in this category.</td></tr>`;
    return;
  }
  tbody.innerHTML = claims
    .map((c, idx) => {
      const st = c.status === "Approved" ? "claimed" : c.status === "Rejected" ? "rejected" : "pending";
      const canAct = c.status === "Pending Review";
      const src = c.sourceType === "lost-recovery" ? '<span class="s-badge approved" style="margin-left:6px;">Lost recovery</span>' : "";
      return `
      <tr>
        <td>${idx + 1}</td>
        <td><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">${c.itemEmoji}</span><div style="font-weight:700;font-size:0.83rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.itemName}</div>${src}</div></td>
        <td>${c.claimantName}</td>
        <td>${c.studentId}</td>
        <td>${c.contact}</td>
        <td style="font-size:0.78rem;white-space:nowrap;">${c.submittedAt}</td>
        <td><span class="s-badge ${st}">${c.status}</span></td>
        <td>
          <div class="admin-actions">
            <button class="btn-sm-action view" onclick="viewClaimDetails(${c.id})"><i class="bi bi-eye"></i> View</button>
            ${canAct ? `<button class="btn-sm-action approve" onclick="quickApprovePrompt(${c.id})"><i class="bi bi-check-lg"></i> Approve</button>
            <button class="btn-sm-action reject" onclick="rejectClaim(${c.id})"><i class="bi bi-x-lg"></i> Reject</button>` : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function viewClaimDetails(cid) {
  console.log("viewClaimDetails called with cid:", cid, "Type:", typeof cid);
  console.log("allClaims count:", allClaims?.length);
  console.log("allClaims sample IDs:", allClaims?.slice(0, 3).map(x => ({id: x.id, type: typeof x.id})));
  
  // Normalize ID comparison - handle both string and number
  const c = allClaims.find((x) => String(x.id) === String(cid));
  if (!c) {
    console.error("Claim not found! CID:", cid);
    showToast("Error: Claim not found", "danger");
    return;
  }
  console.log("Found claim:", c.id, c.itemName, c.status);
  const canAct = c.status === "Pending Review";
  const isLostRecovery = c.sourceType === "lost-recovery";
  const relatedLost = isLostRecovery ? lostReports.find((r) => Number(r.id) === Number(c.relatedLostReportId)) : null;
  const relatedLead = isLostRecovery ? lostItemLeads.find((l) => Number(l.id) === Number(c.relatedLeadId)) : null;
  document.getElementById("viewClaimBody").innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <span style="font-size:40px;">${c.itemEmoji}</span>
      <div>
        <div style="font-weight:800;font-size:1.1rem;color:#1a2a4a;">${c.itemName}</div>
        <div>${statusBadge(c.status)}</div>
      </div>
    </div>
    <div class="modal-section" style="margin-top:0;">${isLostRecovery ? "Lost Recovery Reporter" : "Claimant Information"}</div>
    <div class="detail-row"><i class="bi bi-person-fill"></i><span class="detail-lbl">Full Name:</span>${htmlEsc(c.claimantName)}</div>
    <div class="detail-row"><i class="bi bi-card-text"></i><span class="detail-lbl">Student ID:</span>${htmlEsc(c.studentId)}</div>
    <div class="detail-row"><i class="bi bi-telephone-fill"></i><span class="detail-lbl">Contact:</span>${htmlEsc(c.contact)}</div>
    <div class="detail-row"><i class="bi bi-clock-fill"></i><span class="detail-lbl">Submitted:</span>${c.submittedAt}</div>
    ${
      isLostRecovery
        ? `<div class="detail-row"><i class="bi bi-person-circle"></i><span class="detail-lbl">Reporter:</span>${htmlEsc(c.claimantName)} • ${htmlEsc(c.claimantEmail || "—")}</div>
    <div class="detail-row"><i class="bi bi-person-badge"></i><span class="detail-lbl">Finder:</span>${htmlEsc(relatedLead?.finderName || "—")} • ${htmlEsc(relatedLead?.finderEmail || "—")}</div>
    <div class="detail-row"><i class="bi bi-geo-alt"></i><span class="detail-lbl">Lost Location:</span>${htmlEsc(relatedLost?.location || "—")}</div>`
        : ""
    }
    <div class="modal-section">Proof of Ownership</div>
    <div class="detail-row"><i class="bi bi-file-earmark-text-fill"></i><span class="detail-lbl">Description:</span>${htmlEsc(c.proofDesc)}</div>
    <div class="detail-row"><i class="bi bi-tag-fill"></i><span class="detail-lbl">Marks:</span>${htmlEsc(c.marks || "—")}</div>
    ${
      c.proofImage
        ? `<div style="margin:10px 0 14px;"><img src="${c.proofImage}" alt="Proof" style="max-width:100%;max-height:240px;border-radius:10px;border:1px solid #e0e6f0;"/></div>`
        : `<div class="detail-row"><i class="bi bi-image-fill"></i><span class="detail-lbl">Photo File:</span>${htmlEsc(c.photoName || "—")}</div>
           ${c.proofImageMissing ? '<div style="font-size:0.82rem;color:#b54708;margin-top:6px;">Proof image was not saved due to browser storage limit.</div>' : ""}`
    }
    ${
      canAct
        ? `
      <div class="modal-section">${isLostRecovery ? "Admin Validation Notes" : "Admin Release Note to Claimant"}</div>
      ${isLostRecovery ? "" : `<label class="f-label">Where to claim *</label>
      <input class="f-input" id="admin_claim_where_${c.id}" placeholder="e.g. OSA Office, Main Building"/>
      <label class="f-label">When to claim *</label>
      <input class="f-input" id="admin_claim_when_${c.id}" type="datetime-local"/>`}
      <label class="f-label">Admin Note ${isLostRecovery ? "" : "(optional)"}</label>
      <textarea class="f-input" id="admin_claim_note_${c.id}" rows="2" placeholder="${isLostRecovery ? "Validation notes for this lost item recovery..." : "Bring school ID and claim stub."}"></textarea>
      <div class="f-err" id="admin_claim_err_${c.id}"></div>
      <div class="d-flex gap-2 mt-2">
        <button class="btn-gc success" style="flex:1;" onclick="approveClaim(${c.id});closeModal('viewClaimModal')">
          <i class="bi bi-check-circle-fill"></i> Approve Claim
        </button>
        <button class="btn-gc danger" style="flex:1;" onclick="rejectClaim(${c.id});closeModal('viewClaimModal')">
          <i class="bi bi-x-circle-fill"></i> Reject Claim
        </button>
      </div>`
        : `
      <div class="mt-3 p-3" style="background:#f8f9fa;border-radius:10px;">
        ${c.adminNote ? `<div style="font-size:0.88rem;margin-bottom:6px;"><strong>Admin Note:</strong> ${htmlEsc(c.adminNote)}</div>` : ""}
        ${c.claimWhere ? `<div style="font-size:0.88rem;"><strong>Claim Where:</strong> ${htmlEsc(c.claimWhere)}</div>` : ""}
        ${c.claimWhen ? `<div style="font-size:0.88rem;"><strong>Claim When:</strong> ${fmtDate(c.claimWhen)} ${new Date(c.claimWhen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>` : ""}
      </div>`
    }
  `;
  openModal("viewClaimModal");
}

function approveClaim(cid) {
  console.log("approveClaim called with cid:", cid, "Type:", typeof cid);
  if (!requirePermission("admin.claims.review")) return;
  // Normalize ID comparison - handle both string and number
  const c = allClaims.find((x) => String(x.id) === String(cid));
  if (!c) {
    console.error("approveClaim: Claim not found! CID:", cid);
    showToast("Error: Claim not found", "danger");
    return;
  }
  console.log("approveClaim: Found claim", c.id, c.itemName);
  const whereEl = document.getElementById(`admin_claim_where_${cid}`);
  const whenEl = document.getElementById(`admin_claim_when_${cid}`);
  const noteEl = document.getElementById(`admin_claim_note_${cid}`);
  const errEl = document.getElementById(`admin_claim_err_${cid}`);
  const claimWhere = whereEl ? whereEl.value.trim() : c.claimWhere || "";
  const claimWhen = whenEl ? whenEl.value : c.claimWhen || "";
  const adminNote = noteEl ? noteEl.value.trim() : c.adminNote || "";
  const isLostRecovery = c.sourceType === "lost-recovery";
  if (!isLostRecovery && (!claimWhere || !claimWhen) && errEl) {
    errEl.style.display = "block";
    errEl.textContent = "Where and when to claim are required for approval.";
    return;
  }
  c.status = "Approved";
  c.claimWhere = claimWhere;
  c.claimWhen = claimWhen;
  c.adminNote = adminNote;
  const mc = myClaimsByEmail[c.claimantEmail]?.find((x) => String(x.id) === String(cid));
  if (mc) {
    mc.status = "Approved";
    mc.claimWhere = claimWhere;
    mc.claimWhen = claimWhen;
    mc.adminNote = adminNote;
  }
  const localMc = myClaims.find((x) => String(x.id) === String(cid));
  if (localMc) {
    localMc.status = "Approved";
    localMc.claimWhere = claimWhere;
    localMc.claimWhen = claimWhen;
    localMc.adminNote = adminNote;
  }
  const item = findItemById(c.itemId);
  if (item) item.status = "Claimed";
  if (isLostRecovery) {
    const report = lostReports.find((r) => Number(r.id) === Number(c.relatedLostReportId));
    if (report) report.status = "Claimed";
    const lead = lostItemLeads.find((l) => Number(l.id) === Number(c.relatedLeadId));
    if (lead) lead.status = "Completed";
  }
  savePersisted();
  // Sync to Supabase
  saveToSupabase("claims", c).catch(e => console.warn("Supabase save failed:", e));
  if (item) saveToSupabase("founditems", item).catch(e => console.warn("Supabase save failed:", e));
  if (isLostRecovery) {
    const report = lostReports.find((r) => Number(r.id) === Number(c.relatedLostReportId));
    if (report) saveToSupabase("lostreports", report).catch(e => console.warn("Supabase save failed:", e));
    const lead = lostItemLeads.find((l) => Number(l.id) === Number(c.relatedLeadId));
    if (lead) saveToSupabase("lostitemleads", lead).catch(e => console.warn("Supabase save failed:", e));
  }
  renderAdminClaims();
  renderAdminLostRecoveries();
  updateAdminStats();
  updateStudentStats();
  renderAdminItems();
  renderAdminOverviewLists();
  renderItems();
  renderRecentGrid();
  renderAdminReports();
  renderMyFoundLeads();
  renderLostReportsList();
  renderMyClaims();
  closeModal("viewClaimModal");
  addAuditLog("claim.approved", { claimId: cid, itemId: c.itemId, claimantEmail: c.claimantEmail });
  addNotification(`Your claim for "${c.itemName}" was approved.`, "success", c.claimantEmail);
  showToast(`Claim APPROVED for "${c.itemName}".`, "success");
}

function rejectClaim(cid) {
  console.log("rejectClaim called with cid:", cid, "Type:", typeof cid);
  if (!requirePermission("admin.claims.review")) return;
  const c = allClaims.find((x) => String(x.id) === String(cid));
  if (!c) {
    console.error("rejectClaim: Claim not found! CID:", cid);
    showToast("Error: Claim not found", "danger");
    return;
  }
  c.status = "Rejected";
  const mc = myClaimsByEmail[c.claimantEmail]?.find((x) => String(x.id) === String(cid));
  if (mc) mc.status = "Rejected";
  const localMc = myClaims.find((x) => String(x.id) === String(cid));
  if (localMc) localMc.status = "Rejected";
  const item = findItemById(c.itemId);
  if (item && item.status === "Pending") item.status = "Unclaimed";
  if (c.sourceType === "lost-recovery") {
    const report = lostReports.find((r) => Number(r.id) === Number(c.relatedLostReportId));
    if (report) report.status = "Claiming";
    const lead = lostItemLeads.find((l) => Number(l.id) === Number(c.relatedLeadId));
    if (lead) lead.status = "Accepted";
  }
  savePersisted();
  // Sync to Supabase
  saveToSupabase("claims", c).catch(e => console.warn("Supabase save failed:", e));
  if (item && item.status === "Unclaimed") saveToSupabase("founditems", item).catch(e => console.warn("Supabase save failed:", e));
  if (c.sourceType === "lost-recovery") {
    const report = lostReports.find((r) => Number(r.id) === Number(c.relatedLostReportId));
    if (report) saveToSupabase("lostreports", report).catch(e => console.warn("Supabase save failed:", e));
    const lead = lostItemLeads.find((l) => Number(l.id) === Number(c.relatedLeadId));
    if (lead) saveToSupabase("lostitemleads", lead).catch(e => console.warn("Supabase save failed:", e));
  }
  renderAdminClaims();
  renderAdminLostRecoveries();
  updateAdminStats();
  updateStudentStats();
  renderAdminItems();
  renderAdminOverviewLists();
  renderItems();
  renderRecentGrid();
  renderAdminReports();
  renderMyFoundLeads();
  renderLostReportsList();
  renderMyClaims();
  addAuditLog("claim.rejected", { claimId: cid, itemId: c.itemId, claimantEmail: c.claimantEmail });
  addNotification(`Your claim for "${c.itemName}" was rejected.`, "danger", c.claimantEmail);
  showToast(`Claim REJECTED for "${c.itemName}".`, "danger");
}

// Quick approve from table - always opens view modal so admin can add notes
function quickApprovePrompt(cid) {
  // Always open view modal for both regular claims and lost-recovery
  // This allows admin to review details and add notes before approving
  viewClaimDetails(cid);
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function closeOnOverlay(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

function toggleMobileSidebar() {
  const studentSidebar = document.getElementById("studentSidebar");
  const adminSidebar = document.getElementById("adminSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const mainApp = document.getElementById("mainApp");
  const adminApp = document.getElementById("adminApp");

  // Check computed style to properly detect visibility
  const mainAppVisible = mainApp && (window.getComputedStyle(mainApp).display !== "none");
  const adminAppVisible = adminApp && (window.getComputedStyle(adminApp).display !== "none");

  // Toggle the appropriate sidebar based on which app is visible
  if (studentSidebar && mainAppVisible) {
    studentSidebar.classList.toggle("open");
    if (overlay) overlay.classList.toggle("open");
  } else if (adminSidebar && adminAppVisible) {
    adminSidebar.classList.toggle("open");
    if (overlay) overlay.classList.toggle("open");
  } else if (adminSidebar && !mainAppVisible) {
    // Fallback: if mainApp is not visible, assume admin is active
    adminSidebar.classList.toggle("open");
    if (overlay) overlay.classList.toggle("open");
  }
}

function initSidebarToggle() {
  document.querySelectorAll(".topbar-hamburger").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-collapsed");
    });
  });
}

function showToast(msg, type = "success") {
  const container = document.getElementById("toastContainer");
  const id = "toast_" + Date.now();
  const icons = { success: "bi-check-circle-fill", danger: "bi-x-circle-fill", info: "bi-info-circle-fill", warn: "bi-exclamation-triangle-fill" };
  const div = document.createElement("div");
  div.className = `toast-msg ${type}`;
  div.id = id;
  div.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i> ${msg}`;
  container.appendChild(div);
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, 4000);
}

bootstrapData();

// Check for existing session on page load
async function initAuth() {
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    
    if (data?.session?.user) {
      const user = data.session.user;
      const metadata = user.user_metadata || {};
      
      currentUser = {
        email: user.email,
        role: metadata.role || "student",
        name: metadata.displayName || metadata.name || user.email.split('@')[0],
        dept: metadata.dept || "Gordon College"
      };
      
      document.getElementById("loginPage").style.display = "none";
      syncMyClaims();
      
      // Load data from Supabase (including profiles) before launching app
      try {
        await loadAllDataFromSupabase();
      } catch(e) { console.warn("Supabase load failed on init:", e); }
      
      if (currentUser.role === "admin") await launchAdminApp();
      else await launchStudentApp();
      
      // Restore last visited page after apps are launched
      restoreLastPage();
      
      console.log("Session restored for:", currentUser.email);
    }
  } catch (e) {
    console.log("No existing session found or error:", e?.message);
  }
}

// Save current page to localStorage
function saveCurrentPage(page, role) {
  try {
    localStorage.setItem('gclf_lastPage', JSON.stringify({ page, role, timestamp: Date.now() }));
  } catch (e) {
    console.warn("Failed to save page state:", e);
  }
}

// Restore last visited page from localStorage
function restoreLastPage() {
  try {
    const saved = localStorage.getItem('gclf_lastPage');
    if (!saved) return;
    
    const { page, role } = JSON.parse(saved);
    if (role !== currentUser?.role) return; // Only restore if same role
    
    // Navigate to saved page after a short delay to ensure DOM is ready
    setTimeout(() => {
      if (role === "admin") {
        const navEl = document.querySelector(`#adminSidebar .sb-item[data-page="${page}"]`);
        if (navEl) adminNav(page, navEl);
      } else {
        const navEl = document.querySelector(`#studentSidebar .sb-item[data-page="${page}"]`);
        if (navEl) studentNav(page, navEl);
      }
    }, 100);
  } catch (e) {
    console.warn("Failed to restore page state:", e);
  }
}

// Initialize auth check when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}

// ===================== AI ASSISTANT FUNCTIONS =====================
// Using Google AI Studio (Gemini API) - supports CORS from browser
const GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest"
];
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Get API key from localStorage or window variable
function getGeminiKey() {
  return localStorage.getItem('gclf_gemini_key') || window.GEMINI_API_KEY || '';
}

// Save API key to localStorage
function saveGeminiKey(key) {
  localStorage.setItem('gclf_gemini_key', key);
}

// Calculate analytics data for AI
function getAnalyticsData() {
  const totalItems = itemsData.length;
  const claimedItems = itemsData.filter(i => i.status === "Claimed").length;
  const unclaimedItems = itemsData.filter(i => i.status === "Unclaimed").length;
  const pendingItems = itemsData.filter(i => i.status === "Pending").length;
  
  const totalClaims = allClaims.length;
  const approvedClaims = allClaims.filter(c => c.status === "Approved").length;
  const rejectedClaims = allClaims.filter(c => c.status === "Rejected").length;
  const pendingClaims = allClaims.filter(c => c.status === "Pending Review").length;
  
  const approvalRate = totalClaims > 0 ? ((approvedClaims / totalClaims) * 100).toFixed(1) : 0;
  const rejectionRate = totalClaims > 0 ? ((rejectedClaims / totalClaims) * 100).toFixed(1) : 0;
  
  const totalReports = pendingFoundReports.length + lostReports.length;
  const pendingReports = pendingFoundReports.filter(r => r.status === "Pending Review").length;
  
  // Category breakdown
  const categoryCounts = {};
  itemsData.forEach(item => {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  });
  
  // Recent activity (last 7 days)
  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);
  const recentClaims = allClaims.filter(c => new Date(c.submittedAt) >= last7Days).length;
  const recentItems = itemsData.filter(i => new Date(i.date) >= last7Days).length;
  
  return {
    totalItems, claimedItems, unclaimedItems, pendingItems,
    totalClaims, approvedClaims, rejectedClaims, pendingClaims,
    approvalRate, rejectionRate,
    totalReports, pendingReports,
    categoryCounts,
    recentClaims, recentItems,
    topLocations: getTopLocations(),
    monthlyTrend: getMonthlyTrend()
  };
}

function getTopLocations() {
  const locCounts = {};
  itemsData.forEach(item => {
    locCounts[item.location] = (locCounts[item.location] || 0) + 1;
  });
  return Object.entries(locCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([loc, count]) => ({ location: loc, count }));
}

function getMonthlyTrend() {
  const months = {};
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months[d.toISOString().slice(0, 7)] = 0;
  }
  allClaims.forEach(c => {
    const month = new Date(c.submittedAt).toISOString().slice(0, 7);
    if (months.hasOwnProperty(month)) {
      months[month]++;
    }
  });
  return Object.entries(months).map(([month, count]) => ({ month, count }));
}

// Add message to chat
function addAIMessage(role, content) {
  const container = document.getElementById("aiChatMessages");
  const welcome = document.querySelector(".ai-welcome-message");
  if (welcome) welcome.style.display = "none";
  
  const msgDiv = document.createElement("div");
  msgDiv.className = `ai-message ${role}`;
  msgDiv.innerHTML = `
    <div class="ai-message-header">${role === "user" ? "You" : "AI Assistant"}</div>
    <div class="ai-message-content">${content}</div>
  `;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function showAILoading() {
  const container = document.getElementById("aiChatMessages");
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "ai-loading";
  loadingDiv.id = "aiLoadingIndicator";
  loadingDiv.innerHTML = '<i class="bi bi-stars"></i> AI is thinking...';
  container.appendChild(loadingDiv);
  container.scrollTop = container.scrollHeight;
}

function hideAILoading() {
  const loading = document.getElementById("aiLoadingIndicator");
  if (loading) loading.remove();
}

// Send message to Gemini API
async function sendToAI(userMessage, systemPrompt = null) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return "Please set your Google AI Studio API key first. Use the Settings option in the AI panel.";
  }
  
  const analytics = getAnalyticsData();
  
  const systemInstruction = systemPrompt || `You are an AI analytics assistant for the Gordon College Lost & Found (GCLF) system.

Current system data:
- Total Items: ${analytics.totalItems} (Claimed: ${analytics.claimedItems}, Unclaimed: ${analytics.unclaimedItems}, Pending: ${analytics.pendingItems})
- Total Claims: ${analytics.totalClaims} (Approved: ${analytics.approvedClaims}, Rejected: ${analytics.rejectedClaims}, Pending: ${analytics.pendingClaims})
- Approval Rate: ${analytics.approvalRate}%
- Rejection Rate: ${analytics.rejectionRate}%
- Recent Activity (7 days): ${analytics.recentClaims} new claims, ${analytics.recentItems} new items
- Top Locations: ${analytics.topLocations.map(l => l.location).join(", ")}

Provide concise, helpful insights and recommendations. Be professional but friendly.`;

  try {
    let lastError = null;

    for (const model of GEMINI_MODELS) {
      const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [{
            role: "user",
            parts: [{ text: userMessage }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
          }
        })
      });

      if (!response.ok) {
        let errorMsg = "Unknown error";
        try {
          const errorData = await response.json();
          errorMsg = errorData.error?.message || errorMsg;
        } catch (_) {
          // Keep a stable fallback message when API doesn't return JSON.
        }

        // Rate/quota issues are not model-specific, so fail immediately.
        if (response.status === 429 || errorMsg.includes("Quota exceeded")) {
          throw new Error("Rate limit exceeded. Google AI Studio free tier has limits. Please wait a minute and try again, or check your quota at https://ai.google.dev/gemini-api/docs/rate-limits");
        }

        // Invalid key or permission problems should fail immediately.
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication failed: ${errorMsg}`);
        }

        // Model-specific errors can be retried with another model.
        lastError = new Error(`Model ${model} failed (${response.status}): ${errorMsg}`);
        continue;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("")
        .trim();

      if (text) return text;

      // If request succeeded but returned no text, try another model before failing.
      lastError = new Error(`Model ${model} returned an empty response.`);
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("No available Gemini model returned a response.");
  } catch (error) {
    console.error("AI API error:", error);
    return "Sorry, I couldn't process your request. " + error.message;
  }
}

// Chat functions
async function sendAIChatMessage() {
  const input = document.getElementById("aiChatInput");
  const message = input.value.trim();
  if (!message) return;
  
  addAIMessage("user", message);
  input.value = "";
  showAILoading();
  
  const response = await sendToAI(message);
  hideAILoading();
  addAIMessage("assistant", response);
}

async function generateAIAnalyticsSummary() {
  showAILoading();
  const analytics = getAnalyticsData();
  const prompt = `Generate a comprehensive analytics summary with key insights and recommendations for improvement. Include:
1. Overall performance overview
2. Key trends and patterns
3. Areas of concern
4. Actionable recommendations`;
  
  const response = await sendToAI(prompt);
  hideAILoading();
  addAIMessage("assistant", response);
}

async function askAIApprovalRate() {
  const analytics = getAnalyticsData();
  const message = `What's the current approval rate? ${analytics.approvedClaims} out of ${analytics.totalClaims} claims have been approved (${analytics.approvalRate}%). Is this good?`;
  document.getElementById("aiChatInput").value = message;
  sendAIChatMessage();
}

async function askAIClaimTrends() {
  showAILoading();
  const analytics = getAnalyticsData();
  const prompt = `Analyze the claim trends. Monthly data: ${JSON.stringify(analytics.monthlyTrend)}. Recent 7-day activity: ${analytics.recentClaims} claims. What trends do you see and what should we expect?`;
  
  const response = await sendToAI(prompt);
  hideAILoading();
  addAIMessage("assistant", response);
}

async function askAIRecommendations() {
  showAILoading();
  const analytics = getAnalyticsData();
  const prompt = `Based on the data (Approval rate: ${analytics.approvalRate}%, Unclaimed items: ${analytics.unclaimedItems}, Pending claims: ${analytics.pendingClaims}), provide 3-5 specific actionable recommendations to improve the lost and found system efficiency.`;
  
  const response = await sendToAI(prompt);
  hideAILoading();
  addAIMessage("assistant", response);
}

// AI Settings functions
function toggleAISettings() {
  const panel = document.getElementById("aiSettingsPanel");
  if (panel) {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display === "block") {
      // Load existing key (masked)
      const existingKey = getGeminiKey();
      if (existingKey) {
        document.getElementById("aiApiKeyInput").value = existingKey;
        document.getElementById("aiSettingsStatus").textContent = "API key is saved. Click Save to update.";
      }
    }
  }
}

function saveAISettings() {
  const keyInput = document.getElementById("aiApiKeyInput");
  const key = keyInput.value.trim();
  const statusDiv = document.getElementById("aiSettingsStatus");
  
  if (!key) {
    statusDiv.textContent = "Please enter an API key.";
    return;
  }
  
  // Google API keys start with AIza
  if (!key.startsWith("AIza")) {
    statusDiv.textContent = "Invalid API key format. Google AI Studio keys should start with 'AIza'.";
    return;
  }
  
  saveGeminiKey(key);
  statusDiv.textContent = "API key saved successfully! You can now use the AI assistant.";
  statusDiv.style.color = "#28a745";
  keyInput.value = "";
  
  // Hide panel after 2 seconds
  setTimeout(() => {
    const panel = document.getElementById("aiSettingsPanel") || document.getElementById("aiChatSettings");
    if (panel) panel.style.display = "none";
  }, 2000);
}

// Toggle AI Chat panel
function toggleAIChat() {
  const panel = document.getElementById("aiAssistantPanel");
  const bubbles = document.querySelectorAll(".toggle-bubble");
  
  if (panel) {
    const isHidden = panel.style.display === "none";
    panel.style.display = isHidden ? "block" : "none";
    
    // Animate bubbles
    bubbles.forEach((bubble, index) => {
      setTimeout(() => {
        if (isHidden) {
          bubble.classList.add("active");
        } else {
          bubble.classList.remove("active");
        }
      }, index * 100);
    });
    
    // Also hide settings panel when collapsing
    if (!isHidden) {
      const settingsPanel = document.getElementById("aiSettingsPanel");
      if (settingsPanel) settingsPanel.style.display = "none";
    }
  }
}

// Handle Enter key in AI chat input
document.addEventListener("DOMContentLoaded", () => {
  const aiInput = document.getElementById("aiChatInputPopup");
  if (aiInput) {
    aiInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendAIChatMessagePopup();
      }
    });
  }
});

// ===================== AI POPUP FUNCTIONS =====================
function openAIChatPopup() {
  openModal("aiChatModal");
  // Hide welcome message if there are messages
  const messagesContainer = document.getElementById("aiChatMessagesPopup");
  const welcome = document.querySelector(".ai-welcome-popup");
  if (messagesContainer && messagesContainer.children.length > 0 && welcome) {
    welcome.style.display = "none";
  }
}

function toggleAISettingsPopup() {
  const settings = document.getElementById("aiChatSettings");
  if (settings) {
    settings.style.display = settings.style.display === "none" ? "block" : "none";
    if (settings.style.display === "block") {
      const existingKey = getGeminiKey();
      if (existingKey) {
        document.getElementById("aiApiKeyInput").value = existingKey;
        document.getElementById("aiSettingsStatus").textContent = "API key is saved. Click Save to update.";
        document.getElementById("aiSettingsStatus").style.color = "#28a745";
      } else {
        document.getElementById("aiSettingsStatus").textContent = "No API key set. Please enter your Google AI Studio API key.";
        document.getElementById("aiSettingsStatus").style.color = "#dc3545";
      }
    }
  }
}

function addAIMessagePopup(role, content) {
  const container = document.getElementById("aiChatMessagesPopup");
  const welcome = document.querySelector(".ai-welcome-popup");
  if (welcome) welcome.style.display = "none";
  
  const msgDiv = document.createElement("div");
  msgDiv.className = `ai-message-popup ${role}`;
  msgDiv.innerHTML = content;
  container.appendChild(msgDiv);
  
  const body = document.getElementById("aiChatBody");
  body.scrollTop = body.scrollHeight;
}

function showAILoadingPopup() {
  const container = document.getElementById("aiChatMessagesPopup");
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "ai-message-popup assistant";
  loadingDiv.id = "aiLoadingPopup";
  loadingDiv.innerHTML = '<div class="ai-loading"><i class="bi bi-stars"></i> AI is thinking...</div>';
  container.appendChild(loadingDiv);
  
  const body = document.getElementById("aiChatBody");
  body.scrollTop = body.scrollHeight;
}

function hideAILoadingPopup() {
  const loading = document.getElementById("aiLoadingPopup");
  if (loading) loading.remove();
}

async function sendAIChatMessagePopup() {
  const input = document.getElementById("aiChatInputPopup");
  const message = input.value.trim();
  if (!message) return;
  
  addAIMessagePopup("user", message);
  input.value = "";
  showAILoadingPopup();
  
  const response = await sendToAI(message);
  hideAILoadingPopup();
  addAIMessagePopup("assistant", response);
}

// Override ask functions to use popup
const originalAskAIApprovalRate = askAIApprovalRate;
askAIApprovalRate = async function() {
  const analytics = getAnalyticsData();
  const message = `What's the current approval rate? ${analytics.approvedClaims} out of ${analytics.totalClaims} claims have been approved (${analytics.approvalRate}%). Is this good?`;
  addAIMessagePopup("user", message);
  showAILoadingPopup();
  const response = await sendToAI(message);
  hideAILoadingPopup();
  addAIMessagePopup("assistant", response);
};

const originalAskAIClaimTrends = askAIClaimTrends;
askAIClaimTrends = async function() {
  showAILoadingPopup();
  const analytics = getAnalyticsData();
  const prompt = `Analyze the claim trends. Monthly data: ${JSON.stringify(analytics.monthlyTrend)}. Recent 7-day activity: ${analytics.recentClaims} claims. What trends do you see and what should we expect?`;
  
  const response = await sendToAI(prompt);
  hideAILoadingPopup();
  addAIMessagePopup("assistant", response);
};

const originalAskAIRecommendations = askAIRecommendations;
askAIRecommendations = async function() {
  showAILoadingPopup();
  const analytics = getAnalyticsData();
  const prompt = `Based on the data (Approval rate: ${analytics.approvalRate}%, Unclaimed items: ${analytics.unclaimedItems}, Pending claims: ${analytics.pendingClaims}), provide 3-5 specific actionable recommendations to improve the lost and found system efficiency.`;
  
  const response = await sendToAI(prompt);
  hideAILoadingPopup();
  addAIMessagePopup("assistant", response);
};

const originalGenerateAIAnalyticsSummary = generateAIAnalyticsSummary;
generateAIAnalyticsSummary = async function() {
  showAILoadingPopup();
  const prompt = `Generate a comprehensive analytics summary with key insights and recommendations for improvement. Include:
1. Overall performance overview
2. Key trends and patterns
3. Areas of concern
4. Actionable recommendations`;
  
  const response = await sendToAI(prompt);
  hideAILoadingPopup();
  addAIMessagePopup("assistant", response);
};


