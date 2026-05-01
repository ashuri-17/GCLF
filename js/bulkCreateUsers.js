/**
 * bulkCreateUsers.js
 *
 * Reads students.csv with columns: studentId,lastName
 * Creates Firebase Auth users:
 *   email:    [studentId]@gclf.app
 *   password: [lastName]GC[first digit of studentId]
 *
 * Usage:
 *   node bulkCreateUsers.js
 */

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = path.join(__dirname, "gclf-43f7f-firebase-adminsdk-fbsvc-f3c304d338.json");
const CSV_PATH = path.join(__dirname, "students.csv");
const EMAIL_DOMAIN = "gordoncollege.edu.ph";

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Missing service account file: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  console.error(`Missing CSV file: ${CSV_PATH}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH))
});

function normalize(value) {
  return String(value || "").trim();
}

function buildEmail(studentId) {
  return `${studentId}@${EMAIL_DOMAIN}`;
}

function buildPassword(lastName, studentId) {
  const firstDigit = studentId[0];
  return `${lastName}GC${firstDigit}`;
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

  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName: `${lastName}, ${studentId}`,
    emailVerified: false,
    disabled: false
  });

  return { uid: userRecord.uid, email };
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

