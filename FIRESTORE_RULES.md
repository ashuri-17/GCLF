# Firestore Security Rules

Apply these rules in Firebase Console → Firestore Database → Rules.

## Production Rules (Recommended)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Student profiles - users can read all, but only edit their own
    match /studentProfiles/{email} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.token.email == email;
    }

    // Found items - anyone can read, only admins can write
    match /foundItems/{itemId} {
      allow read: if true;
      allow write: if request.auth != null &&
        request.auth.token.email in ['admin@gc.edu', 'admin@gordoncollege.edu.ph'];
    }

    // Claims - users can create their own claims, admins can update status
    match /claims/{claimId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null &&
        request.resource.data.claimantEmail == request.auth.token.email;
      allow update: if request.auth != null &&
        request.auth.token.email in ['admin@gc.edu', 'admin@gordoncollege.edu.ph'];
    }

    // Lost reports - anyone can read, reporters can create, admins can update
    match /lostReports/{reportId} {
      allow read: if true;
      allow create: if request.auth != null &&
        request.resource.data.reporterEmail == request.auth.token.email;
      allow update: if request.auth != null &&
        request.auth.token.email in ['admin@gc.edu', 'admin@gordoncollege.edu.ph'];
    }

    // Pending found reports - only admins can access
    match /pendingFoundReports/{reportId} {
      allow read, write: if request.auth != null &&
        request.auth.token.email in ['admin@gc.edu', 'admin@gordoncollege.edu.ph'];
    }

    // Lost item leads - involved users can read/write
    match /lostItemLeads/{leadId} {
      allow read, write: if request.auth != null &&
        (request.auth.token.email == resource.data.reporterEmail ||
         request.auth.token.email == resource.data.finderEmail);
    }
  }
}
```

## Open Rules (For Testing Only)

Use these temporary rules for initial testing (allows all reads/writes):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**WARNING**: Change to production rules before deploying to real users!

## Setup Instructions

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: `gclf-43f7f`
3. Navigate to **Firestore Database** in the left sidebar
4. Click on the **Rules** tab
5. Replace the existing rules with the production rules above
6. Click **Publish**
