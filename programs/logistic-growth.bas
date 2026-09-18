10 REM Logistic Growth
20 REM Autocatalytic growth against a limiting source, drawn down as it is used.
30 REM
40 REM Q grows on the product of itself and the remaining source S, which is what
50 REM makes the curve S-shaped rather than exponential: early on S is plentiful
60 REM and growth compounds, later S is the constraint and growth stalls. The
70 REM depreciation term K2*Q is what sets the plateau below the total source.
80 REM
90 LET ST = 1000
100 LET Q = 10
110 LET K1 = 0.0004
120 LET K2 = 0.02
130 LET DT = 0.5
140 PRINT "T", "Q", "SOURCE"
150 FOR T = 0 TO 200 STEP DT
160 LET S = ST - Q
170 LET G = K1 * Q * S
180 LET D = K2 * Q
190 PRINT T, Q, S
200 LET Q = Q + (G - D) * DT
210 NEXT T
220 END
