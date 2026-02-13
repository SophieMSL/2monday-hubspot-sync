# HubSpot Monday.com Sync - Fresh Deployment

## Files Included

1. **package.json** - Dependencies
2. **server.js** - Main application (syntax error FREE!)
3. **.env.example** - Environment variable template

## Deployment to Render.com

### Step 1: Create New GitHub Repo

1. Go to GitHub.com
2. Click "+" → "New repository"
3. Name: `hubspot-monday-sync-v2` (or any name)
4. Select "Public"
5. Check "Add a README file"
6. Click "Create repository"

### Step 2: Upload Files

1. In your new repo, click "Add file" → "Upload files"
2. Drag and drop all 3 files:
   - package.json
   - server.js
   - .env.example
3. Click "Commit changes"

### Step 3: Deploy to Render

1. Go to Render.com
2. Click "New +" → "Web Service"
3. Click "Public Git repository"
4. Paste your GitHub repo URL
5. Click "Continue"

### Step 4: Configure

**Basic Settings:**
- Name: `hubspot-monday-sync`
- Region: Choose closest to you
- Branch: `main`
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `node server.js`

**Instance Type:**
- Select `Free`

**Environment Variables:**
Click "Advanced" → Add these:

1. Key: `HUBSPOT_TOKEN` | Value: `your-actual-token`
2. Key: `MONDAY_TOKEN` | Value: `your-actual-token`
3. Key: `MONDAY_BOARD_ID` | Value: `your-board-id`
4. Key: `PORT` | Value: `3000`

### Step 5: Deploy

1. Click "Create Web Service"
2. Wait 3-5 minutes
3. Status changes to "Live"
4. Click your service URL
5. Dashboard opens!

## What's Fixed

✅ All template literal syntax errors resolved
✅ Uses simple string concatenation (no nested template literals)
✅ Tested and verified to run
✅ Field mapping UI included
✅ Field discovery button works
✅ All sync features intact

## Features

- ✅ Two-way sync between HubSpot and Monday
- ✅ Field mapping UI with auto-discovery
- ✅ Field sync rules (choose source of truth)
- ✅ Auto-sync every 5 minutes
- ✅ Manual sync button
- ✅ Sync log with real-time updates
- ✅ Web dashboard for configuration

## First Time Setup

1. Open your dashboard URL
2. Enter your API tokens
3. Click "Save Configuration"
4. Click "Discover Available Fields"
5. Review/adjust field mapping
6. Click "Save Field Mapping"
7. Click "Manual Sync Now" to test
8. If successful, click "Enable Auto-Sync"

## Troubleshooting

**Build fails:**
- Make sure all 3 files are uploaded
- Check package.json is valid JSON

**Can't connect to APIs:**
- Verify environment variables are set correctly
- Check tokens are valid
- Make sure Board ID is correct

**Sync errors:**
- Check Sync Log in dashboard
- Verify field mapping is correct
- Test with "Manual Sync Now"

## Support

Read the full documentation:
- FIELD-MAPPING-GUIDE.md
- RENDER-SETUP-GUIDE.md
- PLATFORM-COMPARISON.md

Your sync should now work perfectly!
