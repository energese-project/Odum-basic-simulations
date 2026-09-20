/**
 * The BASIC engine: the dialect the published listings are written in, in C.
 *
 * Two jobs, deliberately separable, because they run in different places and at
 * different rates:
 *
 *   BAS_Validate   parses and checks, never executes.  Safe to call on every
 *                  keystroke, from an editor or from Monaco through wasm.
 *   BAS_Init/Step  executes, a bounded number of statements at a time, so the
 *                  caller keeps control.  See the note on stepping below.
 *
 * The engine emits data and never pixels.  SCREEN, COLOR, CLS, PSET, PRESET and
 * LINE are recorded as rows in the program's own coordinates: the published
 * listings plot rather than print, so dropping the graphics statements would
 * make the archive's central program emit nothing at all.  Rasterising those
 * rows into a screen, and drawing charts from them, is someone else's job.
 *
 * Why stepping rather than one Run call.  The browser runs this in a Web Worker
 * and must be able to stop a program that does not terminate, and CONT must
 * resume where END or STOP left the program counter.  A single call into wasm
 * cannot be interrupted — once inside the C loop, the host never regains
 * control — so the loop belongs to the caller.  BAS_Step runs at most
 * max_statements and returns; the instance holds the program counter.
 *
 * Numbers are single precision, as the original machines' were.  See the note
 * on BAS_Real in basic_config.h: matching the oracle depends on it, and on the
 * compiler not evaluating intermediates wider than the type.
 */

#ifndef BASIC_H
#define BASIC_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Every entry point returns one of these.  0 is success; nothing else is. */
typedef enum {
  BAS_OK = 0,
  BAS_ERR_ALLOC,        /**< Out of memory. */
  BAS_ERR_ARGUMENT,     /**< A NULL or otherwise unusable argument. */
  BAS_ERR_SYNTAX,       /**< The source did not parse.  Diagnostics say where. */
  BAS_ERR_RUNTIME,      /**< The program failed while running. */
  BAS_ERR_HALTED,       /**< Stopped at the caller's request. */
  BAS_ERR_UNSUPPORTED,  /**< A statement this engine does not implement yet. */
  BAS_STATUS_COUNT
} BAS_Status;

/** Human-readable form of a status, for a CLI message or a thrown JS error. */
const char *BAS_GetErrorDescription(BAS_Status status);

/** Engine version, as "major.minor.patch". */
const char *BAS_GetVersionString(void);

/* ---------------------------------------------------------------- validation */

/**
 * Parse `source` and report what is wrong with it, without running anything.
 *
 * Writes a JSON document to `*out_json`, which the caller frees with
 * BAS_FreeString.  The shape is Monaco's marker shape, so the browser can pass
 * it through untouched, and an editor or a CI job can read the same document:
 *
 *   {"diagnostics":[
 *     {"severity":"error","code":"BAS0104","message":"NEXT without FOR",
 *      "startLineNumber":12,"startColumn":7,"endLineNumber":12,"endColumn":11}
 *   ]}
 *
 * Line and column are 1-based, and endColumn is exclusive, because that is what
 * Monaco means by them.  An empty array is a valid program.
 *
 * Returns BAS_OK when the document was produced, whether or not it holds
 * diagnostics — a program with errors is a successful validation.  A non-OK
 * return means validation itself could not be performed.
 */
BAS_Status BAS_Validate(const char *source, char **out_json);

/* ----------------------------------------------------------------- execution */

/** An opaque program, loaded and ready to step.  Free with BAS_Free. */
typedef struct BAS_Instance BAS_Instance;

/**
 * Load `source` and prepare it to run.  Fails with BAS_ERR_SYNTAX if it does
 * not parse; call BAS_Validate to find out where.
 */
BAS_Status BAS_Init(const char *source, BAS_Instance **out_inst);

/** Release an instance.  Safe on NULL. */
void BAS_Free(BAS_Instance *inst);

/** Return the program counter to the start and clear every variable. */
void BAS_Reset(BAS_Instance *inst);

/**
 * Run at most `max_statements`, then return.  BAS_OK means the budget ran out
 * and there is more to do; call again.  BAS_ERR_HALTED means the program
 * finished, or reached END or STOP — BAS_CanContinue distinguishes those, and
 * BAS_Continue resumes.  Anything else is a failure, described by
 * BAS_GetRuntimeError.
 */
BAS_Status BAS_Step(BAS_Instance *inst, size_t max_statements);

/** True when the program stopped at END or STOP and CONT would resume it. */
int BAS_CanContinue(BAS_Instance *inst);

/** Resume after END or STOP, as CONT does.  No effect otherwise. */
BAS_Status BAS_Continue(BAS_Instance *inst);

/**
 * The message and line of the failure that stopped the program, or NULL and 0
 * when it did not fail.  The string belongs to the instance.
 */
const char *BAS_GetRuntimeError(BAS_Instance *inst);
int BAS_GetRuntimeErrorLine(BAS_Instance *inst);

/* -------------------------------------------------------------------- output */

/**
 * What a run emitted, in the order it was emitted.  One row per point, which is
 * the long format `runs/<run>.csv` is specified in: the line that emitted it,
 * the program's own x and y, and the colour it asked for.
 *
 * `kind` says which statement produced the row, so a consumer can tell a drawn
 * point from a printed one without re-parsing the source.
 */
typedef enum {
  BAS_ROW_PSET = 0,
  BAS_ROW_PRESET,
  BAS_ROW_LINE,     /**< x,y is the end point; x0,y0 the start. */
  BAS_ROW_PRINT     /**< A printed numeric column; `column` says which. */
} BAS_RowKind;

/** Number of rows emitted so far. */
size_t BAS_GetRowCount(BAS_Instance *inst);

/**
 * The rows, as a flat array the caller must not free — it is the instance's,
 * and a further BAS_Step may move it.  Laid out for a zero-copy read from
 * wasm's HEAPF64: BAS_ROW_STRIDE doubles per row, in the order given by
 * BAS_RowField.
 */
const double *BAS_GetRows(BAS_Instance *inst);

/** Fields of one row, as indices into the array BAS_GetRows returns. */
typedef enum {
  BAS_FIELD_KIND = 0,
  BAS_FIELD_LINE,    /**< The listing's line number, not the file's line. */
  BAS_FIELD_X0,
  BAS_FIELD_Y0,
  BAS_FIELD_X,
  BAS_FIELD_Y,
  BAS_FIELD_COLOR,
  BAS_ROW_STRIDE
} BAS_RowField;

/**
 * The rows as CSV, header included, in the long format the archive publishes.
 * The caller frees it with BAS_FreeString.
 */
BAS_Status BAS_WriteCSV(BAS_Instance *inst, char **out_csv);

/** Free a string this library returned.  Safe on NULL. */
void BAS_FreeString(char *s);

#ifdef __cplusplus
}
#endif

#endif /* BASIC_H */
