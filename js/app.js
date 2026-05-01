const STORAGE_KEY = "gclf_student_portal_v2";

const ACCOUNTS = [
  { email: "admin@gc.edu", password: "admin123", role: "admin", name: "System Admin", dept: "Administration" },
  { email: "student@gc.edu", password: "password123", role: "student", name: "JOHN ASHLEE M. MALIGA", dept: "CCS / BSIT" },
  { email: "student2@gc.edu", password: "pass2024", role: "student", name: "MARIA SANTOS", dept: "CCS / BSCS" }
];
const ADMIN_EMAILS = ["admin@gc.edu", "admin@gordoncollege.edu.ph"];
const firebaseConfig = {
  apiKey: "AIzaSyBYH-vjjg1oFlqmuoHwaO6Utm1JeIYV9ps",
  authDomain: "gclf-43f7f.firebaseapp.com",
  projectId: "gclf-43f7f",
  storageBucket: "gclf-43f7f.firebasestorage.app",
  messagingSenderId: "1010891807535",
  appId: "1:1010891807535:web:e9f8881eb2881317e21fda",
  measurementId: "G-94PFS9ZLJZ"
};
// Cloudinary — browser uploads use UNSIGNED presets only.
// Do NOT put CLOUDINARY_URL, API secret, or API key in this file (anyone can read it in DevTools).
// Dashboard: Settings → Upload → Upload presets → Add preset → Signing mode: Unsigned → copy its name here.
const CLOUDINARY_CLOUD_NAME = "dx4cgsmaa";
// First matching preset wins (fixes typos / renames). Create one named gclf_unsigned (recommended).
const CLOUDINARY_UPLOAD_PRESETS = ["gclf_unsigned", "GCLF iMAGES", "GCLF_IMAGES", "gclf_upload"];

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
let db = null; // Firestore instance
let firestoreListeners = []; // Track Firestore listeners for cleanup

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePersisted() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ itemsData, allClaims, myClaimsByEmail, studentProfiles, lostReports, pendingFoundReports, lostItemLeads })
    );
    return true;
  } catch (e) {
    console.warn("Unable to save local data", e);
    return false;
  }
}

function isDataImageUrl(s) {
  return typeof s === "string" && s.startsWith("data:image");
}

/** Frees localStorage by removing embedded base64 photos (keeps Cloudinary https URLs). */
function stripInlineImagesFromAppState() {
  for (const item of itemsData) {
    if (isDataImageUrl(item?.image)) item.image = null;
  }
  for (const r of lostReports) {
    if (isDataImageUrl(r?.image)) r.image = null;
  }
  for (const r of pendingFoundReports) {
    if (isDataImageUrl(r?.image)) r.image = null;
  }
  for (const c of allClaims) {
    if (isDataImageUrl(c?.proofImage)) {
      c.proofImage = null;
      c.proofImageMissing = true;
    }
    if (isDataImageUrl(c?.itemImage)) c.itemImage = null;
  }
  for (const email of Object.keys(myClaimsByEmail)) {
    const arr = myClaimsByEmail[email];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      if (isDataImageUrl(c?.proofImage)) {
        c.proofImage = null;
        c.proofImageMissing = true;
      }
      if (isDataImageUrl(c?.itemImage)) c.itemImage = null;
    }
  }
  for (const l of lostItemLeads) {
    if (isDataImageUrl(l?.proofImage)) {
      l.proofImage = null;
      l.proofImageMissing = true;
    }
  }
}

function removeClaimFromStoresById(claimId) {
  const id = Number(claimId);
  const c = allClaims.find((x) => Number(x.id) === id);
  if (!c) return;
  allClaims = allClaims.filter((x) => Number(x.id) !== id);
  const email = c.claimantEmail;
  if (email && Array.isArray(myClaimsByEmail[email])) {
    myClaimsByEmail[email] = myClaimsByEmail[email].filter((x) => Number(x.id) !== id);
  }
  syncMyClaims();
}

function loadFromLocalStorage() {
  const p = loadPersisted();
  if (p) {
    itemsData = Array.isArray(p.itemsData) && p.itemsData.length ? p.itemsData : [];
    allClaims = Array.isArray(p.allClaims) ? p.allClaims : [];
    myClaimsByEmail = p.myClaimsByEmail && typeof p.myClaimsByEmail === "object" ? p.myClaimsByEmail : {};
    studentProfiles = p.studentProfiles && typeof p.studentProfiles === "object" ? p.studentProfiles : {};
    lostReports = Array.isArray(p.lostReports) ? p.lostReports : [];
    pendingFoundReports = Array.isArray(p.pendingFoundReports) ? p.pendingFoundReports : [];
    lostItemLeads = Array.isArray(p.lostItemLeads) ? p.lostItemLeads : [];
  } else {
    itemsData = [];
    allClaims = [];
    myClaimsByEmail = {};
    studentProfiles = {};
    lostReports = [];
    pendingFoundReports = [];
    lostItemLeads = [];
  }
}

async function bootstrapData() {
  if (USE_FIRESTORE) {
    try {
      const firestore = getFirestore();
      const [foundSnap, claimsSnap, lostSnap, pendingSnap, leadsSnap, profilesSnap] = await Promise.all([
        firestore.collection('foundItems').get(),
        firestore.collection('claims').get(),
        firestore.collection('lostReports').get(),
        firestore.collection('pendingFoundReports').get(),
        firestore.collection('lostItemLeads').get(),
        firestore.collection('studentProfiles').get()
      ]);

      itemsData = foundSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      allClaims = claimsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      myClaimsByEmail = {};
      for (const claim of allClaims) {
        if (claim.claimantEmail) {
          if (!myClaimsByEmail[claim.claimantEmail]) myClaimsByEmail[claim.claimantEmail] = [];
          myClaimsByEmail[claim.claimantEmail].push(claim);
        }
      }

      studentProfiles = {};
      profilesSnap.docs.forEach(doc => { studentProfiles[doc.id] = doc.data(); });

      lostReports = lostSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      pendingFoundReports = pendingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      lostItemLeads = leadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      setupFirestoreListeners();
    } catch (error) {
      console.error("Firestore load failed, falling back to localStorage:", error);
      loadFromLocalStorage();
    }
  } else {
    loadFromLocalStorage();
  }

  // Remove old placeholder/seed items
  itemsData = itemsData.filter((x) => !PLACEHOLDER_ITEM_NAMES.has(String(x?.name || "").trim()));
  lostReports = lostReports.map((r) => ({
    ...r,
    status: normalizeReviewStatus(r.status, "Pending Review")
  }));
  pendingFoundReports = pendingFoundReports.map((r) => ({
    ...r,
    status: normalizeReviewStatus(r.status, "Pending Review")
  }));

  if (!USE_FIRESTORE) savePersisted();
}

function setupFirestoreListeners() {
  // Clean up existing listeners
  firestoreListeners.forEach(unsubscribe => unsubscribe());
  firestoreListeners = [];

  const firestore = getFirestore();

  // Listen to foundItems changes
  const unsub1 = firestore.collection('foundItems').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() };
      if (change.type === 'added' || change.type === 'modified') {
        const idx = itemsData.findIndex(i => String(i.id) === String(data.id));
        if (idx >= 0) { itemsData[idx] = data; } else { itemsData.push(data); }
      } else if (change.type === 'removed') {
        itemsData = itemsData.filter(i => String(i.id) !== String(data.id));
      }
    });
    updateStudentStats();
    updateAdminStats();
    renderItems();
    renderDashboardMixed();
    renderAdminItems();
  });
  firestoreListeners.push(unsub1);

  // Listen to claims changes
  const unsub2 = firestore.collection('claims').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() };
      if (change.type === 'added' || change.type === 'modified') {
        const idx = allClaims.findIndex(c => String(c.id) === String(data.id));
        if (idx >= 0) { allClaims[idx] = data; } else { allClaims.push(data); }
      } else if (change.type === 'removed') {
        allClaims = allClaims.filter(c => String(c.id) !== String(data.id));
      }
    });
    myClaimsByEmail = {};
    for (const claim of allClaims) {
      if (claim.claimantEmail) {
        if (!myClaimsByEmail[claim.claimantEmail]) myClaimsByEmail[claim.claimantEmail] = [];
        myClaimsByEmail[claim.claimantEmail].push(claim);
      }
    }
    syncMyClaims();
    renderMyClaims();
    renderAdminClaims();
    updateAdminStats();
  });
  firestoreListeners.push(unsub2);

  // Listen to lostReports changes
  const unsub3 = firestore.collection('lostReports').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() };
      if (change.type === 'added' || change.type === 'modified') {
        const idx = lostReports.findIndex(r => String(r.id) === String(data.id));
        if (idx >= 0) { lostReports[idx] = data; } else { lostReports.push(data); }
      } else if (change.type === 'removed') {
        lostReports = lostReports.filter(r => String(r.id) !== String(data.id));
      }
    });
    renderLostReportsList();
    renderLostMatches();
    renderPublicLostItems();
    renderAdminReports();
    updateAdminStats();
  });
  firestoreListeners.push(unsub3);

  // Listen to pendingFoundReports changes
  const unsub4 = firestore.collection('pendingFoundReports').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() };
      if (change.type === 'added' || change.type === 'modified') {
        const idx = pendingFoundReports.findIndex(r => String(r.id) === String(data.id));
        if (idx >= 0) { pendingFoundReports[idx] = data; } else { pendingFoundReports.push(data); }
      } else if (change.type === 'removed') {
        pendingFoundReports = pendingFoundReports.filter(r => String(r.id) !== String(data.id));
      }
    });
    renderAdminReports();
    updateAdminStats();
  });
  firestoreListeners.push(unsub4);

  // Listen to lostItemLeads changes
  const unsub5 = firestore.collection('lostItemLeads').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = { id: change.doc.id, ...change.doc.data() };
      if (change.type === 'added' || change.type === 'modified') {
        const idx = lostItemLeads.findIndex(l => String(l.id) === String(data.id));
        if (idx >= 0) { lostItemLeads[idx] = data; } else { lostItemLeads.push(data); }
      } else if (change.type === 'removed') {
        lostItemLeads = lostItemLeads.filter(l => String(l.id) !== String(data.id));
      }
    });
    renderMyFoundLeads();
    renderLostReportsList();
  });
  firestoreListeners.push(unsub5);

  // Listen to studentProfiles changes
  const unsub6 = firestore.collection('studentProfiles').onSnapshot((snapshot) => {
    studentProfiles = {};
    snapshot.docs.forEach(doc => { studentProfiles[doc.id] = doc.data(); });
    buildStudentProfileForm();
  });
  firestoreListeners.push(unsub6);
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

async function uploadImageToCloudinary(file, _folder, opts = {}) {
  let dataUrl = null;
  try {
    dataUrl = await readFileAsDataURL(file, opts);
  } catch {
    return { src: null, remote: false, error: "Could not read image file." };
  }
  try {
    const cloud = String(CLOUDINARY_CLOUD_NAME || "").trim();
    const presets = Array.isArray(CLOUDINARY_UPLOAD_PRESETS)
      ? CLOUDINARY_UPLOAD_PRESETS.map((p) => String(p).trim()).filter(Boolean)
      : [];
    if (!cloud || !presets.length) {
      throw new Error("Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESETS in js/app.js");
    }
    // Opening HTML as file:// often blocks fetch() to Cloudinary — use Live Server / http://localhost
    if (window.location.protocol === "file:") {
      throw new Error(
        "Use a local web server (e.g. VS Code Live Server) so the address is http://localhost — not file://"
      );
    }
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloud}/image/upload`;
    let lastErr = "Unknown error";
    for (const preset of presets) {
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", preset);
      const resp = await fetch(uploadUrl, { method: "POST", body: form });
      const payload = await resp.json().catch(() => ({}));
      if (resp.ok) {
        const url = payload.secure_url || payload.url;
        if (url) return { src: url, remote: true, error: null };
        lastErr = "No URL in response";
        continue;
      }
      lastErr =
        payload.error?.message ||
        (typeof payload.error === "string" ? payload.error : null) ||
        `HTTP ${resp.status}`;
    }
    throw new Error(lastErr);
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn("Cloudinary upload failed. Using local data URL.", e);
    return { src: dataUrl, remote: false, error: msg };
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

function fmtDate(d) {
  const t = Date.parse(d);
  if (isNaN(t)) return String(d || "—");
  return new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function emojiFor(cat) {
  return { Electronics: "📱", Accessories: "⌚", Clothing: "🧥", Documents: "🪪", Bags: "🎒", Others: "📦", Wallet: "👛", Keys: "🔑" }[cat] || "📦";
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
  return overlaps >= 1;
}

function getCurrentUserLostReports() {
  if (!currentUser?.email) return [];
  return lostReports.filter((r) => r.reporterEmail === currentUser.email && r.status !== "Rejected");
}

function isItemMatchedForCurrentUser(item) {
  const mine = getCurrentUserLostReports();
  return mine.some((r) => itemMatchesLostReport(item, r));
}

function initFirebaseIfNeeded() {
  if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK not loaded.");
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    // Enable offline persistence
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      if (err.code == 'failed-precondition') {
        console.warn('Offline persistence can only be enabled in one tab at a time.');
      } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support offline persistence.');
      }
    });
  } else if (!db) {
    db = firebase.firestore();
  }
}

function getFirestore() {
  if (!db) initFirebaseIfNeeded();
  return db;
}

// ==================== FIRESTORE HELPER FUNCTIONS ====================
const USE_FIRESTORE = true; // Set to false to fallback to localStorage

// Generic Firestore operations
async function fsAdd(collection, data, customId = null) {
  const firestore = getFirestore();
  if (customId) {
    await firestore.collection(collection).doc(String(customId)).set(data);
    return customId;
  } else {
    const docRef = await firestore.collection(collection).add(data);
    return docRef.id;
  }
}

async function fsUpdate(collection, docId, data) {
  const firestore = getFirestore();
  await firestore.collection(collection).doc(String(docId)).update(data);
}

async function fsDelete(collection, docId) {
  const firestore = getFirestore();
  await firestore.collection(collection).doc(String(docId)).delete();
}

async function fsGetAll(collection) {
  const firestore = getFirestore();
  const snapshot = await firestore.collection(collection).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Real-time listener setup
function fsListen(collection, callback) {
  const firestore = getFirestore();
  return firestore.collection(collection).onSnapshot((snapshot) => {
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(data, snapshot);
  });
}

// ==================== END FIRESTORE HELPERS ====================

// Migration function to move localStorage data to Firestore
async function migrateLocalStorageToFirestore() {
  if (!USE_FIRESTORE) {
    showToast("Firestore is not enabled.", "warning");
    return;
  }
  const p = loadPersisted();
  if (!p) {
    showToast("No localStorage data to migrate.", "info");
    return;
  }
  try {
    showToast("Migrating data to Firestore...", "info");
    const firestore = getFirestore();
    // Migrate foundItems
    if (Array.isArray(p.itemsData)) {
      for (const item of p.itemsData) {
        if (item.id) {
          await firestore.collection('foundItems').doc(String(item.id)).set(item);
        }
      }
    }
    // Migrate claims
    if (Array.isArray(p.allClaims)) {
      for (const claim of p.allClaims) {
        if (claim.id) {
          await firestore.collection('claims').doc(String(claim.id)).set(claim);
        }
      }
    }
    // Migrate lostReports
    if (Array.isArray(p.lostReports)) {
      for (const report of p.lostReports) {
        if (report.id) {
          await firestore.collection('lostReports').doc(String(report.id)).set(report);
        }
      }
    }
    // Migrate pendingFoundReports
    if (Array.isArray(p.pendingFoundReports)) {
      for (const report of p.pendingFoundReports) {
        if (report.id) {
          await firestore.collection('pendingFoundReports').doc(String(report.id)).set(report);
        }
      }
    }
    // Migrate lostItemLeads
    if (Array.isArray(p.lostItemLeads)) {
      for (const lead of p.lostItemLeads) {
        if (lead.id) {
          await firestore.collection('lostItemLeads').doc(String(lead.id)).set(lead);
        }
      }
    }
    // Migrate studentProfiles
    if (p.studentProfiles && typeof p.studentProfiles === 'object') {
      for (const [email, profile] of Object.entries(p.studentProfiles)) {
        await firestore.collection('studentProfiles').doc(email).set(profile);
      }
    }
    showToast("Migration complete! Data is now in Firestore.", "success");
    // Reload data
    await bootstrapData();
    // Refresh UI
    if (currentUser?.role === 'admin') {
      launchAdminApp();
    } else {
      launchStudentApp();
    }
  } catch (error) {
    console.error("Migration failed:", error);
    showToast("Migration failed. Check console for details.", "danger");
  }
}

async function doLogin() {
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const pass = document.getElementById("loginPass").value;
  const errEl = document.getElementById("loginErr");
  try {
    initFirebaseIfNeeded();
    const cred = await firebase.auth().signInWithEmailAndPassword(email, pass);
    const u = cred.user;
    const role = ADMIN_EMAILS.includes(email) || email.startsWith("admin") ? "admin" : "student";
    currentUser = {
      email,
      role,
      name: (u && u.displayName) || email.split("@")[0].toUpperCase(),
      dept: role === "admin" ? "Administration" : "Student"
    };
    errEl.style.display = "none";
    document.getElementById("loginPage").style.display = "none";
    syncMyClaims();
    if (role === "admin") launchAdminApp();
    else launchStudentApp();
    return;
  } catch (firebaseErr) {
    // Fallback to local demo accounts for development convenience.
    const account = ACCOUNTS.find((a) => a.email === email && a.password === pass);
    if (!account) {
      errEl.style.display = "block";
      errEl.textContent = "Invalid credentials. Please try again.";
      return;
    }
    errEl.style.display = "none";
    currentUser = account;
    document.getElementById("loginPage").style.display = "none";
    syncMyClaims();
    if (account.role === "admin") launchAdminApp();
    else launchStudentApp();
  }
}

function launchStudentApp() {
  // Always refresh from persisted storage so newly approved
  // reports/items are visible to any user who logs in next.
  bootstrapData();
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
  initSidebarToggle();
}

function launchAdminApp() {
  bootstrapData();
  document.getElementById("adminApp").style.display = "block";
  startDateTime("adminTopbarDate");
  updateAdminStats();
  renderAdminOverviewLists();
  renderAdminItems();
  renderAdminClaims();
  renderAdminReports();
  buildReportForm("adminAddItemForm", true);
  initSidebarToggle();
}

function doLogout() {
  if (currentUser?.email) myClaimsByEmail[currentUser.email] = [...myClaims];
  savePersisted();
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
    el.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  update();
  setInterval(update, 1000);
}

function studentNav(page, el) {
  document.querySelectorAll("#studentSidebar .sb-item").forEach((i) => i.classList.remove("active"));
  if (el) el.classList.add("active");
  document.querySelectorAll("#mainApp .page-section").forEach((s) => s.classList.remove("active"));
  const sec = document.getElementById("s-" + page);
  if (sec) sec.classList.add("active");
  if (page === "dashboard") {
    updateStudentStats();
    renderDashboardMixed();
  }
  if (page === "profile") buildStudentProfileForm();
  if (page === "foundItems") renderItems();
  if (page === "lostItems") {
    renderPublicLostItems();
    renderMyFoundLeads();
  }
  if (page === "myClaims") renderMyClaims();
  if (page === "report") buildReportForm("reportPageForm", false);
  if (page === "reportLost") {
    buildLostReportForm();
    renderLostReportsList();
    renderLostMatches();
    renderMyFoundLeads();
  }
}

function adminNav(page, el) {
  document.querySelectorAll("#adminSidebar .sb-item").forEach((i) => i.classList.remove("active"));
  if (el) el.classList.add("active");
  document.querySelectorAll("#adminApp .page-section").forEach((s) => s.classList.remove("active"));
  const sec = document.getElementById("a-" + page);
  if (sec) sec.classList.add("active");
  if (page === "overview") {
    updateAdminStats();
    renderAdminOverviewLists();
  }
  if (page === "manageItems") renderAdminItems();
  if (page === "manageClaims") renderAdminClaims();
  if (page === "manageReports") renderAdminReports();
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

function buildStudentProfileForm() {
  const wrap = document.getElementById("studentProfileFormWrap");
  if (!wrap || !currentUser) return;
  const p = getCurrentProfile();
  wrap.innerHTML = `
    <label class="f-label">Full Name *</label>
    <input class="f-input" id="pf_fullName" value="${htmlEsc(p.fullName)}" placeholder="e.g. Juan Dela Cruz"/>
    <label class="f-label">Student ID *</label>
    <input class="f-input" id="pf_studentId" value="${htmlEsc(p.studentId)}" placeholder="e.g. 2023-BSIT-001"/>
    <label class="f-label">Course / Year *</label>
    <input class="f-input" id="pf_courseYear" value="${htmlEsc(p.courseYear)}" placeholder="e.g. BSIT 3rd Year"/>
    <label class="f-label">Contact Number *</label>
    <input class="f-input" id="pf_contactNumber" value="${htmlEsc(p.contactNumber)}" placeholder="e.g. 09XXXXXXXXX"/>
    <div class="f-err" id="pf_err"></div>
    <button type="button" class="btn-submit" onclick="saveStudentProfile()"><i class="bi bi-floppy-fill"></i> Save Profile</button>
  `;
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
  studentProfiles[currentUser.email] = { fullName, studentId, courseYear, contactNumber };
  document.getElementById("sbStudentName").textContent = fullName;
  document.getElementById("sbStudentRole").textContent = courseYear;
  if (USE_FIRESTORE) {
    try {
      await fsUpdate('studentProfiles', currentUser.email, { fullName, studentId, courseYear, contactNumber });
    } catch (e) {
      console.error("Firestore save failed:", e);
    }
  } else {
    savePersisted();
  }
  showToast("Student profile saved.", "success");
}

function buildCard(item) {
  const thumbContent = item.image ? `<img src="${item.image}" alt="${htmlEsc(item.name)}"/>` : `<span style="font-size:65px;">${item.emoji}</span>`;
  const matchHint = isItemMatchedForCurrentUser(item)
    ? `<div class="item-card-match"><i class="bi bi-stars"></i> Possible match to your lost report</div>`
    : "";
  return `
    <div class="col-6 col-md-4 col-lg-3" onclick="openItemModal(${item.id})">
      <div class="item-card">
        <div class="item-card-thumb">
          ${thumbContent}
          <div class="status-ribbon">${statusBadge(item.status)}</div>
        </div>
        <div class="item-card-body">
          <div class="item-card-name">${item.name}</div>
          <div class="item-card-loc"><i class="bi bi-geo-alt-fill"></i> ${item.location}</div>
          <div class="item-card-date"><i class="bi bi-calendar3"></i> Found: ${fmtDate(item.date)}</div>
          <div class="item-card-cat"><i class="bi bi-tag"></i> ${item.category}</div>
          ${matchHint}
        </div>
      </div>
    </div>`;
}

function renderDashboardMixed() {
  const out = document.getElementById("dashboardMixedGrid");
  if (!out) return;
  const foundRows = itemsData.map((x) => ({
    type: "Found",
    date: x.date,
    id: x.id,
    title: x.name,
    subtitle: `${x.category} • ${x.location}`,
    image: x.image,
    emoji: x.emoji,
    open: `openItemModal(${x.id})`
  }));
  const lostRows = lostReports
    .filter((x) => x.status === "Approved")
    .map((x) => ({
      type: "Lost",
      date: x.dateLost,
      id: x.id,
      title: x.name,
      subtitle: `${x.category} • ${x.location}`,
      image: x.image,
      emoji: "🔍",
      open: `openFoundYourItemModal(${x.id})`
    }));
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
    <div class="col-6 col-md-4 col-lg-3" onclick="${r.open}">
      <div class="item-card">
        <div class="item-card-thumb">
          ${r.image ? `<img src="${r.image}" alt="${htmlEsc(r.title)}"/>` : `<span style="font-size:65px;">${r.emoji}</span>`}
          <div class="status-ribbon"><span class="s-badge ${r.type === "Found" ? "claimed" : "pending"}">${r.type}</span></div>
        </div>
        <div class="item-card-body">
          <div class="item-card-name">${htmlEsc(r.title)}</div>
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
        return `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="item-card">
          <div class="item-card-thumb">
            ${r.image ? `<img src="${r.image}" alt="${htmlEsc(r.name)}"/>` : `<span style="font-size:65px;">🔍</span>`}
            <div class="status-ribbon"><span class="s-badge pending">Lost</span></div>
          </div>
          <div class="item-card-body">
            <div class="item-card-name">${htmlEsc(r.name)}</div>
            <div class="item-card-loc"><i class="bi bi-tag"></i> ${htmlEsc(r.category)} • ${htmlEsc(r.location)}</div>
            <div class="item-card-date"><i class="bi bi-calendar3"></i> Lost: ${fmtDate(r.dateLost)}</div>
            <div class="item-card-desc">${htmlEsc(r.description)}</div>
            <div class="lost-card-action mt-2">
              ${
                own
                  ? `<span class="s-badge claimed">Your report</span>`
                  : `<button type="button" class="btn-gc success" onclick="event.stopPropagation();openFoundYourItemModal(${r.id})"><i class="bi bi-patch-check"></i> Found your item</button>`
              }
            </div>
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
    const nm = String(item?.name || "").toLowerCase();
    const loc = String(item?.location || "").toLowerCase();
    const desc = String(item?.description || "").toLowerCase();
    const ms = nm.includes(q) || loc.includes(q) || desc.includes(q);
    return ms && (!st || item.status === st) && (!cat || item.category === cat);
  });
  const grid = document.getElementById("itemsGrid");
  if (!grid) return;
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
  let claimBtn = "";
  if (item.status === "Claimed") {
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
  const upload = await uploadImageToCloudinary(photo.files[0], "claims", { maxSide: 800, quality: 0.5 });
  const proofImage = upload.src;
  const proofStoredRemotely = upload.remote;
  if (!proofImage) {
    errEl.style.display = "block";
    errEl.textContent = upload.error || "Could not read photo file.";
    return;
  }
  if (!upload.remote) {
    showToast(
      `Photo did not upload to Cloudinary (${upload.error || "check preset"}). Saved as base64 in browser only. Use http://localhost (not file://) and verify unsigned preset name in Cloudinary.`,
      "warning"
    );
  }
  const item = findItemById(id);
  const claimEntry = {
    id: Date.now(),
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
    proofImageMissing: false,
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
  if (USE_FIRESTORE) {
    const { id, ...claimData } = claimEntry;
    const docId = await fsAdd('claims', claimData);
    claimEntry.id = docId;
    const idx1 = myClaims.findIndex(c => String(c.id) === String(id));
    if (idx1 >= 0) myClaims[idx1].id = docId;
    const idx2 = allClaims.findIndex(c => String(c.id) === String(id));
    if (idx2 >= 0) allClaims[idx2].id = docId;
    const idx3 = (myClaimsByEmail[currentUser.email] || []).findIndex(c => String(c.id) === String(id));
    if (idx3 >= 0) myClaimsByEmail[currentUser.email][idx3].id = docId;
  } else {
    let persisted = savePersisted();
    if (!persisted && !proofStoredRemotely && claimEntry.proofImage) {
      claimEntry.proofImage = null;
      claimEntry.proofImageMissing = true;
      persisted = savePersisted();
      if (persisted) showToast("Claim saved without proof photo (browser storage full).", "warning");
    }
    if (!persisted) {
      stripInlineImagesFromAppState();
      persisted = savePersisted();
      if (persisted) {
        showToast("Saved after removing old embedded photos from browser storage.", "warning");
      }
    }
    if (!persisted) {
      while (allClaims.length > 1) {
        if (savePersisted()) {
          persisted = true;
          break;
        }
        const victim = allClaims.find((c) => Number(c.id) !== Number(claimEntry.id));
        if (!victim) break;
        removeClaimFromStoresById(victim.id);
      }
      if (!persisted) persisted = savePersisted();
      if (persisted) {
        showToast("Saved after removing older claims to free browser space.", "warning");
      }
    }
    if (!persisted) {
      removeClaimFromStoresById(claimEntry.id);
      if (item && item.status === "Pending") item.status = "Unclaimed";
      errEl.style.display = "block";
      errEl.textContent =
        "Browser storage is full. Clear site data for this site or use Live Server (http://localhost) so proof photos upload to Cloudinary instead of huge local copies.";
      return;
    }
  }
  updateStudentStats();
  updateAdminStats();
  renderItems();
  renderRecentGrid();
  renderAdminItems();
  renderAdminClaims();
  closeModal("itemModal");
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
          <option>Electronics</option><option>Accessories</option><option>Clothing</option><option>Documents</option><option>Bags</option><option>Others</option>
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
  const photo = document.getElementById(`${cid}_photo`);
  if (!errEl || !photo) {
    showToast("Form not found. Refresh the page and try again.", "danger");
    console.error("submitFoundItem missing DOM", cid);
    return;
  }
  try {
  const name = get("name");
  const cat = get("cat");
  const loc = get("loc");
  const date = get("date");
  const desc = get("desc");
  const idents = get("idents");
  const finder = get("finder");
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
  const uploadFound = await uploadImageToCloudinary(photo.files[0], "found-reports", { maxSide: 800, quality: 0.5 });
  const imageData = uploadFound.src;
  const imageStoredRemotely = uploadFound.remote;
  if (!imageData) {
    errEl.style.display = "block";
    errEl.textContent = uploadFound.error || "Could not read image file.";
    return;
  }
  if (!uploadFound.remote) {
    showToast(
      `Image not on Cloudinary: ${uploadFound.error || "check preset"}. Use http://localhost (not file://) and an unsigned preset in Cloudinary.`,
      "warning"
    );
  }
  errEl.style.display = "none";
  const reportPayload = {
    id: Date.now(),
    name,
    category: cat,
    location: loc,
    date,
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
    submittedAt: new Date().toLocaleString(),
    status: isAdmin ? "Unclaimed" : "Pending Review"
  };
  if (isAdmin) {
    itemsData.unshift(reportPayload);
  } else {
    pendingFoundReports.unshift(reportPayload);
  }
  if (USE_FIRESTORE) {
    const { id, ...payloadData } = reportPayload;
    const collection = isAdmin ? 'foundItems' : 'pendingFoundReports';
    const docId = await fsAdd(collection, payloadData);
    reportPayload.id = docId;
    if (isAdmin) {
      const idx = itemsData.findIndex(i => String(i.id) === String(id));
      if (idx >= 0) itemsData[idx].id = docId;
    } else {
      const idx = pendingFoundReports.findIndex(r => String(r.id) === String(id));
      if (idx >= 0) pendingFoundReports[idx].id = docId;
    }
  } else {
    let persisted = savePersisted();
    if (!persisted && !isAdmin && !imageStoredRemotely && pendingFoundReports[0]) {
      pendingFoundReports[0].image = null;
      persisted = savePersisted();
      if (persisted) showToast("Report saved without image due to storage limit.", "warning");
    }
    if (!persisted) {
      stripInlineImagesFromAppState();
      persisted = savePersisted();
      if (persisted) showToast("Saved after freeing old embedded images from browser storage.", "warning");
    }
    if (!persisted && !isAdmin) {
      while (pendingFoundReports.length > 1) {
        if (savePersisted()) {
          persisted = true;
          break;
        }
        pendingFoundReports.pop();
      }
      if (!persisted) persisted = savePersisted();
      if (persisted) showToast("Saved after removing older pending found reports.", "warning");
    }
    if (!persisted && isAdmin) {
      while (itemsData.length > 1) {
        if (savePersisted()) {
          persisted = true;
          break;
        }
        itemsData.pop();
      }
      if (!persisted) persisted = savePersisted();
      if (persisted) showToast("Saved after removing older items to free space.", "warning");
    }
    if (!persisted) {
      if (!isAdmin && pendingFoundReports.length) pendingFoundReports.shift();
      if (isAdmin && itemsData.length) itemsData.shift();
      errEl.style.display = "block";
      errEl.textContent =
        "Could not save report. Clear site data or ensure photos upload to Cloudinary (http://localhost).";
      return;
    }
  }
  if (isAdmin) {
    updateAdminStats();
    renderAdminItems();
    renderAdminOverviewLists();
    renderAdminReports();
    showToast("Item reported and added to the system successfully!", "success");
  } else {
    updateStudentStats();
    renderItems();
    renderRecentGrid();
    renderAdminReports();
    showToast("Found-item report submitted. Waiting for admin approval.", "success");
  }
  closeModal("reportModal");
  buildReportForm(cid, isAdmin);
  if (!isAdmin) {
    const sb = document.querySelector('#studentSidebar .sb-item[data-page="foundItems"]');
    if (sb) studentNav("foundItems", sb);
  }
  } catch (e) {
    console.error(e);
    showToast(e?.message || "Submit failed — see console (F12).", "danger");
    const el = document.getElementById(`${cid}_err`);
    if (el) {
      el.style.display = "block";
      el.textContent = e?.message || "Something went wrong. Press F12 → Console for details.";
    }
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
          <option>Electronics</option><option>Accessories</option><option>Clothing</option><option>Documents</option><option>Bags</option><option>Others</option>
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
  if (!err || !photo) {
    showToast("Form not found. Refresh the page and try again.", "danger");
    console.error("submitLostReport missing DOM");
    return;
  }
  if (!currentUser?.email) {
    err.style.display = "block";
    err.textContent = "You must be logged in to submit a lost report.";
    return;
  }
  try {
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
  const uploadLost = await uploadImageToCloudinary(photo.files[0], "lost-reports", { maxSide: 800, quality: 0.5 });
  const imageData = uploadLost.src;
  const imageStoredRemotely = uploadLost.remote;
  if (!imageData) {
    err.style.display = "block";
    err.textContent = uploadLost.error || "Could not read image file.";
    return;
  }
  if (!uploadLost.remote) {
    showToast(
      `Image not on Cloudinary: ${uploadLost.error || "check preset"}. Use http://localhost (not file://) and an unsigned preset in Cloudinary.`,
      "warning"
    );
  }
  err.style.display = "none";
  const entry = {
    id: Date.now(),
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
  if (USE_FIRESTORE) {
    const { id, ...reportData } = entry;
    const docId = await fsAdd('lostReports', reportData);
    entry.id = docId;
    const idx = lostReports.findIndex(r => String(r.id) === String(id));
    if (idx >= 0) lostReports[idx].id = docId;
  } else {
    let persisted = savePersisted();
    if (!persisted && !imageStoredRemotely && lostReports[0]) {
      lostReports[0].image = null;
      persisted = savePersisted();
      if (persisted) showToast("Lost report saved without image due to storage limit.", "warning");
    }
    if (!persisted) {
      stripInlineImagesFromAppState();
      persisted = savePersisted();
      if (persisted) showToast("Saved after freeing old embedded images from browser storage.", "warning");
    }
    if (!persisted) {
      while (lostReports.length > 1) {
        if (savePersisted()) {
          persisted = true;
          break;
        }
        lostReports.pop();
      }
      if (!persisted) persisted = savePersisted();
      if (persisted) showToast("Saved after removing older lost reports.", "warning");
    }
    if (!persisted) {
      if (lostReports.length) lostReports.shift();
      err.style.display = "block";
      err.textContent =
        "Could not save report. Clear site data or ensure photos upload to Cloudinary (http://localhost).";
      return;
    }
  }
  buildLostReportForm();
  renderLostReportsList();
  renderLostMatches();
  renderAdminReports();
  showToast("Lost item report submitted. Waiting for admin approval.", "info");
  } catch (e) {
    console.error(e);
    showToast(e?.message || "Submit failed — see console (F12).", "danger");
    const el = document.getElementById("lost_err");
    if (el) {
      el.style.display = "block";
      el.textContent = e?.message || "Something went wrong. Press F12 → Console for details.";
    }
  }
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
      const st = r.status === "Approved" ? "claimed" : r.status === "Rejected" ? "rejected" : "pending";
      return `
      <div class="claim-row">
        <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : "📄"}</div>
        <div class="claim-info">
          <div class="claim-info-name">${htmlEsc(r.name)}</div>
          <div class="claim-info-sub">${htmlEsc(r.category)} • ${htmlEsc(r.location)}</div>
          <div class="claim-info-sub">Lost: ${fmtDate(r.dateLost)} • Submitted: ${r.submittedAt}</div>
          <div class="claim-info-sub mt-1">${htmlEsc(r.description)}</div>
          ${r.adminNote ? `<div class="claim-info-sub mt-1"><strong>Admin note:</strong> ${htmlEsc(r.adminNote)}</div>` : ""}
        </div>
        <div class="text-end"><span class="s-badge ${st}">${r.status === "Pending Review" ? "Pending" : r.status}</span></div>
      </div>`;
    })
    .join("");
}

function renderLostMatches() {
  const box = document.getElementById("lostMatchesList");
  if (!box) return;
  const mine = getCurrentUserLostReports().filter((r) => r.status !== "Rejected");
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

function renderMyFoundLeads() {
  const wraps = [document.getElementById("myFoundLeadsList"), document.getElementById("myFoundLeadsListReport")].filter(Boolean);
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
      const canChat = l.status === "Accepted";
      const who = l.finderEmail === currentUser.email ? "You responded to this report" : "Someone responded to your report";
      const st = l.status === "Accepted" ? "claimed" : l.status === "Rejected" ? "rejected" : "pending";
      const msgs = (l.messages || [])
        .map(
          (m) =>
            `<div style="font-size:0.8rem;margin-bottom:6px;"><strong>${m.from === currentUser.email ? "You" : "Other"}:</strong> ${htmlEsc(m.text)} <span style="color:#aaa;">(${m.at})</span></div>`
        )
        .join("");
      return `
      <div class="claim-row" style="display:block;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div class="claim-info-name">${htmlEsc(l.itemName)} <span class="s-badge ${st}">${l.status}</span></div>
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
        <div style="margin-top:10px;">${msgs || '<div class="claim-info-sub">No messages yet.</div>'}</div>
        ${
          canChat
            ? `<div class="d-flex gap-2 mt-2">
                <input class="f-input" style="margin-bottom:0;" id="lead_msg_${l.id}" placeholder="Type message..."/>
                <button type="button" class="btn-gc" onclick="sendLeadMessage(${l.id})"><i class="bi bi-send"></i> Send</button>
              </div>`
            : '<div class="claim-info-sub mt-2"><em>Chat unlocks after reporter accepts.</em></div>'
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
    showToast("Lost report not available.", "danger");
    return;
  }
  if (report.reporterEmail === currentUser?.email) {
    showToast("You cannot respond to your own report.", "warn");
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
  const uploadLead = await uploadImageToCloudinary(photo.files[0], "lead-proofs", { maxSide: 800, quality: 0.5 });
  const proofImage = uploadLead.src;
  const proofStoredRemotely = uploadLead.remote;
  if (!proofImage) {
    err.style.display = "block";
    err.textContent = uploadLead.error || "Could not read image file.";
    return;
  }
  if (!uploadLead.remote) {
    showToast(
      `Photo not on Cloudinary: ${uploadLead.error || "check preset"}. Use http://localhost (not file://) and an unsigned preset in Cloudinary.`,
      "warning"
    );
  }
  err.style.display = "none";
  const report = lostReports.find((r) => Number(r.id) === Number(lostReportId));
  if (!report) return;
  const newLead = {
    id: Date.now(),
    lostReportId: report.id,
    itemName: report.name,
    reporterEmail: report.reporterEmail,
    finderEmail: currentUser.email,
    finderName: name,
    finderContact: contact,
    proofDesc: proof,
    proofImage,
    proofStoredRemotely,
    proofImageMissing: false,
    status: "Pending Reporter Review",
    messages: [],
    submittedAt: new Date().toLocaleString(),
    rejectedReason: ""
  };
  lostItemLeads.unshift(newLead);
  if (USE_FIRESTORE) {
    const { id, ...leadData } = newLead;
    const docId = await fsAdd('lostItemLeads', leadData);
    newLead.id = docId;
    const idx = lostItemLeads.findIndex(l => String(l.id) === String(id));
    if (idx >= 0) lostItemLeads[idx].id = docId;
  } else {
    let persisted = savePersisted();
    if (!persisted && !proofStoredRemotely && newLead.proofImage) {
      newLead.proofImage = null;
      newLead.proofImageMissing = true;
      persisted = savePersisted();
      if (persisted) showToast("Response saved without photo (browser storage full).", "warning");
    }
    if (!persisted) {
      stripInlineImagesFromAppState();
      persisted = savePersisted();
      if (persisted) {
        showToast("Saved after removing old embedded photos from browser storage.", "warning");
      }
    }
    if (!persisted) {
      while (lostItemLeads.length > 1) {
        if (savePersisted()) {
          persisted = true;
          break;
        }
        lostItemLeads.pop();
      }
      if (!persisted) persisted = savePersisted();
      if (persisted) {
        showToast("Saved after removing oldest responses to free space.", "warning");
      }
    }
    if (!persisted) {
      lostItemLeads.shift();
      err.style.display = "block";
      err.textContent =
        "Browser storage is full. Export or clear site data for this site, then try again. Fix Cloudinary uploads (http://localhost + unsigned preset) so photos are not stored as huge base64.";
      return;
    }
  }
  renderMyFoundLeads();
  renderLostReportsList();
  closeModal("foundYourItemModal");
  showToast("Sent to reporter for review.", "success");
}

async function acceptLostLead(leadId) {
  const lead = lostItemLeads.find((l) => Number(l.id) === Number(leadId));
  if (!lead || lead.reporterEmail !== currentUser?.email) return;
  lead.status = "Accepted";
  lead.messages = lead.messages || [];
  lead.messages.push({ from: currentUser.email, text: "I accepted your response. Let's coordinate item handoff.", at: new Date().toLocaleString() });
  if (USE_FIRESTORE) {
    await fsUpdate('lostItemLeads', leadId, { status: 'Accepted', messages: lead.messages });
  } else {
    savePersisted();
  }
  renderMyFoundLeads();
  showToast("Response accepted. Chat unlocked.", "success");
}

async function rejectLostLead(leadId) {
  const lead = lostItemLeads.find((l) => Number(l.id) === Number(leadId));
  if (!lead || lead.reporterEmail !== currentUser?.email) return;
  lead.status = "Rejected";
  lead.rejectedReason = "Proof did not match.";
  if (USE_FIRESTORE) {
    await fsUpdate('lostItemLeads', leadId, { status: 'Rejected', rejectedReason: 'Proof did not match.' });
  } else {
    savePersisted();
  }
  renderMyFoundLeads();
  showToast("Response rejected.", "danger");
}

async function sendLeadMessage(leadId) {
  const lead = lostItemLeads.find((l) => Number(l.id) === Number(leadId));
  const input = document.getElementById(`lead_msg_${leadId}`);
  if (!lead || !input) return;
  if (lead.status !== "Accepted") return;
  const text = input.value.trim();
  if (!text) return;
  if (lead.finderEmail !== currentUser?.email && lead.reporterEmail !== currentUser?.email) return;
  lead.messages = lead.messages || [];
  lead.messages.push({ from: currentUser.email, text, at: new Date().toLocaleString() });
  input.value = "";
  if (USE_FIRESTORE) {
    await fsUpdate('lostItemLeads', leadId, { messages: lead.messages });
  } else {
    savePersisted();
  }
  renderMyFoundLeads();
}

function renderAdminReports() {
  const foundWrap = document.getElementById("adminFoundReportsList");
  const lostWrap = document.getElementById("adminLostReportsList");

  if (foundWrap) {
    const foundRows = pendingFoundReports
      .map(
        (r) => `
    <div class="claim-row">
      <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : r.emoji || "📦"}</div>
      <div class="claim-info">
        <div class="claim-info-name">${htmlEsc(r.name)} <span class="s-badge pending">Pending</span></div>
        <div class="claim-info-sub">${htmlEsc(r.category)} • ${htmlEsc(r.location)} • ${fmtDate(r.date)}</div>
        <div class="claim-info-sub">By: ${htmlEsc(r.reporterName || r.foundBy)} • ${htmlEsc(r.reporterEmail || "")}</div>
      </div>
      <div class="admin-actions">
        <button type="button" class="btn-sm-action approve" onclick="approveFoundReport(${r.id})"><i class="bi bi-check-lg"></i> Approve</button>
        <button type="button" class="btn-sm-action reject" onclick="rejectFoundReport(${r.id})"><i class="bi bi-x-lg"></i> Reject</button>
      </div>
    </div>`
      )
      .join("");
    foundWrap.innerHTML = foundRows || '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No pending found reports.</p></div>';
  }

  if (lostWrap) {
    const lostRows = lostReports
      .map((r) => {
        const st = r.status === "Approved" ? "claimed" : r.status === "Rejected" ? "rejected" : "pending";
        const actions =
          r.status === "Pending Review"
            ? `<button type="button" class="btn-sm-action approve" onclick="approveLostReport(${r.id})"><i class="bi bi-check-lg"></i> Approve</button>
             <button type="button" class="btn-sm-action reject" onclick="rejectLostReport(${r.id})"><i class="bi bi-x-lg"></i> Reject</button>`
            : "";
        return `
    <div class="claim-row">
      <div class="claim-thumb">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover;"/>` : "📄"}</div>
      <div class="claim-info">
        <div class="claim-info-name">${htmlEsc(r.name)} <span class="s-badge ${st}">${r.status === "Pending Review" ? "Pending" : r.status}</span></div>
        <div class="claim-info-sub">${htmlEsc(r.category)} • ${htmlEsc(r.location)} • Lost: ${fmtDate(r.dateLost)}</div>
        <div class="claim-info-sub">By: ${htmlEsc(r.reporterName)} • ${htmlEsc(r.contact)}</div>
      </div>
      <div class="admin-actions">${actions}</div>
    </div>`;
      })
      .join("");
    lostWrap.innerHTML = lostRows || '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No lost reports.</p></div>';
  }
}

function getPendingReportsCount() {
  const pendingLost = lostReports.filter((r) => r.status === "Pending Review").length;
  const pendingFound = pendingFoundReports.length;
  return pendingLost + pendingFound;
}

async function approveFoundReport(id) {
  const idx = pendingFoundReports.findIndex((r) => Number(r.id) === Number(id));
  if (idx < 0) return;
  const r = pendingFoundReports[idx];
  pendingFoundReports.splice(idx, 1);
  const newItem = { ...r, status: "Unclaimed" };
  delete newItem.reportType;
  itemsData.unshift(newItem);
  if (USE_FIRESTORE) {
    await fsDelete('pendingFoundReports', id);
    const { id: removed, reportType, ...newItemData } = r;
    const docId = await fsAdd('foundItems', newItemData);
    const itemIdx = itemsData.findIndex(i => String(i.id) === String(id));
    if (itemIdx >= 0) itemsData[itemIdx].id = docId;
  } else {
    savePersisted();
  }
  renderAdminReports();
  renderItems();
  renderRecentGrid();
  updateStudentStats();
  updateAdminStats();
  renderAdminItems();
  renderAdminOverviewLists();
  renderLostMatches();
  showToast("Found report approved and published.", "success");
}

async function rejectFoundReport(id) {
  pendingFoundReports = pendingFoundReports.filter((r) => Number(r.id) !== Number(id));
  if (USE_FIRESTORE) {
    await fsDelete('pendingFoundReports', id);
  } else {
    savePersisted();
  }
  renderAdminReports();
  showToast("Found report rejected.", "danger");
}

async function approveLostReport(id) {
  const r = lostReports.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  r.status = "Approved";
  if (USE_FIRESTORE) {
    await fsUpdate('lostReports', id, { status: 'Approved' });
  } else {
    savePersisted();
  }
  renderAdminReports();
  renderLostReportsList();
  renderLostMatches();
  showToast("Lost report approved.", "success");
}

async function rejectLostReport(id) {
  const r = lostReports.find((x) => Number(x.id) === Number(id));
  if (!r) return;
  r.status = "Rejected";
  if (USE_FIRESTORE) {
    await fsUpdate('lostReports', id, { status: 'Rejected' });
  } else {
    savePersisted();
  }
  renderAdminReports();
  renderLostReportsList();
  renderLostMatches();
  showToast("Lost report rejected.", "danger");
}

function openReportModal() {
  buildReportForm("reportModalBody", false);
  openModal("reportModal");
}

function renderAdminOverviewLists() {
  const recentEl = document.getElementById("adminRecentItems");
  const claimsEl = document.getElementById("adminRecentClaims");
  if (!recentEl || !claimsEl) return;
  const recent = [...itemsData].slice(0, 5);
  recentEl.innerHTML = recent.length
    ? recent
        .map(
          (item) => `
    <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f5;">
      <div style="width:40px;height:40px;border-radius:8px;background:#eef2fa;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">
        ${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;"/>` : item.emoji}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.85rem;color:#1a2a4a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</div>
        <div style="font-size:0.76rem;color:#aaa;">${item.location} &bull; ${fmtDate(item.date)}</div>
      </div>
      ${statusBadge(item.status)}
    </div>`
        )
        .join("")
    : '<div class="empty-state" style="padding:20px;"><i class="bi bi-inbox"></i><p>No items yet.</p></div>';

  const recentClaims = [...allClaims].slice(0, 5);
  claimsEl.innerHTML = recentClaims.length
    ? recentClaims
        .map((c) => {
          const st = c.status === "Approved" ? "claimed" : c.status === "Rejected" ? "rejected" : "pending";
          return `
      <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f5;">
        <div style="width:40px;height:40px;border-radius:8px;background:#eef2fa;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${c.itemEmoji}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.85rem;color:#1a2a4a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.itemName}</div>
          <div style="font-size:0.76rem;color:#aaa;">${c.claimantName} &bull; ${c.studentId}</div>
        </div>
        <span class="s-badge ${st}">${c.status}</span>
      </div>`;
        })
        .join("")
    : '<div class="empty-state" style="padding:20px;"><i class="bi bi-clipboard2-x"></i><p>No claims yet.</p></div>';
}

function renderAdminItems() {
  const q = (document.getElementById("adminSearchQ")?.value || "").toLowerCase();
  const st = document.getElementById("adminFilterStat")?.value || "";
  const filtered = itemsData.filter((item) => {
    const ms = item.name.toLowerCase().includes(q) || item.location.toLowerCase().includes(q);
    return ms && (!st || item.status === st);
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

async function adminDeleteItem(id) {
  if (!confirm("Are you sure you want to delete this item? This cannot be undone.")) return;
  itemsData = itemsData.filter((i) => i.id !== id);
  if (USE_FIRESTORE) {
    await fsDelete('foundItems', id);
  } else {
    savePersisted();
  }
  renderAdminItems();
  renderItems();
  renderRecentGrid();
  updateStudentStats();
  updateAdminStats();
  renderAdminOverviewLists();
  showToast("Item deleted from the system.", "danger");
}

function openEditItemModal(id) {
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
          ${["Electronics", "Accessories", "Clothing", "Documents", "Bags", "Others"].map((c) => `<option ${item.category === c ? "selected" : ""}>${c}</option>`).join("")}
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

async function saveEditItem(id) {
  const item = findItemById(id);
  if (!item) return;
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
  if (USE_FIRESTORE) {
    await fsUpdate('foundItems', id, {
      name: item.name,
      status: item.status,
      category: item.category,
      color: item.color,
      brand: item.brand,
      location: item.location,
      description: item.description,
      identifiers: item.identifiers,
      emoji: item.emoji
    });
  } else {
    savePersisted();
  }
  renderAdminItems();
  renderItems();
  renderRecentGrid();
  updateStudentStats();
  updateAdminStats();
  closeModal("editItemModal");
  showToast("Item updated successfully!", "info");
}

function setClaimTab(tab, el) {
  claimTabFilter = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  renderAdminClaims();
}

function renderAdminClaims() {
  let claims = [...allClaims];
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
      return `
      <tr>
        <td>${idx + 1}</td>
        <td><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">${c.itemEmoji}</span><div style="font-weight:700;font-size:0.83rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.itemName}</div></div></td>
        <td>${c.claimantName}</td>
        <td>${c.studentId}</td>
        <td>${c.contact}</td>
        <td style="font-size:0.78rem;white-space:nowrap;">${c.submittedAt}</td>
        <td><span class="s-badge ${st}">${c.status}</span></td>
        <td>
          <div class="admin-actions">
            <button class="btn-sm-action view" onclick="viewClaimDetails(${c.id})"><i class="bi bi-eye"></i> View</button>
            ${canAct ? `<button class="btn-sm-action approve" onclick="viewClaimDetails(${c.id})"><i class="bi bi-check-lg"></i> Approve</button>
            <button class="btn-sm-action reject" onclick="rejectClaim(${c.id})"><i class="bi bi-x-lg"></i> Reject</button>` : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function viewClaimDetails(cid) {
  const c = allClaims.find((x) => x.id === cid);
  if (!c) return;
  const canAct = c.status === "Pending Review";
  document.getElementById("viewClaimBody").innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <span style="font-size:40px;">${c.itemEmoji}</span>
      <div>
        <div style="font-weight:800;font-size:1.1rem;color:#1a2a4a;">${c.itemName}</div>
        <div>${statusBadge(c.status)}</div>
      </div>
    </div>
    <div class="modal-section" style="margin-top:0;">Claimant Information</div>
    <div class="detail-row"><i class="bi bi-person-fill"></i><span class="detail-lbl">Full Name:</span>${htmlEsc(c.claimantName)}</div>
    <div class="detail-row"><i class="bi bi-card-text"></i><span class="detail-lbl">Student ID:</span>${htmlEsc(c.studentId)}</div>
    <div class="detail-row"><i class="bi bi-telephone-fill"></i><span class="detail-lbl">Contact:</span>${htmlEsc(c.contact)}</div>
    <div class="detail-row"><i class="bi bi-clock-fill"></i><span class="detail-lbl">Submitted:</span>${c.submittedAt}</div>
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
      <div class="modal-section">Admin Release Note to Claimant</div>
      <label class="f-label">Where to claim *</label>
      <input class="f-input" id="admin_claim_where_${c.id}" placeholder="e.g. OSA Office, Main Building"/>
      <label class="f-label">When to claim *</label>
      <input class="f-input" id="admin_claim_when_${c.id}" type="datetime-local"/>
      <label class="f-label">Additional notes</label>
      <textarea class="f-input" id="admin_claim_note_${c.id}" rows="2" placeholder="Bring school ID and claim stub."></textarea>
      <div class="f-err" id="admin_claim_err_${c.id}"></div>
      <div class="d-flex gap-2 mt-2">
        <button class="btn-gc success" style="flex:1;" onclick="approveClaim(${c.id});">
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

async function approveClaim(cid) {
  const c = allClaims.find((x) => x.id === cid);
  if (!c) return;
  const whereEl = document.getElementById(`admin_claim_where_${cid}`);
  const whenEl = document.getElementById(`admin_claim_when_${cid}`);
  const noteEl = document.getElementById(`admin_claim_note_${cid}`);
  const errEl = document.getElementById(`admin_claim_err_${cid}`);
  const claimWhere = whereEl ? whereEl.value.trim() : c.claimWhere || "";
  const claimWhen = whenEl ? whenEl.value : c.claimWhen || "";
  const adminNote = noteEl ? noteEl.value.trim() : c.adminNote || "";
  if ((!claimWhere || !claimWhen) && errEl) {
    errEl.style.display = "block";
    errEl.textContent = "Where and when to claim are required for approval.";
    return;
  }
  c.status = "Approved";
  c.claimWhere = claimWhere;
  c.claimWhen = claimWhen;
  c.adminNote = adminNote;
  const mc = myClaimsByEmail[c.claimantEmail]?.find((x) => x.id === cid);
  if (mc) {
    mc.status = "Approved";
    mc.claimWhere = claimWhere;
    mc.claimWhen = claimWhen;
    mc.adminNote = adminNote;
  }
  const localMc = myClaims.find((x) => x.id === cid);
  if (localMc) {
    localMc.status = "Approved";
    localMc.claimWhere = claimWhere;
    localMc.claimWhen = claimWhen;
    localMc.adminNote = adminNote;
  }
  const item = findItemById(c.itemId);
  if (item) item.status = "Claimed";
  if (USE_FIRESTORE) {
    await fsUpdate('claims', cid, { status: 'Approved', claimWhere, claimWhen, adminNote });
    if (item) {
      await fsUpdate('foundItems', item.id, { status: 'Claimed' });
    }
  } else {
    savePersisted();
  }
  renderAdminClaims();
  updateAdminStats();
  updateStudentStats();
  renderAdminItems();
  renderAdminOverviewLists();
  renderItems();
  renderRecentGrid();
  renderMyClaims();
  closeModal("viewClaimModal");
  showToast(`Claim APPROVED for "${c.itemName}".`, "success");
}

async function rejectClaim(cid) {
  const c = allClaims.find((x) => x.id === cid);
  if (!c) return;
  c.status = "Rejected";
  const mc = myClaimsByEmail[c.claimantEmail]?.find((x) => x.id === cid);
  if (mc) mc.status = "Rejected";
  const localMc = myClaims.find((x) => x.id === cid);
  if (localMc) localMc.status = "Rejected";
  const item = findItemById(c.itemId);
  if (item && item.status === "Pending") item.status = "Unclaimed";
  if (USE_FIRESTORE) {
    await fsUpdate('claims', cid, { status: 'Rejected' });
    if (item && item.status === "Unclaimed") {
      await fsUpdate('foundItems', item.id, { status: 'Unclaimed' });
    }
  } else {
    savePersisted();
  }
  renderAdminClaims();
  updateAdminStats();
  updateStudentStats();
  renderAdminItems();
  renderAdminOverviewLists();
  renderItems();
  renderRecentGrid();
  renderMyClaims();
  showToast(`Claim REJECTED for "${c.itemName}".`, "danger");
}

function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

function closeOnOverlay(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
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