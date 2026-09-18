10 REM Two Tanks In Series
20 REM A storage draining into a second storage, which drains to the outside.
30 REM
40 REM Q1 is charged by a constant inflow and drains into Q2; Q2 drains away.
50 REM Q2 lags Q1 and peaks later, which is the point of plotting both on one
60 REM pair of axes rather than reading two columns of figures.
70 REM
80 LET J = 50
90 LET K1 = 0.15
100 LET K2 = 0.05
110 LET Q1 = 0
120 LET Q2 = 0
130 LET DT = 0.25
140 PRINT "T", "Q1", "Q2"
150 FOR T = 0 TO 80 STEP DT
160 LET F1 = K1 * Q1
170 LET F2 = K2 * Q2
180 PRINT T, Q1, Q2
190 LET Q1 = Q1 + (J - F1) * DT
200 LET Q2 = Q2 + (F1 - F2) * DT
210 IF T > 40 THEN LET J = 0
220 NEXT T
230 PRINT
240 PRINT "INFLOW CUT OFF AT T=40"
250 END
