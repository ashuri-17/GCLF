/**
 * bulkCreateUsers.js
 *
 * Reads students.csv with columns: studentId,lastName
 * Creates Supabase Auth users:
 *   email:    [studentId]@gordoncollege.edu.ph
 *   password: [lastName]GC[first 4 digits of studentId]
 *
 * Usage:
 *   node bulkCreateUsers.js
 */

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { createClient } = require("@supabase/supabase-js");

// Supabase configuration - USE SERVICE ROLE KEY for admin operations!
const SUPABASE_URL = "https://wzdjjtttszukvfdbxluf.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "YOUR_SERVICE_ROLE_KEY_HERE";

const CSV_PATH = path.join(__dirname, "students.csv");
const EMAIL_DOMAIN = "gordoncollege.edu.ph";

// Check for service key
if (SUPABASE_SERVICE_KEY === "YOUR_SERVICE_ROLE_KEY_HERE") {
  console.error("ERROR: Please set your SUPABASE_SERVICE_KEY");
  console.error("Get it from: Supabase Dashboard → Project Settings → API → service_role key");
  console.error("Run with: set SUPABASE_SERVICE_KEY=your_key&& node bulkCreateUsers.js");
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  console.error(`Missing CSV file: ${CSV_PATH}`);
  process.exit(1);
}

// Initialize Supabase with SERVICE ROLE KEY (admin privileges)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function normalize(value) {
  return String(value || "").trim();
}

function buildEmail(studentId) {
  return `${studentId}@${EMAIL_DOMAIN}`;
}

function buildPassword(lastName, studentId) {
  const firstFourDigits = studentId.slice(0, 4);
  return `${lastName}GC${firstFourDigits}`;
}

async function createUserFromRow(row, rowNumber) {
  const studentId = normalize(row.studentId);
  const lastName = normalize(row.lastName);

  if (!studentId || !lastName) {
    throw new Error(
      `Row ${rowNumber}: Missing required fields (studentId='${studentId}', lastName='${lastName}')`
    );
  }

  const email = buildEmail(studentId);
  const password = buildPassword(lastName, studentId);

  // Create user in Supabase Auth using admin API
  const { data: user, error } = await supabase.auth.admin.createUser({
    email,
    password,
    user_metadata: {
      lastName,
      studentId,
      displayName: `${lastName}, ${studentId}`
    },
    email_confirm: true
  });

  if (error) {
    throw new Error(error.message);
  }

  return { uid: user.user.id, email };
}

async function run() {
  const rows = [];
  let processed = 0;
  let success = 0;
  let failed = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", resolve)
      .on("error", reject);
  });

  console.log(`Loaded ${rows.length} rows from students.csv`);
  console.log("Starting user creation...\n");

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    processed++;

    try {
      const result = await createUserFromRow(rows[i], rowNumber);
      success++;
      console.log(`Created: ${result.email} (uid: ${result.uid})`);
    } catch (err) {
      failed++;
      const studentId = normalize(rows[i].studentId);
      const email = studentId ? buildEmail(studentId) : "(invalid email)";
      console.error(`Failed: ${email}`);
      console.error(`Reason: ${err.message}\n`);
    }
  }

  console.log("\n==============================");
  console.log("Done.");
  console.log(`Processed: ${processed}`);
  console.log(`Success:   ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log("==============================");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

