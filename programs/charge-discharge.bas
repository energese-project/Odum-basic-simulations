10 REM Charge And Discharge
20 REM One tank filled at a constant rate and drained in proportion to storage.
30 REM
40 REM The first mini-model in the systems-ecology sequence: a storage Q fed by
50 REM a constant inflow J and drained by an outflow K1*Q. Q climbs towards the
60 REM steady state J/K1, fast at first and then ever more slowly, because the
70 REM drain grows with what is stored. Euler integration, DT small enough that
80 REM the step error stays invisible at this scale.
90 REM
100 LET J = 100
110 LET K1 = 0.1
120 LET Q = 0
130 LET DT = 0.5
140 PRINT "T", "Q", "OUTFLOW"
150 FOR T = 0 TO 60 STEP DT
160 LET F = K1 * Q
170 PRINT T, Q, F
180 LET Q = Q + (J - F) * DT
190 NEXT T
200 PRINT
210 PRINT "STEADY STATE J/K1 ="; J / K1
220 END
