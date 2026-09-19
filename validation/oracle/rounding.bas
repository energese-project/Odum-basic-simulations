10 REM Where PSET puts a coordinate half-way between two pixels, beside CINT.
20 REM The screen is read back with POINT, then printed in text mode for -o.
30 DIM X(3), PX(3), PY(3)
40 SCREEN 1: CLS
50 FOR I = 0 TO 3
60 X(I) = I + .5
70 PSET (X(I), 20 * I + 10), 3
80 PSET (20, 20 * I + X(I) + 100), 3
90 PX(I) = -1: PY(I) = -1
100 FOR C = 0 TO 5
110 IF POINT(C, 20 * I + 10) = 3 THEN PX(I) = C
120 IF POINT(20, 20 * I + 100 + C) = 3 THEN PY(I) = C
130 NEXT C
140 NEXT I
150 SCREEN 0: WIDTH 80
160 FOR I = 0 TO 3: PRINT X(I); PX(I); PY(I); CINT(X(I)): NEXT I
