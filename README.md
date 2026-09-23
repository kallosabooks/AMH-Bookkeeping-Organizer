# Bookkeeping Client Tracker

A board for tracking monthly bookkeeping clients through your workflow. There are two versions:

| | Shared team version | Single-computer version |
|---|---|---|
| Where | [`google-sheets/`](google-sheets/) | `index.html` |
| Who can use it | Your whole team, each with their own Google sign-in | One person, in one browser |
| Where the data lives | A Google Sheet you own | That browser |
| Setup | About 10 minutes; see [google-sheets/SETUP.md](google-sheets/SETUP.md) | None; double-click the file |

Both versions have the same board and features. The shared version also records who wrote each note and who moved each client.

The rest of this page describes the single-computer version.

## How to open it

1. Download `index.html` (on GitHub, open the file and click the **Download raw file** button). Save it somewhere permanent, such as your Documents folder.
2. Double-click `index.html`. It opens in your web browser (Chrome, Edge, Safari or Firefox).
3. Bookmark the page so you can get back to it quickly.

When you download a newer version, replace the old file in the same place and open it in the same browser. Your saved data carries over.

## How to use it

- **Add Client**: click **+ Add Client**. **Business Name** is required. Contact name, accountant, starting stage, the monthly setting, and notes are optional.
- **Accountants**: click **Accountants** to add, rename, or remove the people on your team. You can also add one directly from the Accountant drop-down on a client ("+ Add new accountant…").
- **Monthly clients**: tick **Repeats monthly** and pick a day (1st–28th). On that day each month, the client moves back to **Bookkeeping to Start** automatically.
  - If they were still in an unfinished stage, a note is added so you can check that the previous month was done.
  - Monthly clients show a ↻ symbol on their card.
  - You can choose which stage monthly clients return to under **Edit Stages**.
- **Sort**: each column has its own **Sort** drop-down: Business A–Z, Accountant (grouped under each accountant's name), or Longest in stage.
- **Move a client**: drag their card to another column. On a tablet, press and hold the card for a moment, then drag it. You can also open the card and change the **Stage** drop-down.
- **View or edit a client**: click the card. Changes save as you type. Each note you add is saved with the date and time, so you get a history of updates.
- **Delete a client**: open the card and click **Delete Client**. You'll be asked to confirm first.
- **Search**: filters by business, contact, or accountant name. Press `/` to jump to the search bar.
- **Edit Stages**: rename, add, remove, or reorder the columns.

Monthly restarts happen when the page is open or next opened. If the tracker is closed on the 1st, clients move the next time you open it.

## Your data

- Everything saves automatically in your browser, so it stays after you close the tab or restart the computer.
- The data belongs to **that browser on that computer**. If you open the file in a different browser or on another computer, you'll see an empty board.
- Clearing your browser's history or site data for local files can erase it. Use **Backup & Restore → Download Backup (JSON)** regularly.
- **Download Spreadsheet (CSV)** gives you a file that opens in Excel or Google Sheets.
- To restore data, go to **Backup & Restore → Choose File to Import…** and choose a JSON backup or a CSV file exported from this app. Importing replaces what's on the board, and you'll be asked to confirm first.
