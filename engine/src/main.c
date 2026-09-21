/**
 * odum: the command-line tool.
 *
 *   odum run <file.bas> [--csv <out>] [--max-steps N]
 *   odum check <file.bas>
 *
 * `run` executes a listing and writes its rows as CSV — stdout by default, so
 * it composes with everything else.  `check` validates without executing and
 * prints the diagnostics, exiting non-zero if there are any, so CI and an
 * agent can rely on it.
 *
 * Exit codes are part of the interface:
 *   0  ran, or validated clean
 *   1  the program failed while running
 *   2  the listing did not validate
 *   3  the tool was used wrongly, or a file could not be read
 */

#include "../include/basic.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define EXIT_RUNTIME 1
#define EXIT_INVALID 2
#define EXIT_USAGE   3

static void usage(void) {
  fprintf(stderr,
          "Usage:\n"
          "  odum run <file.bas> [--csv <out>] [--max-steps N]\n"
          "  odum check <file.bas>\n");
}

/** Read a whole file.  The caller frees. */
static char *read_file(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
  long size = ftell(f);
  if (size < 0) { fclose(f); return NULL; }
  rewind(f);
  char *buf = malloc((size_t)size + 1);
  if (!buf) { fclose(f); return NULL; }
  size_t got = fread(buf, 1, (size_t)size, f);
  fclose(f);
  buf[got] = '\0';
  return buf;
}

static int cmd_check(const char *path) {
  char *src = read_file(path);
  if (!src) { fprintf(stderr, "cannot read %s\n", path); return EXIT_USAGE; }

  char *json = NULL;
  BAS_Status s = BAS_Validate(src, &json);
  free(src);
  if (s != BAS_OK) {
    fprintf(stderr, "check failed: %s\n", BAS_GetErrorDescription(s));
    BAS_FreeString(json);
    return EXIT_USAGE;
  }
  printf("%s\n", json);
  /* An empty diagnostics array is the only clean result. */
  int clean = strstr(json, "\"diagnostics\":[]") != NULL;
  BAS_FreeString(json);
  return clean ? 0 : EXIT_INVALID;
}

/** Write out whatever PRINT has produced since the last call. */
static void drain(BAS_Instance *inst) {
  char *text = NULL;
  if (BAS_TakeText(inst, &text) == BAS_OK && text) {
    fputs(text, stdout);
    BAS_FreeString(text);
  }
}

static int cmd_run(const char *path, const char *csv_path, long max_steps) {
  char *src = read_file(path);
  if (!src) { fprintf(stderr, "cannot read %s\n", path); return EXIT_USAGE; }

  BAS_Instance *inst = NULL;
  BAS_Status s = BAS_Init(src, &inst);
  free(src);
  if (s != BAS_OK) {
    fprintf(stderr, "%s: %s — run `odum check` for the details\n", path,
            BAS_GetErrorDescription(s));
    BAS_Free(inst);
    return EXIT_INVALID;
  }

  /* The step budget is the caller's guard against a listing that does not
     terminate; the engine itself is happy to run forever, as the original
     machine was. */
  long steps = 0;
  for (;;) {
    s = BAS_Step(inst, 4096);
    if (s == BAS_AWAITING_INPUT) {
      /* The engine suspends rather than reading, so the console belongs to
         whoever drives it — here, this terminal. The "? " is added here for
         the same reason: GW-BASIC's prompt punctuation is the console's
         business, not the program's. */
      drain(inst);   /* a question after whatever the program said first */
      const char *prompt = BAS_GetInputPrompt(inst);
      if (prompt) fputs(prompt, stdout);
      fputs("? ", stdout);
      fflush(stdout);
      char line[256];
      if (!fgets(line, sizeof line, stdin)) {
        fprintf(stderr, "%s: end of input while a value was wanted\n", path);
        BAS_Free(inst);
        return EXIT_RUNTIME;
      }
      line[strcspn(line, "\r\n")] = '\0';
      /* BAS_AWAITING_INPUT again means the line was short or unreadable, and
         the loop asks once more — GW-BASIC's "??" and "?Redo from start". */
      BAS_ProvideInput(inst, line);
      continue;
    }
    drain(inst);
    if (s != BAS_OK) break;
    if (max_steps > 0 && ++steps * 4096 > max_steps) {
      fprintf(stderr, "%s: stopped after %ld statements\n", path, max_steps);
      break;
    }
  }
  if (s == BAS_ERR_RUNTIME) {
    fprintf(stderr, "%s: %s in line %d\n", path, BAS_GetRuntimeError(inst),
            BAS_GetRuntimeErrorLine(inst));
    BAS_Free(inst);
    return EXIT_RUNTIME;
  }

  char *csv = NULL;
  if (BAS_WriteCSV(inst, &csv) != BAS_OK) {
    fprintf(stderr, "could not write the results\n");
    BAS_Free(inst);
    return EXIT_RUNTIME;
  }
  if (csv_path) {
    FILE *out = fopen(csv_path, "wb");
    if (!out) {
      fprintf(stderr, "cannot write %s\n", csv_path);
      BAS_FreeString(csv);
      BAS_Free(inst);
      return EXIT_USAGE;
    }
    fputs(csv, out);
    fclose(out);
    fprintf(stderr, "%zu rows written to %s\n", BAS_GetRowCount(inst), csv_path);
  } else {
    fputs(csv, stdout);
  }
  BAS_FreeString(csv);
  BAS_Free(inst);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) { usage(); return EXIT_USAGE; }

  const char *cmd = argv[1];
  const char *path = NULL, *csv_path = NULL;
  long max_steps = 0;

  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "--csv") && i + 1 < argc) csv_path = argv[++i];
    else if (!strcmp(argv[i], "--max-steps") && i + 1 < argc) max_steps = atol(argv[++i]);
    else if (argv[i][0] == '-') { usage(); return EXIT_USAGE; }
    else path = argv[i];
  }
  if (!path) { usage(); return EXIT_USAGE; }

  if (!strcmp(cmd, "run")) return cmd_run(path, csv_path, max_steps);
  if (!strcmp(cmd, "check")) return cmd_check(path);
  usage();
  return EXIT_USAGE;
}
