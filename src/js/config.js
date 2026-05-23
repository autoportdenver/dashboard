'use strict';

// ══════════════════════════════════════════════
//  CONFIG — src/js/config.js
//  All environment constants in one place.
//  Drive IDs are kept here but only used by drive.js.
//  Local file paths are used by data.js when Drive is not available.
// ══════════════════════════════════════════════

// ── Google Drive MCP tool identifiers ──
const DRIVE_READ   = 'mcp__d97b1518-9016-4011-a420-7ec2458ff224__read_file_content';
const DRIVE_SEARCH = 'mcp__d97b1518-9016-4011-a420-7ec2458ff224__search_files';

// ── Google Drive file/folder IDs ──
const FILE_IDS = {
  salesLog:   '1Pfwl5RmIelMycQkOmy7bN3Po394qTxf0',
  accounting: '1MBajUUBQpBy-QxdfkejKxFuVk3pTS9dK',
  dashboard:  '11dyCxDx1iEc4v-k0oPzHV0GgsVFJKOXU',
};
const FOLDER_IDS = {
  dealDetail:    '1gaaZ5UxGrm1nW23SHXXf-dFkLvc_dJm8',
  dealPayments:  '1RnyD-0MSphr9b9NnbSdlJa_cgcQPnAcz',
  itemizedCosts: '1skBt9ltZRx0M7srOFtdShm-FGmHjppM0',
  loanPayments:  '1E4oAlHAA7tj6ub4SsRQA3IbXYi6oJX4Y',
  inventory:     '19xfbNjgL5R71FgFUyDQ5M_wDoLwF5Pp5',
  leads:         '1MuOT0tv8PcKEMoJbDKWJ_e7znrb8MGIT',
};
// Drive name-search patterns (files found by name, not folder)
const FILE_NAME_PATTERNS = {
  salesLive:   'Sales - Live',
  chase9532:   'Chase9532',
  chaseDebit:  'Chase Debit',
  chaseCredit: 'Chase Credit',
  warranty:    'Warranty Remittance',
};

// ── Local file paths (src/uploads/) ── TODO
// Place exported CSVs here. Set a key to null to skip local loading for that source.
const LOCAL_FILES = {
  inventory:     'src/uploads/inventory.csv',
  dealDetail:    'src/uploads/deal_detail.csv',
  itemizedCosts: 'src/uploads/itemized_costs.csv',
  dealPayments:  'src/uploads/deal_payments.csv',
  loanPayments:  'src/uploads/loan_payments.csv',
  leads:         'src/uploads/leads.csv',
  salesLog:      'src/uploads/Sales-Live.xlsx',   // flat export of Sales - Live sheet
  accounting:    'src/uploads/accounting.txt',   // flat text export of Accounting Package
  chase9532:     'src/uploads/ChaseBank/Checking/Chase9532_Activity_20260505.CSV',
  chaseDebit:    'src/uploads/chase_debit.csv',
  chaseCredit:   'src/uploads/chase_credit.csv',
  warranty:      'src/uploads/Warranties/26 05 05 - Warranties Report.xls',
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
