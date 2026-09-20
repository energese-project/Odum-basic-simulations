/**
 * The arithmetic contract.  This is the file that decides whether the engine
 * agrees with the machines the listings were written for, so it is checked at
 * compile time rather than assumed.
 *
 * The originals computed in single precision.  GW-BASIC held numbers in
 * Microsoft Binary Format, which is not IEEE 754 — but it carries the same 24
 * bits of mantissa, and every MBF single inside IEEE single's exponent range is
 * exactly representable as one (see validation/oracle/mbf.ts).  So `float` is
 * the right type: within the range these models occupy, an MBF single and an
 * IEEE single denote the same number, and the exponent range only matters at
 * magnitudes no coefficient in the archive comes near.  MBF has no subnormals
 * and no infinities, so a program that reaches either has already left the
 * region where the two agree; BAS_ERR_RUNTIME is the honest answer there, and
 * the engine checks for it rather than quietly producing a number GW-BASIC
 * could not have held.
 *
 * The trap is not the type but the evaluation.  C permits intermediate results
 * to be computed wider than their operands — FLT_EVAL_METHOD 1 evaluates float
 * in double, 2 in long double, which is what x87 does by default.  GW-BASIC
 * rounded to single after every operation.  So on a machine that evaluates
 * wide, `A = A + DA * DT` rounds once at the assignment where the original
 * rounded three times, and the run drifts from the oracle in the last bits.
 *
 * That is exactly the difference the attestation already measures as R4a
 * against R4b (validation/oracle/single-precision.ts): rounding on assignment
 * only, against rounding after every operation.  The oracle says R4b is the
 * one that matches.  So the engine requires FLT_EVAL_METHOD == 0 and refuses
 * to build without it, because the alternative is a binary that looks correct,
 * passes its own tests, and disagrees with PC-BASIC in the last bit — and
 * disagrees differently between the native CLI and the wasm build, which is
 * the worst version of the bug.
 *
 * Contraction is the same hazard by another route: `-ffp-contract` lets a
 * compiler fuse a multiply and an add into one operation with a single
 * rounding.  The build passes -ffp-contract=off; this file cannot check that
 * portably, so the arithmetic tests carry a case that fusing would change.
 */

#ifndef BASIC_CONFIG_H
#define BASIC_CONFIG_H

#include <float.h>

/** The type every BASIC numeric value is held and computed in. */
typedef float BAS_Real;

/**
 * Refuse to build where intermediates are evaluated wider than BAS_Real.
 *
 * On x86-64 the SSE default is already 0.  On 32-bit x86 with x87 it is 2, and
 * the fix is -msse2 -mfpmath=sse rather than a change here.  Emscripten is 0.
 * If a future target cannot offer 0, the answer is an explicit rounding step
 * after every operation, not relaxing this.
 */
#if defined(FLT_EVAL_METHOD) && FLT_EVAL_METHOD != 0
#error "FLT_EVAL_METHOD must be 0: see the note in basic_config.h. Build with -msse2 -mfpmath=sse on 32-bit x86."
#endif

/**
 * One BASIC operation, rounded to single as the original rounded it.
 *
 * With FLT_EVAL_METHOD 0 this is what the arithmetic does anyway, and the
 * macro is documentation.  It is written out so that the evaluator reads as a
 * sequence of single-precision operations rather than relying on the reader
 * knowing the contract, and so there is one place to change if a target ever
 * has to emulate the rounding instead of getting it from the hardware.
 */
#define BAS_ROUND(x) ((BAS_Real)(x))

#endif /* BASIC_CONFIG_H */
