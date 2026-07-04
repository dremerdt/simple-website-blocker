# Simple Website Blocker

Simple Website Blocker is a Chromium extension for blocking distracting websites from the toolbar popup or the extension options page.

## Features

* Block a full domain, including its subdomains.
* Block a specific URL.
* Create permanent, temporary, or weekly scheduled blocks.
* Create reusable named weekly schedules from the options page.
* Pause, resume, edit, delete, and search blocked entries from the options page.
* Automatically refreshes active rules for temporary expiry and schedule transitions.

## Usage

1. Load the extension as an unpacked extension from `chrome://extensions`.
2. Open the toolbar popup.
3. Choose `Domain` or `URL`.
4. Choose `Permanent`, `Temporary`, or `Scheduled`.
5. Enter the target and select `Block`.

Use the extension options page to edit entries, build named weekly schedules, filter the list, or clear expired temporary blocks. The popup can assign a scheduled block by selecting one of those schedule names.

## Notes

Temporary blocks are kept in the list after expiry with an `Expired` status, so they can be reviewed or cleared later.
Scheduled blocks use the browser's local time. Overnight schedules such as `22:00-06:00` are supported.
