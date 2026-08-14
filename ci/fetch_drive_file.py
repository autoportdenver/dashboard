#!/usr/bin/env python3
"""
fetch_drive_file.py -- download one file from Google Drive using Application
Default Credentials (ADC).

This is auth-agnostic: it works whether the credentials were set up by
Workload Identity Federation (keyless) or by a service-account JSON key, because
google-github-actions/auth writes ADC to GOOGLE_APPLICATION_CREDENTIALS either
way and google.auth.default() picks it up.

The workbook lives on a Shared Drive, so the download passes
supportsAllDrives=True. The service account (or WIF-impersonated identity) must
be a member of that Shared Drive, or have the file shared with it, as Viewer.

Env:
    DRIVE_FILE_ID   (required)  the Drive file ID of the AP Acct Pckg .xlsx
    OUT             (optional)  output path (default: ./workbook.xlsx)
"""
import io, os, sys

try:
    from google.auth import default
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
except ImportError:
    sys.exit("Missing deps: pip install google-api-python-client google-auth")

file_id = os.environ.get("DRIVE_FILE_ID")
if not file_id:
    sys.exit("ERROR: DRIVE_FILE_ID is not set.")
out = os.environ.get("OUT", "workbook.xlsx")

# Read-only Drive scope; ADC comes from the auth step (WIF or SA key).
creds, _ = default(scopes=["https://www.googleapis.com/auth/drive.readonly"])
svc = build("drive", "v3", credentials=creds, cache_discovery=False)

# The package is a real .xlsx (binary), so get_media downloads the bytes
# directly. (A native Google Sheet would need files().export_media instead.)
req = svc.files().get_media(fileId=file_id, supportsAllDrives=True)

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
buf = io.FileIO(out, "wb")
downloader = MediaIoBaseDownload(buf, req, chunksize=8 * 1024 * 1024)
done = False
while not done:
    status, done = downloader.next_chunk()
    if status:
        print("  downloading... %d%%" % int(status.progress() * 100))
buf.close()
print("downloaded", out, os.path.getsize(out), "bytes")
