# Shared Bookkeeping Tracker: setup guide

This version lets your whole team use the same board. Everything is stored in a Google Sheet that you own, and each person signs in with their Google account.

Setup takes about 10 minutes and you only do it once. You'll copy two files from this folder into Google:

- `Code.gs`
- `Index.html`

**To copy a file from GitHub:** open the file on GitHub and click the **Raw** button (top right of the file). A plain page of text opens. Press **Ctrl+A** (Cmd+A on a Mac) to select all, then **Ctrl+C** (Cmd+C) to copy.

Check what you copied before you paste it:

- `Code.gs` must start with `/**`.
- `Index.html` must start with `<!DOCTYPE html>`.

If it starts with `{` or mentions `"payload"`, you copied GitHub's page data instead of the file. Go back and use the **Raw** button.

---

## Step 1: Create the Google Sheet

1. Go to **https://sheets.new**. This opens a new blank Google Sheet.
2. Click **Untitled spreadsheet** at the top left and rename it, for example **Bookkeeping Tracker**.

## Step 2: Add the code

1. In the Sheet's menu, click **Extensions → Apps Script**. A new tab opens with a code editor.
2. At the top left, click **Untitled project** and rename it **Bookkeeping Tracker**.
3. You'll see a file called `Code.gs` containing `function myFunction() {…}`. Select everything in it and delete it.
4. Paste in the contents of **`Code.gs`** from this folder.
5. Next to **Files** on the left, click the **+** button and choose **HTML**. Name it exactly `Index` (Google adds the `.html` for you).
6. Select everything in the new `Index.html` file, delete it, and paste in the contents of **`Index.html`** from this folder.
7. Click the **Save** icon (the floppy disk) or press Ctrl+S (Cmd+S on a Mac).
8. In the toolbar above the code, pick **setup** from the function drop-down (next to **Debug**), then click **▶ Run**.
   - Google asks for permission. Choose your account. If it says **"Google hasn't verified this app"**, click **Advanced → Go to Bookkeeping Tracker (unsafe) → Allow**.
   - The **Execution log** at the bottom should say **"Setup complete"**, and the new tabs appear in your Sheet. If it shows an error instead, copy the message and send it to whoever is helping you.

## Step 3: Publish it as a web app

1. At the top right, click the blue **Deploy** button, then **New deployment**.
2. Next to "Select type", click the gear icon ⚙ and choose **Web app**.
3. Fill in:
   - **Description:** `Bookkeeping Tracker`
   - **Execute as:** **User accessing the web app**
   - **Who has access:** **Anyone with Google account**. If your whole team uses your company's Google Workspace accounts, you can choose **Anyone within [your company]** instead.
4. Click **Deploy**.
5. Click **Authorize access** and choose your Google account.
6. Google will say **"Google hasn't verified this app."** That's expected, because this is your own private script and not a public app. Click **Advanced**, then **Go to Bookkeeping Tracker (unsafe)**, then **Allow**.
7. Copy the **Web app URL** (it ends in `/exec`). This is the link to your tracker. Bookmark it.

Open the link. The first time, the tracker sets up the tabs in your Google Sheet (Clients, Notes, Stage History, Stages, Accountants and Settings), and the board appears.

## Step 4: Bring over your existing clients (optional)

If you've been using the single-computer version:

1. Open the old tracker file and click **Backup & Restore → Download Backup (JSON)**.
2. In the new shared tracker, click **Backup & Restore → Choose File to Import…** and choose that file.

Your clients, notes, accountants, stages and monthly settings are copied over.

## Step 5: Invite your team

1. Open the Google Sheet and click **Share** (top right).
2. Add each teammate's email address. Set them to **Editor**, and click **Send**.
3. Send them the **Web app URL** from Step 3.

The first time each teammate opens the link, they see the same Google sign-in and "hasn't verified this app" screens you saw. They should click **Advanced → Go to Bookkeeping Tracker (unsafe) → Allow**. After that, the link just opens the board.

**Who can do what:**

| Access to the Google Sheet | What they can do in the tracker |
|---|---|
| Editor | Everything |
| Viewer | See the board, but not change anything |
| Not shared | Nothing; they get an error |

To remove someone, remove them from the Sheet's Share list.

---

## Good to know

- **Everyone sees the same board.** Changes save immediately, and other people's boards update within about 15 seconds.
- **Two people can work at the same time.** Changes are saved one at a time, so they don't overwrite each other.
- **Notes and moves are signed.** Each note shows who wrote it, and the stage history shows who moved the client.
- **Sort choices are personal.** Each person's column sort (A–Z, by accountant, longest in stage) is remembered on their own computer.
- **Monthly restarts happen automatically.** They run whenever anyone opens the board, on or after each client's day.
- **You can read or edit the Sheet directly.** It's fine to fix a typo there or add a client row with at least a Business Name. Don't add, remove or reorder the columns. Hand edits show up on everyone's board the next time it refreshes.
- **Backups:** Google Sheets keeps version history (**File → Version history** in the Sheet). The tracker's **Backup & Restore** button also downloads JSON and CSV copies.
- **Cost:** free. Google's free limits are far more than a small team needs.

## Updating to a newer version later

1. Open the Sheet, then **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` and/or `Index.html` with the new versions and save.
3. Click **Deploy → Manage deployments**, click the pencil ✏️ icon, set **Version** to **New version**, and click **Deploy**.

The link stays the same, so your team doesn't need a new one.

## Troubleshooting

- **"Google needs you to approve this app…" or other sign-in errors on the board**: this often happens when you're signed in to more than one Google account in the same browser. Open the link in an incognito/private window and sign in with only the account that has access to the Sheet. If you're the owner, also run **setup** from the editor (Step 2, item 8).

- **"Syntax error … Unexpected token" when saving**: the pasted text isn't the code file. In the Apps Script editor, select everything in `Code.gs` (Ctrl+A), delete it, and paste again using the **Raw** button method at the top of this guide. Line 1 must be `/**` and line 2 must be ` * Bookkeeping Client Tracker (shared team version)`. Check `Index.html` the same way; its line 1 must be `<!DOCTYPE html>`.
- **"You have view-only access…"**: the person is a Viewer on the Google Sheet. Change them to Editor under Share.
- **"You need access" or "Sorry, unable to open the file"**: the Sheet hasn't been shared with that Google account. People signed into several Google accounts should open the link in a private/incognito window, or sign in with the account you shared the Sheet with.
- **The board doesn't load after updating the code**: make sure you deployed a **New version** (see above), and that the HTML file is named exactly `Index`.
