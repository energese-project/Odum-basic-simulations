10 REM How GW-BASIC lays out PRINT, so the engine can be written against the
20 REM machine rather than against a recollection of it. Each line below is a
30 REM case the archive's listings actually produce.
40 REM
50 REM `-o` writes the 80-column text screen, so a wide row wraps. Every case
60 REM here is kept well inside 80 columns, and a marker ends each line so the
70 REM row boundaries survive being read back as a stream. The width is left at
80 REM its default, so this runs unaltered in both engines and can be compared.
90 REM --- the sign and trailing space of a number, semicolon-separated -------
100 PRINT 1; 2; 3; "|"
110 PRINT -1; -2; -3; "|"
120 PRINT 0.5; -0.5; "|"
130 REM --- no leading zero, and how many digits survive ----------------------
140 PRINT 1/3; "|"
150 PRINT 2/3; "|"
160 PRINT 1/300000; "|"
170 PRINT 123456789; "|"
180 PRINT 0.00001; "|"
190 PRINT 0.0001; "|"
200 REM --- an integer that is really a float, and a whole-numbered one -------
210 PRINT 10/2; "|"
220 PRINT 100; "|"
230 REM --- the comma, which moves to the next print zone --------------------
240 PRINT 1, 2, 3, "|"
250 PRINT "A", "B", "C", "|"
260 PRINT "T", "Q", "OUTFLOW", "|"
270 PRINT -1, -2, "|"
280 REM --- a string and a number together, as a labelled result -------------
290 PRINT "STEADY STATE J/K1 ="; 1000; "|"
300 PRINT "LABEL", 42, "|"
310 REM --- a trailing separator holds the line open; the next PRINT continues
320 PRINT 7;
330 PRINT 8; "|"
340 PRINT 9,
350 PRINT 10; "|"
360 REM --- a bare PRINT is a blank line --------------------------------------
370 PRINT "BEFORE"; "|"
380 PRINT
390 PRINT "AFTER"; "|"
