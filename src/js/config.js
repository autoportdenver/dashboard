'use strict';

// ══════════════════════════════════════════════
//  CONFIG — src/js/config.js
//  All environment constants in one place.
//  Drive IDs are the only data source — no local files.
// ══════════════════════════════════════════════

// ── Google OAuth 2.0 ──
const GOOGLE_CLIENT_ID = '340123477262-1ik6ki43bqudvvthnrqiem08gdu90q48.apps.googleusercontent.com';

// ── Google Drive file/folder IDs ──
const FILE_IDS = {
  salesLog:   '1Pfwl5RmIelMycQkOmy7bN3Po394qTxf0',  // Sales - Live.xlsx
  accounting: '1MBajUUBQpBy-QxdfkejKxFuVk3pTS9dK',  // Accounting Package.xlsx
  dashboard:  '11dyCxDx1iEc4v-k0oPzHV0GgsVFJKOXU',
};
const FOLDER_IDS = {
  dealDetail:        '1gaaZ5UxGrm1nW23SHXXf-dFkLvc_dJm8',
  dealPayments:      '1RnyD-0MSphr9b9NnbSdlJa_cgcQPnAcz',
  itemizedCosts:     '1skBt9ltZRx0M7srOFtdShm-FGmHjppM0',
  loanPayments:      '1E4oAlHAA7tj6ub4SsRQA3IbXYi6oJX4Y',
  inventory:         '19xfbNjgL5R71FgFUyDQ5M_wDoLwF5Pp5',
  leads:             '1MuOT0tv8PcKEMoJbDKWJ_e7znrb8MGIT',
  westlakePaidUnits: '1q3DbxXU2fpE8JVI78RYShkqkULYa2KQ2',  // Westlake / Paid Units Report sub-folder
  dtsReports:        '1-dLxtYiBodwsvR2JXtL08IbIdR895jFF',  // Module Reports - Title Transfers
};

// Drive name-search patterns (files found by name, not folder)
const FILE_NAME_PATTERNS = {
  salesLive:    'Sales - Live',
  chase9532:    'Chase9532',
  chaseDebit:   'Chase Debit',
  chaseCredit:  'Chase Credit',
  warranty:     'Warranty Remittance',
  titlesReport: 'Sold Inventory - Title Report',
};

// ── Business constants ──
const AUCTIONS  = ['dealers auto auction', 'manheim', 'carmax', 'loveland', 'adesa', 'iaai'];
const KNOWN_SPS = ['joseph', 'kris', 'felix'];

// ── Chart of Accounts ──
const CHART_OF_ACCOUNTS = [
  '— Income —',
  'Vehicle Sales Revenue', 'BHPH Collections', 'Finance Reserve',
  'Doc Fees / Dealer Fees', 'Warranty Revenue', 'Other Income',
  '— COGS —',
  'Vehicle Purchases', 'Auction Fees & Buyer Fees', 'Reconditioning / Recon',
  'Floorplan Principal', 'Transfer Fees & Titles',
  '— Operating Expenses —',
  'Advertising & Marketing', 'Bank Charges & Fees', 'Fuel & Transportation',
  'Insurance', 'License & Registration', 'Office Supplies',
  'Payroll & Benefits', 'Professional Fees', 'Rent & Utilities',
  'Repairs & Maintenance', 'Sales Tax Remittance', 'Taxes & Licenses',
  'Warranty Remittance', 'Floorplan Interest', 'Miscellaneous',
  '— Transfers —',
  'Owner Draw / Distribution', 'Interaccount Transfer',
];
