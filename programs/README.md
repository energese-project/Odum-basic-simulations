# The program archive

Each program here is a BASIC listing from the systems-ecology literature — or a
worked example of one — kept so that anyone can run it and check it against the
source it came from.

**A single program is two files, and optionally a third.** A published article or
book is a folder instead — see [Adding an article or book](#adding-an-article-or-book).

```
programs/
  charge-discharge.bas     the listing, exactly as it should run
  charge-discharge.json    where it came from, and how faithfully
  charge-discharge.png     optional: its energy systems diagram
```

For a single program that is the whole structure. There is no index to update: the build finds the
files, checks them, and publishes both at
`https://energese-project.github.io/Odum-basic-simulations/programs/<id>.bas`.

## Adding a program

### The form on GitHub

**Contribute**, at the top of the workbench, opens this form.

[**Open an "Add a program" issue**](https://github.com/energese-project/Odum-basic-simulations/issues/new?template=add-program.yml)
and fill it in. No git, JSON or BibLaTeX needed. Paste the listing, type in the
citation, drag the diagram image in if there is one.

A bot checks it against the same rules as everything below, usually within a
couple of minutes:

- if something is wrong, it comments on the issue saying what. **Edit the
  issue** to fix it and it checks again;
- when everything passes, it opens a pull request with the files, credits you as
  co-author, and runs the full test suite on it. A maintainer reviews and merges.

Add a photo of the source page in the form's last box if you can. It stays in
the issue for the reviewer and is not published.

### By hand

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
reviewer and stays out of the published archive.

The one image that may live here is the program's **diagram**, and only when its
sidecar declares it with the rights it is published under — see
[`diagram`](#diagram--optional-with-its-rights) below. The build rejects any other
file.

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

### `diagram` — optional, with its rights

The energy systems diagram that goes with the listing, shown above the plot.
Usually it is the figure printed beside the listing in the source, cropped from a
scan.

```json
"diagram": {
  "file": "two-tank.png",
  "caption": "Two storages in series: Q1 fed by J, draining into Q2, which drains away.",
  "figure": "Figure 5-3, p. 112",
  "rights": {
    "basis": "fair-use",
    "statement": "Reproduced for scholarship and review, beside the listing it documents."
  }
}
```

- `file` — **`<id>.png`, `.jpg`, `.jpeg` or `.webp`**, next to the listing. One
  per program. At most 2 MB: crop to the figure. SVG is not accepted, because an
  SVG opened directly from the published site can run scripts.
- `caption` — required. What the diagram shows, in words. It is also the image's
  alt text, so write it for someone who cannot see the image.
- `figure` — optional. Where it is in the source, so a reader can find the
  original.
- `rights` — required. Both `basis` and `statement`:

| `basis` | Means | Also requires |
| --- | --- | --- |
| `own-work` | Drawn for this repository. | — |
| `public-domain` | Out of copyright, or never in it. | `source` |
| `licensed` | Under a licence that allows it. Name the licence in the statement. | `source` |
| `permission` | The rights holder agreed. Say who, and when. | `source` |
| `fair-use` | Fair use or fair dealing: reproduced for scholarship, criticism or review, beside the listing it documents. | `source` |

Like `fidelity`, this has no default. Only the person adding a figure from a book
can say why it may be published here, and the build will not publish an image
whose sidecar does not say so. A reproduced figure must have a `source`: a scan
from nowhere is worse than no scan.

### Everything else

- `title` and `description` — required; the title names the program in the
  explorer, and the description is shown when you hover over it.
- `notes` — optional, except for `corrected`. Where the listing came from beyond
  the citation, what was hard to read, what differs from the source.
- `tags` — optional, free-form. The explorer's filter searches them.

## Adding an article or book

A published work — a paper, a book, a report — often prints more than one model,
and runs each model more than once for its figures. Odum's 1989 paper in
*Simulation* prints two listings and seven plots drawn from them. So a work gets a
folder, laid out like the publication:

```
programs/
  odum_simulation_1989/            one folder per work
    source.json                    its citation, and the rights its crops are under
    macroeconomics/                one folder per model in it
      model.bas                    the listing
      meta-data.json               what it is, and what each crop shows
      program.png                  the listing as printed, cropped from the page
      diagram.png                  the energy systems diagram, cropped from the page
      runs/
        fig3a.json                 one published figure, and how the run differs
        fig3a.png                  that figure, cropped from the page
```

The crops are the point. With them anyone can check two things against the page:
that `model.bas` is what was printed, and whether it draws what was printed.

**The PDF of the work is never added.** It is someone else's copyright, and this
directory is published as it stands. The build refuses a PDF anywhere in
`programs/`, and git ignores them.

### The folder name

The first author's family name, the first word of the title that is not "a", "an"
or "the", and the year — lowercase, joined by underscores: `odum_simulation_1989`.
Accents are dropped and a hyphenated name keeps its hyphen (`muller-brandt_…`).
If one author has two works in a year, add a letter, as the papers cite them:
`odum_energy_1967a`, `odum_biological_1967b`.

The build checks the name against `source.json`, so a typo in either fails. The
name is also the work's BibTeX key.

### `source.json`

```json
{
  "source": {
    "type": "article",
    "author": ["Odum, Howard T."],
    "title": "Simulation models of ecological economics developed with energy language methods",
    "journal": "Simulation",
    "volume": "53",
    "year": 1989,
    "doi": "10.1177/003754978905300205"
  },
  "rights": {
    "basis": "fair-use",
    "statement": "Cropped from the article for scholarship and review, beside the reproduction of its models."
  }
}
```

- `source` — the same BibLaTeX fields as [above](#source--biblatex-fields), and
  `year` is required: it is part of the name. The models in the work do not
  repeat it.
- `rights` — the basis every crop in the work is published under, from the
  [same list](#diagram--optional-with-its-rights), except `own-work`: a crop of a
  printed page is not.

### A model: `<model>/model.bas` and `meta-data.json`

The model folder is lowercase-kebab, named for what the model is
(`macroeconomics`, `state-development`). Every model gets a folder, even in a
work that prints only one, so adding a second never means moving the first.

```json
{
  "title": "Macroeconomics Minimodel",
  "description": "Assets grow on renewable and nonrenewable sources.",
  "fidelity": "verbatim",
  "program": { "caption": "The BASIC listing, as printed.", "where": "Table 2, p. 71" },
  "diagram": { "caption": "The minimodel in energy systems symbols: …", "figure": "Figure 2, p. 71" },
  "notes": "Anything a reader checking this against the page should know.",
  "tags": ["macroeconomics", "minimodel"]
}
```

- `fidelity` — as [above](#fidelity--required-and-the-field-that-matters-most),
  except that `original` is not allowed: a work always has a source.
- `program` and `diagram` — describe `program.png` and `diagram.png`. Each image
  and its description come together or not at all: the caption is the image's alt
  text. PNG, JPEG or WebP, at most 2 MB, one image each.

### A run: `runs/<run>.json` and its plot

One published figure, and what the listing was run with to draw it. Name it for
the figure (`fig5`, `fig3a`).

```json
{
  "figure": "Figure 5, p. 73",
  "caption": "Without investment or external trade (IV = 0 and K = 0).",
  "changes": { "22": "22 IV = 0", "30": "30 K = 0" }
}
```

- `figure` and `caption` — required. The caption says what the published caption
  says; it is also the plot crop's alt text.
- `changes` — whole numbered lines of `model.bas` to replace for this run. Each
  keeps its line number, so the run reads as a diff against the page. Leave it out
  for a figure drawn by the listing as printed.

`model.bas` itself is never edited for a run: that is what keeps `verbatim`
true. A change naming a line the listing does not have fails the build.

`<run>.png` is the published figure, cropped from the page, and needs its
`<run>.json`.

## Checking your work locally

```sh
make test-unit     # includes the archive checks
make dev           # then open the program and read its details in the sidebar
```

The same checks run in CI on every pull request.
