# Rally file format (version 1)

A rally file holds one rally: the Setup details, the table of Route Instructions with their sign images, and the run state (what is complete, and the Time Allowances). It does not hold page photos, page copies, band data, the API key, preferences, or anything about how the pages were read.

This document is enough to write or read a rally file without the app. DESIGN.md describes what the app does with a file; this file describes the file.

## Container

- A standard zip archive. The extension is `.rally`; a file still named `.zip` also loads, because the app recognises a file by its contents.
- `rally.json` at the root of the archive is required. Everything else is optional.
- Sign images are separate entries. The app writes them as `signs/0001.jpg`, `signs/0002.jpg`, and so on, but any path works as long as `rally.json` refers to it.
- Entries may be stored (no compression) or deflate-compressed. The app writes them stored. Any other compression method, ZIP64, encryption, and a zip split over several files are rejected.
- The order of entries does not matter. Entries that `rally.json` does not refer to are ignored.
- Paths are matched exactly and are case-sensitive. A backslash in an entry name is read as `/`, and a leading `./` or `/` is ignored.
- Limits: the whole file at most 50 MB (a larger file is refused before it is read), one entry at most 20 MB uncompressed, and all images together at most 100 MB uncompressed.
- The app saves the file with the type `application/octet-stream`, so that no browser renames it to `.zip`.

## `rally.json`

UTF-8 JSON, one object. Unknown fields are ignored at every level, so adding an optional field never changes `version`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always `"rally-monte-style"`. |
| `version` | integer | yes | `1`. A larger number is rejected, because it comes from a newer app. |
| `kind` | string | no | `"saved"`: a rally saved from the app, which opens on the Run screen. `"distributed"`: a rally prepared for others, which opens on Setup. A missing or unknown value opens on Setup (an unknown value also shows a notice). |
| `savedAt` | string | no | ISO 8601 date and time of the save. Informational. |
| `rally` | object | yes | The Setup details. |
| `ris` | list | yes | The Route Instructions, in table order. May be empty. |
| `ta` | list | no | The Time Allowances. Default: none. |

### `rally`

Every field is optional. A missing field takes its default. A value that fails the rule below is a content problem: it is left blank or set to its default, and the load notice lists it. The rules are the ones the Setup screen applies to a typed entry.

| Field | Type | Rule | Default |
|---|---|---|---|
| `id` | string | 1–64 characters from `A–Z a–z 0–9 _ -`, the first a letter or digit. Identifies the rally, so loading the same rally again can replace it. | none (the app makes one) |
| `name` | string | free text | empty |
| `date` | string | `YYYY-MM-DD` | the day of loading |
| `driver`, `navigator` | string | free text | empty |
| `passengers` | list of strings | non-string entries are dropped | none |
| `vehicle` | string | free text | empty |
| `carNumber` | number or string | empty, or a whole number 0–999. Empty counts as 0 minutes. | empty |
| `class` | string | `"A"`, `"B"`, `"C"`, `"D"`, or empty | none |
| `ocf` | number or string | greater than 0. VM = OM × OCF. | `1` |
| `closeLimitMi` | number or string | 0–5 (vehicle miles). Adjacent RIs this close are highlighted. | `0.5` |
| `speedometer` | number or string | 1–100 (mph), used for estimates | `35` |

### Items of `ris`

Each item is an object. The row order in the file is kept.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `ri` | number or string | no | The RI as printed (`12` or `"12A"`). A numeric string loads as a number. A missing or blank `ri` loads as a row with no RI, and the notice lists it. A second row with the same RI as an earlier one is dropped, and the notice lists it. |
| `om` | string | no | The official mileage as printed: `"5.94"`; a restart `"5.94/0.00"`; a restart at OM 0 `"/0.00"`. Missing or empty: the row has no OM. A number is read as its text. A value that is none of these is left blank. |
| `czt` | string | no | The checkpoint zero time: `"H:MM:SS"`, `"H:MM:SS.s"`, `"H:MM.cc"` (hundredths of a minute), or `"H:MM"`. Hours below 48. |
| `cp` | string or number | no | The checkpoint number. |
| `instruction` | string | no | The instruction text. A sign graphic is written `[sign: …]` in its place. Missing: it loads as empty, and the notice lists it. |
| `info` | string | no | The additional information. |
| `signs` | list of strings | no | Paths of this RI's sign images in the archive, in order. |
| `done` | boolean | no | The RI is complete. Default `false`. |
| `doneAt` | string | no | When it was completed, ISO 8601. |
| `ttDone` | string | no | The TT the row had when it was completed: CZT + car number minutes + Time Allowance, not wrapped at 24 hours. Nothing is computed from it. |
| `estLock` | string | no | The estimated TT locked when a row with no CZT was completed. A completed row shows this estimate instead of a live one. |

`ttDone` and `estLock` use `HH:MM:SS` with up to 3 decimal places on the seconds, unwrapped, hours `00`–`99` (for example `"27:05:10.5"`). A time of day past midnight keeps counting. A value that does not fit is left blank.

The run state is exactly what Clear run data clears: `done`, `doneAt`, `ttDone`, `estLock`, and the Time Allowances. A file with none of it is a rally nobody has run yet.

The file never contains bands, page references, or page images, and the reader ignores them if they appear.

### Items of `ta`

| Field | Type | Meaning |
|---|---|---|
| `ri` | number or string | The row the Time Allowance starts at. It applies from that row through the row before the next restart. |
| `ta` | string | `"m:ss"` (seconds 0–59) or whole seconds, 0 to `"90:00"`. |
| `at` | string | When it was entered, ISO 8601. Optional. |

An item whose `ri` matches no row, a second item for a RI that already has one, or an item with an invalid `ta`, is dropped and listed in the notice.

## Images

- A sign image is a JPEG or a PNG. The type is taken from the file's first bytes, not from its name.
- An image over 800 px on its long side is scaled down to 800 px and stored as JPEG at quality 0.85. A smaller image is stored as it is.
- An RI has 0, 1, or more sign images, in the order of its `signs` list. Display: when the number of images equals the number of `[sign: …]` tags in the instruction, each tag is replaced by its image in order; otherwise the images follow the text.
- A path that is missing from the archive, or an entry that is not a readable JPEG or PNG, is a content problem. The image is dropped, the file still loads, and Route flags the row (`RI n: k of m sign images`, or `RI n: no sign images`).

## What is rejected, and what only warns

A file is **rejected**, with a message naming the reason, and nothing on the device changes, when:

- it is not a zip archive (a JSON file gets its own message: an earlier version's JSON export, which this version cannot load);
- it is over 50 MB, uses ZIP64, encryption, a compression method other than stored or deflate, or fails a checksum;
- `rally.json` is missing, does not parse, or is not an object;
- `format` is not `"rally-monte-style"`;
- `version` is missing, not an integer, or higher than 1;
- `rally` is not an object, `ris` is not a list, or `ta` is present and not a list;
- an item of `ris` is not an object, or a `signs` is not a list of strings.

Everything else is a **content problem**. The file loads, the value is left blank, dropped, or defaulted as the tables above say, and one notice after the load lists what changed, by RI.

## Loading

- A file whose `rally.id` matches a rally on the device asks whether to replace that rally or keep both. Replace keeps the id. Keep both gives the loaded copy a new id and adds ` (2)` to its name (` (3)` and so on). With no `id`, or no match, the file loads as a new rally.
- The loaded rally becomes current. `"saved"` opens on Run; anything else opens on Setup.
- The run state in the file is loaded as written, whatever `kind` says.

## Example

`rally.json`:

```json
{
  "format": "rally-monte-style",
  "version": 1,
  "kind": "distributed",
  "rally": {
    "name": "Example Rally",
    "date": "2026-05-02",
    "driver": "Jane Driver",
    "navigator": "John Navigator",
    "carNumber": 7,
    "class": "C",
    "ocf": 1.01
  },
  "ris": [
    { "ri": 1, "om": "/0.00", "czt": "09:00:00", "cp": 1, "instruction": "Begin rally at START.", "done": true, "doneAt": "2026-05-02T16:00:05Z", "ttDone": "09:07:00" },
    { "ri": 2, "om": "0.31", "instruction": "R at SIGNAL." },
    { "ri": 3, "om": "1.62", "czt": "09:04:30", "cp": 2, "instruction": "CHECKPOINT at [sign: deer crossing].", "signs": ["signs/0001.png"] }
  ],
  "ta": [
    { "ri": 2, "ta": "1:05" }
  ]
}
```

## Building a file by hand

1. Write `rally.json` in a text editor, and put any sign images in a folder such as `signs/`.
2. Zip them with any zip tool, so that `rally.json` is at the top of the archive (not inside a folder) and the image paths in `rally.json` match the paths in the archive.
3. Rename the archive from `.zip` to `.rally`, or leave it as `.zip`.
4. In the app, open the Rallies tab and tap Load.
