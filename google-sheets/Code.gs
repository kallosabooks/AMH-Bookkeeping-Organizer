/**
 * Bookkeeping Client Tracker (shared team version)
 *
 * Server code for a Google Apps Script web app. All data lives in the Google
 * Sheet this script is attached to, one tab per kind of record, so the sheet
 * can also be opened and read directly. See SETUP.md for installation.
 *
 * Every change from the web page goes through mutate(), which takes a lock,
 * re-reads the sheet, applies that one change and writes it back. Two people
 * editing at the same time therefore never overwrite each other's work.
 */

var DEFAULT_STAGES = [
  'Bookkeeping to Start',
  'Waiting on Documents',
  'In Progress',
  'Ready for Review',
  'Complete'
];

var TABLES = {
  clients: {
    sheet: 'Clients',
    headers: ['ID', 'Business Name', 'Client Name', 'Accountant', 'Stage', 'Monthly', 'Monthly Day',
      'Entered Stage', 'Client Added', 'Last Monthly Restart', 'Last Updated', 'Updated By'],
    dateCols: [8, 9, 10, 11],
    widths: { 1: 90, 2: 220, 3: 160, 4: 140, 5: 170 }
  },
  notes: {
    sheet: 'Notes',
    headers: ['ID', 'Client ID', 'Business Name', 'Date', 'Author', 'Note'],
    dateCols: [4],
    widths: { 3: 200, 5: 180, 6: 480 },
    wrapCol: 6
  },
  history: {
    sheet: 'Stage History',
    headers: ['Client ID', 'Business Name', 'Stage', 'Date', 'Changed By', 'Monthly Restart'],
    dateCols: [4],
    widths: { 2: 200, 3: 170, 5: 180 }
  },
  stages: { sheet: 'Stages', headers: ['Stage'], widths: { 1: 220 } },
  accountants: { sheet: 'Accountants', headers: ['Accountant'], widths: { 1: 220 } },
  settings: { sheet: 'Settings', headers: ['Setting', 'Value'], widths: { 1: 220, 2: 220 } },
  // Each client's own checklist items, in display order.
  tasks: {
    sheet: 'Checklist Tasks',
    headers: ['Client ID', 'Business Name', 'Task ID', 'Task'],
    widths: { 2: 200, 4: 260 }
  },
  // One row per ticked box. Month is written as text, e.g. 2026-08.
  checks: {
    sheet: 'Checklist',
    headers: ['Client ID', 'Business Name', 'Task ID', 'Task', 'Month', 'Checked By', 'Checked On'],
    dateCols: [7],
    widths: { 2: 200, 4: 240, 6: 180 }
  },
  template: { sheet: 'Checklist Template', headers: ['Task'], widths: { 1: 260 } }
};
var TABLE_ORDER = ['clients', 'notes', 'history', 'stages', 'accountants', 'settings', 'tasks', 'checks', 'template'];
var RESTART_SETTING = 'Monthly clients restart in';
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
var DEFAULT_TEMPLATE = [
  'Checking',
  'Savings',
  'Credit Card',
  'Loans',
  'Payroll Liabilities',
  'Reclassify Transactions',
  'Transaction Questions',
  'Month Complete'
];

// ============================================================================
// Web app entry points
// ============================================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Bookkeeping Clients')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Run this once from the Apps Script editor (choose "setup", click Run).
 * It asks Google for permission and creates the tabs in the Sheet. Any
 * problem appears in the Execution log with Google's full message.
 */
function setup() {
  var m = loadModel_();
  saveModel_(m);
  console.log('Setup complete. Tabs: ' + m.ss.getSheets().map(function (s) { return s.getName(); }).join(', ') +
    '. Signed in as: ' + (userEmail_() || 'unknown'));
}

// Lets open boards notice when someone edits the sheet by hand.
function onEdit() {
  try { bumpRev_(); } catch (e) { /* ignore */ }
}

/** Returns the whole board as a JSON string. */
function getState() {
  try {
    var m = loadModel_();
    if (isDirty_(m) || recurrencesDue_(m)) {
      try {
        m = withLock_(function () {
          var fresh = loadModel_();
          runRecurrences_(fresh);
          saveModel_(fresh);
          return fresh;
        });
      } catch (e) {
        // View-only users can't save; show them what is there.
      }
    }
    return JSON.stringify(stateOf_(m));
  } catch (e) {
    throw friendlyError_(e);
  }
}

/** Cheap check the page polls to see whether anything changed. */
function getRev() {
  return PropertiesService.getScriptProperties().getProperty('rev') || '0';
}

/** Applies one change and returns the updated board as a JSON string. */
function mutate(op, args) {
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) throw new Error('Unknown action: ' + op);
  try {
    return withLock_(function () {
      var m = loadModel_();
      OPS[op](m, args || {}, userEmail_());
      runRecurrences_(m);
      saveModel_(m);
      var state = stateOf_(m);
      if (m.result) state.result = m.result;
      return JSON.stringify(state);
    });
  } catch (e) {
    throw friendlyError_(e);
  }
}

/**
 * The board only carries checkmarks for this year and last year. Older
 * years are fetched with this when someone looks at them.
 */
function getChecklistYear(clientId, year) {
  try {
    var m = loadModel_();
    var prefix = String(year) + '-';
    var out = {};
    m.checks.forEach(function (k) {
      if (k.clientId === clientId && k.month.indexOf(prefix) === 0) out[k.taskId + '|' + k.month] = [k.by, k.date];
    });
    return JSON.stringify(out);
  } catch (e) {
    throw friendlyError_(e);
  }
}

/** A complete backup, including every year of checklists. */
function exportAll() {
  try {
    var m = loadModel_();
    var state = stateOf_(m, true);
    return JSON.stringify({
      app: 'bookkeeping-tracker-shared', version: 4, exportedAt: nowIso_(),
      stages: state.stages, accountants: state.accountants, restartStage: state.restartStage,
      template: state.template, clients: state.clients
    });
  } catch (e) {
    throw friendlyError_(e);
  }
}

// ============================================================================
// Changes the page can make
// ============================================================================

var OPS = {
  addClient: function (m, a, me) {
    var now = nowIso_();
    var c = {
      id: newId_(),
      business: required_(a.business, 'Business Name'),
      name: clean_(a.name),
      accountant: accountantName_(m, a.accountant),
      stage: a.stage ? stageName_(m, a.stage) : m.stages[0],
      monthly: !!a.monthly,
      recurDay: day_(a.recurDay),
      enteredAt: now,
      createdAt: now,
      lastRecurAt: a.monthly ? now : '',
      updatedAt: now,
      updatedBy: me
    };
    m.clients.push(c);
    m.history.push({ clientId: c.id, business: c.business, stage: c.stage, date: now, by: me, auto: false });
    if (clean_(a.note)) addNoteRow_(m, c, a.note, me);
    m.template.forEach(function (name) { addTaskRow_(m, c, name); });
    m.dirty.clients = m.dirty.history = true;
  },

  updateClient: function (m, a, me) {
    var c = client_(m, a.id);
    if ('business' in a) {
      var b = required_(a.business, 'Business Name');
      if (b !== c.business) {
        c.business = b;
        m.notes.forEach(function (n) { if (n.clientId === c.id) n.business = b; });
        m.history.forEach(function (h) { if (h.clientId === c.id) h.business = b; });
        m.tasks.forEach(function (t) { if (t.clientId === c.id) t.business = b; });
        m.checks.forEach(function (k) { if (k.clientId === c.id) k.business = b; });
        m.dirty.notes = m.dirty.history = m.dirty.tasks = m.dirty.checks = true;
      }
    }
    if ('name' in a) c.name = clean_(a.name);
    if ('accountant' in a) c.accountant = accountantName_(m, a.accountant);
    if ('recurDay' in a) c.recurDay = day_(a.recurDay);
    if ('monthly' in a) {
      // Start counting from now so switching it on doesn't restart the client immediately.
      if (a.monthly && !c.monthly) c.lastRecurAt = nowIso_();
      c.monthly = !!a.monthly;
    }
    touch_(m, c, me);
  },

  moveClient: function (m, a, me) {
    var c = client_(m, a.id);
    setStage_(m, c, stageName_(m, a.stage), me, false);
  },

  deleteClient: function (m, a) {
    var c = client_(m, a.id);
    m.clients = m.clients.filter(function (x) { return x.id !== c.id; });
    m.notes = m.notes.filter(function (n) { return n.clientId !== c.id; });
    m.history = m.history.filter(function (h) { return h.clientId !== c.id; });
    m.tasks = m.tasks.filter(function (t) { return t.clientId !== c.id; });
    m.checks = m.checks.filter(function (k) { return k.clientId !== c.id; });
    m.dirty.clients = m.dirty.notes = m.dirty.history = m.dirty.tasks = m.dirty.checks = true;
  },

  addNote: function (m, a, me) {
    var c = client_(m, a.clientId);
    required_(a.text, 'Note');
    addNoteRow_(m, c, a.text, me);
  },

  deleteNote: function (m, a) {
    m.notes = m.notes.filter(function (n) { return n.id !== a.id; });
    m.dirty.notes = true;
  },

  addStage: function (m, a) {
    var name = required_(a.name, 'Stage name');
    if (findName_(m.stages, name)) throw new Error('There is already a stage called "' + name + '".');
    m.stages.push(name);
    m.dirty.stages = true;
  },

  renameStage: function (m, a) {
    var from = stageName_(m, a.from);
    var to = required_(a.to, 'Stage name');
    var clash = findName_(m.stages, to);
    if (clash && clash !== from) throw new Error('There is already a stage called "' + to + '".');
    m.stages = m.stages.map(function (s) { return s === from ? to : s; });
    m.clients.forEach(function (c) { if (c.stage === from) c.stage = to; });
    if (m.restartStage === from) m.restartStage = to;
    m.dirty.stages = m.dirty.clients = m.dirty.settings = true;
  },

  moveStage: function (m, a) {
    var i = m.stages.indexOf(stageName_(m, a.name));
    var j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= m.stages.length) return;
    var tmp = m.stages[i];
    m.stages[i] = m.stages[j];
    m.stages[j] = tmp;
    m.dirty.stages = true;
  },

  removeStage: function (m, a, me) {
    var name = stageName_(m, a.name);
    if (m.stages.length < 2) throw new Error('You need at least one stage.');
    var i = m.stages.indexOf(name);
    var fallback = m.stages[i > 0 ? i - 1 : 1];
    m.clients.forEach(function (c) { if (c.stage === name) setStage_(m, c, fallback, me, false); });
    m.stages.splice(i, 1);
    if (m.restartStage === name) m.restartStage = fallback;
    m.dirty.stages = m.dirty.settings = true;
  },

  setRestartStage: function (m, a) {
    m.restartStage = stageName_(m, a.name);
    m.dirty.settings = true;
  },

  addAccountant: function (m, a) {
    accountantName_(m, required_(a.name, 'Accountant name'));
  },

  renameAccountant: function (m, a) {
    var from = findName_(m.accountants, a.from);
    if (!from) throw new Error('That accountant no longer exists.');
    var to = required_(a.to, 'Accountant name');
    var clash = findName_(m.accountants, to);
    if (clash && clash !== from) throw new Error('There is already an accountant called "' + to + '".');
    m.accountants = m.accountants.map(function (x) { return x === from ? to : x; });
    m.clients.forEach(function (c) { if (c.accountant === from) c.accountant = to; });
    m.dirty.accountants = m.dirty.clients = true;
  },

  removeAccountant: function (m, a) {
    var name = findName_(m.accountants, a.name);
    if (!name) return;
    m.accountants = m.accountants.filter(function (x) { return x !== name; });
    m.clients.forEach(function (c) { if (c.accountant === name) c.accountant = ''; });
    m.dirty.accountants = m.dirty.clients = true;
  },

  // Replaces everything with the contents of a backup file.
  importAll: function (m, a, me) {
    var d = a.data || {};
    var stages = uniqueNames_(d.stages);
    if (!stages.length) throw new Error('The backup has no stages.');
    m.stages = stages;
    m.accountants = uniqueNames_(d.accountants);
    m.restartStage = findName_(stages, d.restartStage) || stages[0];
    m.clients = [];
    m.notes = [];
    m.history = [];
    m.tasks = [];
    m.checks = [];
    if (Array.isArray(d.template)) m.template = uniqueNames_(d.template);
    var now = nowIso_();
    (Array.isArray(d.clients) ? d.clients : []).forEach(function (x) {
      if (!x) return;
      var business = clean_(x.business) || clean_(x.name);
      if (!business) return;
      var c = {
        id: newId_(),
        business: business,
        name: clean_(x.business) ? clean_(x.name) : '',
        accountant: accountantName_(m, x.accountant),
        stage: findName_(stages, x.stage) || stages[0],
        monthly: !!x.monthly,
        recurDay: day_(x.recurDay),
        enteredAt: iso_(x.enteredAt) || now,
        createdAt: iso_(x.createdAt) || iso_(x.enteredAt) || now,
        lastRecurAt: iso_(x.lastRecurAt) || (x.monthly ? now : ''),
        updatedAt: now,
        updatedBy: me
      };
      m.clients.push(c);
      (Array.isArray(x.notes) ? x.notes : []).forEach(function (n) {
        if (!n || !clean_(n.text)) return;
        m.notes.push({ id: newId_(), clientId: c.id, business: c.business, date: iso_(n.date) || now,
          author: clean_(n.author), text: String(n.text).trim() });
      });
      (Array.isArray(x.history) ? x.history : []).forEach(function (h) {
        if (!h || !iso_(h.date)) return;
        m.history.push({ clientId: c.id, business: c.business, stage: clean_(h.stage) || c.stage,
          date: iso_(h.date), by: clean_(h.by), auto: !!h.auto });
      });
      var taskIds = {};
      (Array.isArray(x.tasks) ? x.tasks : []).forEach(function (t) {
        var name = clean_(t && t.name);
        if (!name) return;
        var task = addTaskRow_(m, c, name);
        if (t.id) taskIds[t.id] = task;
      });
      var checks = x.checks && typeof x.checks === 'object' ? x.checks : {};
      Object.keys(checks).forEach(function (key) {
        var parts = key.split('|'), task = taskIds[parts[0]], month = monthKey_(parts[1]);
        if (!task || !month) return;
        var info = Array.isArray(checks[key]) ? checks[key] : [];
        m.checks.push({ clientId: c.id, business: c.business, taskId: task.id, task: task.name, month: month,
          by: clean_(info[0]), date: iso_(info[1]) || now });
      });
    });
    TABLE_ORDER.forEach(function (k) { m.dirty[k] = true; });
  },

  // ---------- Monthly checklists ----------

  toggleCheck: function (m, a, me) {
    var c = client_(m, a.clientId);
    var t = task_(m, c, a.taskId);
    var month = monthKey_(a.month);
    if (!month) throw new Error('That month is not valid.');
    var idx = -1;
    for (var i = 0; i < m.checks.length; i++) {
      var k = m.checks[i];
      if (k.clientId === c.id && k.taskId === t.id && k.month === month) { idx = i; break; }
    }
    if (a.done && idx === -1) {
      var added = { clientId: c.id, business: c.business, taskId: t.id, task: t.name, month: month, by: me,
        date: nowIso_() };
      m.checks.push(added);
      m.checkAdds.push(added);
    } else if (!a.done && idx !== -1) {
      var removed = m.checks.splice(idx, 1)[0];
      m.checkDels.push(removed.row);
    }
  },

  addTask: function (m, a) {
    var c = client_(m, a.clientId);
    var name = required_(a.name, 'Task name');
    if (findName_(clientTaskNames_(m, c), name)) throw new Error('This client already has "' + name + '".');
    addTaskRow_(m, c, name);
  },

  renameTask: function (m, a) {
    var c = client_(m, a.clientId);
    var t = task_(m, c, a.taskId);
    var name = required_(a.name, 'Task name');
    var clash = findName_(clientTaskNames_(m, c), name);
    if (clash && clash !== t.name) throw new Error('This client already has "' + name + '".');
    t.name = name;
    m.checks.forEach(function (k) { if (k.taskId === t.id) k.task = name; });
    m.dirty.tasks = m.dirty.checks = true;
  },

  moveTask: function (m, a) {
    var c = client_(m, a.clientId);
    var t = task_(m, c, a.taskId);
    var mine = m.tasks.filter(function (x) { return x.clientId === c.id; });
    var i = mine.indexOf(t), j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= mine.length) return;
    // Swap the two tasks' positions in the full list.
    var ai = m.tasks.indexOf(mine[i]), aj = m.tasks.indexOf(mine[j]);
    m.tasks[ai] = mine[j];
    m.tasks[aj] = mine[i];
    m.dirty.tasks = true;
  },

  removeTask: function (m, a) {
    var c = client_(m, a.clientId);
    var t = task_(m, c, a.taskId);
    m.tasks = m.tasks.filter(function (x) { return x !== t; });
    m.checks = m.checks.filter(function (k) { return k.taskId !== t.id; });
    m.dirty.tasks = m.dirty.checks = true;
  },

  // Adds any template items the client doesn't have yet.
  applyTemplate: function (m, a) {
    var c = client_(m, a.clientId);
    var names = clientTaskNames_(m, c);
    m.template.forEach(function (name) { if (!findName_(names, name)) addTaskRow_(m, c, name); });
  },

  // Gives the template to every client that has no checklist yet.
  applyTemplateAll: function (m) {
    var count = 0;
    m.clients.forEach(function (c) {
      if (clientTaskNames_(m, c).length) return;
      m.template.forEach(function (name) { addTaskRow_(m, c, name); });
      count++;
    });
    m.result = { clients: count };
  },

  setTemplate: function (m, a) {
    m.template = uniqueNames_(a.tasks);
    m.dirty.template = true;
  },

  /**
   * Reads a workbook laid out like the old per-client checklist sheets: one
   * tab per client with the business name at the top, a row of month names
   * (Jan..Dec), task names down the first column with checkboxes under each
   * month, and an optional "Additional Notes" section. A tab whose name
   * contains "template" becomes the Checklist Template. Tabs are matched to
   * clients by business name; unknown ones are added as new clients.
   * Running it again only adds what is missing.
   */
  importChecklists: function (m, a, me) {
    var year = parseInt(a.year, 10);
    if (!(year > 2000 && year < 2100)) throw new Error('Please choose a year.');
    var url = clean_(a.url);
    if (!url) throw new Error('Please paste the link to the Google Sheet.');
    var src;
    try {
      src = /^https?:/i.test(url) ? SpreadsheetApp.openByUrl(url) : SpreadsheetApp.openById(url);
    } catch (e) {
      throw new Error('Could not open that Google Sheet. Check the link, and that your account can open it. ' +
        '(Details from Google: ' + e.message + ')');
    }
    if (src.getId() === m.ss.getId()) throw new Error('That link is this tracker\'s own Sheet. Paste the link to your old checklist workbook.');

    var summary = { tabs: 0, created: [], matched: [], checks: 0, tasks: 0, notes: 0, template: 0, skipped: [] };
    src.getSheets().forEach(function (sh) {
      var parsed = parseChecklistTab_(sh.getDataRange().getValues());
      if (!parsed) { summary.skipped.push(sh.getName()); return; }
      summary.tabs++;

      if (/template/i.test(sh.getName())) {
        m.template = uniqueNames_(parsed.tasks.map(function (t) { return t.name; }));
        m.dirty.template = true;
        summary.template = m.template.length;
        return;
      }

      var business = parsed.title || clean_(sh.getName());
      var c = null;
      for (var i = 0; i < m.clients.length; i++) {
        if (m.clients[i].business.toLowerCase() === business.toLowerCase()) { c = m.clients[i]; break; }
      }
      if (c) {
        summary.matched.push(c.business);
      } else {
        var now = nowIso_();
        c = { id: newId_(), business: business, name: '', accountant: '', stage: m.restartStage, monthly: true,
          recurDay: 1, enteredAt: now, createdAt: now, lastRecurAt: now, updatedAt: now, updatedBy: me };
        m.clients.push(c);
        m.history.push({ clientId: c.id, business: c.business, stage: c.stage, date: now, by: me, auto: false });
        m.dirty.clients = m.dirty.history = true;
        summary.created.push(business);
      }

      // A client nobody has ticked anything for yet takes the workbook's list
      // as-is (dropping template items it doesn't use); otherwise merge.
      var hasChecks = m.checks.some(function (k) { return k.clientId === c.id; });
      if (!hasChecks) {
        m.tasks = m.tasks.filter(function (t) { return t.clientId !== c.id; });
        m.dirty.tasks = true;
      }
      var names = clientTaskNames_(m, c);
      parsed.tasks.forEach(function (row) {
        var existing = findName_(names, row.name);
        var task = existing ? m.tasks.filter(function (t) { return t.clientId === c.id && t.name === existing; })[0]
          : addTaskRow_(m, c, row.name);
        if (!existing) { names.push(task.name); summary.tasks++; }
        row.months.forEach(function (mi) {
          var month = year + '-' + (mi < 9 ? '0' : '') + (mi + 1);
          var have = m.checks.some(function (k) { return k.taskId === task.id && k.month === month; });
          if (have) return;
          var added = { clientId: c.id, business: c.business, taskId: task.id, task: task.name, month: month,
            by: 'Imported', date: nowIso_() };
          m.checks.push(added);
          m.checkAdds.push(added);
          summary.checks++;
        });
      });

      parsed.notes.forEach(function (text) {
        var dup = m.notes.some(function (n) { return n.clientId === c.id && n.text === text; });
        if (!dup) { addNoteRow_(m, c, text, 'Imported'); summary.notes++; }
      });
    });
    if (!summary.tabs) {
      throw new Error('No checklist tabs were found in that Sheet. Each tab needs a row with the month names ' +
        '(Jan, Feb, Mar …) above the list of tasks.');
    }
    m.result = summary;
  }
};

var MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Understands one tab of the old checklist workbook. Returns null if the tab
// doesn't look like a checklist.
function parseChecklistTab_(values) {
  var headerRow = -1, monthCols = {};
  for (var r = 0; r < Math.min(values.length, 15) && headerRow === -1; r++) {
    var cols = {}, found = 0;
    for (var c = 0; c < values[r].length; c++) {
      var idx = MONTH_ABBR.indexOf(clean_(values[r][c]).slice(0, 3).toLowerCase());
      if (idx !== -1 && clean_(values[r][c]).length <= 9) { cols[c] = idx; found++; }
    }
    if (found >= 6) { headerRow = r; monthCols = cols; }
  }
  if (headerRow === -1) return null;

  // The task names are in the first column that isn't a month column.
  var taskCol = 0;
  while (taskCol in monthCols) taskCol++;

  var title = '';
  for (r = 0; r < headerRow && !title; r++) {
    for (c = 0; c < values[r].length && !title; c++) title = clean_(values[r][c]);
  }

  var tasks = [];
  for (r = headerRow + 1; r < values.length; r++) {
    var name = clean_(values[r][taskCol]);
    if (!name || /^additional notes/i.test(name)) break;
    var months = [];
    Object.keys(monthCols).forEach(function (col) {
      if (values[r][col] === true || /^(true|x|✓|✔|yes)$/i.test(clean_(values[r][col]))) months.push(monthCols[col]);
    });
    tasks.push({ name: name, months: months });
  }

  var notes = [];
  for (r = headerRow + 1; r < values.length; r++) {
    if (!values[r].some(function (v) { return /^additional notes/i.test(clean_(v)); })) continue;
    for (var n = r + 1; n < values.length; n++) {
      var text = values[n].map(clean_).filter(Boolean).join(' ');
      if (text) notes.push(text);
    }
    break;
  }
  return { title: title, tasks: tasks, notes: notes };
}

// ============================================================================
// Monthly recurrence
//   On each monthly client's chosen day, the client moves back to the
//   restart stage. Runs whenever anyone opens the board or saves a change.
// ============================================================================

function lastOccurrence_(day, now) {
  var d = new Date(now.getFullYear(), now.getMonth(), day);
  if (d > now) d = new Date(now.getFullYear(), now.getMonth() - 1, day);
  return d;
}

function recurrenceDue_(c, now) {
  if (!c.monthly) return false;
  if (!c.lastRecurAt) return true;
  return new Date(c.lastRecurAt) < lastOccurrence_(c.recurDay, now);
}

function recurrencesDue_(m) {
  var now = new Date();
  return m.clients.some(function (c) { return recurrenceDue_(c, now); });
}

function runRecurrences_(m) {
  var now = new Date();
  var finalStage = m.stages[m.stages.length - 1];
  m.clients.forEach(function (c) {
    if (!recurrenceDue_(c, now)) return;
    if (c.lastRecurAt && c.stage !== m.restartStage) {
      var occ = lastOccurrence_(c.recurDay, now);
      if (c.stage !== finalStage) {
        addNoteRow_(m, c, 'Automatic monthly restart for ' + MONTHS[occ.getMonth()] + ' ' + occ.getFullYear() +
          '. This client was still in "' + c.stage + '", so check that the previous month was finished.', 'Automatic');
      }
      setStage_(m, c, m.restartStage, 'Automatic', true);
    }
    c.lastRecurAt = now.toISOString();
    m.dirty.clients = true;
  });
}

// ============================================================================
// Model helpers
// ============================================================================

function setStage_(m, c, stage, by, auto) {
  if (c.stage === stage) return;
  var now = nowIso_();
  c.stage = stage;
  c.enteredAt = now;
  m.history.push({ clientId: c.id, business: c.business, stage: stage, date: now, by: by, auto: !!auto });
  touch_(m, c, by);
  m.dirty.history = true;
}

function addNoteRow_(m, c, text, author) {
  m.notes.push({ id: newId_(), clientId: c.id, business: c.business, date: nowIso_(), author: author,
    text: String(text).trim() });
  m.dirty.notes = true;
}

function addTaskRow_(m, c, name) {
  var t = { clientId: c.id, business: c.business, id: newId_(), name: clean_(name) };
  m.tasks.push(t);
  m.dirty.tasks = true;
  return t;
}

function clientTaskNames_(m, c) {
  return m.tasks.filter(function (t) { return t.clientId === c.id; }).map(function (t) { return t.name; });
}

function task_(m, c, id) {
  for (var i = 0; i < m.tasks.length; i++) {
    if (m.tasks[i].id === id && m.tasks[i].clientId === c.id) return m.tasks[i];
  }
  throw new Error('That checklist item was removed by someone else. The board has been refreshed.');
}

// Turns a Date or text like "2026-8" / "2026-08" into "2026-08".
function monthKey_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2);
  var m = /^(\d{4})-(\d{1,2})$/.exec(clean_(v));
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2);
}

function touch_(m, c, me) {
  c.updatedAt = nowIso_();
  c.updatedBy = me;
  m.dirty.clients = true;
}

function client_(m, id) {
  for (var i = 0; i < m.clients.length; i++) if (m.clients[i].id === id) return m.clients[i];
  throw new Error('That client was deleted by someone else. The board has been refreshed.');
}

function stageName_(m, name) {
  var found = findName_(m.stages, name);
  if (!found) throw new Error('The stage "' + clean_(name) + '" no longer exists. The board has been refreshed.');
  return found;
}

// Returns the accountant's name as stored, adding it to the list if it's new.
function accountantName_(m, name) {
  name = clean_(name);
  if (!name) return '';
  var found = findName_(m.accountants, name);
  if (found) return found;
  m.accountants.push(name);
  m.dirty.accountants = true;
  return name;
}

function findName_(list, name) {
  name = clean_(name).toLowerCase();
  if (!name) return '';
  for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === name) return list[i];
  return '';
}

function uniqueNames_(list) {
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (n) {
    n = clean_(n);
    if (n && !findName_(out, n)) out.push(n);
  });
  return out;
}

function required_(v, label) {
  v = clean_(v);
  if (!v) throw new Error(label + ' is required.');
  return v;
}

function clean_(v) { return v == null ? '' : String(v).trim(); }
function day_(v) { var n = parseInt(v, 10); return n >= 1 && n <= 28 ? n : 1; }
function bool_(v) { return v === true || /^(true|yes|y|1|x)$/i.test(clean_(v)); }
function nowIso_() { return new Date().toISOString(); }
function newId_() { return Utilities.getUuid().slice(0, 8); }

function iso_(v) {
  if (!v) return '';
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function userEmail_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function isDirty_(m) {
  return m.checkAdds.length > 0 || m.checkDels.length > 0 || TABLE_ORDER.some(function (k) { return m.dirty[k]; });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function bumpRev_() {
  PropertiesService.getScriptProperties().setProperty('rev', String(Date.now()));
}

function friendlyError_(e) {
  var raw = (e && e.message) || String(e);
  var msg = raw;
  if (/authoriz/i.test(raw)) {
    msg = 'Google needs you to approve this app. If you are signed in to more than one Google account, ' +
      'open the link in an incognito/private window and sign in with only the account that has the Sheet. ' +
      'The Sheet\'s owner can also open Extensions → Apps Script, choose "setup" and click Run.';
  } else if (/do not have permission|don't have permission|access denied|not have access/i.test(raw)) {
    msg = 'You don\'t have edit access to the Google Sheet. Ask the owner to share it with you as an Editor.';
  } else if (/lock/i.test(raw) && /timeout|timed out/i.test(raw)) {
    msg = 'The tracker is busy right now. Please try again in a moment.';
  }
  if (msg !== raw) msg += ' (Details from Google: ' + raw + ')';
  return new Error(msg);
}

// ============================================================================
// Reading and writing the sheet
// ============================================================================

function loadModel_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('This script is not attached to a Google Sheet. Open your Google Sheet, choose ' +
      'Extensions → Apps Script, and paste the code there (see SETUP.md).');
  }
  ensureSheets_(ss);
  // checkAdds / checkDels let a single tick be saved without rewriting the
  // whole Checklist tab, which grows every month.
  var m = { ss: ss, dirty: {}, checkAdds: [], checkDels: [] };
  var now = nowIso_();

  m.stages = uniqueNames_(readRows_(ss, 'stages').map(function (r) { return r[0]; }));
  if (!m.stages.length) { m.stages = DEFAULT_STAGES.slice(); m.dirty.stages = true; }
  m.accountants = uniqueNames_(readRows_(ss, 'accountants').map(function (r) { return r[0]; }));

  var settings = {};
  readRows_(ss, 'settings').forEach(function (r) { if (clean_(r[0])) settings[clean_(r[0])] = r[1]; });
  m.restartStage = findName_(m.stages, settings[RESTART_SETTING]) || m.stages[0];

  var ids = {};
  m.clients = readRows_(ss, 'clients').map(function (r) {
    return {
      id: clean_(r[0]), business: clean_(r[1]), name: clean_(r[2]), accountant: clean_(r[3]), stage: clean_(r[4]),
      monthly: bool_(r[5]), recurDay: day_(r[6]), enteredAt: iso_(r[7]), createdAt: iso_(r[8]),
      lastRecurAt: iso_(r[9]), updatedAt: iso_(r[10]), updatedBy: clean_(r[11])
    };
  }).filter(function (c) { return c.id || c.business || c.name; });

  // Tidy up rows that were added or edited by hand in the sheet.
  m.clients.forEach(function (c) {
    if (!c.id || ids[c.id]) { c.id = newId_(); m.dirty.clients = true; }
    ids[c.id] = true;
    if (!c.business) { c.business = c.name; c.name = ''; m.dirty.clients = true; }
    var stage = findName_(m.stages, c.stage) || m.stages[0];
    if (stage !== c.stage) { c.stage = stage; m.dirty.clients = true; }
    if (c.accountant) {
      var acc = accountantName_(m, c.accountant);
      if (acc !== c.accountant) { c.accountant = acc; m.dirty.clients = true; }
    }
    if (!c.enteredAt) { c.enteredAt = now; m.dirty.clients = true; }
    if (!c.createdAt) { c.createdAt = c.enteredAt; m.dirty.clients = true; }
  });

  m.notes = readRows_(ss, 'notes').map(function (r) {
    return { id: clean_(r[0]), clientId: clean_(r[1]), business: clean_(r[2]), date: iso_(r[3]) || now,
      author: clean_(r[4]), text: r[5] == null ? '' : String(r[5]).trim() };
  }).filter(function (n) { return n.text && ids[n.clientId]; });
  m.notes.forEach(function (n) { if (!n.id) { n.id = newId_(); m.dirty.notes = true; } });

  m.history = readRows_(ss, 'history').map(function (r) {
    return { clientId: clean_(r[0]), business: clean_(r[1]), stage: clean_(r[2]), date: iso_(r[3]),
      by: clean_(r[4]), auto: bool_(r[5]) };
  }).filter(function (h) { return h.date && ids[h.clientId]; });

  m.template = uniqueNames_(readRows_(ss, 'template').map(function (r) { return r[0]; }));

  var taskIds = {};
  m.tasks = readRows_(ss, 'tasks').map(function (r) {
    return { clientId: clean_(r[0]), business: clean_(r[1]), id: clean_(r[2]), name: clean_(r[3]) };
  }).filter(function (t) { return t.name && ids[t.clientId]; });
  m.tasks.forEach(function (t) {
    if (!t.id || taskIds[t.id]) { t.id = newId_(); m.dirty.tasks = true; }
    taskIds[t.id] = t;
  });

  m.checks = [];
  readRows_(ss, 'checks').forEach(function (r, i) {
    var k = { clientId: clean_(r[0]), business: clean_(r[1]), taskId: clean_(r[2]), task: clean_(r[3]),
      month: monthKey_(r[4]), by: clean_(r[5]), date: iso_(r[6]) || now, row: i + 2 };
    if (!k.clientId && !k.taskId) return; // blank row
    var t = taskIds[k.taskId];
    if (!k.month || !t || t.clientId !== k.clientId) { m.dirty.checks = true; return; } // leftover row
    m.checks.push(k);
  });

  return m;
}

function saveModel_(m) {
  if (!isDirty_(m)) return;
  var stageOrder = {};
  m.stages.forEach(function (s, i) { stageOrder[s] = i; });
  var byDate = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; };

  var rows = {
    clients: function () {
      return m.clients.slice().sort(function (a, b) {
        return (stageOrder[a.stage] - stageOrder[b.stage]) ||
          a.business.toLowerCase().localeCompare(b.business.toLowerCase());
      }).map(function (c) {
        return [txt_(c.id), txt_(c.business), txt_(c.name), txt_(c.accountant), txt_(c.stage), !!c.monthly,
          c.recurDay, date_(c.enteredAt), date_(c.createdAt), date_(c.lastRecurAt), date_(c.updatedAt),
          txt_(c.updatedBy)];
      });
    },
    notes: function () {
      return m.notes.slice().sort(byDate).map(function (n) {
        return [txt_(n.id), txt_(n.clientId), txt_(n.business), date_(n.date), txt_(n.author), txt_(n.text)];
      });
    },
    history: function () {
      return m.history.slice().sort(byDate).map(function (h) {
        return [txt_(h.clientId), txt_(h.business), txt_(h.stage), date_(h.date), txt_(h.by), !!h.auto];
      });
    },
    stages: function () { return m.stages.map(function (s) { return [txt_(s)]; }); },
    accountants: function () {
      return m.accountants.slice().sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); })
        .map(function (a) { return [txt_(a)]; });
    },
    settings: function () { return [[RESTART_SETTING, txt_(m.restartStage)]]; },
    tasks: function () {
      return m.tasks.map(function (t) { return [txt_(t.clientId), txt_(t.business), txt_(t.id), txt_(t.name)]; });
    },
    checks: function () {
      return m.checks.slice().sort(function (a, b) {
        return a.month < b.month ? -1 : a.month > b.month ? 1 : a.business.toLowerCase().localeCompare(b.business.toLowerCase());
      }).map(checkRow_);
    },
    template: function () { return m.template.map(function (t) { return [txt_(t)]; }); }
  };

  TABLE_ORDER.forEach(function (k) {
    if (m.dirty[k]) writeTable_(m.ss, k, rows[k]());
  });
  if (!m.dirty.checks) saveCheckChanges_(m);
  m.dirty = {};
  m.checkAdds = [];
  m.checkDels = [];
  bumpRev_();
}

function checkRow_(k) {
  return [txt_(k.clientId), txt_(k.business), txt_(k.taskId), txt_(k.task), txt_(k.month), txt_(k.by), date_(k.date)];
}

// Saves ticked and unticked boxes by adding and deleting single rows.
function saveCheckChanges_(m) {
  var sh = m.ss.getSheetByName(TABLES.checks.sheet);
  var dels = m.checkDels.filter(Boolean).sort(function (a, b) { return b - a; });
  dels.forEach(function (row) {
    if (sh.getMaxRows() <= 2) sh.insertRowsAfter(sh.getMaxRows(), 1);
    sh.deleteRow(row);
  });
  // A box ticked and unticked in the same save has no row yet and needs nothing.
  var adds = m.checkAdds.filter(function (k) { return m.checks.indexOf(k) !== -1; });
  if (!adds.length) return;
  var start = sh.getLastRow() + 1;
  var needed = start + adds.length - 1;
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());
  sh.getRange(start, 1, adds.length, TABLES.checks.headers.length).setValues(adds.map(checkRow_));
}

// The page gets checkmarks for this year and last year; `allYears` is for backups.
function stateOf_(m, allYears) {
  var notesBy = {}, historyBy = {}, tasksBy = {}, checksBy = {};
  var fromMonth = (new Date().getFullYear() - 1) + '-01';
  m.tasks.forEach(function (t) {
    (tasksBy[t.clientId] = tasksBy[t.clientId] || []).push({ id: t.id, name: t.name });
  });
  m.checks.forEach(function (k) {
    if (!allYears && k.month < fromMonth) return;
    (checksBy[k.clientId] = checksBy[k.clientId] || {})[k.taskId + '|' + k.month] = [k.by, k.date];
  });
  m.notes.forEach(function (n) {
    (notesBy[n.clientId] = notesBy[n.clientId] || []).push({ id: n.id, date: n.date, author: n.author, text: n.text });
  });
  m.history.forEach(function (h) {
    (historyBy[h.clientId] = historyBy[h.clientId] || []).push({ stage: h.stage, date: h.date, by: h.by, auto: h.auto });
  });
  return {
    rev: getRev(),
    me: userEmail_(),
    sheetUrl: m.ss.getUrl(),
    stages: m.stages,
    accountants: m.accountants,
    restartStage: m.restartStage,
    template: m.template,
    checksFrom: allYears ? '' : fromMonth,
    clients: m.clients.map(function (c) {
      return {
        id: c.id, business: c.business, name: c.name, accountant: c.accountant, stage: c.stage,
        monthly: c.monthly, recurDay: c.recurDay, enteredAt: c.enteredAt, createdAt: c.createdAt,
        lastRecurAt: c.lastRecurAt, updatedAt: c.updatedAt, updatedBy: c.updatedBy,
        notes: notesBy[c.id] || [],
        history: historyBy[c.id] || [],
        tasks: tasksBy[c.id] || [],
        checks: checksBy[c.id] || {}
      };
    })
  };
}

// A leading apostrophe stores text exactly as typed (so "=..." or "0012"
// are never turned into formulas or numbers). It isn't shown in the sheet.
function txt_(v) { v = v == null ? '' : String(v); return v ? "'" + v : ''; }
function date_(iso) { return iso ? new Date(iso) : ''; }

function readRows_(ss, key) {
  var t = TABLES[key];
  var sh = ss.getSheetByName(t.sheet);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, t.headers.length).getValues();
}

function writeTable_(ss, key, rows) {
  var t = TABLES[key];
  var sh = ss.getSheetByName(t.sheet);
  var width = t.headers.length;
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (!rows.length) return;
  var needed = rows.length + 1;
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());
  sh.getRange(2, 1, rows.length, width).setValues(rows);
}

function ensureSheets_(ss) {
  var created = false;
  TABLE_ORDER.forEach(function (key) {
    var t = TABLES[key];
    if (ss.getSheetByName(t.sheet)) return;
    var sh = ss.insertSheet(t.sheet);
    created = true;
    sh.getRange(1, 1, 1, t.headers.length).setValues([t.headers]).setFontWeight('bold').setBackground('#e8eef8');
    sh.setFrozenRows(1);
    (t.dateCols || []).forEach(function (col) {
      sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd h:mm am/pm');
    });
    Object.keys(t.widths || {}).forEach(function (col) { sh.setColumnWidth(Number(col), t.widths[col]); });
    if (t.wrapCol) sh.getRange(2, t.wrapCol, sh.getMaxRows() - 1, 1).setWrap(true);
    if (key === 'stages') {
      sh.getRange(2, 1, DEFAULT_STAGES.length, 1).setValues(DEFAULT_STAGES.map(function (s) { return [s]; }));
    }
    if (key === 'settings') sh.getRange(2, 1, 1, 2).setValues([[RESTART_SETTING, DEFAULT_STAGES[0]]]);
    if (key === 'template') {
      sh.getRange(2, 1, DEFAULT_TEMPLATE.length, 1).setValues(DEFAULT_TEMPLATE.map(function (s) { return [s]; }));
    }
  });
  if (created) {
    // Remove the empty starter tab that comes with a new spreadsheet.
    ['Sheet1', 'Sheet 1'].forEach(function (n) {
      var blank = ss.getSheetByName(n);
      if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
    });
  }
}
