/**
 * BAS_Validate: what an editor sees.
 *
 * The contract these tests pin is that validation never executes anything, and
 * that a program with errors is a *successful* validation — BAS_OK with
 * diagnostics in the document.  A non-OK return means validation itself could
 * not be performed, which is a different thing and must not be conflated: an
 * editor that treats "your program has a typo" as "the validator crashed" will
 * either swallow real errors or spam the user with false ones.
 *
 * Diagnostics are checked by substring rather than by exact JSON, so that
 * adding a field to the document does not break every test here.
 */

#include "../include/basic.h"
#include "test.h"

#include <stdlib.h>

/** Validate and hand back the JSON, which the caller frees. */
static char *validate(const char *src, BAS_Status *status_out) {
  char *json = NULL;
  BAS_Status s = BAS_Validate(src, &json);
  if (status_out) *status_out = s;
  return json;
}

static int contains(const char *haystack, const char *needle) {
  return haystack && strstr(haystack, needle) != NULL;
}

int main(void) {
  {
    TEST("a valid program yields no diagnostics");
    BAS_Status s;
    char *json = validate("10 K0 = 2.3\n20 PRINT K0\n30 END\n", &s);
    CHECK_INT(s, BAS_OK);
    CHECK(contains(json, "\"diagnostics\":[]"));
    BAS_FreeString(json);
  }

  {
    /* The whole point of a separate entry point: an infinite loop must not
       hang the editor.  This program never terminates if executed. */
    TEST("validation does not execute the program");
    BAS_Status s;
    char *json = validate("10 T = T + 1\n20 GOTO 10\n", &s);
    CHECK_INT(s, BAS_OK);
    CHECK(contains(json, "\"diagnostics\":[]"));
    BAS_FreeString(json);
  }

  {
    TEST("a program with an error still validates successfully");
    BAS_Status s;
    char *json = validate("10 K0 = = 2.3\n", &s);
    CHECK_INT(s, BAS_OK);          /* the validation worked */
    CHECK(contains(json, "\"severity\":\"error\""));  /* the program did not */
    BAS_FreeString(json);
  }

  {
    /* The single most common real error in a transcribed listing: a jump to a
       line that was mistyped or dropped in transcription.  It is invisible
       until the branch is taken, which may be thousands of steps in. */
    TEST("GOTO to a line that does not exist is reported, with its line");
    char *json = validate("10 PRINT 1\n20 GOTO 999\n", NULL);
    CHECK(contains(json, "undefined line 999"));
    CHECK(contains(json, "\"startLineNumber\":2"));
    BAS_FreeString(json);
  }

  {
    TEST("GOSUB to a line that does not exist is reported too");
    char *json = validate("10 GOSUB 500\n20 END\n", NULL);
    CHECK(contains(json, "undefined line 500"));
    BAS_FreeString(json);
  }

  {
    TEST("a jump to a line that does exist is not reported");
    char *json = validate("10 PRINT 1\n20 GOTO 10\n", NULL);
    CHECK(contains(json, "\"diagnostics\":[]"));
    BAS_FreeString(json);
  }

  {
    TEST("NEXT without FOR is reported");
    char *json = validate("10 NEXT I\n", NULL);
    CHECK(contains(json, "NEXT without FOR"));
    BAS_FreeString(json);
  }

  {
    TEST("FOR without NEXT is reported");
    char *json = validate("10 FOR I = 1 TO 10\n20 END\n", NULL);
    CHECK(contains(json, "FOR without NEXT"));
    BAS_FreeString(json);
  }

  {
    TEST("a matched FOR and NEXT is not reported");
    char *json = validate("10 FOR I = 1 TO 10\n20 PRINT I\n30 NEXT I\n", NULL);
    CHECK(contains(json, "\"diagnostics\":[]"));
    BAS_FreeString(json);
  }

  {
    /* Duplicate line numbers make a listing ambiguous: a GOTO to one of them
       has two possible targets, and which one runs is an implementation
       detail nobody should have to know. */
    TEST("a duplicate line number is reported");
    char *json = validate("10 PRINT 1\n10 PRINT 2\n", NULL);
    CHECK(contains(json, "duplicate line number 10"));
    BAS_FreeString(json);
  }

  {
    /* A word in basic-language.ts's PLANNED list is BASIC, it is just not
       implemented.  "not supported yet" is a better error than "syntax", and
       the distinction is what tells a contributor whether to fix their
       listing or to open an issue. */
    TEST("a planned-but-unimplemented statement says so, rather than 'syntax'");
    char *json = validate("10 WHILE X < 5\n20 WEND\n", NULL);
    CHECK(contains(json, "not supported yet"));
    CHECK(!contains(json, "syntax"));
    BAS_FreeString(json);
  }

  {
    TEST("an unterminated string is reported at its own line and column");
    char *json = validate("10 PRINT 1\n20 PRINT \"oops\n", NULL);
    CHECK(contains(json, "unterminated string"));
    CHECK(contains(json, "\"startLineNumber\":2"));
    BAS_FreeString(json);
  }

  {
    /* More than one problem, because an editor that reports only the first
       makes the user recompile to find the second. */
    TEST("several errors are all reported");
    char *json = validate("10 GOTO 111\n20 GOTO 222\n", NULL);
    CHECK(contains(json, "undefined line 111"));
    CHECK(contains(json, "undefined line 222"));
    BAS_FreeString(json);
  }

  {
    TEST("columns are 1-based and endColumn is exclusive, as Monaco means them");
    char *json = validate("10 GOTO 999\n", NULL);
    CHECK(contains(json, "\"startColumn\":4"));
    CHECK(contains(json, "\"endColumn\":12"));
    BAS_FreeString(json);
  }

  {
    TEST("an empty source is valid, not an error");
    BAS_Status s;
    char *json = validate("", &s);
    CHECK_INT(s, BAS_OK);
    CHECK(contains(json, "\"diagnostics\":[]"));
    BAS_FreeString(json);
  }

  {
    TEST("a NULL source is an argument error, not a crash");
    char *json = NULL;
    CHECK_INT(BAS_Validate(NULL, &json), BAS_ERR_ARGUMENT);
    BAS_FreeString(json);
  }

  {
    /* table3.bas is the listing the whole attestation is built on.  If the
       validator reports anything about it, the validator is wrong. */
    TEST("the archive's central listing validates clean");
    const char *src =
      "2 REM IBM PC\n"
      "4 CLS\n"
      "5 SCREEN 1,0: COLOR 0,0\n"
      "6 LINE (0,0)-(319,180),3,B\n"
      "7 LINE (0,50) -(320,50),3\n"
      "10 K0 = 2.3\n"
      "25 K2 = .033\n"
      "49 K8= .01\n"
      "200 R = I0 / (1 + K0 * N*A +K1)\n"
      "250 A = A + DA * DT\n"
      "255 IF A <.001 THEN A= .001\n"
      "310  PSET (T / T0,180 - N / N0),1\n"
      "400  IF T / T0 < 320 GOTO 200\n";
    BAS_Status s;
    char *json = validate(src, &s);
    CHECK_INT(s, BAS_OK);
    CHECK(contains(json, "\"diagnostics\":[]"));
    BAS_FreeString(json);
  }

  TEST_REPORT();
}
