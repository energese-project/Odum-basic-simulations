# The program archive

Each program here is a BASIC listing from the systems-ecology literature — or a
worked example of one — kept so that anyone can run it and check it against the
source it came from.

**Every program is two files:**

```
programs/
  charge-discharge.bas     the listing, exactly as it should run
  charge-discharge.json    where it came from, and how faithfully
```

That is the whole structure. There is no index to update: the build finds the
files, checks them, and publishes both at
`https://energese-project.github.io/Odum-basic-simulations/programs/<id>.bas`.

## Adding a program

1. **Name it.** Lowercase, words joined by hyphens: `two-tank.bas`, not
   `TwoTank.BAS`. The name becomes a URL (`?prg=two-tank`), so the build
   refuses anything else.

2. **Add the listing** as `<id>.bas`. Plain text, one numbered line per line.

3. **Add the metadata** as `<id>.json`. See below. This is the part that matters.

4. **Open a pull request.** CI builds the catalog and runs the full test suite
   against it; a sidecar that does not validate fails the check with a message
   naming the file and the field.

Please attach a photo or scan of the source page **to the pull request**, not to
this directory. `programs/` is published as-is, so a page image would be
redistributed from a public site; attached to a PR it is available to the
reviewer and stays out of the published archive. The build rejects anything that
is not a `.bas` or a `.json` here for exactly this reason.

## The metadata file

```json
{
  "title": "Charge And Discharge",
  "description": "One tank filled at a constant rate and drained in proportion to storage.",
  "fidelity": "verbatim",
  "source": {
    "type": "book",
    "author": ["Odum, Howard T."],
    "title": "Systems Ecology: An Introduction",
    "publisher": "Wiley",
    "address": "New York",
    "year": 1983,
    "pages": "123-125"
  },
  "notes": "Anything a reader checking this against the source should know.",
  "tags": ["mini-model", "storage"]
}
```

### `fidelity` — required, and the field that matters most

It says what this file *is*, and it changes what the rest of the metadata means.

| Value | Means | Also requires |
| --- | --- | --- |
| `verbatim` | Transcribed from the source, character for character — including its mistakes. | `source` |
| `corrected` | Transcribed, with typographic errors in the original fixed. | `source`, and `notes` listing **every** change |
| `adapted` | The published model, rewritten to run here. Not the published listing. | `source` |
| `original` | Written for this repository. Not from a published listing. | no `source` — there is nothing to cite |

Choose the lowest one that is true. If you fixed one misprinted variable name,
that is `corrected`, not `verbatim`: the value of the archive is that a reader can
trust `verbatim` to mean the page.

If the published listing will not run — a typo, a missing line — prefer
committing it **as `verbatim`, broken**, and opening a second PR that adds the fix
as `corrected`. Then both are on record and the difference is visible in the diff.

### `source` — BibLaTeX fields

The field names are BibLaTeX's, so the metadata converts to a `.bib` entry without
translation.

- `type` — one of `book`, `incollection`, `article`, `report`, `thesis`, `unpublished`
- `author` — an array, each in `"Family, Given"` form: `["Odum, Howard T."]`
- `title` — required
- `year` — a **number** (`1983`), not a string (`"1983"`)
- `doi` — bare, beginning `10.` — not a `https://doi.org/` URL; the page builds the link
- optional: `booktitle`, `journal`, `publisher`, `institution`, `address`,
  `volume`, `pages`, `edition`, `isbn`, `url`

### Everything else

- `title` and `description` — required; shown in the program picker and the
  library sidebar.
- `notes` — optional, except for `corrected`. Where the listing came from beyond
  the citation, what was hard to read, what differs from the source.
- `tags` — optional, free-form. The library filter searches them, and clicking one
  in the details panel lists every program that shares it.

## Checking your work locally

```sh
make test-unit     # includes the archive checks
make dev           # then open the program and read its details in the sidebar
```

The same checks run in CI on every pull request.
