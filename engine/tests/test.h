/**
 * The smallest test harness that reports usefully: a counter, a macro that
 * prints the failing expression with its file and line, and a main that exits
 * non-zero if anything failed.  No framework, because a test binary that needs
 * a package manager to run is one more thing to outlive.
 */

#ifndef BASIC_TEST_H
#define BASIC_TEST_H

#include <stdio.h>
#include <string.h>

static int bas_tests_run = 0;
static int bas_tests_failed = 0;
static const char *bas_current_test = "";

#define TEST(name)                                                             \
  bas_current_test = name;                                                     \
  bas_tests_run++;

#define CHECK(cond)                                                            \
  do {                                                                         \
    if (!(cond)) {                                                             \
      bas_tests_failed++;                                                      \
      printf("  FAIL  %s\n        %s:%d: %s\n", bas_current_test, __FILE__,    \
             __LINE__, #cond);                                                 \
    }                                                                          \
  } while (0)

#define CHECK_INT(actual, expected)                                            \
  do {                                                                         \
    long a_ = (long)(actual), e_ = (long)(expected);                           \
    if (a_ != e_) {                                                            \
      bas_tests_failed++;                                                      \
      printf("  FAIL  %s\n        %s:%d: %s was %ld, expected %ld\n",          \
             bas_current_test, __FILE__, __LINE__, #actual, a_, e_);           \
    }                                                                          \
  } while (0)

#define CHECK_STR(actual, expected)                                            \
  do {                                                                         \
    const char *a_ = (actual), *e_ = (expected);                               \
    if (a_ == NULL || strcmp(a_, e_) != 0) {                                   \
      bas_tests_failed++;                                                      \
      printf("  FAIL  %s\n        %s:%d: %s was \"%s\", expected \"%s\"\n",    \
             bas_current_test, __FILE__, __LINE__, #actual,                    \
             a_ ? a_ : "(null)", e_);                                          \
    }                                                                          \
  } while (0)

#define TEST_REPORT()                                                          \
  do {                                                                         \
    printf("%s: %d checked, %d failed\n",                                      \
           bas_tests_failed ? "FAILED" : "ok", bas_tests_run,                  \
           bas_tests_failed);                                                  \
    return bas_tests_failed ? 1 : 0;                                           \
  } while (0)

#endif /* BASIC_TEST_H */
