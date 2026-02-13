# HubSpot Monday Sync v2 - Dynamic Field Mapping

## 🎉 What's New in Version 2

### Fixed Issues:
1. ✅ **All HubSpot fields available** - Select from ANY HubSpot ticket property
2. ✅ **Add unlimited mappings** - Not limited to 3, add as many as you need
3. ✅ **Dropdown persistence** - Your selections are saved and don't reset
4. ✅ **Remove mappings** - Delete field mappings you don't need

### New Features:
5. ✅ **Dynamic field discovery** - Automatically loads all available fields
6. ✅ **Better UI** - Cleaner interface with add/remove buttons
7. ✅ **Attachment support** - Code ready for syncing HubSpot attachments (partial)

---

## 📋 Files Included

1. **package.json** - Dependencies
2. **server.js** - Improved application
3. **.env.example** - Environment variables template

---

## 🚀 Deployment to Render

### Option 1: Update Existing Service

1. Go to your GitHub repo
2. Delete the old `server.js` file
3. Upload the new `server.js` from this folder
4. Commit changes
5. Render will auto-deploy in 2-3 minutes

### Option 2: Fresh Deployment

Follow the same steps as before:
1. Create new GitHub repo
2. Upload all 3 files
3. Deploy to Render
4. Add environment variables
5. Access your dashboard

---

## 🗺️ How Dynamic Field Mapping Works

### Step 1: Discover Fields

1. Open your dashboard
2. Click **"Discover Available Fields"**
3. Wait 2-3 seconds
4. ALL dropdowns populate automatically

### Step 2: Map Fields

You'll see rows like this:

```
[HubSpot Field Dropdown] → [Monday Column Dropdown] [Remove]
```

**For each row:**
- Left dropdown: Choose ANY HubSpot ticket property
- Right dropdown: Choose which Monday column to sync it to
- Remove button: Delete this mapping

### Step 3: Add More Mappings

1. Click **"+ Add Field Mapping"**
2. New row appears
3. Select fields from dropdowns
4. Repeat as needed

### Step 4: Save

1. Click **"Save Field Mappings"**
2. All your selections are saved
3. Dropdowns will show your saved selections on next page load

---

## 📊 Example Usage

### Basic Setup (3 fields):

1. **Mapping 1:**
   - HubSpot: `content` (Ticket description)
   - Monday: `text` (Description column)

2. **Mapping 2:**
   - HubSpot: `hs_pipeline_stage` (Stage)
   - Monday: `status` (Status column)

3. **Mapping 3:**
   - HubSpot: `hs_ticket_priority` (Priority)
   - Monday: `priority` (Priority column)

### Advanced Setup (10+ fields):

Click "+ Add Field Mapping" to add more:

4. **Mapping 4:**
   - HubSpot: `hs_ticket_category` (Category)
   - Monday: `dropdown_1` (Category column)

5. **Mapping 5:**
   - HubSpot: `createdate` (Created date)
   - Monday: `date` (Created column)

6. **Mapping 6:**
   - HubSpot: `closed_date` (Closed date)
   - Monday: `date_1` (Closed column)

7. **Mapping 7:**
   - HubSpot: `hs_resolution` (Resolution)
   - Monday: `long_text` (Resolution column)

...and so on!

---

## 🎯 Available HubSpot Fields

After clicking "Discover Available Fields", you'll see dropdowns with ALL ticket properties including:

**Standard Fields:**
- `subject` - Ticket name/title (always mapped to Monday item name)
- `content` - Ticket description
- `hs_pipeline_stage` - Pipeline stage/status
- `hs_ticket_priority` - Priority (LOW, MEDIUM, HIGH, etc.)
- `hs_ticket_category` - Category
- `hubspot_owner_id` - Owner/assignee
- `createdate` - Created date
- `closed_date` - Closed date
- `hs_resolution` - Resolution notes
- `source_type` - How ticket was created

**Plus:**
- Any custom properties you've created in HubSpot
- All system properties
- All calculated properties

The dropdowns show: **Label (field_name)** for easy selection

---

## 📦 Monday Column Types

The Monday dropdown shows: **Column Title (type) [column_id]**

**Best matches:**
- Text/Long Text columns → for HubSpot text fields
- Status columns → for HubSpot status/stage fields
- Dropdown columns → for HubSpot category/priority fields
- People columns → for HubSpot owner fields
- Date columns → for HubSpot date fields
- Number columns → for HubSpot number fields

---

## 🖼️ Image/Attachment Syncing

### Current Status:

The code includes **partial support** for HubSpot attachments:

```javascript
async function getHubSpotAttachments(ticketId)
```

This function can fetch attachments from HubSpot tickets.

### To Fully Enable:

1. **Add a "Files" column to your Monday board**
   - Column type: "Files"
   - Note the column ID

2. **Add mapping for attachments:**
   - HubSpot: `hs_attachment_ids` (read-only field showing attachment IDs)
   - Monday: `your_files_column_id`

3. **Note:** Full implementation requires:
   - Downloading files from HubSpot
   - Re-uploading to Monday via API
   - Monday's file upload uses different API endpoint
   - May need additional development

### Current Limitation:

Monday.com's file upload API is more complex and requires multipart form data. The basic code structure is there, but full implementation would need:

1. Download file from HubSpot URL
2. Convert to proper format
3. Upload to Monday using their file upload mutation
4. Handle large files properly

**This is marked for future development** but the foundation is in place.

---

## 🔧 Troubleshooting

### Dropdowns Empty After "Discover Fields"

**Cause:** API connection issue

**Fix:**
1. Check your API tokens are correct
2. Verify Board ID is correct
3. Check browser console (F12) for errors
4. Try "Save Configuration" first, then "Discover Fields"

### Selections Reset After Save

**This is fixed in v2!** 

**If still happening:**
1. Make sure you're using the NEW server.js file
2. Clear browser cache
3. Hard refresh (Ctrl+F5 or Cmd+Shift+R)

### Can't Add More Than 3 Mappings

**This is fixed in v2!**

**If still happening:**
1. Make sure you uploaded the NEW server.js
2. Check Render logs - should show "Deployed" with new code
3. Click "+ Add Field Mapping" button (green button)

### "Remove" Button Doesn't Work

**Fix:**
1. Hard refresh browser
2. Make sure JavaScript is enabled
3. Check browser console for errors

### Mappings Not Saving

**Fix:**
1. Fill out BOTH dropdowns (HubSpot AND Monday)
2. Click "Save Field Mappings" button at bottom
3. Check Sync Log for confirmation message
4. Wait for page reload

---

## 📝 Best Practices

### 1. Start Small
- Begin with 3-5 essential fields
- Test sync with "Manual Sync Now"
- Add more fields gradually

### 2. Match Column Types
- Text → Text columns
- Status → Status columns
- Dates → Date columns
- Numbers → Number columns

### 3. Use Descriptive Names
- Label your Monday columns clearly
- Helps identify them in dropdowns

### 4. Test Before Enabling Auto-Sync
1. Add field mappings
2. Save
3. Click "Manual Sync Now"
4. Check both platforms
5. Only then enable auto-sync

### 5. Document Your Mappings
Keep a note of what you mapped:
```
content → text (Description)
hs_pipeline_stage → status (Status)
hs_ticket_priority → priority (Priority)
hs_ticket_category → dropdown_1 (Category)
```

---

## 🎓 How Matching Still Works

**Important:** Even with dynamic mapping, tickets still match by **name/title**:

- HubSpot `subject` = Monday `name`
- If names match exactly → updates existing item
- If no match → creates new item

**Future improvement:** Will add ID-based matching for more reliability.

---

## ✅ Success Checklist

- ✅ Deployed new server.js to Render
- ✅ Dashboard loads without errors
- ✅ Clicked "Discover Available Fields"
- ✅ See ALL HubSpot fields in left dropdowns
- ✅ See ALL Monday columns in right dropdowns
- ✅ Can add new field mappings with "+ Add Field Mapping"
- ✅ Can remove mappings with "Remove" button
- ✅ Saved mappings persist after page reload
- ✅ "Manual Sync Now" works
- ✅ Data syncs correctly between platforms

---

## 🚀 Next Steps

1. Deploy this version
2. Test dynamic field mapping
3. Let me know if you want:
   - ID-based matching (more reliable)
   - Full attachment syncing
   - Bi-directional attachment support
   - Custom field type handling

Your feedback on this version will help me prioritize the next improvements!
