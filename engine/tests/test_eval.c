/**
 * The evaluator, and above all its arithmetic.
 *
 * The cases that matter here are not "does 2 + 2 work".  They are the ones
 * where a plausible implementation differs from the machines these listings
 * were written for, because those are the differences the oracle will find and
 * that a reader comparing a rerun with a published figure would have to
 * explain:
 *
 *   - every operation rounds to single, not just the assignment;
 *   - integer division is not integer division, `/` is always real;
 *   - INT truncates toward minus infinity, which is not what C's cast does;
 *   - a variable that was never assigned is zero rather than an error;
 *   - the listings' own idiom, `A = A + DA * DT`, must round exactly as
 *     GW-BASIC rounded it.
 */

#include "../include/basic.h"
#include "../include/basic_config.h"
#include "test.h"

#include <math.h>
#include <stdlib.h>

/** Run `src` and check the whole of what PRINT produced. */
#define CHECK_TEXT(src, expect)                                               \
  do {                                                                        \
    BAS_Status st_;                                                           \
    BAS_Instance *in_ = run((src), &st_);                                     \
    char *got_ = NULL;                                                        \
    BAS_TakeText(in_, &got_);                                                 \
    CHECK_STR(got_ ? got_ : "", (expect));                                    \
    BAS_FreeString(got_);                                                     \
    BAS_Free(in_);                                                            \
  } while (0)

/** Run a source to completion and hand back the instance, or NULL. */
static BAS_Instance *run(const char *src, BAS_Status *out) {
  BAS_Instance *inst = NULL;
  BAS_Status s = BAS_Init(src, &inst);
  if (s != BAS_OK) { if (out) *out = s; return inst; }
  /* A bounded loop, so a runaway program fails the test instead of the suite. */
  for (int i = 0; i < 100000; i++) {
    s = BAS_Step(inst, 256);
    if (s != BAS_OK) break;
  }
  if (out) *out = s;
  return inst;
}

/** The single value a one-row program plotted, by field. */
static double plotted(BAS_Instance *inst, size_t row, BAS_RowField f) {
  const double *rows = BAS_GetRows(inst);
  return rows[row * BAS_ROW_STRIDE + f];
}

int main(void) {
  {
    TEST("a program runs to the end and reports that it halted");
    BAS_Status s;
    BAS_Instance *i = run("10 X = 1\n20 END\n", &s);
    CHECK_INT(s, BAS_ERR_HALTED);
    BAS_Free(i);
  }

  {
    TEST("PSET emits one row, in the program's own coordinates");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (3, 4), 2\n20 END\n", &s);
    CHECK_INT(BAS_GetRowCount(i), 1);
    CHECK_INT(plotted(i, 0, BAS_FIELD_KIND), BAS_ROW_PSET);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 3);
    CHECK_INT(plotted(i, 0, BAS_FIELD_Y), 4);
    CHECK_INT(plotted(i, 0, BAS_FIELD_COLOR), 2);
    CHECK_INT(plotted(i, 0, BAS_FIELD_LINE), 10);
    BAS_Free(i);
  }

  {
    /* The coordinate is NOT rounded here.  Rounding a point to a pixel is the
       rasteriser's job, and which way a half goes is the whole subject of the
       oracle comparison; an evaluator that rounds early destroys the evidence. */
    TEST("a fractional coordinate is emitted unrounded");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (2.5, 7.5), 1\n20 END\n", &s);
    CHECK(fabs(plotted(i, 0, BAS_FIELD_X) - 2.5) < 1e-9);
    CHECK(fabs(plotted(i, 0, BAS_FIELD_Y) - 7.5) < 1e-9);
    BAS_Free(i);
  }

  {
    TEST("LINE emits its start and its end");
    BAS_Status s;
    BAS_Instance *i = run("10 LINE (0,0)-(319,180),3,B\n20 END\n", &s);
    CHECK_INT(BAS_GetRowCount(i), 1);
    CHECK_INT(plotted(i, 0, BAS_FIELD_KIND), BAS_ROW_LINE);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X0), 0);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 319);
    CHECK_INT(plotted(i, 0, BAS_FIELD_Y), 180);
    CHECK_INT(plotted(i, 0, BAS_FIELD_BOX), 1);   /* the B clause */
    BAS_Free(i);
  }

  {
    TEST("an unassigned variable is zero, not an error");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (Q, 1), 1\n20 END\n", &s);
    CHECK_INT(s, BAS_ERR_HALTED);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 0);
    BAS_Free(i);
  }

  {
    TEST("arithmetic follows GW-BASIC's precedence, not left to right");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (2 + 3 * 4, 2 ^ 3 ^ 2), 1\n20 END\n", &s);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 14);
    CHECK_INT(plotted(i, 0, BAS_FIELD_Y), 64);   /* left-associative ^ */
    BAS_Free(i);
  }

  {
    TEST("division is real, never integer");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (7 / 2, 1), 1\n20 END\n", &s);
    CHECK(fabs(plotted(i, 0, BAS_FIELD_X) - 3.5) < 1e-9);
    BAS_Free(i);
  }

  {
    /* INT is a floor, so INT(-2.5) is -3.  A C cast to int truncates toward
       zero and would give -2, which is a wrong answer rather than a crash. */
    TEST("INT floors toward minus infinity");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (INT(2.7), INT(-2.5)), 1\n20 END\n", &s);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 2);
    CHECK_INT(plotted(i, 0, BAS_FIELD_Y), -3);
    BAS_Free(i);
  }

  {
    TEST("comparisons yield -1 for true and 0 for false, as BASIC does");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (1 < 2, 2 < 1), 1\n20 END\n", &s);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), -1);
    CHECK_INT(plotted(i, 0, BAS_FIELD_Y), 0);
    BAS_Free(i);
  }

  {
    /* The listings' central idiom.  With .1 and .5 held as single precision,
       the sequence is exactly what GW-BASIC computed, and the test states the
       expected value as the float it must be rather than as a decimal. */
    TEST("A = A + DA * DT rounds to single at every operation");
    BAS_Status s;
    BAS_Instance *i = run("10 A = .1\n20 DA = .3\n30 DT = .5\n"
                          "40 A = A + DA * DT\n"
                          "50 PSET (A, 0), 1\n60 END\n", &s);
    BAS_Real a = 0.1f;
    BAS_Real expect = BAS_ROUND(a + BAS_ROUND(0.3f * 0.5f));
    CHECK(fabs(plotted(i, 0, BAS_FIELD_X) - (double)expect) < 1e-12);
    BAS_Free(i);
  }

  {
    /* If the engine held values as double, this loop would drift from the
       single-precision original.  200 steps is enough for the difference to
       exceed float's own epsilon, so the check is meaningful. */
    TEST("accumulated arithmetic stays in single precision");
    BAS_Status s;
    BAS_Instance *i = run("10 T = 0\n20 FOR I = 1 TO 200\n"
                          "30 T = T + .1\n40 NEXT I\n"
                          "50 PSET (T, 0), 1\n60 END\n", &s);
    BAS_Real t = 0.0f;
    for (int k = 0; k < 200; k++) t = BAS_ROUND(t + 0.1f);
    CHECK(fabs(plotted(i, 0, BAS_FIELD_X) - (double)t) < 1e-12);
    CHECK(fabs(plotted(i, 0, BAS_FIELD_X) - 20.0) > 1e-9);  /* it must drift */
    BAS_Free(i);
  }

  {
    TEST("IF .. THEN <line> jumps, and a false condition falls through");
    BAS_Status s;
    BAS_Instance *i = run("10 X = 5\n20 IF X > 3 THEN 50\n"
                          "30 PSET (111, 0), 1\n40 END\n"
                          "50 PSET (222, 0), 1\n60 END\n", &s);
    CHECK_INT(BAS_GetRowCount(i), 1);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 222);
    BAS_Free(i);
  }

  {
    /* table3.bas line 400: a bare GOTO after the condition, no THEN. */
    TEST("IF .. GOTO <line> is the same statement as IF .. THEN <line>");
    BAS_Status s;
    BAS_Instance *i = run("10 T = 0\n20 T = T + 1\n"
                          "30 IF T < 3 GOTO 20\n"
                          "40 PSET (T, 0), 1\n50 END\n", &s);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 3);
    BAS_Free(i);
  }

  {
    TEST("FOR and NEXT run the body the right number of times");
    BAS_Status s;
    BAS_Instance *i = run("10 FOR I = 1 TO 4\n20 PSET (I, 0), 1\n"
                          "30 NEXT I\n40 END\n", &s);
    CHECK_INT(BAS_GetRowCount(i), 4);
    CHECK_INT(plotted(i, 3, BAS_FIELD_X), 4);
    BAS_Free(i);
  }

  {
    TEST("GOSUB returns to the statement after it");
    BAS_Status s;
    BAS_Instance *i = run("10 GOSUB 100\n20 PSET (2, 0), 1\n30 END\n"
                          "100 PSET (1, 0), 1\n110 RETURN\n", &s);
    CHECK_INT(BAS_GetRowCount(i), 2);
    CHECK_INT(plotted(i, 0, BAS_FIELD_X), 1);
    CHECK_INT(plotted(i, 1, BAS_FIELD_X), 2);
    BAS_Free(i);
  }

  {
    /* The reason the API steps rather than runs: a non-terminating program
       must hand control back, not hang the caller. */
    TEST("a non-terminating program returns from every step");
    BAS_Instance *inst = NULL;
    CHECK_INT(BAS_Init("10 X = X + 1\n20 GOTO 10\n", &inst), BAS_OK);
    for (int k = 0; k < 50; k++) CHECK_INT(BAS_Step(inst, 64), BAS_OK);
    BAS_Free(inst);
  }

  {
    TEST("END stops the program and CONT can resume it");
    BAS_Instance *inst = NULL;
    BAS_Init("10 PSET (1, 0), 1\n20 END\n30 PSET (2, 0), 1\n40 END\n", &inst);
    BAS_Status s = BAS_OK;
    while (s == BAS_OK) s = BAS_Step(inst, 64);
    CHECK_INT(s, BAS_ERR_HALTED);
    CHECK_INT(BAS_CanContinue(inst), 1);
    CHECK_INT(BAS_GetRowCount(inst), 1);
    BAS_Continue(inst);
    s = BAS_OK;
    while (s == BAS_OK) s = BAS_Step(inst, 64);
    CHECK_INT(BAS_GetRowCount(inst), 2);
    BAS_Free(inst);
  }

  {
    TEST("the rows come back as CSV in the published long format");
    BAS_Status s;
    BAS_Instance *i = run("10 PSET (3, 4), 2\n20 END\n", &s);
    char *csv = NULL;
    CHECK_INT(BAS_WriteCSV(i, &csv), BAS_OK);
    CHECK(csv && strstr(csv, "line,kind,x0,y0,x,y,color,box") == csv);
    CHECK(csv && strstr(csv, "10,pset,") != NULL);
    BAS_FreeString(csv);
    BAS_Free(i);
  }

  {
    TEST("a runtime failure names its line");
    BAS_Instance *inst = NULL;
    BAS_Init("10 X = 1 / 0\n20 END\n", &inst);
    BAS_Status s = BAS_OK;
    while (s == BAS_OK) s = BAS_Step(inst, 64);
    CHECK_INT(s, BAS_ERR_RUNTIME);
    CHECK_INT(BAS_GetRuntimeErrorLine(inst), 10);
    BAS_Free(inst);
  }

  {
    TEST("freeing a NULL instance is safe");
    BAS_Free(NULL);
    CHECK(1);
  }


  /* ------------------------------------------------------------- INPUT */

  {
    /* The statement suspends rather than reading: the engine does not own the
       console, so it stops and says what it wants. */
    TEST("INPUT suspends, names its prompt, and resumes when given a value");
    BAS_Instance *i = NULL;
    CHECK_INT(BAS_Init("10 INPUT \"YOUR GUESS\"; G\n20 LET H = G * 2\n30 END\n", &i), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK(BAS_GetInputPrompt(i) && !strcmp(BAS_GetInputPrompt(i), "YOUR GUESS"));
    CHECK_INT(BAS_ProvideInput(i, "21"), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_ERR_HALTED);
    CHECK(BAS_GetInputPrompt(i) == NULL);   /* nothing is waiting now */
    BAS_Free(i);
  }

  {
    /* Stepping without supplying the value must not run the INPUT twice, and
       must not advance past it. */
    TEST("stepping again while a value is outstanding changes nothing");
    BAS_Instance *i = NULL;
    CHECK_INT(BAS_Init("10 INPUT G\n20 END\n", &i), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_ProvideInput(i, "7"), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_ERR_HALTED);
    BAS_Free(i);
  }

  {
    /* `INPUT A, B` reads one line holding both, as GW-BASIC does. */
    TEST("one line fills several variables");
    BAS_Instance *i = NULL;
    CHECK_INT(BAS_Init("10 INPUT A, B\n20 LET C = A + B\n30 END\n", &i), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_ProvideInput(i, "3, 4"), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_ERR_HALTED);
    BAS_Free(i);
  }

  {
    /* A line short of values asks again rather than filling the rest with
       zeroes, which would be a wrong answer rather than a missing one. */
    TEST("a line short of values asks for the rest");
    BAS_Instance *i = NULL;
    CHECK_INT(BAS_Init("10 INPUT A, B\n20 END\n", &i), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_ProvideInput(i, "3"), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_ProvideInput(i, "4"), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_ERR_HALTED);
    BAS_Free(i);
  }

  {
    /* GW-BASIC's "?Redo from start": the whole line is discarded, not the
       part that failed to parse. */
    TEST("a line that is not a number is refused whole");
    BAS_Instance *i = NULL;
    CHECK_INT(BAS_Init("10 INPUT A, B\n20 END\n", &i), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_ProvideInput(i, "3, banana"), BAS_AWAITING_INPUT);
    CHECK_INT(BAS_ProvideInput(i, "3, 4"), BAS_OK);
    CHECK_INT(BAS_Step(i, 256), BAS_ERR_HALTED);
    BAS_Free(i);
  }

  {
    /* No string variables in this engine, so reading into one is refused
       rather than silently reading into a numeric of the same name. */
    TEST("INPUT into a string variable is refused, not guessed at");
    BAS_Status s;
    BAS_Instance *i = run("10 INPUT N$\n20 END\n", &s);
    CHECK_INT(s, BAS_ERR_RUNTIME);
    CHECK(BAS_GetRuntimeError(i) != NULL);
    BAS_Free(i);
  }

  {
    TEST("providing input when nothing is waiting is an error");
    BAS_Instance *i = NULL;
    CHECK_INT(BAS_Init("10 LET A = 1\n20 END\n", &i), BAS_OK);
    CHECK_INT(BAS_ProvideInput(i, "5"), BAS_ERR_ARGUMENT);
    BAS_Free(i);
  }


  /* --------------------------------------------------------- PRINT as text */

  /* Every expectation below is a line of validation/oracle/runs/print.txt,
     which is PC-BASIC's own output for validation/oracle/print.bas. They are
     transcribed from the machine, not from what this implementation happens
     to do. */
  {
    TEST("a positive number carries a leading space and a trailing one");
    CHECK_TEXT("10 PRINT 1; 2; 3; \"|\"\n20 END\n", " 1  2  3 |\n");
  }
  {
    TEST("a negative number puts the sign where the space would be");
    CHECK_TEXT("10 PRINT -1; -2; -3; \"|\"\n20 END\n", "-1 -2 -3 |\n");
  }
  {
    TEST("there is no leading zero before the point");
    CHECK_TEXT("10 PRINT 0.5; -0.5; \"|\"\n20 END\n", " .5 -.5 |\n");
  }
  {
    /* PC-BASIC prints .00001 here where %G would give 1E-05, and only reaches
       for an exponent a decade further down. */
    TEST("the exponent appears a decade later than C's %G reaches for it");
    CHECK_TEXT("10 PRINT 0.00001; \"|\"\n20 END\n", " .00001 |\n");
    CHECK_TEXT("10 PRINT 0.0001; \"|\"\n20 END\n", " .0001 |\n");
    CHECK_TEXT("10 PRINT 1/300000; \"|\"\n20 END\n", " 3.333333E-06 |\n");
  }
  {
    TEST("a comma moves to the next 14-column print zone");
    CHECK_TEXT("10 PRINT \"A\", \"B\", \"C\", \"|\"\n20 END\n",
               "A             B             C             |\n");
    CHECK_TEXT("10 PRINT \"T\", \"Q\", \"OUTFLOW\", \"|\"\n20 END\n",
               "T             Q             OUTFLOW       |\n");
  }
  {
    /* The number's sign occupies the first column of the zone, so its digits
       start one in. */
    TEST("a number in a zone starts after the sign column");
    CHECK_TEXT("10 PRINT 1, 2, 3, \"|\"\n20 END\n",
               " 1             2             3            |\n");
    CHECK_TEXT("10 PRINT \"LABEL\", 42, \"|\"\n20 END\n",
               "LABEL          42           |\n");
  }
  {
    TEST("a label and a value, as a listing reports a steady state");
    CHECK_TEXT("10 PRINT \"STEADY STATE J/K1 =\"; 1000; \"|\"\n20 END\n",
               "STEADY STATE J/K1 = 1000 |\n");
  }
  {
    TEST("a trailing separator holds the line open for the next PRINT");
    CHECK_TEXT("10 PRINT 7;\n20 PRINT 8; \"|\"\n30 END\n", " 7  8 |\n");
    CHECK_TEXT("10 PRINT 9,\n20 PRINT 10; \"|\"\n30 END\n", " 9             10 |\n");
  }
  {
    TEST("a bare PRINT is a blank line");
    CHECK_TEXT("10 PRINT \"BEFORE\"; \"|\"\n20 PRINT\n30 PRINT \"AFTER\"; \"|\"\n40 END\n",
               "BEFORE|\n\nAFTER|\n");
  }
  {
    /* The text is what a console shows; the rows are the same numbers for
       comparison. A listing that prints its table still yields both. */
    TEST("PRINT still emits rows as well as text");
    BAS_Status st;
    BAS_Instance *i = run("10 PRINT 1, 2\n20 END\n", &st);
    CHECK_INT(BAS_GetRowCount(i), 2);
    BAS_Free(i);
  }

  TEST_REPORT();
}
